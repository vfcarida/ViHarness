/**
 * HarnessAdapter Interface.
 *
 * Defines the contract for pluggable harness adapters (e.g. Pi vs Vi-Harness)
 * allowing the benchmark runner to evaluate harnesses as the primary independent variable
 * while holding model, tasks, tools, timeout, budget, and environment constant.
 */
import type {
  BenchmarkTask,
  BenchmarkEnvironment,
  ModelConfiguration,
} from '../model/benchmark-types.js';
import type { IdFactory } from '../types/identifiers.js';
import type { Clock } from './clock.js';

export interface HarnessExecutionContext {
  /** Index of this run in repeated trials (0-indexed) */
  readonly runIndex: number;

  /** Deterministic seed for reproducible runs */
  readonly seed: string;

  /** Isolated temporary workspace root directory for this run */
  readonly workspacePath: string;

  /** Model configuration */
  readonly modelConfig: ModelConfiguration;

  /** Benchmark environment */
  readonly environment: BenchmarkEnvironment;

  /** Initial Git commit ref/SHA for baseline */
  readonly initialCommit: string;

  /** ID Factory */
  readonly idFactory: IdFactory;

  /** Clock */
  readonly clock: Clock;
}

export interface HarnessExecutionResult {
  /** Whether the task completed successfully */
  readonly success: boolean;

  /** Final state / phase */
  readonly finalState: string;

  /** Changed files in workspace */
  readonly changedFiles: ReadonlyArray<string>;

  /** Unified diff */
  readonly finalDiff: string;

  /** Test results */
  readonly tests: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly passRate: number;
  };

  /** Regressions detected */
  readonly regressions: number;

  /** Total iterations */
  readonly iterations: number;

  /** Total tool calls */
  readonly toolCalls: number;

  /** Token usage breakdown */
  readonly tokens: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };

  /** Estimated cost in USD */
  readonly estimatedCost: number;

  /** Execution latency / duration in milliseconds */
  readonly duration: number;

  /** Termination reason */
  readonly terminationReason: string;

  /** Optional error message if execution crashed */
  readonly error?: string;
}

export interface HarnessAdapter {
  /** Unique harness identifier (e.g. 'Vi-Harness', 'Pi') */
  readonly name: string;

  /** Harness version */
  readonly version: string;

  /** Execute a benchmark task within the provided isolated execution context */
  execute(task: BenchmarkTask, context: HarnessExecutionContext): Promise<HarnessExecutionResult>;
}
