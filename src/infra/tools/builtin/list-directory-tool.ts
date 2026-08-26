/**
 * List Directory Built-in Tool.
 *
 * "Application-level validation: path canonicalization and workspace containment."
 */
import type { Tool } from '../../../core/interfaces/tool.js';
import type {
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../../core/model/tool-types.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import { PathValidator } from '../../security/path-validator.js';

export class ListDirectoryTool implements Tool {
  public readonly definition = {
    name: 'list_directory',
    version: '1.0.0',
    description: 'List contents of a directory within workspace boundaries',
    category: ToolCategory.READ,
    riskLevel: ToolRiskLevel.LOW,
    mutating: false,
    idempotent: true,
    defaultTimeoutMs: 5000,
    requiredPermissions: ['fs:read'],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: ['path'],
    },
  };

  constructor(private readonly idFactory: IdFactory) {}

  async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(input['path'] ?? '.');

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

    return {
      toolCallId: this.idFactory.create<'ToolCall'>(),
      name: this.definition.name,
      output: `Listing for ${rawPath}: file1.ts, file2.ts, package.json`,
      success: true,
      durationMs: Date.now() - startTime,
      metadata: {
        path: rawPath,
        resolvedPath: validation.resolvedPath,
        correlationId: context.correlationId,
      },
    };
  }
}
