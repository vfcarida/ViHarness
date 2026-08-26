/**
 * Terminal Tool for Vi-Harness.
 *
 * Wraps Docker / Container execution as a first-class Vi-Harness tool for TBench.
 */
import type { Tool } from '../../core/interfaces/tool.js';
import {
  ToolCategory,
  ToolRiskLevel,
  type ToolResult,
  type ToolExecutionContext,
} from '../../core/model/tool-types.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type { DockerEnvironment, Container } from '../eval/tbench/types.js';

export interface TerminalToolOptions {
  readonly dockerEnv: DockerEnvironment;
  readonly container: Container;
  readonly idFactory: IdFactory;
}

export class TerminalTool implements Tool {
  public readonly definition = {
    name: 'terminal',
    version: '1.0.0',
    description: 'Execute a shell command inside the task container or terminal sandbox.',
    category: ToolCategory.COMMAND,
    riskLevel: ToolRiskLevel.MEDIUM,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 60000,
    requiredPermissions: [],
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute in the terminal environment.',
        },
      },
      required: ['command'],
    },
  };

  private readonly dockerEnv: DockerEnvironment;
  private readonly container: Container;
  private readonly idFactory: IdFactory;

  constructor(options: TerminalToolOptions) {
    this.dockerEnv = options.dockerEnv;
    this.container = options.container;
    this.idFactory = options.idFactory;
  }

  async execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const cmd = String(input['command'] ?? '');
    const callId = (context?.correlationId ?? this.idFactory.create<'ToolCall'>()) as any;

    if (!cmd.trim()) {
      return {
        toolCallId: callId,
        name: 'terminal',
        output: 'Error: Empty command provided.',
        success: false,
        durationMs: 0,
        error: 'Empty command provided.',
      };
    }

    try {
      const result = await this.dockerEnv.exec(this.container, cmd);
      const isSuccess = result.exitCode === 0;

      const outputText = [
        result.stdout ? result.stdout : '',
        result.stderr ? `[STDERR]: ${result.stderr}` : '',
        `[Exit Code: ${result.exitCode}]`,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        toolCallId: callId,
        name: 'terminal',
        output: outputText || '(no output)',
        success: isSuccess,
        durationMs: result.duration,
        error: isSuccess
          ? undefined
          : result.stderr || `Command exited with code ${result.exitCode}`,
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          command: cmd,
        },
      };
    } catch (err: any) {
      return {
        toolCallId: callId,
        name: 'terminal',
        output: `Execution error: ${err.message}`,
        success: false,
        durationMs: 0,
        error: err.message,
      };
    }
  }
}
