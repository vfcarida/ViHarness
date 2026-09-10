/**
 * Tool Execution Layer Domain Types.
 *
 * Defines tool categories (READ, WRITE, EXECUTE, DESTRUCTIVE), risk levels,
 * tool metadata, execution context, calls, and results.
 */
import type { ToolCallId, TaskId, IterationId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Tool Categories & Risk Levels
// ---------------------------------------------------------------------------

export enum ToolCategory {
  READ = 'READ',
  WRITE = 'WRITE',
  EXECUTE = 'EXECUTE',
  COMMAND = 'COMMAND',
  DESTRUCTIVE = 'DESTRUCTIVE',
}

export enum ToolRiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// ---------------------------------------------------------------------------
// Tool Input & Definition
// ---------------------------------------------------------------------------

export type FilesystemScope = 'workspace' | 'read-only' | 'system' | 'none';

export type ToolInput = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  /** Unique tool name (e.g. 'read_file', 'run_command'). */
  readonly name: string;

  /** Semantic version of the tool (e.g. '1.0.0'). */
  readonly version: string;

  /** Human-readable description of tool capabilities. */
  readonly description: string;

  /** Tool category (READ, WRITE, EXECUTE, DESTRUCTIVE). */
  readonly category: ToolCategory;

  /** Risk level for policy evaluation. */
  readonly riskLevel: ToolRiskLevel;

  /** Whether execution modifies persistent state/files. */
  readonly mutating: boolean;

  /** Whether execution is irreversible (e.g., deletion, push). */
  readonly irreversible?: boolean;

  /** Whether tool requires external network access. */
  readonly requiresNetwork?: boolean;

  /** Filesystem access scope ('workspace' | 'read-only' | 'system' | 'none'). */
  readonly filesystemScope?: FilesystemScope;

  /** Whether multiple calls with identical input produce identical effects. */
  readonly idempotent: boolean;

  /** Default execution timeout in milliseconds. */
  readonly defaultTimeoutMs: number;

  /** Concurrency safety classifier (from DSH). Only true opts into parallel execution. */
  readonly isConcurrencySafe?: (args: unknown) => boolean;

  /** Cooperative timeout budget in milliseconds. */
  readonly timeoutMs?: number;

  /** Permissions required to invoke this tool (e.g. ['fs:read', 'cmd:exec']). */
  readonly requiredPermissions: ReadonlyArray<string>;

  /** JSON Schema describing expected input parameters. */
  readonly inputSchema: Readonly<Record<string, unknown>>;

  /** Alias / complement for inputSchema. */
  readonly parameters?: Readonly<Record<string, unknown>>;

  /** Optional JSON Schema describing output structure. */
  readonly outputSchema?: Readonly<Record<string, unknown>>;

  /** Optional direct executor function for DSL tools. */
  readonly execute?: (args: any, context?: any) => Promise<any> | any;
}

// ---------------------------------------------------------------------------
// Tool Call & Context
// ---------------------------------------------------------------------------

export interface ToolCall {
  readonly id: ToolCallId;
  readonly name: string;
  readonly input: ToolInput;
}

export interface ToolExecutionContext {
  readonly correlationId: string;
  readonly taskId?: TaskId;
  readonly iterationId?: IterationId;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tool Result
// ---------------------------------------------------------------------------

export interface ToolResult {
  readonly toolCallId: ToolCallId;
  readonly name: string;
  readonly output: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
