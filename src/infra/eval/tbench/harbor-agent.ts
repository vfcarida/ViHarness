/**
 * Harbor Agent Adapter for Vi-Harness.
 *
 * Implements Harbor's BaseAgent / BaseInstalledAgent interface, enabling Vi-Harness
 * to be invoked directly by the Harbor evaluation framework.
 *
 * Reference: https://github.com/laude-institute/harbor
 */
import type { TBenchTask, DockerEnvironment, Container } from './types.js';
import { TBenchTaskLoader } from './task-loader.js';
import { TerminalTool } from '../../tools/terminal-tool.js';
import { DefaultToolRegistry } from '../../tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../tools/default-tool-executor.js';
import type { AgentRuntime } from '../../../core/interfaces/agent-runtime.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import type { Clock } from '../../../core/interfaces/clock.js';
import type { ExecutionOptions } from '../../../core/model/runtime-types.js';

export interface TerminalConnection {
  readonly execute: (
    command: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ViHarnessHarborAgentOptions {
  readonly runtime: AgentRuntime;
  readonly idFactory: IdFactory;
  readonly clock?: Clock;
  readonly dockerEnv?: DockerEnvironment;
}

export class ViHarnessHarborAgent {
  public readonly runtime: AgentRuntime;
  private readonly idFactory: IdFactory;
  private readonly dockerEnv?: DockerEnvironment;

  constructor(options: ViHarnessHarborAgentOptions) {
    this.runtime = options.runtime;
    this.idFactory = options.idFactory;
    this.dockerEnv = options.dockerEnv;
  }

  /**
   * Invoked by Harbor or TBench runner with task instruction and container/terminal connection.
   */
  async run(
    task: TBenchTask,
    containerOrConnection: Container | TerminalConnection,
    options?: Partial<ExecutionOptions>,
  ): Promise<{ success: boolean; tokens: number; cost: number; durationMs: number }> {
    const goal = TBenchTaskLoader.mapTaskToGoal(task, this.idFactory);

    // Build terminal tool
    let terminalTool;
    if ('status' in containerOrConnection && this.dockerEnv) {
      terminalTool = new TerminalTool({
        dockerEnv: this.dockerEnv,
        container: containerOrConnection,
        idFactory: this.idFactory,
      });
    } else {
      const conn = containerOrConnection as TerminalConnection;
      terminalTool = {
        definition: {
          name: 'terminal',
          version: '1.0.0',
          description: 'Execute shell command in Harbor terminal connection.',
          category: 'COMMAND' as any,
          riskLevel: 'MEDIUM' as any,
          mutating: true,
          idempotent: false,
          defaultTimeoutMs: 60000,
          requiredPermissions: [],
          inputSchema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
        execute: async (input: Record<string, unknown>, ctx: any) => {
          const cmd = String(input['command'] ?? '');
          const callId = (ctx?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;
          const start = Date.now();
          const res = await conn.execute(cmd);
          return {
            toolCallId: callId,
            name: 'terminal',
            output: res.stdout || res.stderr || `Exit code ${res.exitCode}`,
            success: res.exitCode === 0,
            durationMs: Date.now() - start,
          };
        },
      };
    }

    const registry = new DefaultToolRegistry();
    registry.register(terminalTool);

    const toolExecutor = new DefaultToolExecutor({
      registry,
      idFactory: this.idFactory,
    });

    const executionOptions: ExecutionOptions = {
      ...options,
      toolExecutor,
      architectMode: options?.architectMode ?? false,
    };

    const result = await this.runtime.execute(goal, executionOptions);

    return {
      success: result.success,
      tokens: result.totalTokens,
      cost: result.totalCostDollars,
      durationMs: result.durationMs,
    };
  }
}
