/**
 * Harness Performance & Cost Profiler.
 *
 * Measures operational telemetry across 10 critical cost/performance dimensions:
 * 1. Model Calls
 * 2. Token Usage
 * 3. Context Compilation
 * 4. Tool Calls
 * 5. Repeated Retrieval
 * 6. Redundant Verification
 * 7. Subagent Usage
 * 8. Serialization Overhead
 * 9. Persistence Overhead
 * 10. Model Routing
 */

export enum TelemetryCategory {
  MODEL_CALLS = 'MODEL_CALLS',
  TOKEN_USAGE = 'TOKEN_USAGE',
  CONTEXT_COMPILATION = 'CONTEXT_COMPILATION',
  TOOL_CALLS = 'TOOL_CALLS',
  REPEATED_RETRIEVAL = 'REPEATED_RETRIEVAL',
  REDUNDANT_VERIFICATION = 'REDUNDANT_VERIFICATION',
  SUBAGENT_USAGE = 'SUBAGENT_USAGE',
  SERIALIZATION_OVERHEAD = 'SERIALIZATION_OVERHEAD',
  PERSISTENCE_OVERHEAD = 'PERSISTENCE_OVERHEAD',
  MODEL_ROUTING = 'MODEL_ROUTING',
}

export interface MetricSample {
  readonly category: TelemetryCategory;
  readonly value: number;
  readonly unit: 'tokens' | 'ms' | 'usd' | 'count';
  readonly timestamp: Date;
}

export interface PerformanceBaseline {
  readonly totalTokens: number;
  readonly totalCostUSD: number;
  readonly totalLatencyMs: number;
  readonly successRate: number;
  readonly regressionRate: number;
}

export interface PerformanceComparison {
  readonly before: PerformanceBaseline;
  readonly after: PerformanceBaseline;
  readonly costReductionPercent: number;
  readonly latencyReductionPercent: number;
  readonly tokenReductionPercent: number;
  readonly successRateImpactPercent: number;
  readonly regressionRateImpactPercent: number;
  readonly satisfiesReliabilityPolicy: boolean;
}

export class PerformanceProfiler {
  private readonly samples: MetricSample[] = [];

  record(
    category: TelemetryCategory,
    value: number,
    unit: 'tokens' | 'ms' | 'usd' | 'count',
  ): void {
    this.samples.push({
      category,
      value,
      unit,
      timestamp: new Date(),
    });
  }

  getSamples(category?: TelemetryCategory): ReadonlyArray<MetricSample> {
    if (!category) return this.samples;
    return this.samples.filter((s) => s.category === category);
  }

  calculateSum(category: TelemetryCategory): number {
    return this.getSamples(category).reduce((sum, s) => sum + s.value, 0);
  }

  static compare(before: PerformanceBaseline, after: PerformanceBaseline): PerformanceComparison {
    const costDiff = before.totalCostUSD - after.totalCostUSD;
    const costReductionPercent =
      before.totalCostUSD > 0 ? (costDiff / before.totalCostUSD) * 100 : 0;

    const latencyDiff = before.totalLatencyMs - after.totalLatencyMs;
    const latencyReductionPercent =
      before.totalLatencyMs > 0 ? (latencyDiff / before.totalLatencyMs) * 100 : 0;

    const tokenDiff = before.totalTokens - after.totalTokens;
    const tokenReductionPercent =
      before.totalTokens > 0 ? (tokenDiff / before.totalTokens) * 100 : 0;

    const successRateImpactPercent = (after.successRate - before.successRate) * 100;
    const regressionRateImpactPercent = (after.regressionRate - before.regressionRate) * 100;

    // RULE: Reject any optimization that materially lowers reliability (success rate drop > 1%)
    const satisfiesReliabilityPolicy =
      after.successRate >= before.successRate - 0.01 &&
      after.regressionRate <= before.regressionRate + 0.01;

    return {
      before,
      after,
      costReductionPercent: Math.max(0, costReductionPercent),
      latencyReductionPercent: Math.max(0, latencyReductionPercent),
      tokenReductionPercent: Math.max(0, tokenReductionPercent),
      successRateImpactPercent,
      regressionRateImpactPercent,
      satisfiesReliabilityPolicy,
    };
  }
}
