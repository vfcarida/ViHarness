/**
 * Telemetry & Observability Domain Types.
 *
 * Pluggable, vendor-agnostic telemetry primitives:
 * - Trace & Span
 * - AgentMetrics (task count, success/failure rate, iterations, termination reasons)
 * - ModelMetrics (provider, model, input/output tokens, latency, cost, retries, failures)
 * - ContextMetrics (context size, compressed size, compression ratio, retrievals, omitted objects, latency)
 * - ToolMetrics (execution time, success/failure rate, total calls)
 * - VerificationMetrics (pass rate, regression rate, flaky rate, total verifications)
 */
import type { TraceId, TaskId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Tracing Primitives
// ---------------------------------------------------------------------------

export interface Span {
  readonly id: string;
  readonly traceId: TraceId;
  readonly name: string;
  readonly parentId?: string;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly durationMs?: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly status: 'OK' | 'ERROR';
}

export interface Trace {
  readonly id: TraceId;
  readonly taskId: TaskId;
  readonly spans: ReadonlyArray<Span>;
  readonly startTime: Date;
  readonly endTime?: Date;
  readonly status: 'OK' | 'ERROR';
}

// ---------------------------------------------------------------------------
// Telemetry Metrics Structures
// ---------------------------------------------------------------------------

export interface AgentMetrics {
  readonly taskCount: number;
  readonly successRate: number;
  readonly failureRate: number;
  readonly averageIterations: number;
  readonly terminationReasons: Readonly<Record<string, number>>;
}

export interface ModelMetrics {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly cost: number;
  readonly retries: number;
  readonly failures: number;
}

export interface ContextMetrics {
  readonly contextSize: number;
  readonly compressedSize: number;
  readonly compressionRatio: number;
  readonly retrievalCount: number;
  readonly omittedObjects: number;
  readonly compilerLatencyMs: number;
}

export interface ToolMetrics {
  readonly totalCalls: number;
  readonly executionTimeMs: number;
  readonly successRate: number;
  readonly failureRate: number;
}

export interface VerificationMetrics {
  readonly totalVerifications: number;
  readonly passRate: number;
  readonly regressionRate: number;
  readonly flakyRate: number;
}

export interface AggregatedTelemetry {
  readonly agent: AgentMetrics;
  readonly models: ReadonlyArray<ModelMetrics>;
  readonly context: ContextMetrics;
  readonly tool: ToolMetrics;
  readonly verification: VerificationMetrics;
  readonly totalCostUSD: number;
}

// ---------------------------------------------------------------------------
// Evolution Plane Telemetry Events
// ---------------------------------------------------------------------------

export const EvolutionEventType = Object.freeze({
  EvolutionStarted: 'EvolutionStarted',
  CandidateProposed: 'CandidateProposed',
  CandidateRejectedByRegularizer: 'CandidateRejectedByRegularizer',
  ProbeStarted: 'ProbeStarted',
  ProbeCompleted: 'ProbeCompleted',
  ContrastComputed: 'ContrastComputed',
  CandidateComposed: 'CandidateComposed',
  CandidateSelected: 'CandidateSelected',
  AdmissionStarted: 'AdmissionStarted',
  AdmissionPassed: 'AdmissionPassed',
  AdmissionFailed: 'AdmissionFailed',
  HarnessPromoted: 'HarnessPromoted',
  HarnessRolledBack: 'HarnessRolledBack',
  LibraryEntryAdded: 'LibraryEntryAdded',
  LibraryEntryInvalidated: 'LibraryEntryInvalidated',
  EvolutionBudgetExceeded: 'EvolutionBudgetExceeded',
} as const);

export type EvolutionEventType =
  (typeof EvolutionEventType)[keyof typeof EvolutionEventType];

export interface EvolutionTelemetryEvent {
  readonly eventType: EvolutionEventType;
  readonly traceId: TraceId;
  readonly evolutionRunId: string;
  readonly timestamp: string;
  readonly manifestId?: string;
  readonly candidateId?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

