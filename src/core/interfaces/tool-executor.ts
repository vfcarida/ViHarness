/**
 * ToolExecutor interface.
 *
 * Orchestrates tool execution with policy checks, schema validation, command normalization,
 * timeout enforcement, and cancellation.
 */
import type { Tool } from './tool.js';
import type {
  ToolCategory,
  ToolInput,
  ToolResult,
  ToolExecutionContext,
} from '../model/tool-types.js';

export interface ToolExecutionRequest {
  readonly toolName?: string;
  readonly tool?: Tool;
  readonly input: ToolInput;
  readonly context?: Partial<ToolExecutionContext>;
  readonly requiresPolicy?: boolean;
}

export interface ToolExecutor {
  /** Execute a tool with policy enforcement, timeout, and cancellation context. */
  execute(request: ToolExecutionRequest): Promise<ToolResult>;

  /** Register a tool in the executor's registry. */
  register(tool: Tool): void;

  /** Look up a registered tool by name. */
  getTool(name: string): Tool | undefined;

  /** List all registered tools (optionally filtered by category). */
  listTools(category?: ToolCategory): ReadonlyArray<Tool>;
}
