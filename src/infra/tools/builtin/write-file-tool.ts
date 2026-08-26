/**
 * Write File Built-in Tool.
 *
 * "Application-level validation: path canonicalization, symlink inspection, and secret write denial."
 */
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import type { Tool } from '../../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import { PathValidator } from '../../security/path-validator.js';

export class WriteFileTool implements Tool {
  public readonly definition = {
    name: 'write_file',
    version: '1.0.0',
    description: 'Write or update content of a target file within workspace boundaries',
    category: ToolCategory.WRITE,
    riskLevel: ToolRiskLevel.MEDIUM,
    mutating: true,
    idempotent: false,
    defaultTimeoutMs: 10000,
    requiredPermissions: ['fs:write'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Target file path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  };

  constructor(private readonly idFactory: IdFactory) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(input['path'] ?? '');
    const content = String(input['content'] ?? '');

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

    if (resolvedPath) {
      try {
        fs.mkdirSync(nodePath.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, content, 'utf-8');
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
            errorCode: 'FS_WRITE_ERROR',
            correlationId: context.correlationId,
          },
        };
      }
    }

    return {
      toolCallId: this.idFactory.create<'ToolCall'>(),
      name: this.definition.name,
      output: `Successfully wrote ${content.length} bytes to ${rawPath}`,
      success: true,
      durationMs: Date.now() - startTime,
      metadata: {
        path: rawPath,
        resolvedPath,
        bytesWritten: content.length,
        correlationId: context.correlationId,
      },
    };
  }
}
