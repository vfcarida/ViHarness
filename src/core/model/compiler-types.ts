/**
 * Context Compiler Domain Types.
 *
 * "Context is compiled, not accumulated."
 *
 * Defines compilation requests, context budgets, scoring weights,
 * dry-run explanation reports, and metrics for model-aware context compilation.
 */
import type { Goal } from './goal.js';
import type { Task } from './task.js';
import type { AgentState } from './state.js';
import type { Hypothesis } from './hypothesis.js';
import type { Evidence } from './evidence.js';
import type { ContextObject } from './context-object.js';
import type { ModelDescriptor } from './model-io.js';
import type { CompiledContext } from './context.js';
import type { ContextId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Context Budget
// ---------------------------------------------------------------------------

export interface ContextBudget {
  readonly maxTokens: number;
  readonly softLimitTokens: number;
  readonly tierBudgets?: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Scoring Weights
// ---------------------------------------------------------------------------

export interface CompilerScoringWeights {
  readonly importanceWeight: number;
  readonly dependencyWeight: number;
  readonly verificationWeight: number;
  readonly failureRelevanceWeight: number;
  readonly recencyWeight: number;
  readonly tokenCostPenaltyWeight: number;
}

export const DEFAULT_SCORING_WEIGHTS: Readonly<CompilerScoringWeights> = {
  importanceWeight: 0.3,
  dependencyWeight: 0.25,
  verificationWeight: 0.2,
  failureRelevanceWeight: 0.15,
  recencyWeight: 0.1,
  tokenCostPenaltyWeight: 0.05,
};

// ---------------------------------------------------------------------------
// Dry-Run Explanation Types
// ---------------------------------------------------------------------------

export type ItemAction = 'RETAINED' | 'OMITTED' | 'SUMMARIZED' | 'TRIMMED' | 'COLLAPSED';

export interface CompilationItemExplanation {
  readonly id: ContextId | string;
  readonly type: string;
  readonly action: ItemAction;
  readonly score: number;
  readonly tokenCost: number;
  readonly reason: string;
  readonly mustPreserve: boolean;
}

export interface CompilationExplanation {
  readonly items: ReadonlyArray<CompilationItemExplanation>;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// Tool-Result Pruning Types (Deterministic Pre-Compaction)
// ---------------------------------------------------------------------------

export interface ContentBlock {
  readonly type: 'text' | string;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface PrunedEntry {
  readonly id: string;
  readonly originalSize: number;
  readonly prunedSize: number;
  readonly charsRemoved: number;
}

export interface PruneResult {
  readonly pruned: ReadonlyArray<PrunedEntry>;
  readonly charsRemoved: number;
}

export interface ToolResultPruner {
  /** Measure text content in Unicode code points */
  measureContent(blocks: ReadonlyArray<ContentBlock>): number;
  /** Replace over-budget text middle while retaining structure */
  pruneContent(blocks: ReadonlyArray<ContentBlock>, maxCodePoints?: number): ContentBlock[] | null;
  /** Prune all over-budget tool results in one pass */
  pruneSession(items: ReadonlyArray<any>): PruneResult;
}

// ---------------------------------------------------------------------------
// Context Collapse Types (Virtual Read-Time Projection)
// ---------------------------------------------------------------------------

export interface CollapseMetadata {
  readonly headId: string;
  readonly anchorId: string;
  readonly tailId: string;
  readonly collapsedCount: number;
  readonly originalTokens: number;
  readonly collapsedTokens: number;
}

export interface CollapseRecord {
  readonly id: string;
  readonly metadata: CollapseMetadata;
  readonly summary: string;
  readonly originalObjects: ReadonlyArray<ContextObject>;
  readonly createdAt: Date;
}

export interface CollapseStore {
  saveCollapse(record: CollapseRecord): Promise<void> | void;
  getCollapse(id: string): Promise<CollapseRecord | undefined> | CollapseRecord | undefined;
  getAllCollapses(): Promise<ReadonlyArray<CollapseRecord>> | ReadonlyArray<CollapseRecord>;
  clear(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Compaction Lock & Crash Recovery Types
// ---------------------------------------------------------------------------

export interface CompactionLock {
  acquire(sessionId: string): boolean; // false if already locked
  release(sessionId: string, error?: Error): void;
  isOrphaned(sessionId: string): boolean; // detect crash mid-compaction
  recover(sessionId: string): void; // clean up orphaned lock
}

// ---------------------------------------------------------------------------
// Compaction Triggers & Options
// ---------------------------------------------------------------------------

import type { CacheMetrics } from './model-io.js';

export type CompactionTrigger = 'pressure' | 'context-overflow';

export interface MultiTierCompressorOptions {
  readonly modelContextTokens?: number;
  readonly aggressiveThreshold?: number; // 0.0 - 1.0 threshold
  readonly maxToolResultTokens?: number;
  readonly collapseThreshold?: number;
  readonly trigger?: CompactionTrigger;
  readonly aggressiveOnOverflow?: boolean;
  readonly sessionId?: string;
  readonly lock?: CompactionLock;
  readonly collapseStore?: CollapseStore;
  readonly pruner?: ToolResultPruner;
  readonly cachedPrefixIds?: ReadonlySet<string> | ReadonlyArray<string>;
  readonly cacheMetrics?: CacheMetrics;
  readonly deferBoundaryMarkers?: boolean;
}

export type CompactionOptions = MultiTierCompressorOptions;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface CompilationMetrics {
  readonly inputObjectCount: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly compressionRatio: number; // (tokensBefore - tokensAfter) / tokensBefore
  readonly retainedCount: number;
  readonly omittedCount: number;
  readonly mandatoryRetainedCount: number;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Context Compilation Request & Result
// ---------------------------------------------------------------------------

export interface ContextCompilationRequest {
  readonly goal: Goal;
  readonly task: Task;
  readonly currentState: AgentState;
  readonly currentFiles?: ReadonlyArray<string>;
  readonly activeHypothesis?: Hypothesis | null;
  readonly recentEvidence?: ReadonlyArray<Evidence>;
  readonly relevantObjects?: ReadonlyArray<ContextObject>;
  readonly targetModelDescriptor: ModelDescriptor;
  readonly budget: ContextBudget;
  readonly dryRun?: boolean;
  readonly weights?: Partial<CompilerScoringWeights>;
  readonly repoSymbolMap?: import('./symbol-types.js').RepoSymbolMap;
  readonly useSymbolMap?: boolean;
  readonly collapseStore?: CollapseStore;
  readonly cachedPrefixIds?: ReadonlySet<string> | ReadonlyArray<string>;
  readonly lastCacheMetrics?: CacheMetrics;
  readonly deferBoundaryMarkers?: boolean;
  readonly compactionOptions?: Partial<MultiTierCompressorOptions>;
  readonly frozenMemoryObjects?: ReadonlyArray<ContextObject>;
}

export interface ContextCompilationResult {
  readonly compiledContext: CompiledContext;
  readonly retainedObjects: ReadonlyArray<ContextObject>;
  readonly explanation?: CompilationExplanation;
  readonly metrics: CompilationMetrics;
}
