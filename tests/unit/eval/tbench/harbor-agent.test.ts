/**
 * Harbor Agent Adapter Unit Tests (P011).
 */
import { describe, it, expect } from 'vitest';
import {
  ViHarnessHarborAgent,
  MockDockerEnvironment,
  type TBenchTask,
  type TerminalConnection,
} from '../../../../src/infra/eval/tbench/index.js';
import { DefaultAgentRuntime } from '../../../../src/runtime/index.js';
import { DefaultContextCompiler } from '../../../../src/infra/compiler/default-context-compiler.js';
import { DefaultToolRegistry } from '../../../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../../../src/infra/tools/default-tool-executor.js';
import { ScriptedModelProvider } from '../../../../src/infra/model/scripted-model-provider.js';
import { UuidV7IdFactory } from '../../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../../src/infra/time/test-clock.js';
import {
  FinishReason,
  ProviderHealthStatus,
  type ModelRouter,
} from '../../../../src/core/index.js';

describe('Harbor Agent Adapter — P011', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const sampleTask: TBenchTask = {
    id: 'harbor-sample-task',
    instruction: 'Create data.json with { status: "ready" }',
    category: 'software-engineering',
    difficulty: 'easy',
    tags: ['harbor'],
    timeout: 60,
    testScript: 'exit 0',
  };

  it('1. should execute Harbor task through simulated TerminalConnection', async () => {
    let commandExecuted = '';
    const mockConnection: TerminalConnection = {
      execute: async (cmd: string) => {
        commandExecuted = cmd;
        return { stdout: 'OK', stderr: '', exitCode: 0 };
      },
    };

    const provider = new ScriptedModelProvider({
      providerId: 'test-provider',
      steps: [
        {
          content: 'Executing terminal command via Harbor.',
          toolCalls: [{ id: 'call-1', name: 'terminal', input: { command: 'echo hello' } }],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Task finished.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'claude-opus-4-1',
        scores: [],
        rationale: 'Harbor Route',
        decidedAt: clock.now(),
        deterministic: true,
      }),
      listAvailableModels: () => [],
      getProviderHealth: () => ProviderHealthStatus.HEALTHY,
      updateMetrics: () => {},
      hasCapability: () => true,
    };

    const toolRegistry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const agent = new ViHarnessHarborAgent({ runtime, idFactory, clock });
    const result = await agent.run(sampleTask, mockConnection);

    expect(result.success).toBe(true);
    expect(commandExecuted).toBe('echo hello');
  });

  it('2. should execute Harbor task using container with DockerEnvironment', async () => {
    const dockerEnv = new MockDockerEnvironment();
    const container = await dockerEnv.create(sampleTask);

    const provider = new ScriptedModelProvider({
      providerId: 'test-provider',
      steps: [
        {
          content: 'Writing file in container.',
          toolCalls: [
            {
              id: 'call-2',
              name: 'terminal',
              input: {
                command:
                  "node -e \"const fs = require('fs'); fs.writeFileSync('data.json', 'ok');\"",
              },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'File created.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'claude-opus-4-1',
        scores: [],
        rationale: 'Harbor Route',
        decidedAt: clock.now(),
        deterministic: true,
      }),
      listAvailableModels: () => [],
      getProviderHealth: () => ProviderHealthStatus.HEALTHY,
      updateMetrics: () => {},
      hasCapability: () => true,
    };

    const toolRegistry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const agent = new ViHarnessHarborAgent({ runtime, idFactory, clock, dockerEnv });
    const result = await agent.run(sampleTask, container);

    expect(result.success).toBe(true);

    // Verify file written in container workspace
    const execRes = await dockerEnv.exec(
      container,
      "node -e \"const fs = require('fs'); if (!fs.existsSync('data.json')) process.exit(1); console.log('FOUND');\"",
    );
    expect(execRes.exitCode).toBe(0);
    expect(execRes.stdout).toContain('FOUND');

    await dockerEnv.destroy(container);
  });
});
