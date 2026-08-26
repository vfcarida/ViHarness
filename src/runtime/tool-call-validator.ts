/**
 * Canonical Tool Call Validator.
 *
 * Validates tool calls emitted by the model against the ToolRegistry schema.
 * Formats malformed calls into structured ERROR feedback allowing the model
 * to self-correct without crashing the harness loop.
 */
import type { ToolCall } from '../core/model/model-io.js';
import type { ToolRegistry } from '../core/interfaces/tool-registry.js';
import type { Tool } from '../core/interfaces/tool.js';

export interface ToolCallValidationResult {
  readonly valid: boolean;
  readonly toolName: string;
  readonly tool?: Tool;
  readonly isUnknownTool: boolean;
  readonly sanitizedInput: Record<string, unknown>;
  readonly error?: string;
  readonly modelFeedbackMessage?: string;
}

export class ToolCallValidator {
  /**
   * Validate a ToolCall against the tool registry definition and schema.
   */
  static validate(toolCall: ToolCall, toolRegistry?: ToolRegistry): ToolCallValidationResult {
    const rawName = (toolCall.name ?? '').trim();
    if (!rawName) {
      const errorMsg = 'Tool call missing name field.';
      return {
        valid: false,
        toolName: '',
        isUnknownTool: true,
        sanitizedInput: {},
        error: errorMsg,
        modelFeedbackMessage: `ERROR: Tool call is missing the tool name. Available tools: ${
          toolRegistry
            ? toolRegistry
                .listTools()
                .map((t) => t.definition.name)
                .join(', ')
            : 'none'
        }.`,
      };
    }

    if (!toolRegistry) {
      // Without registry, accept call as raw
      return {
        valid: true,
        toolName: rawName,
        isUnknownTool: false,
        sanitizedInput: (toolCall.input as Record<string, unknown>) ?? {},
      };
    }

    const tool = toolRegistry.getTool(rawName) ?? toolRegistry.getTool(rawName.toLowerCase());
    if (!tool) {
      const availableTools = toolRegistry
        .listTools()
        .map((t) => t.definition.name)
        .join(', ');
      const errorMsg = `UNKNOWN_TOOL: Tool [${rawName}] is not registered in ToolRegistry`;
      return {
        valid: false,
        toolName: rawName,
        isUnknownTool: true,
        sanitizedInput: (toolCall.input as Record<string, unknown>) ?? {},
        error: errorMsg,
        modelFeedbackMessage: `ERROR: UNKNOWN_TOOL. Tool [${rawName}] does not exist. Available registered tools: [${availableTools}]. Please call an existing tool with valid parameters.`,
      };
    }

    const rawInput = (toolCall.input as Record<string, unknown>) ?? {};

    // Validate parameters against JSON Schema
    const schemaValidation = toolRegistry.validateInput(tool.definition.name, rawInput);
    if (!schemaValidation.valid) {
      const issues = (schemaValidation.errors ?? []).join('; ');
      const errorMsg = `TOOL_INVALID_INPUT: Tool [${tool.definition.name}] parameter validation failed: ${issues}`;
      const schemaHint = JSON.stringify(tool.definition.inputSchema ?? {});
      return {
        valid: false,
        toolName: tool.definition.name,
        tool,
        isUnknownTool: false,
        sanitizedInput: rawInput,
        error: errorMsg,
        modelFeedbackMessage: `ERROR: Invalid parameters for tool [${tool.definition.name}]: ${issues}. Expected schema: ${schemaHint}. Please correct the parameters and retry.`,
      };
    }

    return {
      valid: true,
      toolName: tool.definition.name,
      tool,
      isUnknownTool: false,
      sanitizedInput: rawInput,
    };
  }

  /**
   * Validate a batch of tool calls.
   */
  static validateBatch(
    toolCalls: ReadonlyArray<ToolCall>,
    toolRegistry?: ToolRegistry,
  ): ReadonlyArray<ToolCallValidationResult> {
    return toolCalls.map((tc) => this.validate(tc, toolRegistry));
  }
}
