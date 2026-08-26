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
import { DefaultContextCompiler } from '../../src/infra/compiler/default-context-compiler.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { ScriptedModelProvider } from '../../src/infra/model/scripted-model-provider.js';
import { MockModelProvider } from '../../src/infra/model/mock-model-provider.js';
import { FailingModelProvider } from '../../src/infra/model/failing-model-provider.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import {
  FinishReason,
  MessageRole,
  ProviderHealthStatus,
  ModelCapability,
} from '../../src/core/model/model-io.js';
import { AgentPhase } from '../../src/core/model/state.js';
import type {
  VerificationEngine,
  VerificationRequest,
  VerificationResult,
} from '../../src/core/interfaces/verification-engine.js';
import type { Goal } from '../../src/core/model/goal.js';
import { GoalStatus } from '../../src/core/model/goal.js';

describe('Error Handling & Resilient Recovery Integration Suite', { timeout: 30000 }, () => {
  it('Caso 1: Unknown tool invocation returns structured error to model and allows recovery on next turn', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-err-unknown-tool-'));
    const dummyFile = path.join(tempDir, 'valid.txt');
    fs.writeFileSync(dummyFile, 'Valid Content', 'utf-8');

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine();
    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    let receivedStructuredError = false;

    const scriptedSteps = [
      // Turn 1: Model requests unknown tool
      {
        content: 'I will call a non-existent tool.',
        toolCalls: [
          { name: 'unregistered_search_tool', input: { query: 'search terms' }, id: 'c_unknown' },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Turn 2: Inspect context for error feedback and call valid tool
      (request: any) => {
        const toolMsg = request.messages.find(
          (m: any) =>
            (m.role === MessageRole.TOOL ||
              m.role === MessageRole.TOOL_RESULT ||
              m.role === 'TOOL' ||
              m.role === 'TOOL_RESULT') &&
            (m.content.includes('UNKNOWN_TOOL') ||
              m.content.includes('unregistered_search_tool') ||
              m.content.includes('not found') ||
              m.content.includes('not registered')),
        );
        if (toolMsg) {
          receivedStructuredError = true;
        }

        return {
          content: 'I noticed the tool was not registered. Falling back to read_file.',
          toolCalls: [{ name: 'read_file', input: { path: dummyFile }, id: 'c_valid' }],
          finishReason: FinishReason.TOOL_CALL,
        };
      },
      // Turn 3: Complete
      {
        content: 'Task completed successfully after recovery.',
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
      description: 'Test unknown tool recovery',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 5, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(receivedStructuredError).toBe(true);
    expect(result.success).toBe(true);
    expect(result.iterationCount).toBe(3);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Caso 2: Primary model unavailable/offline (503/fail) triggers automatic router failover to healthy model', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();

    // 1. Primary failing provider
    const failingProvider = new FailingModelProvider({
      providerId: 'primary-offline-provider',
      failAlways: true,
      errorToThrow: new Error('HTTP 503 Service Unavailable: upstream connection refused'),
      descriptor: {
        id: 'primary-failing-model',
        name: 'Primary Model (Failing)',
        providerId: 'primary-offline-provider',
        version: '1.0',
        capabilities: {
          capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
          maxContextTokens: 64000,
          maxOutputTokens: 2048,
          supportsSystemPrompt: true,
        },
        costPer1kInputTokensDollars: 0.001,
        costPer1kOutputTokensDollars: 0.002,
      },
    });

    // 2. Healthy backup provider
    const healthyBackupProvider = new MockModelProvider({
      providerId: 'backup-healthy-provider',
      defaultResponseText: 'Backup provider handled request successfully.',
      descriptor: {
        id: 'backup-model',
        name: 'Backup Model (Healthy)',
        providerId: 'backup-healthy-provider',
        version: '1.0',
        capabilities: {
          capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
          maxContextTokens: 64000,
          maxOutputTokens: 2048,
          supportsSystemPrompt: true,
        },
        costPer1kInputTokensDollars: 0.002,
        costPer1kOutputTokensDollars: 0.004,
      },
    });

    const router = new UtilityModelRouter();
    router.registerProvider(failingProvider);
    router.registerProvider(healthyBackupProvider);

    // Initial health check marks primary as degraded
    const healthResult = await failingProvider.getHealth();
    expect(healthResult.status).toBe(ProviderHealthStatus.DEGRADED);

    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const evidenceStore = new DefaultEvidenceStore();

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      evidenceStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Execute under model outage',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 3, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(result.success).toBe(true);
  });

  it('Caso 3: Policy Violation blocks forbidden action and feeds denial reason back to model', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-err-policy-'));
    const safeFile = path.join(tempDir, 'safe.ts');
    fs.writeFileSync(safeFile, 'export const safe = true;', 'utf-8');

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new RunCommandTool(idFactory));

    const policyEngine = new DefaultPolicyEngine({
      rules: [new CommandRestrictionRule(), new PathRestrictionRule()],
      idFactory,
      clock,
    });

    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    let policyDenialReceived = false;

    const scriptedSteps = [
      // Turn 1: Model proposes dangerous command (rm -rf /)
      {
        content: 'I will clean up files using rm -rf /',
        toolCalls: [{ name: 'run_command', input: { command: 'rm -rf /' }, id: 'c_bad_cmd' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Turn 2: Inspect message to ensure policy rejection was received, then propose safe read
      (request: any) => {
        const toolMsg = request.messages.find(
          (m: any) =>
            (m.role === MessageRole.TOOL ||
              m.role === MessageRole.TOOL_RESULT ||
              m.role === 'TOOL' ||
              m.role === 'TOOL_RESULT') &&
            (m.content.includes('DENY') ||
              m.content.includes('Forbidden') ||
              m.content.includes('policy') ||
              m.content.includes('sanitizer')),
        );
        if (toolMsg) {
          policyDenialReceived = true;
        }

        return {
          content: 'Policy denied the dangerous command. Switching to reading safe file.',
          toolCalls: [{ name: 'read_file', input: { path: safeFile }, id: 'c_safe_read' }],
          finishReason: FinishReason.TOOL_CALL,
        };
      },
      // Turn 3: Complete
      {
        content: 'Task completed safely.',
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
      description: 'Test policy violation rejection and model recovery',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 5, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(policyDenialReceived).toBe(true);
    expect(result.success).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Caso 4: Missing verification prevents completion when requireVerification is true', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();

    // Verification engine that always returns FAILED verification
    const verificationEngine: VerificationEngine = {
      async verify(_req: VerificationRequest): Promise<VerificationResult> {
        return {
          status: 'FAILED',
          summary: 'Unit test suite failed: 2 tests failing in calculations',
          durationMs: 15,
          confidence: 0.95,
          affectedFiles: ['src/calc.ts'],
        };
      },
    };

    const scriptedSteps = [
      // Model tries to finish immediately without valid passing verification
      {
        content: 'I believe I am done without running tests.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
      {
        content: 'Still attempting to stop.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
      {
        content: 'Stopping.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
    ];

    const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const evidenceStore = new DefaultEvidenceStore();

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      verificationEngine,
      evidenceStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Test verification required constraint',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 3,
        maxRepairAttempts: 2,
        requireVerification: true,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    // Because verification is required but failed, the runtime terminates without success or transitions to REPAIR
    expect(result.success).toBe(false);
  });
});
