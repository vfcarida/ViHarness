/**
 * Tool interface.
 *
 * Represents a single executable tool available to the agent harness.
 */
import type {
  ToolInput,
  ToolResult,
  ToolDefinition,
  ToolExecutionContext,
} from '../model/tool-types.js';

export interface Tool {
  /** The tool's definition (metadata, category, risk level, schemas). */
  readonly definition: ToolDefinition;

  /** Execute the tool with validated input and runtime execution context. */
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult>;
}
