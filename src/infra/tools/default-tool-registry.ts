/**
 * Default Tool Registry.
 *
 * Implements ToolRegistry:
 * - Registration validation (schema, metadata completeness)
 * - Category lookup
 * - JSON schema input validation
 */
import type { Tool } from '../../core/interfaces/tool.js';
import type { ToolRegistry, ValidationResult } from '../../core/interfaces/tool-registry.js';
import type {
  ToolCategory,
  ToolInput,
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from '../../core/model/tool-types.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(toolOrDef: Tool | ToolDefinition): void {
    const isTool = 'definition' in toolOrDef && (toolOrDef as Tool).definition !== undefined;
    const toolDef = isTool ? (toolOrDef as Tool).definition : (toolOrDef as ToolDefinition);
    const tool: Tool = isTool
      ? (toolOrDef as Tool)
      : {
          definition: toolDef,
          execute: async (input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> => {
            const rawArgs = (input as Record<string, unknown>) ?? {};
            if (typeof toolDef.execute === 'function') {
              return toolDef.execute(rawArgs, context);
            }
            throw new HarnessError({
              code: ErrorCode.TOOL_EXECUTION_FAILED,
              category: ErrorCategory.TOOL,
              message: `Tool [${toolDef.name}] has no execute method.`,
            });
          },
        };

    if (!tool.definition || !tool.definition.name) {
      throw new HarnessError({
        code: ErrorCode.TOOL_NOT_FOUND,
        category: ErrorCategory.TOOL,
        message: 'Invalid tool definition: missing name.',
      });
    }

    const name = tool.definition.name;
    if (!tool.definition.inputSchema) {
      throw new HarnessError({
        code: ErrorCode.TOOL_INVALID_INPUT,
        category: ErrorCategory.TOOL,
        message: `Tool [${name}] missing inputSchema.`,
      });
    }

    this.tools.set(name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(category?: ToolCategory): ReadonlyArray<Tool> {
    const all = Array.from(this.tools.values());
    if (!category) return all;
    return all.filter((t) => t.definition.category === category);
  }

  validateInput(name: string, input: ToolInput): ValidationResult {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        valid: false,
        errors: [`Tool not found in registry: ${name}`],
      };
    }

    const schema = tool.definition.inputSchema;
    const errors: string[] = [];

    // Required fields check
    const required = schema['required'] as string[] | undefined;
    if (required && Array.isArray(required)) {
      for (const field of required) {
        if (input[field] === undefined || input[field] === null) {
          errors.push(`Missing required parameter: '${field}'`);
        }
      }
    }

    // Basic property type checks
    const properties = schema['properties'] as Record<string, { type?: string }> | undefined;
    if (properties && typeof properties === 'object') {
      for (const [propName, propDef] of Object.entries(properties)) {
        const val = input[propName];
        if (val !== undefined && propDef.type) {
          const actualType = typeof val;
          if (propDef.type === 'string' && actualType !== 'string') {
            errors.push(`Parameter '${propName}' expected string, received ${actualType}`);
          } else if (propDef.type === 'number' && actualType !== 'number') {
            errors.push(`Parameter '${propName}' expected number, received ${actualType}`);
          } else if (propDef.type === 'boolean' && actualType !== 'boolean') {
            errors.push(`Parameter '${propName}' expected boolean, received ${actualType}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
