/**
 * Falsifiable Change Hypotheses, Evidence Bundles, and Behavioral Contrasts (AHE & Harness²).
 *
 * Every candidate harness modification must pre-declare its falsifiable hypothesis before
 * probing, and produce an empirical EvidenceBundle + BehavioralContrast after probing.
 */
import type {
  HarnessId,
  CandidateId,
  ProbeId,
  ContrastId,
  CompositionId,
  HypothesisId,
  TaskId,
} from '../types/identifiers.js';
import type { EvidenceLevel, ComponentCapabilityClass } from './constitution.js';
import type {
  FailureSignalType,
  CandidateExplorationQuadrant,
} from './failure-taxonomy.js';
import type { HarnessManifest, HarnessManifestDiff } from './harness-manifest.js';

export type ScopeAxis = 'INVARIANT' | 'DOMAIN_SPECIFIC';
export type MechanismAxis = 'GUIDANCE' | 'STRUCTURAL';

export interface ApplicabilityConditions {
  readonly domains?: ReadonlyArray<string>;
  readonly languages?: ReadonlyArray<string>;
  readonly modelFamilies?: ReadonlyArray<string>;
  readonly taskCategories?: ReadonlyArray<string>;
  readonly triggerSignals: ReadonlyArray<FailureSignalType>;
}

export interface PredictedEffect {
  readonly metric:
    | 'pass_rate'
    | 'tokens'
    | 'cost_dollars'
    | 'latency_ms'
    | 'cache_hit_ratio'
    | 'tool_error_rate'
    | 'regression_rate'
    | 'security_violations';
  readonly direction: 'INCREASE' | 'DECREASE' | 'PRESERVE';
  readonly expectedDeltaMagnitude?: number;
  readonly rationale: string;
}

export interface EditBudgetAllocation {
  readonly maxSurfacesModified: number;
  readonly maxUnitsChanged: number;
  readonly maxCapabilityClass: ComponentCapabilityClass;
  readonly iterationStep: number;
}

export interface HarnessChangeHypothesis {
  readonly id: HypothesisId;
  readonly candidateId: CandidateId;
  readonly baseManifestId: HarnessId;
  readonly scopeAxis: ScopeAxis;
  readonly mechanismAxis: MechanismAxis;
  readonly quadrant: CandidateExplorationQuadrant;
  readonly targetComponents: ReadonlyArray<string>;
  readonly observedFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly rationale: string;
  readonly applicability: ApplicabilityConditions;
  readonly predictedEffects: ReadonlyArray<PredictedEffect>;
  readonly predictedTradeoffs: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
  readonly editBudget: EditBudgetAllocation;
  readonly generalizationClaim: string;
  readonly createdAt: string;
}

export type HypothesisVerdict = 'supported' | 'contradicted' | 'inconclusive';

export interface HypothesisOutcome {
  readonly hypothesisId: HypothesisId;
  readonly candidateId: CandidateId;
  readonly verdict: HypothesisVerdict;
  readonly observedEffects: ReadonlyArray<{
    readonly metric: string;
    readonly delta: number;
    readonly matchedPrediction: boolean;
  }>;
  readonly unexpectedEffects: ReadonlyArray<string>;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly confidence: number; // 0.0 - 1.0
  readonly summary: string;
}

export interface ProbeTrialMetrics {
  readonly trialIndex: number;
  readonly taskId: TaskId | string;
  readonly seed?: number;
  readonly success: boolean;
  readonly partialScore: number; // 0.0 - 1.0
  readonly verifierPassed: boolean;
  readonly iterationCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly totalTokens: number;
  readonly cacheHitRatio: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly policyViolations: number;
  readonly regressionsDetected: number;
  readonly oscillationsDetected: number;
  readonly durationMs: number;
  readonly costDollars: number;
  readonly contextMemoryTrafficTokens: number;
  readonly verificationCostDollars: number;
  readonly finalPhase: string;
  readonly failureSignalsObserved: ReadonlyArray<FailureSignalType>;
  readonly outputArtifactRefs: ReadonlyArray<string>;
  readonly infrastructureError?: string;
}

export interface EvidenceBundle {
  readonly id: ProbeId;
  readonly evidenceLevel: EvidenceLevel;
  readonly baseManifestId: HarnessId;
  readonly baseManifestHash: string;
  readonly candidateManifestId: HarnessId;
  readonly candidateManifestHash: string;
  readonly hypothesisId: HypothesisId;
  readonly taskIds: ReadonlyArray<string>;
  readonly split: 'evolve' | 'held_out' | 'ood' | 'retention';
  readonly modelId: string;
  readonly providerId: string;
  readonly modelParameters: Readonly<Record<string, unknown>>;
  readonly environmentFingerprint: string;
  readonly networkEgressPolicy: string;
  readonly tokenBudget: number;
  readonly wallTimeBudgetMs: number;
  readonly repetitions: number;
  readonly baseTrials: ReadonlyArray<ProbeTrialMetrics>;
  readonly candidateTrials: ReadonlyArray<ProbeTrialMetrics>;
  readonly negativeResultsPreserved: boolean;
  readonly createdAt: string;
  readonly provenanceHash: string;
  readonly signature?: string;
}

export interface BehavioralContrast {
  readonly id: ContrastId;
  readonly evidenceBundleId: ProbeId;
  readonly baseManifestId: HarnessId;
  readonly candidateManifestId: HarnessId;
  readonly hypothesisId: HypothesisId;
  readonly passRateDelta: number;
  readonly partialScoreDelta: number;
  readonly meanTokensDelta: number;
  readonly meanCostDollarsDelta: number;
  readonly meanLatencyMsDelta: number;
  readonly cacheHitRatioDelta: number;
  readonly toolErrorRateDelta: number;
  readonly policyViolationDelta: number;
  readonly regressionDelta: number;
  readonly candidateVariance: number;
  readonly confidenceInterval95: readonly [number, number];
  readonly resolvedFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly newlyIntroducedFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly behavioralDiversityScore: number; // 0.0 (identical) - 1.0 (distinct)
  readonly hypothesisOutcome: HypothesisOutcome;
  readonly summary: string;
}

export type ComponentCompositionAction =
  | 'preserve_baseline'
  | 'select_candidate'
  | 'revise_candidate'
  | 'combine_candidates'
  | 'reject_all';

export interface ComponentCompositionDecision {
  readonly surfaceId: string;
  readonly action: ComponentCompositionAction;
  readonly selectedFromManifestIds: ReadonlyArray<HarnessId>;
  readonly supportingContrastIds: ReadonlyArray<ContrastId>;
  readonly rationale: string;
}

export interface HarnessCompositionRecord {
  readonly id: CompositionId;
  readonly baseManifestId: HarnessId;
  readonly inputCandidateIds: ReadonlyArray<HarnessId>;
  readonly composedManifest: HarnessManifest;
  readonly manifestDiffFromBase: HarnessManifestDiff;
  readonly componentDecisions: ReadonlyArray<ComponentCompositionDecision>;
  readonly rejectedCandidateIds: ReadonlyArray<HarnessId>;
  readonly createdAt: string;
}
