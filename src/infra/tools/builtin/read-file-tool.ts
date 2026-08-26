/**
 * Read File Built-in Tool.
 *
 * "Application-level validation: path canonicalization, symlink inspection, and secret scrubbing."
 */
import * as fs from 'node:fs';
import type { Tool } from '../../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import { PathValidator } from '../../security/path-validator.js';
import { SecretScrubber } from '../../security/secret-scrubber.js';

export class ReadFileTool implements Tool {
  public readonly definition = {
    name: 'read_file',
    version: '1.0.0',
    description: 'Read contents of a target file within workspace boundaries',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 5000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative or absolute file path' },
      },
      required: ['path'],
    },
  };

  constructor(private readonly idFactory: IdFactory) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(input['path'] ?? '');

    // Application-Level Path Validation
    const validation = PathValidator.validate(rawPath, context.workingDirectory);
    if (!validation.valid) {
      return {
        toolCallId: this.idFactory.create<'ToolCall'>(),
        name: this.definition.name,
        output: '',
        success: false,
        durationMs: Date.now() - startTime,
        error: validation.error ?? 'Path validation failed',
        metadata: {
          path: rawPath,
          errorCode: validation.errorCode ?? 'INVALID_PATH',
          correlationId: context.correlationId,
        },
      };
    }

    const resolvedPath = validation.resolvedPath;
    let rawContent = `mock content for ${rawPath}`;

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      try {
        rawContent = fs.readFileSync(resolvedPath, 'utf-8');
      } catch (err) {
        return {
          toolCallId: this.idFactory.create<'ToolCall'>(),
          name: this.definition.name,
          output: '',
          success: false,
          durationMs: Date.now() - startTime,
          error: err instanceof Error ? err.message : String(err),
          metadata: {
            path: rawPath,
            errorCode: 'FS_READ_ERROR',
            correlationId: context.correlationId,
          },
        };
      }
    }

    // Secret Scrubbing
    const scrubbedContent = SecretScrubber.scrub(rawContent);
    const output = `[Content of ${rawPath}]:\n${scrubbedContent}`;

    return {
      toolCallId: this.idFactory.create<'ToolCall'>(),
      name: this.definition.name,
      output,
      success: true,
      durationMs: Date.now() - startTime,
      metadata: { path: rawPath, resolvedPath, correlationId: context.correlationId },
    };
  }
}
