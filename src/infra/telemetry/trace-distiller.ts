/**
 * Trace Distiller (Meta-Harness Causal Telemetry Analysis).
 *
 * Implements execution trace analysis and distillation inspired by Meta-Harness (Stanford IRIS Lab, arXiv:2603.28052).
 * Converts granular JSONL iteration records into causal diagnostic metrics:
 * - Cache efficiency and token bottleneck detection
 * - Tool usage accuracy, failure, and rejection rates
 * - Policy denial frequencies and security trigger analysis
 * - Trajectory progression and critical inflection points
 */
import type { IterationTraceRecord, ExecutionTraceSummary } from '../../core/model/trace-types.js';
import { ActionResultStatus } from '../../core/model/action.js';

export interface ToolPerformanceMetrics {
  readonly toolName: string;
  readonly totalProposals: number;
  readonly totalExecutions: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly policyDenials: number;
  readonly averageDurationMs: number;
  readonly failureRate: number;
}

export interface CausalTraceAnalysis {
  readonly executionId: string;
  readonly totalIterations: number;
  readonly totalTokens: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly cacheHitRatio: number;
  readonly totalCostDollars: number;
  readonly averageCostPerIteration: number;
  readonly toolMetrics: ReadonlyArray<ToolPerformanceMetrics>;
  readonly mostFrequentToolName?: string;
  readonly highestFailureToolName?: string;
  readonly policyDenialCount: number;
  readonly passEvidenceCount: number;
  readonly failureEvidenceCount: number;
  readonly inflectionPoints: ReadonlyArray<{
    iterationNumber: number;
    phaseChange: string;
    description: string;
  }>;
  readonly bottleneckIdentified?:
    'CACHE_UNDERUTILIZATION' | 'TOOL_FAILURES' | 'POLICY_FRICTION' | 'CONTEXT_BLOAT' | 'NONE';
}

export class TraceDistiller {
  /**
   * Distill an array of IterationTraceRecords into a comprehensive causal analysis.
   */
  static distill(
    records: ReadonlyArray<IterationTraceRecord>,
    summary?: ExecutionTraceSummary,
  ): CausalTraceAnalysis {
    if (records.length === 0) {
      return {
        executionId: summary?.executionId ?? 'unknown',
        totalIterations: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        cacheHitRatio: 0,
        totalCostDollars: 0,
        averageCostPerIteration: 0,
        toolMetrics: [],
        policyDenialCount: 0,
        passEvidenceCount: 0,
        failureEvidenceCount: 0,
        inflectionPoints: [],
        bottleneckIdentified: 'NONE',
      };
    }

    const executionId = records[0]!.executionId;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedTokens = 0;
    let totalCost = 0;
    let policyDenialCount = 0;
    let passEvidenceCount = 0;
    let failureEvidenceCount = 0;

    const toolStatsMap = new Map<
      string,
      {
        proposals: number;
        executions: number;
        successes: number;
        failures: number;
        denials: number;
        totalDurationMs: number;
      }
    >();

    const inflectionPoints: Array<{
      iterationNumber: number;
      phaseChange: string;
      description: string;
    }> = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      totalPromptTokens += rec.promptTokens;
      totalCompletionTokens += rec.completionTokens;
      totalCachedTokens += rec.cachedTokens ?? 0;
      totalCost += rec.costDollars;

      // Track phase transitions
      if (rec.phaseBefore !== rec.phaseAfter) {
        inflectionPoints.push({
          iterationNumber: rec.sequenceNumber,
          phaseChange: `${rec.phaseBefore} -> ${rec.phaseAfter}`,
          description: `Phase transitioned from ${rec.phaseBefore} to ${rec.phaseAfter}`,
        });
      }

      // Track policy decisions
      for (const pol of rec.policyDecisions) {
        const decisionType = String(pol.decision);
        if (decisionType === 'DENY' || decisionType === 'REQUIRE_APPROVAL') {
          policyDenialCount++;
          const toolName = String(
            pol.action?.metadata?.['toolName'] ?? pol.action?.resource ?? 'unknown_tool',
          );
          const stat = toolStatsMap.get(toolName) ?? {
            proposals: 0,
            executions: 0,
            successes: 0,
            failures: 0,
            denials: 0,
            totalDurationMs: 0,
          };
          stat.denials++;
          toolStatsMap.set(toolName, stat);
        }
      }

      // Track proposed tools
      for (const prop of rec.proposedToolCalls) {
        const stat = toolStatsMap.get(prop.name) ?? {
          proposals: 0,
          executions: 0,
          successes: 0,
          failures: 0,
          denials: 0,
          totalDurationMs: 0,
        };
        stat.proposals++;
        toolStatsMap.set(prop.name, stat);
      }

      // Track executed tool results
      for (const res of rec.executedToolResults) {
        const toolCallId = String(res.metadata?.['toolCallId'] ?? res.actionId);
        // Find corresponding tool name from proposals if available
        const matchedProp = rec.proposedToolCalls.find((p) => p.id === toolCallId);
        const toolName = matchedProp?.name ?? String(res.metadata?.['toolName'] ?? 'unknown_tool');

        const stat = toolStatsMap.get(toolName) ?? {
          proposals: 0,
          executions: 0,
          successes: 0,
          failures: 0,
          denials: 0,
          totalDurationMs: 0,
        };
        stat.executions++;
        stat.totalDurationMs += res.durationMs;
        if (res.status === ActionResultStatus.SUCCESS) {
          stat.successes++;
        } else {
          stat.failures++;
        }
        toolStatsMap.set(toolName, stat);
      }

      // Track evidence
      for (const ev of rec.evidenceCreated) {
        if (ev.pass) {
          passEvidenceCount++;
        } else {
          failureEvidenceCount++;
        }
      }
    }

    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const cacheHitRatio = totalPromptTokens > 0 ? totalCachedTokens / totalPromptTokens : 0;
    const averageCostPerIteration = records.length > 0 ? totalCost / records.length : 0;

    const toolMetrics: ToolPerformanceMetrics[] = [];
    let mostFrequentToolName: string | undefined;
    let maxToolProposals = 0;
    let highestFailureToolName: string | undefined;
    let maxToolFailures = 0;

    for (const [toolName, stat] of toolStatsMap.entries()) {
      const failureRate = stat.executions > 0 ? stat.failures / stat.executions : 0;
      const averageDurationMs = stat.executions > 0 ? stat.totalDurationMs / stat.executions : 0;

      toolMetrics.push({
        toolName,
        totalProposals: stat.proposals,
        totalExecutions: stat.executions,
        successfulExecutions: stat.successes,
        failedExecutions: stat.failures,
        policyDenials: stat.denials,
        averageDurationMs,
        failureRate,
      });

      if (stat.proposals > maxToolProposals) {
        maxToolProposals = stat.proposals;
        mostFrequentToolName = toolName;
      }

      if (stat.failures > maxToolFailures) {
        maxToolFailures = stat.failures;
        highestFailureToolName = toolName;
      }
    }

    // Determine primary bottleneck
    let bottleneckIdentified:
      'CACHE_UNDERUTILIZATION' | 'TOOL_FAILURES' | 'POLICY_FRICTION' | 'CONTEXT_BLOAT' | 'NONE' =
      'NONE';
    if (cacheHitRatio < 0.2 && totalPromptTokens > 10000) {
      bottleneckIdentified = 'CACHE_UNDERUTILIZATION';
    } else if (maxToolFailures >= 3) {
      bottleneckIdentified = 'TOOL_FAILURES';
    } else if (policyDenialCount >= 3) {
      bottleneckIdentified = 'POLICY_FRICTION';
    } else if (totalTokens > 100000) {
      bottleneckIdentified = 'CONTEXT_BLOAT';
    }

    return {
      executionId,
      totalIterations: records.length,
      totalTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cachedTokens: totalCachedTokens,
      cacheHitRatio,
      totalCostDollars: totalCost,
      averageCostPerIteration,
      toolMetrics,
      mostFrequentToolName,
      highestFailureToolName,
      policyDenialCount,
      passEvidenceCount,
      failureEvidenceCount,
      inflectionPoints,
      bottleneckIdentified,
    };
  }
}
