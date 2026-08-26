import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultSubagentManager,
  DefaultToolExecutor,
  DefaultToolRegistry,
  ReadFileTool,
  WriteFileTool,
  DefaultEvidenceStore,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { SubagentRole } from '../../../src/core/index.js';
import type { SubagentSpec } from '../../../src/core/index.js';

describe('Subagent Manager', () => {
  let manager: DefaultSubagentManager;
  let toolExecutor: DefaultToolExecutor;
  let registry: DefaultToolRegistry;
  let evidenceStore: DefaultEvidenceStore;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    evidenceStore = new DefaultEvidenceStore();

    registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    toolExecutor = new DefaultToolExecutor({ registry, idFactory });

    manager = new DefaultSubagentManager({
      idFactory,
      clock,
      toolExecutor,
      evidenceStore,
    });
  });

  it('should spawn subagent with isolated context and return summary, artifacts, and evidence (no full transcript)', async () => {
    const spec: SubagentSpec = {
      role: SubagentRole.EXPLORE,
      description: 'Explore auth module',
      scope: { workingDirectory: 'src/auth', filePaths: ['src/auth/login.ts'] },
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 5,
      timeoutMs: 10000,
    };

    const result = await manager.spawn(spec);

    expect(result.success).toBe(true);
    expect(result.role).toBe(SubagentRole.EXPLORE);
    expect(result.summary).toContain('completed task successfully');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.type).toBe('report');
    expect(result.decisions).toBeDefined();
    // Verify transcript is NOT present in result
    expect((result as any).transcript).toBeUndefined();
  });

  it('should execute subagents sequentially in array order', async () => {
    const spec1: SubagentSpec = {
      role: SubagentRole.EXPLORE,
      description: 'Explore codebase',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const spec2: SubagentSpec = {
      role: SubagentRole.CODER,
      description: 'Implement refactor',
      scope: {},
      allowedTools: ['write_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const results = await manager.executeSequential([spec1, spec2]);

    expect(results).toHaveLength(2);
    expect(results[0]!.role).toBe(SubagentRole.EXPLORE);
    expect(results[1]!.role).toBe(SubagentRole.CODER);
  });

  it('should execute subagents in parallel concurrently', async () => {
    const spec1: SubagentSpec = {
      role: SubagentRole.TESTER,
      description: 'Run unit tests',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const spec2: SubagentSpec = {
      role: SubagentRole.REVIEWER,
      description: 'Review pull request',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const results = await manager.executeParallel([spec1, spec2]);

    expect(results).toHaveLength(2);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(true);
  });

  it('should execute dependent subagent DAG respecting declared dependencies', async () => {
    const id1 = idFactory.create<'Subagent'>();
    const id2 = idFactory.create<'Subagent'>();

    const spec1: SubagentSpec = {
      id: id1,
      role: SubagentRole.EXPLORE,
      description: 'Step 1: Explore',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const spec2: SubagentSpec = {
      id: id2,
      role: SubagentRole.CODER,
      description: 'Step 2: Code after explore',
      scope: {},
      allowedTools: ['write_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
      dependencies: [id1],
    };

    const results = await manager.executeDependentGraph([spec1, spec2]);

    expect(results).toHaveLength(2);
    expect(results[0]!.subagentId).toBe(id1);
    expect(results[1]!.subagentId).toBe(id2);
  });

  it('should enforce Failure Isolation: subagent failure does NOT throw or corrupt parent state', async () => {
    const failingSpec: SubagentSpec = {
      role: SubagentRole.CODER,
      description: 'Failing coder subagent',
      scope: {},
      allowedTools: ['unregistered_tool_name'], // Will fail tool validation
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    // Subagent spawn must NOT throw error to parent
    const result = await manager.spawn(failingSpec);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('failed');
    expect(result.error).toBeDefined();
    expect(result.unresolvedIssues).toHaveLength(1);
    expect(result.evidence[0]!.pass).toBe(false);
  });

  it('should enforce subagent execution timeout', async () => {
    const slowSpec: SubagentSpec = {
      role: SubagentRole.TESTER,
      description: 'Very slow subagent',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 1, // 1ms timeout
    };

    const result = await manager.spawn(slowSpec);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('should support parent cancellation upfront and cancelAll', async () => {
    const controller = new AbortController();
    controller.abort();

    const spec: SubagentSpec = {
      role: SubagentRole.REVIEWER,
      description: 'Cancelled review',
      scope: {},
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const result = await manager.spawn(spec, controller.signal);
    expect(result.success).toBe(false);
    expect(result.unresolvedIssues[0]).toContain('cancelled');

    // Test cancelAll
    await manager.cancelAll('Parent execution aborted');
  });
});
