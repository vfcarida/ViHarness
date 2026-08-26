/**
 * In-Memory Model Metrics Collector.
 *
 * Implements ModelMetricsCollector to track:
 * - Total / success / failed requests
 * - Input / output / total tokens
 * - Financial cost in dollars
 * - Average latency in ms
 * - Total retries
 */
import type {
  ModelMetricsCollector,
  RecordMetricParams,
  ProviderMetricsSummary,
} from '../../core/interfaces/model-metrics.js';

interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostDollars: number;
  totalLatencyMs: number;
  totalRetries: number;
}

export class InMemoryMetricsCollector implements ModelMetricsCollector {
  private readonly stats = new Map<string, ProviderStats>();

  recordRequest(params: RecordMetricParams): void {
    let stat = this.stats.get(params.providerId);
    if (!stat) {
      stat = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCostDollars: 0,
        totalLatencyMs: 0,
        totalRetries: 0,
      };
      this.stats.set(params.providerId, stat);
    }

    stat.totalRequests += 1;
    if (params.success) {
      stat.successfulRequests += 1;
    } else {
      stat.failedRequests += 1;
    }

    stat.totalInputTokens += params.usage.inputTokens;
    stat.totalOutputTokens += params.usage.outputTokens;
    stat.totalTokens += params.usage.totalTokens;
    stat.totalCostDollars += params.costDollars;
    stat.totalLatencyMs += params.latencyMs;
    if (params.attempts > 1) {
      stat.totalRetries += params.attempts - 1;
    }
  }

  getMetrics(providerId?: string): ProviderMetricsSummary {
    if (providerId) {
      const stat = this.stats.get(providerId);
      if (!stat) {
        return {
          providerId,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalCostDollars: 0,
          averageLatencyMs: 0,
          totalRetries: 0,
        };
      }
      return {
        providerId,
        totalRequests: stat.totalRequests,
        successfulRequests: stat.successfulRequests,
        failedRequests: stat.failedRequests,
        totalInputTokens: stat.totalInputTokens,
        totalOutputTokens: stat.totalOutputTokens,
        totalTokens: stat.totalTokens,
        totalCostDollars: stat.totalCostDollars,
        averageLatencyMs: stat.totalRequests > 0 ? stat.totalLatencyMs / stat.totalRequests : 0,
        totalRetries: stat.totalRetries,
      };
    }

    // Aggregate across all providers
    let totalReq = 0;
    let succReq = 0;
    let failReq = 0;
    let inTok = 0;
    let outTok = 0;
    let totTok = 0;
    let totCost = 0;
    let totLat = 0;
    let totRet = 0;

    for (const stat of this.stats.values()) {
      totalReq += stat.totalRequests;
      succReq += stat.successfulRequests;
      failReq += stat.failedRequests;
      inTok += stat.totalInputTokens;
      outTok += stat.totalOutputTokens;
      totTok += stat.totalTokens;
      totCost += stat.totalCostDollars;
      totLat += stat.totalLatencyMs;
      totRet += stat.totalRetries;
    }

    return {
      providerId: 'all',
      totalRequests: totalReq,
      successfulRequests: succReq,
      failedRequests: failReq,
      totalInputTokens: inTok,
      totalOutputTokens: outTok,
      totalTokens: totTok,
      totalCostDollars: totCost,
      averageLatencyMs: totalReq > 0 ? totLat / totalReq : 0,
      totalRetries: totRet,
    };
  }

  reset(): void {
    this.stats.clear();
  }
}
