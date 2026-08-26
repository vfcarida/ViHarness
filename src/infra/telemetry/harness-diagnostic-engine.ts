// Pattern: Outer-loop harness diagnostic engine (ref: Meta-Harness)
/**
 * Harness Diagnostic Engine (Meta-Harness Outer-Loop Adaptation).
 *
 * Implements causal diagnosis and automated remediation recommendations inspired by Meta-Harness
 * (Stanford IRIS Lab, arXiv:2603.28052).
 *
 * Provides single-run diagnosis and non-Markovian cross-run trace analysis to systematically
 * improve token efficiency, eliminate tool failure traps, and optimize harness configuration.
 */
import { TraceDistiller, type CausalTraceAnalysis } from './trace-distiller.js';
import type { IterationTraceRecord, ExecutionTraceSummary } from '../../core/model/trace-types.js';
import type { RunTraceData } from './experience-store.js';

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
  readonly evidence: ReadonlyArray<string>; // trace excerpts supporting the recommendation
  readonly confidence: number; // 0.0 - 1.0
  readonly rationale: string;
  readonly code?: string;
  readonly priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly description?: string;
  readonly actionablePatchSuggestion?: string;
}

export interface HarnessDiagnosticReport {
  readonly executionId: string;
  readonly overallHealth: 'OPTIMAL' | 'DEGRADED' | 'BOTTLENECKED' | 'FAILED';
  readonly analysis: CausalTraceAnalysis;
  readonly recommendations: ReadonlyArray<HarnessRecommendation>;
  readonly suggestedConfigOverrides: Record<string, unknown>;
}

export interface CrossRunAnalysisOptions {
  readonly minRunsForPattern?: number;
  readonly minConfidence?: number;
}

export interface CrossRunAnalysisReport {
  readonly runsAnalyzed: number;
  readonly aggregateSuccessRate: number;
  readonly averageTokensPerRun: number;
  readonly averageCostPerRun: number;
  readonly recurringFailurePatterns: ReadonlyArray<string>;
  readonly recommendations: ReadonlyArray<HarnessRecommendation>;
  readonly suggestedConfigOverrides: Record<string, unknown>;
}

export class HarnessDiagnosticEngine {
  /**
   * Run full causal diagnostics on execution traces from a single run.
   */
  static diagnose(
    records: ReadonlyArray<IterationTraceRecord>,
    summary?: ExecutionTraceSummary,
  ): HarnessDiagnosticReport {
    const analysis = TraceDistiller.distill(records, summary);
    const recommendations: HarnessRecommendation[] = [];
    const suggestedConfigOverrides: Record<string, unknown> = {};

    // 1. Check Cache Hit Ratio
    if (analysis.cacheHitRatio < 0.3 && analysis.promptTokens > 5000) {
      const rec: HarnessRecommendation = {
        type: 'THRESHOLD_ADJUSTMENT',
        parameter: 'enablePrefixCaching',
        currentValue: false,
        suggestedValue: true,
        evidence: [
          `Cache hit ratio was ${(analysis.cacheHitRatio * 100).toFixed(1)}% across ${analysis.totalIterations} iterations with ${analysis.promptTokens} prompt tokens`,
        ],
        confidence: 0.85,
        rationale:
          'Invariant static prompt segments and repo-maps should be segregated with ephemeral cache headers to reduce latency and cost.',
        code: 'INCREASE_PREFIX_CACHING',
        priority: 'HIGH',
        description: `Cache hit ratio is low (${(analysis.cacheHitRatio * 100).toFixed(1)}%).`,
        actionablePatchSuggestion: 'Enable PrefixCachingCompiler in context compilation pipeline.',
      };
      recommendations.push(rec);
      suggestedConfigOverrides['enablePrefixCaching'] = true;
      suggestedConfigOverrides['staticSegmentThresholdTokens'] = 1024;
    }

    // 2. Check Tool Failures
    if (analysis.highestFailureToolName) {
      const toolMetric = analysis.toolMetrics.find(
        (m) => m.toolName === analysis.highestFailureToolName,
      );
      if (toolMetric && toolMetric.failureRate >= 0.4 && toolMetric.totalExecutions >= 2) {
        const rec: HarnessRecommendation = {
          type: 'TOOL_OPTIMIZATION',
          parameter: `toolFeedbackEnhancement_${toolMetric.toolName}`,
          currentValue: false,
          suggestedValue: true,
          evidence: [
            `Tool [${toolMetric.toolName}] failed ${toolMetric.failedExecutions} of ${toolMetric.totalExecutions} times (failure rate: ${(toolMetric.failureRate * 100).toFixed(1)}%)`,
          ],
          confidence: 0.9,
          rationale: `Tool [${toolMetric.toolName}] repeatedly fails during execution. Schema examples and validation feedback must be injected.`,
          code: 'REFINE_TOOL_SCHEMA',
          priority: 'CRITICAL',
          description: `Tool [${toolMetric.toolName}] has high failure rate.`,
          actionablePatchSuggestion: `Add input schema examples and validation error feedback for tool [${toolMetric.toolName}].`,
        };
        recommendations.push(rec);
        suggestedConfigOverrides[`toolFeedbackEnhancement_${toolMetric.toolName}`] = true;
      }
    }

    // 3. Check Policy Denials
    if (analysis.policyDenialCount >= 2) {
      const rec: HarnessRecommendation = {
        type: 'POLICY_ADJUSTMENT',
        parameter: 'injectSecurityBoundariesInPrompt',
        currentValue: false,
        suggestedValue: true,
        evidence: [
          `Agent triggered ${analysis.policyDenialCount} security policy denials while requesting restricted paths or operations`,
        ],
        confidence: 0.85,
        rationale: 'Agent repeatedly attempted operations outside permitted security boundaries.',
        code: 'ADJUST_POLICY_PERMISSIONS',
        priority: 'HIGH',
        description: `Encountered ${analysis.policyDenialCount} security policy denials.`,
        actionablePatchSuggestion:
          'Inject explicit workspace boundary guidelines into L3 system prompt.',
      };
      recommendations.push(rec);
      suggestedConfigOverrides['injectSecurityBoundariesInPrompt'] = true;
    }

    // 4. Check Context Token Bloat
    if (analysis.totalTokens > 80000 || analysis.totalIterations >= 15) {
      const rec: HarnessRecommendation = {
        type: 'COMPACTION_TUNING',
        parameter: 'aggressiveCompactionThreshold',
        currentValue: 0.85,
        suggestedValue: 0.65,
        evidence: [
          `Total token consumption reached ${analysis.totalTokens} tokens over ${analysis.totalIterations} iterations`,
        ],
        confidence: 0.85,
        rationale: 'High token bloat threatens context limits and degrades retrieval quality.',
        code: 'ACTIVATE_4STAGE_COMPACTION',
        priority: 'HIGH',
        description: `High token accumulation detected (${analysis.totalTokens} tokens).`,
        actionablePatchSuggestion:
          'Engage progressive 4-Stage Context Compaction with lower trigger threshold.',
      };
      recommendations.push(rec);
      suggestedConfigOverrides['contextCompactionStrategy'] = 'FOUR_STAGE_PROGRESSIVE';
      suggestedConfigOverrides['aggressiveCompactionThreshold'] = 0.65;
    }

    // Determine overall health
    let overallHealth: 'OPTIMAL' | 'DEGRADED' | 'BOTTLENECKED' | 'FAILED' = 'OPTIMAL';
    if (summary && !summary.success) {
      overallHealth = 'FAILED';
    } else if (recommendations.some((r) => r.priority === 'CRITICAL')) {
      overallHealth = 'DEGRADED';
    } else if (recommendations.length > 0) {
      overallHealth = 'BOTTLENECKED';
    }

    return {
      executionId: analysis.executionId,
      overallHealth,
      analysis,
      recommendations,
      suggestedConfigOverrides,
    };
  }

  /**
   * Analyzes raw non-Markovian traces across multiple historical runs to formulate
   * outer-loop harness configuration improvements (Meta-Harness Pattern).
   */
  static analyzeAcrossRuns(
    runs: ReadonlyArray<RunTraceData>,
    options?: CrossRunAnalysisOptions,
  ): CrossRunAnalysisReport {
    if (runs.length === 0) {
      return {
        runsAnalyzed: 0,
        aggregateSuccessRate: 0,
        averageTokensPerRun: 0,
        averageCostPerRun: 0,
        recurringFailurePatterns: [],
        recommendations: [],
        suggestedConfigOverrides: {},
      };
    }

    const minRuns = options?.minRunsForPattern ?? 2;
    const minConfidence = options?.minConfidence ?? 0.7;

    let successfulRuns = 0;
    let totalTokens = 0;
    let totalCost = 0;

    // Cross-run aggregators
    const toolFailureCounts = new Map<
      string,
      { count: number; total: number; evidence: string[] }
    >();
    const errorSignatureCounts = new Map<string, { count: number; evidence: string[] }>();
    let totalOscillationEvents = 0;
    const oscillationEvidence: string[] = [];
    let highTokenRunCount = 0;
    const highTokenEvidence: string[] = [];
    let lowCacheRunCount = 0;
    const lowCacheEvidence: string[] = [];
    let repairExhaustionCount = 0;
    const repairEvidence: string[] = [];

    for (const run of runs) {
      if (run.success) successfulRuns++;
      const runTokens = Number(run.scores['totalTokens'] ?? 0);
      const runCost = Number(run.scores['totalCostDollars'] ?? 0);
      totalTokens += runTokens;
      totalCost += runCost;

      if (runTokens > 20000) {
        highTokenRunCount++;
        highTokenEvidence.push(
          `Run [${run.runId}]: Consumed ${runTokens} tokens for goal '${run.goalDescription}'`,
        );
      }

      // Analyze trace records in this run
      let cachedTokensInRun = 0;
      let promptTokensInRun = 0;
      let repairCountInRun = 0;

      for (let i = 0; i < run.traces.length; i++) {
        const trace = run.traces[i]!;
        cachedTokensInRun += trace.cachedTokens ?? 0;
        promptTokensInRun += trace.promptTokens;

        if (trace.phaseBefore === 'REPAIR' || trace.phaseAfter === 'REPAIR') {
          repairCountInRun++;
        }

        // Detect phase oscillation (switching between IMPLEMENT and REPAIR multiple times)
        if (i > 1) {
          const prevTrace = run.traces[i - 1]!;
          if (
            trace.phaseBefore === 'REPAIR' &&
            prevTrace.phaseBefore === 'IMPLEMENT' &&
            trace.phaseAfter === 'IMPLEMENT'
          ) {
            totalOscillationEvents++;
            oscillationEvidence.push(
              `Run [${run.runId}] Iter ${trace.sequenceNumber}: Phase oscillated IMPLEMENT -> REPAIR -> IMPLEMENT`,
            );
          }
        }

        // Track executed tool results & errors
        for (const res of trace.executedToolResults) {
          const toolName = String(res.metadata?.['toolName'] ?? (res as any).name ?? 'unknown');
          const entry = toolFailureCounts.get(toolName) ?? { count: 0, total: 0, evidence: [] };
          entry.total++;

          if (res.status !== 'SUCCESS') {
            entry.count++;
            const errSnippet = res.error || res.output || 'Tool execution failed';
            entry.evidence.push(
              `Run [${run.runId}] Iter ${trace.sequenceNumber}: Tool [${toolName}] failed with: ${errSnippet.slice(0, 120)}`,
            );
            toolFailureCounts.set(toolName, entry);

            // Group by error signature
            const sigKey = `${toolName}:${errSnippet.slice(0, 50)}`;
            const sigEntry = errorSignatureCounts.get(sigKey) ?? { count: 0, evidence: [] };
            sigEntry.count++;
            sigEntry.evidence.push(`Run [${run.runId}]: ${errSnippet.slice(0, 100)}`);
            errorSignatureCounts.set(sigKey, sigEntry);
          } else {
            toolFailureCounts.set(toolName, entry);
          }
        }
      }

      if (repairCountInRun >= 3) {
        repairExhaustionCount++;
        repairEvidence.push(`Run [${run.runId}]: Reached ${repairCountInRun} repair iterations.`);
      }

      const cacheHitRatio = promptTokensInRun > 0 ? cachedTokensInRun / promptTokensInRun : 0;
      if (cacheHitRatio < 0.25 && promptTokensInRun > 4000) {
        lowCacheRunCount++;
        lowCacheEvidence.push(
          `Run [${run.runId}]: Low cache hit ratio ${(cacheHitRatio * 100).toFixed(1)}% across ${promptTokensInRun} prompt tokens`,
        );
      }
    }

    const recommendations: HarnessRecommendation[] = [];
    const suggestedConfigOverrides: Record<string, unknown> = {};
    const recurringFailurePatterns: string[] = [];

    // 1. Evaluate Recurring Tool Failures
    for (const [toolName, stats] of toolFailureCounts.entries()) {
      if (stats.count >= minRuns && stats.total > 0 && stats.count / stats.total >= 0.3) {
        const failurePct = ((stats.count / stats.total) * 100).toFixed(1);
        const patternDesc = `Tool [${toolName}] failed ${stats.count} times across ${runs.length} runs (${failurePct}% failure rate)`;
        recurringFailurePatterns.push(patternDesc);

        const confidence = Math.min(0.95, 0.7 + (stats.count / runs.length) * 0.25);
        if (confidence >= minConfidence) {
          recommendations.push({
            type: 'TOOL_OPTIMIZATION',
            parameter: `toolFeedbackEnhancement_${toolName}`,
            currentValue: false,
            suggestedValue: true,
            evidence: stats.evidence.slice(0, 5),
            confidence,
            rationale: `Recurring tool failures detected in ${stats.count} instances across multiple runs. Schema examples and targeted error recovery guidance should be injected into the tool context.`,
            priority: 'CRITICAL',
            description: patternDesc,
          });
          suggestedConfigOverrides[`toolFeedbackEnhancement_${toolName}`] = true;
        }
      }
    }

    // 2. Evaluate Oscillation Frequency & Repair Exhaustion
    if (totalOscillationEvents >= minRuns || repairExhaustionCount >= minRuns) {
      const patternDesc = `High oscillation frequency (${totalOscillationEvents} oscillation events) and repair exhaustion in ${repairExhaustionCount} runs`;
      recurringFailurePatterns.push(patternDesc);

      const confidence = Math.min(0.95, 0.75 + (repairExhaustionCount / runs.length) * 0.2);
      if (confidence >= minConfidence) {
        // Suggest Architect Mode or increased max repair attempts
        recommendations.push({
          type: 'ROUTING_CHANGE',
          parameter: 'architectMode',
          currentValue: false,
          suggestedValue: true,
          evidence: [...oscillationEvidence.slice(0, 3), ...repairEvidence.slice(0, 3)],
          confidence,
          rationale:
            'Frequent oscillation between implement and repair phases indicates reasoning breakdown during code generation. Dual-model Architect Mode decouples planning from editing to prevent cyclic repairs.',
          priority: 'HIGH',
          description: 'Enable Architect Mode to prevent phase oscillation.',
        });
        suggestedConfigOverrides['architectMode'] = true;
      }
    }

    // 3. Evaluate Context Bloat and Compaction Inefficiency
    if (highTokenRunCount >= Math.max(1, Math.floor(runs.length * 0.4))) {
      const patternDesc = `Context token explosion in ${highTokenRunCount} of ${runs.length} runs`;
      recurringFailurePatterns.push(patternDesc);

      const confidence = 0.85;
      if (confidence >= minConfidence) {
        recommendations.push({
          type: 'COMPACTION_TUNING',
          parameter: 'aggressiveCompactionThreshold',
          currentValue: 0.8,
          suggestedValue: 0.65,
          evidence: highTokenEvidence.slice(0, 4),
          confidence,
          rationale:
            'Long-horizon token accumulation frequently exceeds budget boundaries. Lower compaction trigger threshold to 0.65 to engage progressive compaction earlier.',
          priority: 'HIGH',
          description: 'Engage progressive compaction at 65% budget threshold.',
        });
        suggestedConfigOverrides['aggressiveCompactionThreshold'] = 0.65;
        suggestedConfigOverrides['contextCompactionStrategy'] = 'FOUR_STAGE_PROGRESSIVE';
      }
    }

    // 4. Evaluate Prefix Caching Underutilization
    if (lowCacheRunCount >= Math.max(1, Math.floor(runs.length * 0.4))) {
      const patternDesc = `Low prefix caching hit ratio in ${lowCacheRunCount} of ${runs.length} runs`;
      recurringFailurePatterns.push(patternDesc);

      const confidence = 0.88;
      if (confidence >= minConfidence) {
        recommendations.push({
          type: 'THRESHOLD_ADJUSTMENT',
          parameter: 'enablePrefixCaching',
          currentValue: false,
          suggestedValue: true,
          evidence: lowCacheEvidence.slice(0, 4),
          confidence,
          rationale:
            'Cache hit ratios remain low across repeated runs. Segregate immutable system instructions and frozen memory snapshots with provider ephemeral cache headers.',
          priority: 'HIGH',
          description: 'Enable Prefix Caching Compiler across all runs.',
        });
        suggestedConfigOverrides['enablePrefixCaching'] = true;
        suggestedConfigOverrides['staticSegmentThresholdTokens'] = 1024;
      }
    }

    const runsAnalyzed = runs.length;
    const aggregateSuccessRate = runsAnalyzed > 0 ? successfulRuns / runsAnalyzed : 0;
    const averageTokensPerRun = runsAnalyzed > 0 ? Math.round(totalTokens / runsAnalyzed) : 0;
    const averageCostPerRun = runsAnalyzed > 0 ? totalCost / runsAnalyzed : 0;

    return {
      runsAnalyzed,
      aggregateSuccessRate,
      averageTokensPerRun,
      averageCostPerRun,
      recurringFailurePatterns,
      recommendations,
      suggestedConfigOverrides,
    };
  }
}
