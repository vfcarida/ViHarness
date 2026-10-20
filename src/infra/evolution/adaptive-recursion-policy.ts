/**
 * Adaptive Recursion Budget Policy (Expected Value of Information / Stopping & Expansion).
 *
 * Replaces static --k loops with an adaptive policy driven by:
 * - Confidence threshold attainment
 * - Marginal expected gain vs marginal expected cost
 * - Behavioral redundancy / diversity collapse detection
 * - Contradictory probe noise detection
 * - Unexplained failure signals remaining
 * - Structural candidate replication demand
 * - Budget & safety risk limits
 */
import type {
  EvolutionResourceAccounting,
  RecursionBudgetDecision,
  RecursionBudgetPolicy,
} from '../../core/evolution/interfaces.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { BehavioralContrast } from '../../core/evolution/hypothesis.js';

export interface AdaptiveRecursionBudgetPolicyOptions {
  readonly confidenceStopThreshold?: number;
  readonly minPoolDiversityScore?: number;
  readonly minMarginalGainToCostRatio?: number;
  readonly maxSafetyViolationsAllowed?: number;
}

export class AdaptiveRecursionBudgetPolicy implements RecursionBudgetPolicy {
  private readonly confidenceStopThreshold: number;
  private readonly minPoolDiversityScore: number;
  private readonly minMarginalGainToCostRatio: number;
  private readonly maxSafetyViolationsAllowed: number;

  constructor(options: AdaptiveRecursionBudgetPolicyOptions = {}) {
    this.confidenceStopThreshold = options.confidenceStopThreshold ?? 0.88;
    this.minPoolDiversityScore = options.minPoolDiversityScore ?? 0.2;
    this.minMarginalGainToCostRatio = options.minMarginalGainToCostRatio ?? 1.25;
    this.maxSafetyViolationsAllowed = options.maxSafetyViolationsAllowed ?? 0;
  }

  evaluateStep(params: {
    readonly stepIndex: number;
    readonly maxSteps: number;
    readonly accounting: EvolutionResourceAccounting;
    readonly budgetProfile: HarnessManifest['budgetProfile'];
    readonly contrastsSoFar: ReadonlyArray<BehavioralContrast>;
    readonly unexplainedSignalsCount: number;
    readonly hasStructuralCandidate: boolean;
  }): RecursionBudgetDecision {
    const {
      stepIndex,
      maxSteps,
      accounting,
      budgetProfile,
      contrastsSoFar,
      unexplainedSignalsCount,
      hasStructuralCandidate,
    } = params;

    // 1. Check hard step limit
    if (stepIndex >= maxSteps) {
      return {
        action: 'STOP',
        stopReason: 'MAX_STEPS_REACHED',
        expectedValueOfInformation: 0,
        marginalExpectedGain: 0,
        marginalExpectedCost: 0,
        poolDiversityScore: 1,
        recommendedRepetitions: 1,
        rationale: `Reached configured maximum recursion steps (${maxSteps}).`,
      };
    }

    // 2. Check hard token/cost/wallTime budget limits
    const totalTokens =
      accounting.cachedInputTokens +
      accounting.uncachedInputTokens +
      accounting.outputTokens +
      accounting.policyTokens;
    const maxTotalTokens =
      budgetProfile.maxTokensPerProbe * budgetProfile.maxProbesPerEvolutionRun;
    const maxTotalWallTimeMs =
      budgetProfile.maxWallTimeMsPerProbe * budgetProfile.maxProbesPerEvolutionRun;
    if (
      accounting.totalCostDollars >= budgetProfile.maxTotalEvolutionCostDollars ||
      totalTokens >= maxTotalTokens ||
      accounting.wallTimeMs >= maxTotalWallTimeMs
    ) {
      return {
        action: 'STOP',
        stopReason: 'BUDGET_EXHAUSTED',
        expectedValueOfInformation: 0,
        marginalExpectedGain: 0,
        marginalExpectedCost: 0,
        poolDiversityScore: 1,
        recommendedRepetitions: 1,
        rationale: `Evolution resource budget exhausted (cost=$${accounting.totalCostDollars.toFixed(4)}/${budgetProfile.maxTotalEvolutionCostDollars}, tokens=${totalTokens}/${maxTotalTokens}).`,
      };
    }

    // 3. Check safety violations across contrasts
    const safetyViolations = contrastsSoFar.reduce(
      (sum, c) => sum + Math.max(0, c.policyViolationDelta),
      0,
    );
    if (safetyViolations > this.maxSafetyViolationsAllowed) {
      return {
        action: 'STOP',
        stopReason: 'SAFETY_RISK_THRESHOLD_EXCEEDED',
        expectedValueOfInformation: 0,
        marginalExpectedGain: 0,
        marginalExpectedCost: 0,
        poolDiversityScore: 0,
        recommendedRepetitions: 1,
        rationale: `Safety risk threshold exceeded (${safetyViolations} policy violation delta detected).`,
      };
    }

    if (contrastsSoFar.length === 0) {
      return {
        action: 'CONTINUE',
        expectedValueOfInformation: 1.0,
        marginalExpectedGain: 0.25,
        marginalExpectedCost: 0.02,
        poolDiversityScore: 1.0,
        recommendedRepetitions: hasStructuralCandidate ? 2 : 1,
        rationale: 'Initial recursion step with no prior contrasts.',
      };
    }

    // 4. Compute pool diversity score and behavioral redundancy
    const poolDiversityScore = this.computePoolDiversity(contrastsSoFar);
    if (contrastsSoFar.length >= 2 && poolDiversityScore < this.minPoolDiversityScore) {
      return {
        action: 'STOP',
        stopReason: 'DIVERSITY_COLLAPSE',
        expectedValueOfInformation: 0.05,
        marginalExpectedGain: 0.01,
        marginalExpectedCost: 0.02,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: `Candidate pool diversity collapsed (${poolDiversityScore.toFixed(2)} < ${this.minPoolDiversityScore}).`,
      };
    }

    const avgRedundancy =
      contrastsSoFar.reduce((s, c) => s + (1 - c.behavioralDiversityScore), 0) /
      contrastsSoFar.length;
    if (contrastsSoFar.length >= 2 && avgRedundancy > 0.85) {
      return {
        action: 'STOP',
        stopReason: 'BEHAVIORAL_REDUNDANCY',
        expectedValueOfInformation: 0.05,
        marginalExpectedGain: 0.01,
        marginalExpectedCost: 0.02,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: `Successive candidates are behaviorally redundant (avg redundancy=${avgRedundancy.toFixed(2)}).`,
      };
    }

    // 5. Check high confidence supported winner
    const bestSupported = contrastsSoFar
      .filter((c) => c.hypothesisOutcome.verdict === 'supported' && c.passRateDelta > 0)
      .sort((a, b) => b.hypothesisOutcome.confidence - a.hypothesisOutcome.confidence)[0];

    if (
      bestSupported &&
      bestSupported.hypothesisOutcome.confidence >= this.confidenceStopThreshold &&
      unexplainedSignalsCount === 0
    ) {
      return {
        action: 'STOP',
        stopReason: 'CONFIDENCE_THRESHOLD_REACHED',
        expectedValueOfInformation: 0.08,
        marginalExpectedGain: 0.02,
        marginalExpectedCost: 0.02,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: `Supported candidate ${bestSupported.candidateManifestId} reached confidence ${bestSupported.hypothesisOutcome.confidence.toFixed(2)} >= ${this.confidenceStopThreshold} with 0 unexplained failure signals.`,
      };
    }

    // 6. Check contradictory / noisy probes -> EXPAND_REPLICATION or STOP
    const inconclusiveCount = contrastsSoFar.filter(
      (c) => c.hypothesisOutcome.verdict === 'inconclusive',
    ).length;
    if (inconclusiveCount >= 2 && stepIndex >= 2) {
      return {
        action: 'STOP',
        stopReason: 'CONTRADICTORY_PROBE_NOISE',
        expectedValueOfInformation: 0.1,
        marginalExpectedGain: 0.01,
        marginalExpectedCost: 0.03,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: `Repeated probes produced ${inconclusiveCount} inconclusive/noisy contrasts.`,
      };
    }

    if (unexplainedSignalsCount === 0 && bestSupported) {
      return {
        action: 'STOP',
        stopReason: 'NO_NEW_FAILURE_SIGNALS_EXPLAINED',
        expectedValueOfInformation: 0.1,
        marginalExpectedGain: 0.02,
        marginalExpectedCost: 0.02,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: 'All observed failure signals have been explained by a supported candidate.',
      };
    }

    // 7. Compute marginal expected gain vs marginal expected cost (VoI)
    const meanProbeCost =
      accounting.probesExecuted > 0
        ? accounting.totalCostDollars / accounting.probesExecuted
        : 0.02;
    const marginalExpectedCost = Math.max(0.005, Number(meanProbeCost.toFixed(4)));
    const remainingUpside = bestSupported
      ? Math.max(0.02, 1.0 - bestSupported.passRateDelta)
      : 0.35;
    const marginalExpectedGain = Number(
      (remainingUpside * poolDiversityScore * Math.pow(0.75, stepIndex)).toFixed(4),
    );
    const expectedValueOfInformation = Number(
      (marginalExpectedGain / Math.max(0.01, marginalExpectedCost * 10)).toFixed(4),
    );

    if (expectedValueOfInformation < this.minMarginalGainToCostRatio && stepIndex >= 1) {
      return {
        action: 'STOP',
        stopReason: 'LOW_MARGINAL_VALUE_OF_INFORMATION',
        expectedValueOfInformation,
        marginalExpectedGain,
        marginalExpectedCost,
        poolDiversityScore,
        recommendedRepetitions: 1,
        rationale: `Expected Value of Information (${expectedValueOfInformation.toFixed(2)}) fell below threshold (${this.minMarginalGainToCostRatio.toFixed(2)}).`,
      };
    }

    // 8. Expansion signal: structural change or conflicting evidence requires replication
    if (hasStructuralCandidate || inconclusiveCount === 1) {
      return {
        action: 'EXPAND_REPLICATION',
        expectedValueOfInformation,
        marginalExpectedGain,
        marginalExpectedCost,
        poolDiversityScore,
        recommendedRepetitions: 2,
        rationale:
          'High-value uncertainty or structural candidate detected; expanding probe replication to 2 matched runs.',
      };
    }

    return {
      action: 'CONTINUE',
      expectedValueOfInformation,
      marginalExpectedGain,
      marginalExpectedCost,
      poolDiversityScore,
      recommendedRepetitions: 1,
      rationale: `Continuing recursion at step ${stepIndex} (VoI=${expectedValueOfInformation.toFixed(2)}, diversity=${poolDiversityScore.toFixed(2)}).`,
    };
  }

  private computePoolDiversity(
    contrasts: ReadonlyArray<BehavioralContrast>,
  ): number {
    if (contrasts.length <= 1) return 1.0;
    const distinctDeltas = new Set(
      contrasts.map(
        (c) =>
          `${c.passRateDelta.toFixed(2)}:${c.resolvedFailureSignals.join(',')}:${c.hypothesisOutcome.verdict}`,
      ),
    );
    return Number((distinctDeltas.size / contrasts.length).toFixed(4));
  }
}

export function createEmptyResourceAccounting(): EvolutionResourceAccounting {
  return {
    modelCalls: 0,
    policyTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    wallTimeMs: 0,
    totalCostDollars: 0,
    contextMemoryTrafficTokens: 0,
    verificationCostDollars: 0,
    probesExecuted: 0,
  };
}

export function accumulateEvidenceAccounting(
  current: EvolutionResourceAccounting,
  bundle: {
    readonly baseTrials: ReadonlyArray<{
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly cachedTokens: number;
      readonly toolCalls: number;
      readonly durationMs: number;
      readonly costDollars: number;
    }>;
    readonly candidateTrials: ReadonlyArray<{
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly cachedTokens: number;
      readonly toolCalls: number;
      readonly durationMs: number;
      readonly costDollars: number;
    }>;
  },
): EvolutionResourceAccounting {
  let cached = current.cachedInputTokens;
  let uncached = current.uncachedInputTokens;
  let output = current.outputTokens;
  let tools = current.toolCalls;
  let wall = current.wallTimeMs;
  let cost = current.totalCostDollars;

  const allTrials = [...bundle.baseTrials, ...bundle.candidateTrials];
  for (const trial of allTrials) {
    cached += trial.cachedTokens;
    uncached += Math.max(0, trial.promptTokens - trial.cachedTokens);
    output += trial.completionTokens;
    tools += trial.toolCalls;
    wall += trial.durationMs;
    cost += trial.costDollars;
  }

  return {
    modelCalls: current.modelCalls + allTrials.length,
    policyTokens: current.policyTokens + allTrials.length * 150,
    cachedInputTokens: cached,
    uncachedInputTokens: uncached,
    outputTokens: output,
    toolCalls: tools,
    wallTimeMs: wall,
    totalCostDollars: Number(cost.toFixed(6)),
    contextMemoryTrafficTokens: cached + uncached,
    verificationCostDollars: Number(
      (current.verificationCostDollars + allTrials.length * 0.0005).toFixed(6),
    ),
    probesExecuted: current.probesExecuted + 1,
  };
}
