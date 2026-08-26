/**
 * Context Efficiency Benchmark Runner.
 *
 * Runs identical synthetic long-horizon trajectories across:
 * 1. Naive Transcript Accumulation
 * 2. Pi-Style Compaction Baseline
 * 3. Vi-Harness Context Compiler
 *
 * Measures:
 * - context tokens per iteration
 * - cumulative token consumption
 * - peak context size
 * - compression ratio
 * - critical memory retention rate
 */
import type {
  ContextBenchmarkSuiteResult,
  HorizonComparisonResult,
  StrategyBenchmarkResult,
  IterationMeasurement,
  ContextBenchmarkOptions,
  ContextStrategyType,
  TrajectoryStep,
} from '../../core/model/context-benchmark-types.js';
import type { ContextBenchmarkStrategy } from './strategies/context-strategy.js';
import { NaiveAccumulationStrategy } from './strategies/naive-accumulation-strategy.js';
import { PiCompactionStrategy } from './strategies/pi-compaction-strategy.js';
import { ViContextCompilerStrategy } from './strategies/vi-context-compiler-strategy.js';
import { ContextTrajectoryGenerator } from './context-trajectory-generator.js';

export class ContextBenchmarkRunner {
  private readonly defaultHorizons: ReadonlyArray<number> = [10, 25, 50, 100];

  /**
   * Execute the full multi-horizon context efficiency benchmark suite.
   */
  async runSuite(options?: ContextBenchmarkOptions): Promise<ContextBenchmarkSuiteResult> {
    const horizons = options?.horizons ?? this.defaultHorizons;
    const comparisonsByHorizon: Record<number, HorizonComparisonResult> = {};

    for (const horizon of horizons) {
      const comparison = await this.runHorizon(horizon, options);
      comparisonsByHorizon[horizon] = comparison;
    }

    // Compute executive summary averages across all horizons
    const horizonList = Object.values(comparisonsByHorizon);
    const overallViVsNaiveSavings =
      horizonList.reduce((acc, h) => acc + h.viVsNaiveTokenSavingsPercent, 0) /
      Math.max(1, horizonList.length);
    const overallViVsPiSavings =
      horizonList.reduce((acc, h) => acc + h.viVsPiTokenSavingsPercent, 0) /
      Math.max(1, horizonList.length);

    const overallViRetention =
      horizonList.reduce(
        (acc, h) => acc + h.strategyResults['VI_CONTEXT_COMPILER'].criticalMemoryRetentionScore,
        0,
      ) / Math.max(1, horizonList.length);
    const overallPiRetention =
      horizonList.reduce(
        (acc, h) => acc + h.strategyResults['PI_COMPACTION'].criticalMemoryRetentionScore,
        0,
      ) / Math.max(1, horizonList.length);
    const overallNaiveRetention =
      horizonList.reduce(
        (acc, h) => acc + h.strategyResults['NAIVE_ACCUMULATION'].criticalMemoryRetentionScore,
        0,
      ) / Math.max(1, horizonList.length);

    return {
      suiteId: `context-efficiency-suite-v1`,
      generatedAt: new Date(),
      horizons,
      comparisonsByHorizon,
      executiveSummary: {
        overallViVsNaiveSavingsPercent: overallViVsNaiveSavings,
        overallViVsPiSavingsPercent: overallViVsPiSavings,
        overallViRetentionRate: overallViRetention,
        overallPiRetentionRate: overallPiRetention,
        overallNaiveRetentionRate: overallNaiveRetention,
      },
    };
  }

  /**
   * Run comparison for a single horizon.
   */
  async runHorizon(
    horizon: number,
    options?: ContextBenchmarkOptions,
  ): Promise<HorizonComparisonResult> {
    const trajectory = ContextTrajectoryGenerator.generateTrajectory(horizon);
    const totalCriticalFacts = ContextTrajectoryGenerator.getInjectedCriticalItems(horizon).length;
    const totalInjectedTokens = trajectory.reduce((acc, s) => acc + s.rawTokens, 0);

    const strategies: ContextBenchmarkStrategy[] = [
      new NaiveAccumulationStrategy(),
      new PiCompactionStrategy(),
      new ViContextCompilerStrategy({ maxContextTokens: options?.maxContextLimitTokens }),
    ];

    const strategyResults: Record<ContextStrategyType, StrategyBenchmarkResult> = {} as any;

    // Execute each strategy independently on the exact same trajectory
    for (const strategy of strategies) {
      strategy.reset();
      const startTime = Date.now();
      const measurements: IterationMeasurement[] = [];

      let cumulativeTokens = 0;
      let peakContext = 0;
      let modelCalls = 0;
      let lastContextTokens = 0;

      // Group steps by iteration
      const stepsByIteration = new Map<number, TrajectoryStep[]>();
      for (const step of trajectory) {
        if (!stepsByIteration.has(step.iteration)) {
          stepsByIteration.set(step.iteration, []);
        }
        stepsByIteration.get(step.iteration)!.push(step);
      }

      // Process iteration by iteration
      for (let iter = 1; iter <= horizon; iter++) {
        const iterSteps = stepsByIteration.get(iter) ?? [];
        for (const step of iterSteps) {
          const stepResult = await strategy.processStep(step, step.stepIndex);
          lastContextTokens = stepResult.contextTokens;
        }

        modelCalls++;
        cumulativeTokens += lastContextTokens;
        peakContext = Math.max(peakContext, lastContextTokens);

        const injectedSoFar = ContextTrajectoryGenerator.getInjectedCriticalItems(iter);
        const retention = strategy.evaluateRetention(injectedSoFar);

        // Get naive tokens at this iteration for baseline ratio computation
        const naiveTokensAtIter =
          measurements.length > 0 && strategy.name !== 'NAIVE_ACCUMULATION'
            ? (strategyResults['NAIVE_ACCUMULATION']?.measurements[iter - 1]?.contextTokens ??
              lastContextTokens)
            : lastContextTokens;
        const naiveCumTokensAtIter =
          measurements.length > 0 && strategy.name !== 'NAIVE_ACCUMULATION'
            ? (strategyResults['NAIVE_ACCUMULATION']?.measurements[iter - 1]?.cumulativeTokens ??
              cumulativeTokens)
            : cumulativeTokens;

        const compressionRatio =
          naiveTokensAtIter > 0 ? lastContextTokens / naiveTokensAtIter : 1.0;
        const cumulativeTokenRatio =
          naiveCumTokensAtIter > 0 ? cumulativeTokens / naiveCumTokensAtIter : 1.0;

        measurements.push({
          iteration: iter,
          strategy: strategy.name,
          contextTokens: lastContextTokens,
          modelCalls,
          cumulativeTokens,
          peakContextTokens: peakContext,
          compressionRatio,
          cumulativeTokenRatio,
          retainedCriticalFacts: retention.retainedCount,
          totalCriticalFactsInjected: retention.totalInjected,
          retentionRate: retention.retentionRate,
        });
      }

      const allInjectedCritical = ContextTrajectoryGenerator.getInjectedCriticalItems(horizon);
      const finalRetention = strategy.evaluateRetention(allInjectedCritical);
      const durationMs = Date.now() - startTime;
      const initialContextTokens = measurements[0]?.contextTokens ?? 0;
      const finalContextTokens = measurements[measurements.length - 1]?.contextTokens ?? 0;
      const avgContext =
        measurements.reduce((acc, m) => acc + m.contextTokens, 0) /
        Math.max(1, measurements.length);
      const avgCompression =
        measurements.reduce((acc, m) => acc + m.compressionRatio, 0) /
        Math.max(1, measurements.length);

      strategyResults[strategy.name] = {
        strategy: strategy.name,
        strategyDisplayName: strategy.displayName,
        horizon,
        measurements,
        initialContextTokens,
        finalContextTokens,
        peakContextTokens: peakContext,
        totalCumulativeTokens: cumulativeTokens,
        averageContextTokens: Math.round(avgContext),
        averageCompressionRatio: Number(avgCompression.toFixed(3)),
        criticalMemoryRetentionScore: finalRetention.retentionRate,
        retainedFacts: finalRetention.retained,
        lostFacts: finalRetention.lost,
        taskSuccess: finalRetention.retentionRate >= 1.0,
        durationMs,
      };
    }

    const naiveResult = strategyResults['NAIVE_ACCUMULATION'];
    const piResult = strategyResults['PI_COMPACTION'];
    const viResult = strategyResults['VI_CONTEXT_COMPILER'];

    const viVsNaiveTokenSavings =
      naiveResult.totalCumulativeTokens > 0
        ? ((naiveResult.totalCumulativeTokens - viResult.totalCumulativeTokens) /
            naiveResult.totalCumulativeTokens) *
          100
        : 0;

    const viVsPiTokenSavings =
      piResult.totalCumulativeTokens > 0
        ? ((piResult.totalCumulativeTokens - viResult.totalCumulativeTokens) /
            piResult.totalCumulativeTokens) *
          100
        : 0;

    const viVsPiRetentionDelta =
      (viResult.criticalMemoryRetentionScore - piResult.criticalMemoryRetentionScore) * 100;

    return {
      horizon,
      totalInjectedTokens,
      totalCriticalFacts,
      strategyResults,
      viVsNaiveTokenSavingsPercent: Number(viVsNaiveTokenSavings.toFixed(1)),
      viVsPiTokenSavingsPercent: Number(viVsPiTokenSavings.toFixed(1)),
      viVsPiRetentionDeltaPercent: Number(viVsPiRetentionDelta.toFixed(1)),
    };
  }
}
