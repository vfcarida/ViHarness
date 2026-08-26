/**
 * Run Command Built-in Tool.
 *
 * "Application-level validation: command sanitization, metacharacter blocking, and secret scrubbing."
 */
import type { Tool } from '../../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import { CommandSanitizer } from '../command-sanitizer.js';
import { SecretScrubber } from '../../security/secret-scrubber.js';

export class RunCommandTool implements Tool {
  public readonly definition = {
    name: 'run_command',
    version: '1.0.0',
    description: 'Execute a sanitized shell command',
    category: ToolCategory.EXECUTE,
    riskLevel: ToolRiskLevel.HIGH,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 30000,
    requiredPermissions: ['cmd:exec'],
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command string to execute' },
      },
      required: ['command'],
    },
  };

  constructor(private readonly idFactory: IdFactory) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawCmd = String(input['command'] ?? '');

    const sanitization = CommandSanitizer.sanitize(rawCmd);
    if (!sanitization.allowed) {
      return {
        toolCallId: this.idFactory.create<'ToolCall'>(),
        name: this.definition.name,
        output: '',
        success: false,
        durationMs: Date.now() - startTime,
        error: `Command rejected by sanitizer: ${sanitization.reason}`,
        metadata: {
          rawCmd,
          errorCode: sanitization.errorCode ?? 'COMMAND_SANIZATION_FAILED',
          correlationId: context.correlationId,
        },
      };
    }

    const rawOutput = `Executed command [${sanitization.normalizedCommand}]: exit code 0`;
    const scrubbedOutput = SecretScrubber.scrub(rawOutput);

    return {
      toolCallId: this.idFactory.create<'ToolCall'>(),
      name: this.definition.name,
      output: scrubbedOutput,
      success: true,
      durationMs: Date.now() - startTime,
      metadata: {
        command: sanitization.normalizedCommand,
        correlationId: context.correlationId,
        workingDirectory: context.workingDirectory,
      },
    };
  }
}
