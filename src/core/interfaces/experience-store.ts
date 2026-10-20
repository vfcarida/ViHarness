/**
 * Experience Store Domain Interface.
 *
 * Defines the port for outer-loop execution trace and tuning history persistence,
 * keeping src/core/ independent of src/infra/.
 */
import type { IterationTraceRecord } from '../model/trace-types.js';
import type { ExecutionResult } from '../model/runtime-types.js';

export type RecommendationType =
  | 'THRESHOLD_ADJUSTMENT'
  | 'COMPACTION_TUNING'
  | 'ROUTING_CHANGE'
  | 'TOOL_OPTIMIZATION'
  | 'POLICY_ADJUSTMENT';

export interface HarnessRecommendation {
  readonly type: RecommendationType;
  readonly parameter: string;
  readonly currentValue: unknown;
  readonly suggestedValue: unknown;
  readonly evidence: ReadonlyArray<string>;
  readonly confidence: number;
  readonly rationale: string;
  readonly code?: string;
  readonly priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly description?: string;
  readonly actionablePatchSuggestion?: string;
}

export interface RunIndexEntry {
  readonly runId: string;
  readonly goalId?: string;
  readonly taskId?: string;
  readonly goalDescription: string;
  readonly timestamp: string;
  readonly success: boolean;
  readonly status: string;
  readonly totalTokens: number;
  readonly totalCostDollars: number;
  readonly iterationCount: number;
  readonly finalPhase: string;
  readonly durationMs: number;
  readonly runDir: string;
}

export interface RunRecord {
  readonly indexEntry: RunIndexEntry;
  readonly harnessConfig: Record<string, unknown>;
  readonly traces: ReadonlyArray<IterationTraceRecord>;
  readonly scores: Record<string, unknown>;
  readonly summaryMarkdown: string;
}

export interface RecordRunParams {
  readonly runId: string;
  readonly goalId?: string;
  readonly taskId?: string;
  readonly goalDescription: string;
  readonly executionResult: ExecutionResult;
  readonly harnessConfig: Record<string, unknown>;
  readonly traceRecords?: ReadonlyArray<IterationTraceRecord>;
  readonly summaryMarkdown?: string;
}

export interface RunTraceData {
  readonly runId: string;
  readonly goalDescription: string;
  readonly success: boolean;
  readonly finalPhase: string;
  readonly durationMs: number;
  readonly harnessConfig: Record<string, unknown>;
  readonly traces: ReadonlyArray<IterationTraceRecord>;
  readonly scores: Record<string, unknown>;
}

export interface AutoTuneDecision {
  readonly decisionId: string;
  readonly timestamp: string;
  readonly recommendation: HarnessRecommendation;
  readonly applied: boolean;
  readonly previousConfig: Record<string, unknown>;
  readonly updatedConfig: Record<string, unknown>;
}

export interface ExperienceStore {
  readonly baseDir: string;
  recordRun(params: RecordRunParams): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(limit?: number): Promise<ReadonlyArray<RunIndexEntry>>;
  getRecentTraces(lastN?: number): Promise<ReadonlyArray<RunTraceData>>;
  logTuningDecision(decision: AutoTuneDecision): Promise<void>;
  getTuningHistory(): Promise<ReadonlyArray<AutoTuneDecision>>;
}
