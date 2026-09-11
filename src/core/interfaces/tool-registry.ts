/**
 * ToolRegistry interface.
 *
 * Registry for managing registered agent tools, validating tool input schemas,
 * and querying tools by category or risk level.
 */
import type { Tool } from './tool.js';
import type { ToolCategory, ToolInput, ToolDefinition } from '../model/tool-types.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: ReadonlyArray<string>;
}

export interface ToolRegistry {
  /** Register a tool or tool definition in the registry. Throws if invalid or duplicate. */
  register(tool: Tool | ToolDefinition): void;

  /** Unregister a tool by name. Returns true if removed. */
  unregister(name: string): boolean;

  /** Look up a tool by name. */
  getTool(name: string): Tool | undefined;

  /** List tools (optionally filtered by category). */
  listTools(category?: ToolCategory): ReadonlyArray<Tool>;

  /** Validate input arguments against a tool's JSON schema. */
  validateInput(name: string, input: ToolInput): ValidationResult;
}
