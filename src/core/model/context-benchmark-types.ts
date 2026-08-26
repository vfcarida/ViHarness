/**
 * Context-Efficiency Benchmark Domain Types.
 *
 * Defines data structures for measuring and evaluating context bloat,
 * token growth curves, compression ratios, and critical memory retention
 * across Naive Accumulation, Pi-style Compaction, and Vi-Harness Context Compiler.
 */

export type ContextStrategyType = 'NAIVE_ACCUMULATION' | 'PI_COMPACTION' | 'VI_CONTEXT_COMPILER';

export type InjectionCategory =
  | 'CRITICAL_MEMORY'
  | 'REPEATED_TOOL_OUTPUT'
  | 'IRRELEVANT_LOGS'
  | 'STALE_HYPOTHESIS'
  | 'CONTRADICTORY_OBSERVATION'
  | 'LARGE_FILE'
  | 'REGULAR_STEP';

/**
 * Definition of a critical memory item whose survival must be tested at the end of the horizon.
 */
export interface CriticalMemoryItem {
  readonly id: string;
  readonly factKey: string;
  readonly content: string;
  readonly description: string;
  readonly injectedIteration: number;
  /**
   * String snippet or keyword that MUST appear in the final compiled context
   * for the critical fact to be considered retained.
   */
  readonly expectedPattern: string;
}

/**
 * A deterministic step in a long-horizon trajectory.
 */
export interface TrajectoryStep {
  readonly stepIndex: number;
  readonly iteration: number;
  readonly role: 'user' | 'assistant' | 'tool' | 'system';
  readonly category: InjectionCategory;
  readonly content: string;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolOutput?: string;
  readonly rawTokens: number;
  readonly criticalItem?: CriticalMemoryItem;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Point-in-time measurement for a strategy at a specific iteration.
 */
export interface IterationMeasurement {
  readonly iteration: number;
  readonly strategy: ContextStrategyType;
  /** Context tokens submitted in the active prompt at this iteration */
  readonly contextTokens: number;
  /** Cumulative count of model calls so far */
  readonly modelCalls: number;
  /** Cumulative sum of all context tokens submitted across all iterations up to now */
  readonly cumulativeTokens: number;
  /** Peak context size seen up to this iteration */
  readonly peakContextTokens: number;
  /** Ratio of this strategy's contextTokens relative to naive transcript contextTokens */
  readonly compressionRatio: number;
  /** Cumulative token ratio relative to naive transcript cumulativeTokens */
  readonly cumulativeTokenRatio: number;
  /** Number of critical memory items currently retained in compiled context */
  readonly retainedCriticalFacts: number;
  /** Total number of critical memory items injected up to this iteration */
  readonly totalCriticalFactsInjected: number;
  /** Current retention rate (0.0 to 1.0) */
  readonly retentionRate: number;
}

/**
 * End-to-end benchmark result for a single strategy on a specific horizon.
 */
export interface StrategyBenchmarkResult {
  readonly strategy: ContextStrategyType;
  readonly strategyDisplayName: string;
  readonly horizon: number;
  readonly measurements: ReadonlyArray<IterationMeasurement>;
  readonly initialContextTokens: number;
  readonly finalContextTokens: number;
  readonly peakContextTokens: number;
  readonly totalCumulativeTokens: number;
  readonly averageContextTokens: number;
  readonly averageCompressionRatio: number;
  readonly criticalMemoryRetentionScore: number;
  readonly retainedFacts: ReadonlyArray<string>;
  readonly lostFacts: ReadonlyArray<string>;
  readonly taskSuccess: boolean;
  readonly durationMs: number;
}

/**
 * Comparison result across strategies for a single horizon.
 */
export interface HorizonComparisonResult {
  readonly horizon: number;
  readonly totalInjectedTokens: number;
  readonly totalCriticalFacts: number;
  readonly strategyResults: Readonly<Record<ContextStrategyType, StrategyBenchmarkResult>>;
  readonly viVsNaiveTokenSavingsPercent: number;
  readonly viVsPiTokenSavingsPercent: number;
  readonly viVsPiRetentionDeltaPercent: number;
}

/**
 * Complete multi-horizon context efficiency benchmark suite result.
 */
export interface ContextBenchmarkSuiteResult {
  readonly suiteId: string;
  readonly generatedAt: Date;
  readonly horizons: ReadonlyArray<number>;
  readonly comparisonsByHorizon: Readonly<Record<number, HorizonComparisonResult>>;
  readonly executiveSummary: {
    readonly overallViVsNaiveSavingsPercent: number;
    readonly overallViVsPiSavingsPercent: number;
    readonly overallViRetentionRate: number;
    readonly overallPiRetentionRate: number;
    readonly overallNaiveRetentionRate: number;
  };
}

/**
 * Options for running the context efficiency benchmark.
 */
export interface ContextBenchmarkOptions {
  readonly horizons?: ReadonlyArray<number>;
  readonly maxContextLimitTokens?: number;
  readonly outputDir?: string;
  readonly verbose?: boolean;
}
