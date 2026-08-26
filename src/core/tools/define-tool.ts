// Pattern: Typed Tool Schema DSL (ref: DeepSeek Harness)
/**
 * Typed Tool Definition DSL.
 *
 * Allows declaration of tools with inferred parameter types, JSON schema generation,
 * output rendering, concurrency classifiers, and cooperative timeouts.
 */
import type { ToolDefinition, ToolResult } from '../model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../model/tool-types.js';
import type { ToolCallId } from '../types/identifiers.js';

export interface ParameterField {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly required?: boolean;
  readonly enum?: ReadonlyArray<string>;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly properties?: Record<string, ParameterField>;
}

export type InferParamType<T extends Record<string, ParameterField>> = {
  [K in keyof T]: T[K]['required'] extends true
    ? T[K]['type'] extends 'string'
      ? string
      : T[K]['type'] extends 'number' | 'integer'
        ? number
        : T[K]['type'] extends 'boolean'
          ? boolean
          : any
    : T[K]['type'] extends 'string'
      ? string | undefined
      : T[K]['type'] extends 'number' | 'integer'
        ? number | undefined
        : T[K]['type'] extends 'boolean'
          ? boolean | undefined
          : any;
};

export interface OutputRenderer<TParams, TOutput> {
  readonly schema?: Record<string, unknown>;
  render?(args: TParams, value: TOutput): Array<{ type: string; text: string }>;
}

export interface DefineToolOptions<
  TParamsDef extends Record<string, ParameterField>,
  TOutput = unknown,
> {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly category?: ToolCategory;
  readonly riskLevel?: ToolRiskLevel;
  readonly mutating?: boolean;
  readonly parameters: TParamsDef;
  readonly output?: OutputRenderer<InferParamType<TParamsDef>, TOutput>;
  readonly isConcurrencySafe?: (args: InferParamType<TParamsDef>) => boolean;
  readonly timeoutMs?: number;
  execute(args: InferParamType<TParamsDef>, context?: any): Promise<TOutput> | TOutput;
}

export function defineTool<TParamsDef extends Record<string, ParameterField>, TOutput = unknown>(
  options: DefineToolOptions<TParamsDef, TOutput>,
): ToolDefinition {
  // Convert parameter field definitions to standard JSON Schema
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(options.parameters)) {
    const propDef: Record<string, unknown> = {
      type: field.type,
    };
    if (field.description) propDef.description = field.description;
    if (field.enum) propDef.enum = [...field.enum];
    if (field.default !== undefined) propDef.default = field.default;
    if (field.minimum !== undefined) propDef.minimum = field.minimum;
    if (field.maximum !== undefined) propDef.maximum = field.maximum;

    properties[key] = propDef;

    if (field.required === true) {
      required.push(key);
    }
  }

  const jsonSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  return {
    name: options.name,
    version: options.version || '1.0.0',
    description: options.description,
    category: options.category || ToolCategory.EXECUTE,
    riskLevel: options.riskLevel || ToolRiskLevel.LOW,
    mutating: options.mutating ?? false,
    idempotent: true,
    defaultTimeoutMs: options.timeoutMs || 30000,
    requiredPermissions: [],
    inputSchema: jsonSchema,
    parameters: jsonSchema,
    isConcurrencySafe: options.isConcurrencySafe
      ? (args: unknown) => options.isConcurrencySafe!(args as InferParamType<TParamsDef>)
      : undefined,
    timeoutMs: options.timeoutMs,
    execute: async (rawArgs: Record<string, unknown>, execContext?: any): Promise<ToolResult> => {
      const start = Date.now();
      const callId = (execContext?.callId || execContext?.correlationId || 'call-0') as ToolCallId;

      try {
        const typedArgs = rawArgs as InferParamType<TParamsDef>;
        const output = await Promise.resolve(options.execute(typedArgs, execContext));

        let formattedOutput: string;
        if (typeof output === 'string') {
          formattedOutput = output;
        } else if (output && typeof output === 'object' && 'output' in output) {
          formattedOutput = String((output as any).output);
        } else {
          formattedOutput = JSON.stringify(output, null, 2);
        }

        return {
          toolCallId: callId,
          name: options.name,
          success: true,
          output: formattedOutput,
          durationMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          toolCallId: callId,
          name: options.name,
          success: false,
          output: `Tool execution failed: ${err.message}`,
          durationMs: Date.now() - start,
        };
      }
    },
  };
}
