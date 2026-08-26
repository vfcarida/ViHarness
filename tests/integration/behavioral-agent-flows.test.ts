import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { DefaultAgentRuntime } from '../../src/runtime/default-agent-runtime.js';
import { DefaultToolRegistry } from '../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../src/infra/tools/default-tool-executor.js';
import { ReadFileTool } from '../../src/infra/tools/builtin/read-file-tool.js';
import { WriteFileTool } from '../../src/infra/tools/builtin/write-file-tool.js';
import { RunCommandTool } from '../../src/infra/tools/builtin/run-command-tool.js';
import { DefaultPolicyEngine } from '../../src/infra/security/default-policy-engine.js';
import { PathRestrictionRule } from '../../src/infra/security/rules/path-restriction-rule.js';
import { CommandRestrictionRule } from '../../src/infra/security/rules/command-restriction-rule.js';
import { DefaultEvidenceStore } from '../../src/infra/evidence/default-evidence-store.js';
import { DefaultCheckpointStore } from '../../src/infra/checkpoint/default-checkpoint-store.js';
import { DefaultContextCompiler } from '../../src/infra/compiler/default-context-compiler.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { ScriptedModelProvider } from '../../src/infra/model/scripted-model-provider.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { FinishReason, MessageRole } from '../../src/core/model/model-io.js';
import { AgentPhase } from '../../src/core/model/state.js';
import { EvidenceOutcome } from '../../src/core/model/evidence.js';
import type {
  VerificationEngine,
  VerificationRequest,
  VerificationResult,
} from '../../src/core/interfaces/verification-engine.js';
import type { Goal } from '../../src/core/model/goal.js';
import { GoalStatus } from '../../src/core/model/goal.js';

describe('Realistic Behavioral Agent Workflows Suite', { timeout: 30000 }, () => {
  it('1. Realistic Flow: inspect -> write buggy code -> test fails -> inspect error -> write correct code -> test passes -> verify -> done', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-behavior-edit-'));

    const sourceFile = path.join(tempDir, 'discount.ts');
    const testFile = path.join(tempDir, 'discount.test.ts');

    fs.writeFileSync(
      sourceFile,
      'export function applyDiscount(price: number, discount: number): number { return price; }',
      'utf-8',
    );
    fs.writeFileSync(
      testFile,
      'import { applyDiscount } from "./discount"; // applyDiscount(100, 0.2) should be 80',
      'utf-8',
    );

    // Dynamic Verification Engine validating discount calculation in file
    const verificationEngine: VerificationEngine = {
      async verify(_req: VerificationRequest): Promise<VerificationResult> {
        const content = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf-8') : '';
        const isCorrect =
          content.includes('price * (1 - discount)') ||
          content.includes('price - price * discount') ||
          content.includes('price - (price * discount)');

        return {
          status: isCorrect ? 'PASSED' : 'FAILED',
          summary: isCorrect
            ? 'Verification PASSED: applyDiscount(100, 0.2) === 80'
            : 'Verification FAILED: applyDiscount(100, 0.2) did not equal 80',
          durationMs: 12,
          confidence: 1.0,
          affectedFiles: [sourceFile],
        };
      },
    };

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));
    registry.register(new RunCommandTool(idFactory));

    const policyEngine = new DefaultPolicyEngine({ idFactory, clock });
    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const scriptedSteps = [
      // Step 1: Read source
      {
        content: 'I will read discount.ts to inspect current logic.',
        toolCalls: [{ name: 'read_file', input: { path: sourceFile }, id: 'c1_read_src' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 2: Read test
      {
        content: 'I will read discount.test.ts to inspect expected test contract.',
        toolCalls: [{ name: 'read_file', input: { path: testFile }, id: 'c2_read_test' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 3: Write flawed implementation (simple subtraction instead of percentage)
      {
        content: 'I will write candidate fix: price - discount (flawed formula).',
        toolCalls: [
          {
            name: 'write_file',
            input: {
              path: sourceFile,
              content:
                'export function applyDiscount(price: number, discount: number): number { return price - discount; }',
            },
            id: 'c3_write_flawed',
          },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 4: Run tests (will fail verification)
      {
        content: 'I will run test suite now.',
        toolCalls: [{ name: 'run_command', input: { command: 'npm test' }, id: 'c4_run_tests' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 5: Read source again to review
      {
        content:
          'Tests failed! I need percentage calculation: price * (1 - discount). Reading file again.',
        toolCalls: [{ name: 'read_file', input: { path: sourceFile }, id: 'c5_read_review' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 6: Write correct implementation
      {
        content: 'Writing correct implementation using percentage discount.',
        toolCalls: [
          {
            name: 'write_file',
            input: {
              path: sourceFile,
              content:
                'export function applyDiscount(price: number, discount: number): number { return price * (1 - discount); }',
            },
            id: 'c6_write_fixed',
          },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 7: Run tests again (passes verification)
      {
        content: 'Re-running tests to verify fix.',
        toolCalls: [
          { name: 'run_command', input: { command: 'npm test' }, id: 'c7_run_tests_fixed' },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 8: Finalize
      {
        content: 'All verification checks passed cleanly. Task completed.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
    ];

    const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      policyEngine,
      toolExecutor,
      verificationEngine,
      evidenceStore,
      checkpointStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Fix discount calculation logic in discount.ts',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 10,
        maxRepairAttempts: 3,
        requireVerification: true,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(result.iterationCount).toBe(7);

    // Verify written file content
    const finalContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(finalContent).toContain('price * (1 - discount)');

    // Verify evidence was stored
    const evidenceList = await evidenceStore.listForTask(result.taskId);
    expect(evidenceList.length).toBeGreaterThan(0);
    expect(evidenceList.some((e) => e.outcome === EvidenceOutcome.PASS)).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. Behavioral Flow: Model recovers gracefully when action is blocked by security policy', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-behavior-policy-'));

    const allowedFile = path.join(tempDir, 'allowed_config.json');
    fs.writeFileSync(allowedFile, '{"mode":"prod"}', 'utf-8');

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine({
      rules: [new PathRestrictionRule()],
      idFactory,
      clock,
    });

    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const scriptedSteps = [
      // Step 1: Model tries to write to forbidden .env file
      {
        content: 'I will write API keys to .env',
        toolCalls: [
          {
            name: 'write_file',
            input: { path: path.join(tempDir, '.env'), content: 'API_KEY=secret' },
            id: 'c_forbidden_write',
          },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 2: Model adapts and writes to allowed_config.json
      {
        content: 'Policy denied .env write. I will write to allowed_config.json instead.',
        toolCalls: [
          {
            name: 'write_file',
            input: { path: allowedFile, content: '{"mode":"safe"}' },
            id: 'c_allowed_write',
          },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Step 3: Stop
      {
        content: 'Config written to allowed destination.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
    ];

    const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      policyEngine,
      toolExecutor,
      evidenceStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Update application configuration safely',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 5, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(result.success).toBe(true);

    const updatedConfig = fs.readFileSync(allowedFile, 'utf-8');
    expect(updatedConfig).toBe('{"mode":"safe"}');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('3. Behavioral Flow: Multi-tool concurrent exploration and single-turn synthesis', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-behavior-multi-'));

    const file1 = path.join(tempDir, 'schema.sql');
    const file2 = path.join(tempDir, 'migration.sql');
    fs.writeFileSync(file1, 'CREATE TABLE users (id INT, name VARCHAR);', 'utf-8');
    fs.writeFileSync(file2, 'ALTER TABLE users ADD COLUMN email VARCHAR;', 'utf-8');

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));

    const toolExecutor = new DefaultToolExecutor({ registry, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    let sawBothFiles = false;

    const scriptedSteps = [
      // Turn 1: Propose 2 concurrent reads
      {
        content: 'I will inspect both schema files concurrently.',
        toolCalls: [
          { name: 'read_file', input: { path: file1 }, id: 'c_read_1' },
          { name: 'read_file', input: { path: file2 }, id: 'c_read_2' },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Turn 2: Synthesize findings
      (request: any) => {
        const toolMessages = request.messages.filter(
          (m: any) => m.role === MessageRole.TOOL || m.role === MessageRole.TOOL_RESULT,
        );
        if (toolMessages.length >= 2) {
          sawBothFiles = true;
        }

        return {
          content: 'Both database schema files verified. Migration correctly adds email column.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        };
      },
    ];

    const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      evidenceStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Audit SQL migrations',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 5, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(sawBothFiles).toBe(true);
    expect(result.success).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
