import { describe, it, expect } from 'vitest';
import {
  MicroCompactor,
} from '../../../src/infra/compiler/micro-compactor.js';
import {
  ContextObjectType,
  ContextScope,
  type ContextObject,
} from '../../../src/core/model/context-object.js';
import { ContextTier } from '../../../src/core/model/context.js';
import {
  ActionResultStatus,
  type ActionResult,
} from '../../../src/core/model/action.js';
import type { ContextId } from '../../../src/core/types/identifiers.js';
import { ContextCompressor } from '../../../src/infra/compiler/context-compressor.js';

describe('MicroCompactor (Dynamic Context Pruning & Micro-Compaction)', () => {
  describe('Path & Command Normalization', () => {
    it('normalizes file paths across Windows and POSIX separators', () => {
      expect(MicroCompactor.normalizePath('src\\utils\\math.ts')).toBe('src/utils/math.ts');
      expect(MicroCompactor.normalizePath('src//utils///math.ts')).toBe('src/utils/math.ts');
      expect(MicroCompactor.normalizePath('SRC/UTILS/MATH.TS')).toBe('src/utils/math.ts');
      expect(MicroCompactor.normalizePath('')).toBe('');
    });

    it('normalizes command lines with variable spacing and casing', () => {
      expect(MicroCompactor.normalizeCommand('npm   test   --   --watch=false')).toBe('npm test -- --watch=false');
      expect(MicroCompactor.normalizeCommand('PYTEST   -V  TESTS/')).toBe('pytest -v tests/');
      expect(MicroCompactor.normalizeCommand('')).toBe('');
    });
  });

  describe('ContextObject Graph Compaction', () => {
    const createMockObject = (params: {
      id: string;
      type: ContextObjectType;
      content: string;
      scopeTarget?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      importance?: number;
    }): ContextObject => ({
      id: params.id as ContextId,
      tier: ContextTier.L2_EPISODIC,
      type: params.type,
      content: params.content,
      source: 'test_source',
      timestamp: new Date('2026-03-01T10:00:00Z'),
      importance: params.importance ?? 0.5,
      confidence: 1.0,
      scope: ContextScope.TASK,
      scopeTarget: params.scopeTarget,
      dependencies: [],
      lastUsed: new Date('2026-03-01T10:00:00Z'),
      lastVerified: null,
      costTokens: Math.ceil(params.content.length / 4),
      tags: params.tags ?? [],
      version: 1,
      active: true,
      metadata: params.metadata ?? {},
    });

    it('invalidates stale file reads when a subsequent edit modifies the file', () => {
      const readContent = 'export function calculateTotal() {\n  return 42;\n}\n'.repeat(10); // > 120 chars
      const editContent = 'Modified calculateTotal implementation with discount';

      const readObj = createMockObject({
        id: 'ctx-read-1',
        type: ContextObjectType.FILE,
        content: readContent,
        scopeTarget: 'src/billing.ts',
        tags: ['read_file', 'file_read'],
        metadata: { toolName: 'read_file', filePath: 'src/billing.ts' },
      });

      const unrelatedRead = createMockObject({
        id: 'ctx-read-2',
        type: ContextObjectType.FILE,
        content: 'export const CONFIG = { timeout: 5000 };\n'.repeat(8),
        scopeTarget: 'src/config.ts',
        tags: ['read_file'],
        metadata: { toolName: 'read_file', filePath: 'src/config.ts' },
      });

      const writeObj = createMockObject({
        id: 'ctx-write-3',
        type: ContextObjectType.ARTIFACT,
        content: editContent,
        scopeTarget: 'src/billing.ts',
        tags: ['file_edit', 'edit_file'],
        metadata: { toolName: 'edit_file', filePath: 'src/billing.ts' },
      });

      const compactor = new MicroCompactor();
      const result = compactor.compactContextObjects([readObj, unrelatedRead, writeObj]);

      expect(result.staleReadsCount).toBe(1);
      expect(result.compactedEntries.length).toBe(1);
      expect(result.compactedEntries[0]!.kind).toBe('stale_read');
      expect(result.compactedEntries[0]!.target).toBe('src/billing.ts');

      // The read object is replaced by tombstone
      const compactedRead = result.objects.find((o) => o.id === 'ctx-read-1')!;
      expect(compactedRead.content).toContain("[Stale Read Tombstone: 'src/billing.ts'");
      expect(compactedRead.tags).toContain('stale_read_tombstone');
      expect(compactedRead.costTokens).toBeLessThan(readObj.costTokens);

      // Unrelated read remains untouched
      const untouchedRead = result.objects.find((o) => o.id === 'ctx-read-2')!;
      expect(untouchedRead.content).toBe(unrelatedRead.content);
      expect(untouchedRead.tags).not.toContain('stale_read_tombstone');
    });

    it('compacts resolved command and test failures when followed by a successful run', () => {
      const errorLog = 'AssertionError: expected 42 to equal 43\n    at test_billing.py:54\n    at runner.py:112\n'.repeat(5);

      const failObj = createMockObject({
        id: 'ctx-fail-1',
        type: ContextObjectType.FAILURE,
        content: errorLog,
        tags: ['failure', 'command_failure'],
        metadata: {
          command: 'pytest tests/test_billing.py',
          exitCode: 1,
        },
      });

      const successObj = createMockObject({
        id: 'ctx-succ-2',
        type: ContextObjectType.TEST,
        content: '1 passed in 0.05s',
        tags: ['success', 'command_success'],
        metadata: {
          command: 'pytest tests/test_billing.py',
          exitCode: 0,
        },
      });

      const compactor = new MicroCompactor();
      const result = compactor.compactContextObjects([failObj, successObj]);

      expect(result.resolvedFailuresCount).toBe(1);
      expect(result.compactedEntries[0]!.kind).toBe('resolved_failure');

      const compactedFail = result.objects.find((o) => o.id === 'ctx-fail-1')!;
      expect(compactedFail.content).toContain("[Resolved Failure: command 'pytest tests/test_billing.py'");
      expect(compactedFail.content).toContain('subsequently succeeded');
      expect(compactedFail.tags).toContain('resolved_failure');
      expect(compactedFail.costTokens).toBeLessThan(failObj.costTokens);
    });

    it('preserves unresolved failures intact so the model remembers active errors', () => {
      const errorLog = 'SyntaxError: Unexpected token < in JSON at position 0\n'.repeat(8);

      const failObj = createMockObject({
        id: 'ctx-fail-unresolved',
        type: ContextObjectType.FAILURE,
        content: errorLog,
        tags: ['failure'],
        metadata: {
          command: 'node parse.js',
          exitCode: 1,
        },
      });

      const compactor = new MicroCompactor();
      const result = compactor.compactContextObjects([failObj]);

      expect(result.resolvedFailuresCount).toBe(0);
      const outputFail = result.objects.find((o) => o.id === 'ctx-fail-unresolved')!;
      expect(outputFail.content).toBe(errorLog);
      expect(outputFail.tags).not.toContain('resolved_failure');
    });

    it('NEVER compacts invariant items (user instructions, security rules, decisions, must-preserve)', () => {
      const instructionObj = createMockObject({
        id: 'ctx-instr',
        type: ContextObjectType.USER_INSTRUCTION,
        content: 'Fix the bug in src/billing.ts and ensure all tests pass.\n'.repeat(5),
        scopeTarget: 'src/billing.ts',
        tags: ['must_preserve', 'instruction'],
      });

      const writeObj = createMockObject({
        id: 'ctx-write',
        type: ContextObjectType.ARTIFACT,
        content: 'Modified billing.ts',
        scopeTarget: 'src/billing.ts',
        tags: ['file_write'],
        metadata: { toolName: 'write_file', filePath: 'src/billing.ts' },
      });

      const compactor = new MicroCompactor();
      const result = compactor.compactContextObjects([instructionObj, writeObj]);

      expect(result.staleReadsCount).toBe(0);
      const outputInstr = result.objects.find((o) => o.id === 'ctx-instr')!;
      expect(outputInstr.content).toBe(instructionObj.content);
    });

    it('collapses consecutive redundant observations', () => {
      const gitStatusOutput = 'On branch main\nNothing to commit, working tree clean\n'.repeat(4);

      const obs1 = createMockObject({
        id: 'ctx-obs-1',
        type: ContextObjectType.OBSERVATION,
        content: gitStatusOutput,
        tags: ['tool_output'],
      });

      const obs2 = createMockObject({
        id: 'ctx-obs-2',
        type: ContextObjectType.OBSERVATION,
        content: gitStatusOutput,
        tags: ['tool_output'],
      });

      const compactor = new MicroCompactor();
      const result = compactor.compactContextObjects([obs1, obs2]);

      expect(result.redundantOutputsCount).toBe(1);
      const compactedObs1 = result.objects.find((o) => o.id === 'ctx-obs-1')!;
      expect(compactedObs1.content).toContain('[Micro-Compacted Redundant Output');
      const retainedObs2 = result.objects.find((o) => o.id === 'ctx-obs-2')!;
      expect(retainedObs2.content).toBe(gitStatusOutput);
    });
  });

  describe('Cross-Iteration Tool Result Compactor (createIterationCompactor)', () => {
    it('invalidates stale file reads across iterations', () => {
      const fileContent = 'const a = 1;\nconst b = 2;\n'.repeat(20); // > 120 chars

      const iter1Read: ActionResult = {
        actionId: 'act-1',
        status: ActionResultStatus.SUCCESS,
        output: fileContent,
        metadata: { toolName: 'read_file', path: 'src/models.ts' },
      };

      const iter2Edit: ActionResult = {
        actionId: 'act-2',
        status: ActionResultStatus.SUCCESS,
        output: 'File edited successfully',
        metadata: { toolName: 'edit_file', path: 'src/models.ts' },
      };

      const history = [
        { sequenceNumber: 1, toolResults: [iter1Read] },
        { sequenceNumber: 2, toolResults: [iter2Edit] },
      ];

      const compactor = MicroCompactor.createIterationCompactor(history, 3);

      const result = compactor.compactToolResult({
        iterationSeq: 1,
        actionResult: iter1Read,
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.kind).toBe('stale_read');
      expect(result.output).toContain("[Stale Read Tombstone: 'src/models.ts'");
      expect(result.output).toContain('read in iteration #1, superseded by modifications in iteration #2');
      expect(result.isError).toBe(false);
    });

    it('compacts resolved command failure across iterations while preserving unresolved failure', () => {
      const failOutput = 'FAIL tests/app.test.ts\n  ● render › should match snapshot\n'.repeat(10);
      const succOutput = 'PASS tests/app.test.ts\n  ✓ render › should match snapshot\n';
      const unresolvedFailOutput = 'ERROR: database connection timed out\n'.repeat(8);

      const iter1Fail: ActionResult = {
        actionId: 'act-fail',
        status: ActionResultStatus.FAILURE,
        output: failOutput,
        metadata: { toolName: 'run_command', command: 'npm test', exitCode: 1 },
      };

      const iter1Unresolved: ActionResult = {
        actionId: 'act-unresolved',
        status: ActionResultStatus.FAILURE,
        output: unresolvedFailOutput,
        metadata: { toolName: 'run_command', command: 'npm run db:migrate', exitCode: 2 },
      };

      const iter3Succ: ActionResult = {
        actionId: 'act-succ',
        status: ActionResultStatus.SUCCESS,
        output: succOutput,
        metadata: { toolName: 'run_command', command: 'npm test', exitCode: 0 },
      };

      const history = [
        { sequenceNumber: 1, toolResults: [iter1Fail, iter1Unresolved] },
        { sequenceNumber: 3, toolResults: [iter3Succ] },
      ];

      const compactor = MicroCompactor.createIterationCompactor(history, 4);

      // Iteration 1 npm test was resolved in iteration 3
      const resolvedRes = compactor.compactToolResult({
        iterationSeq: 1,
        actionResult: iter1Fail,
      });
      expect(resolvedRes.wasCompacted).toBe(true);
      expect(resolvedRes.kind).toBe('resolved_failure');
      expect(resolvedRes.output).toContain("[Resolved Failure: command 'npm test' failed in iteration #1");
      expect(resolvedRes.output).toContain('subsequently passed in iteration #3');

      // Iteration 1 db:migrate was NOT resolved -> preserved intact!
      const unresolvedRes = compactor.compactToolResult({
        iterationSeq: 1,
        actionResult: iter1Unresolved,
      });
      expect(unresolvedRes.wasCompacted).toBe(false);
      expect(unresolvedRes.output).toContain('database connection timed out');
    });

    it('falls back to SwePruner for non-stale successful prior reads', () => {
      const oldReadmeOutput = '# Documentation\n'.repeat(40); // > 300 chars for SwePruner

      const iter1Readme: ActionResult = {
        actionId: 'act-readme',
        status: ActionResultStatus.SUCCESS,
        output: oldReadmeOutput,
        metadata: { toolName: 'read_file', path: 'README.md' },
      };

      // README was never modified
      const history = [{ sequenceNumber: 1, toolResults: [iter1Readme] }];
      const compactor = MicroCompactor.createIterationCompactor(history, 4);

      const result = compactor.compactToolResult({
        iterationSeq: 1,
        actionResult: iter1Readme,
      });

      expect(result.wasCompacted).toBe(true);
      expect(result.kind).toBe('age_compacted');
      expect(result.output).toContain('[Compacted read_file of \'README.md\'');
    });
  });

  describe('Integration with ContextCompressor Pipeline', () => {
    it('automatically micro-compacts stale reads before Progressive Multi-Tier Compaction', () => {
      const largeRead = 'function doWork() {\n  return 1;\n}\n'.repeat(20);

      const readObj: ContextObject = {
        id: 'read-1' as ContextId,
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.FILE,
        content: largeRead,
        source: 'compiler',
        timestamp: new Date('2026-03-01T10:00:00Z'),
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        scopeTarget: 'src/worker.ts',
        dependencies: [],
        lastUsed: new Date('2026-03-01T10:00:00Z'),
        lastVerified: null,
        costTokens: Math.ceil(largeRead.length / 4),
        tags: ['read_file'],
        version: 1,
        active: true,
        metadata: { toolName: 'read_file', filePath: 'src/worker.ts' },
      };

      const writeObj: ContextObject = {
        id: 'write-2' as ContextId,
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.ARTIFACT,
        content: 'Updated worker implementation',
        source: 'compiler',
        timestamp: new Date('2026-03-01T10:05:00Z'),
        importance: 0.8,
        confidence: 1.0,
        scope: ContextScope.TASK,
        scopeTarget: 'src/worker.ts',
        dependencies: [],
        lastUsed: new Date('2026-03-01T10:05:00Z'),
        lastVerified: null,
        costTokens: 10,
        tags: ['file_write'],
        version: 1,
        active: true,
        metadata: { toolName: 'write_file', filePath: 'src/worker.ts' },
      };

      const scored = [
        { object: readObj, score: 0.5, mustPreserve: false },
        { object: writeObj, score: 0.8, mustPreserve: false },
      ];

      const result = ContextCompressor.compress(scored, 10000, Date.now(), {
        enableMicroCompactor: true,
      });

      const retainedRead = result.retained.find((o) => o.id === 'read-1')!;
      expect(retainedRead.content).toContain("[Stale Read Tombstone: 'src/worker.ts'");
      expect(retainedRead.costTokens).toBeLessThan(readObj.costTokens);

      const explanation = result.explanations.find((e) => e.id === 'read-1');
      expect(explanation).toBeDefined();
      expect(explanation?.reason).toContain('MICRO-COMPACT Stage: Stale read invalidated');
    });
  });
});
