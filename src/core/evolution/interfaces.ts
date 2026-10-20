/**
 * Core Evolution Plane Interfaces & Multi-Objective / Admission Contracts.
 *
 * Defines ports for the Propose–Probe–Compose engine, Regularizer, Experience Library,
 * Multi-Objective Selector, Retention Suite, and Fail-Closed Admission Gate.
 *
 * Dependency Rule: Evolution Plane -> Runtime interfaces (never Runtime -> concrete Evolution).
 */
import type {
  HarnessId,
  CandidateId,
  AdmissionId,
  ExperienceEntryId,
  EvolutionRunId,
} from '../types/identifiers.js';
import type { IterationTraceRecord } from '../model/trace-types.js';
import type { ExecutionResult } from '../model/runtime-types.js';
import type {
  EvidenceLevel,
  HarnessConstitution,
} from './constitution.js';
import type {
  HarnessManifest,
  HarnessManifestDiff,
  HarnessTargetProfile,
} from './harness-manifest.js';
import type {
  FailureSignal,
  FailureSignalType,
} from './failure-taxonomy.js';
import type {
  HarnessChangeHypothesis,
  HypothesisOutcome,
  ApplicabilityConditions,
  PredictedEffect,
  EvidenceBundle,
  BehavioralContrast,
  HarnessCompositionRecord,
} from './hypothesis.js';
import type { HarnessSurfaceRegistry } from './surface-registry.js';

// ---------------------------------------------------------------------------
// Candidate Proposal & Regularization
// ---------------------------------------------------------------------------

export interface ProposedCandidate {
  readonly candidateId: CandidateId;
  readonly manifest: HarnessManifest;
  readonly diffFromBase: HarnessManifestDiff;
  readonly hypothesis: HarnessChangeHypothesis;
}

export interface RegularizationVerdict {
  readonly candidateId: CandidateId;
  readonly approved: boolean;
  readonly editBudgetPassed: boolean;
  readonly noveltyScore: number; // 0.0 - 1.0
  readonly benchmarkSpecificityScore: number; // 0.0 (clean) - 1.0 (memorized/leaked)
  readonly generalizationScore: number; // 0.0 - 1.0
  readonly complexityPenalty: number; // >= 0
  readonly prunedSurfaces: ReadonlyArray<string>;
  readonly rejectionReasons: ReadonlyArray<string>;
  readonly auditTimestamp: string;
}

export interface RegularizationBatchResult {
  readonly approved: ReadonlyArray<ProposedCandidate>;
  readonly rejected: ReadonlyArray<{
    readonly candidate: ProposedCandidate;
    readonly verdict: RegularizationVerdict;
  }>;
  readonly verdicts: ReadonlyArray<RegularizationVerdict>;
}

// ---------------------------------------------------------------------------
// Multi-Objective Selection & Pareto Frontier
// ---------------------------------------------------------------------------

export type DeploymentProfileName =
  | 'quality_first'
  | 'balanced'
  | 'low_cost'
  | 'low_latency'
  | 'high_assurance';

export interface MultiObjectiveWeights {
  readonly quality: number;
  readonly cost: number;
  readonly latency: number;
  readonly toolReliability: number;
  readonly safety: number;
  readonly regression: number;
  readonly generalization: number;
}

export interface MultiObjectiveVector {
  readonly qualityScore: number; // Q in [0, 1]
  readonly costScore: number; // C normalized cost penalty in [0, 1]
  readonly latencyScore: number; // L normalized latency penalty in [0, 1]
  readonly toolErrorPenalty: number; // E_tool in [0, 1]
  readonly safetyRiskPenalty: number; // R_safety in [0, 1]
  readonly regressionPenalty: number; // R_regression in [0, 1]
  readonly generalizationBonus: number; // G_OOD in [-1, 1]
  readonly variancePenalty: number; // across repetitions in [0, 1]
}

export interface EvaluatedCandidate {
  readonly manifest: HarnessManifest;
  readonly evidenceBundle: EvidenceBundle;
  readonly contrast: BehavioralContrast;
  readonly objectives: MultiObjectiveVector;
  readonly utilityByProfile: Readonly<Record<DeploymentProfileName, number>>;
  readonly isParetoOptimal: boolean;
  readonly dominatedByIds: ReadonlyArray<HarnessId>;
}

export interface CandidateSelectionResult {
  readonly activeProfile: DeploymentProfileName;
  readonly selectedCandidate: EvaluatedCandidate | null;
  readonly paretoFrontier: ReadonlyArray<EvaluatedCandidate>;
  readonly allEvaluated: ReadonlyArray<EvaluatedCandidate>;
  readonly baselinepreserved: boolean;
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Harness-Induced Forgetting & Retention (EvoHarnessBench)
// ---------------------------------------------------------------------------

export type RetentionCapabilityCategory =
  | 'file_editing'
  | 'multi_file_refactoring'
  | 'test_diagnosis'
  | 'git_safety'
  | 'shell_tasks'
  | 'python_coding'
  | 'typescript_coding'
  | 'dependency_management'
  | 'context_intensive'
  | 'long_horizon_repair'
  | 'tool_orchestration';

export type CapabilityRetentionState =
  | 'retained'
  | 'newly_acquired'
  | 'forgotten'
  | 'unstable';

export interface CapabilityRetentionRecord {
  readonly capability: RetentionCapabilityCategory;
  readonly baselinePassed: boolean;
  readonly candidatePassRate: number;
  readonly state: CapabilityRetentionState;
  readonly details: string;
}

export interface RetentionSuiteResult {
  readonly baseManifestId: HarnessId;
  readonly candidateManifestId: HarnessId;
  readonly retainedCount: number;
  readonly newlyAcquiredCount: number;
  readonly forgottenCount: number;
  readonly unstableCount: number;
  readonly records: ReadonlyArray<CapabilityRetentionRecord>;
  readonly passed: boolean; // true iff forgottenCount === 0
}

// ---------------------------------------------------------------------------
// Admission & Promotion Gate
// ---------------------------------------------------------------------------

export type AdmissionStatus =
  | 'promoted'
  | 'task_only'
  | 'library_only'
  | 'rejected'
  | 'inconclusive'
  | 'quarantined';

export interface AdmissionGateCriteria {
  readonly targetScope: 'task' | 'library' | 'global_promotion';
  readonly maxCostRegressionRatio: number; // e.g. 0.15 (+15% max)
  readonly maxLatencyRegressionRatio: number; // e.g. 0.20 (+20% max)
  readonly minHeldOutPassDelta: number; // >= 0.0
  readonly requireZeroForgottenCapabilities: boolean;
  readonly requireZeroSecurityViolations: boolean;
}

export interface AdmissionDecision {
  readonly id: AdmissionId;
  readonly candidateManifestId: HarnessId;
  readonly candidateManifestHash: string;
  readonly baseManifestId: HarnessId;
  readonly status: AdmissionStatus;
  readonly evidenceLevelVerified: EvidenceLevel;
  readonly structuralValidationPassed: boolean;
  readonly constitutionalCheckPassed: boolean;
  readonly evolveSplitPassed: boolean;
  readonly heldOutSplitPassed: boolean;
  readonly oodSplitPassed: boolean;
  readonly retentionResult?: RetentionSuiteResult;
  readonly costRegressionPassed: boolean;
  readonly latencyRegressionPassed: boolean;
  readonly privilegeCheckPassed: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly decidedAt: string;
  readonly signature?: string;
}

// ---------------------------------------------------------------------------
// Experience Library
// ---------------------------------------------------------------------------

export interface ExperienceEntry {
  readonly id: ExperienceEntryId;
  readonly manifest: HarnessManifest;
  readonly manifestHash: string;
  readonly diffFromBaseline: HarnessManifestDiff;
  readonly applicability: ApplicabilityConditions;
  readonly motivatingFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly hypothesis: HarnessChangeHypothesis;
  readonly predictedEffects: ReadonlyArray<PredictedEffect>;
  readonly hypothesisOutcome: HypothesisOutcome;
  readonly positiveEvidence: ReadonlyArray<string>;
  readonly negativeEvidence: ReadonlyArray<string>;
  readonly contradictedPredictions: ReadonlyArray<string>;
  readonly observedEffectSizes: Readonly<Record<string, number>>;
  readonly probeBundleIds: ReadonlyArray<string>;
  readonly repetitionsCount: number;
  readonly targetProfile: HarnessTargetProfile;
  readonly taskDomainProvenance: ReadonlyArray<string>;
  readonly tokenDelta: number;
  readonly costDollarsDelta: number;
  readonly latencyMsDelta: number;
  readonly safetyImpact: 'NONE' | 'IMPROVED' | 'DEGRADED';
  readonly heldOutEvidenceLevel: EvidenceLevel;
  readonly retentionPassed: boolean;
  readonly admissionStatus: AdmissionStatus;
  readonly confidence: number;
  readonly createdAt: string;
  readonly lastValidatedAt: string;
  readonly expiresAt?: string;
  readonly status: 'ACTIVE' | 'STALE' | 'SUPERSEDED' | 'QUARANTINED' | 'PRUNED';
  readonly supersededById?: ExperienceEntryId;
  readonly auditSignature?: string;
}

export interface ExperienceLibraryQuery {
  readonly domain?: string;
  readonly language?: string;
  readonly modelFamily?: string;
  readonly failureSignals?: ReadonlyArray<FailureSignalType>;
  readonly includeNegativeEvidence?: boolean;
  readonly includeStale?: boolean;
  readonly minConfidence?: number;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Recursion Budget & Telemetry
// ---------------------------------------------------------------------------

export interface EvolutionResourceAccounting {
  readonly modelCalls: number;
  readonly policyTokens: number;
  readonly cachedInputTokens: number;
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  readonly wallTimeMs: number;
  readonly totalCostDollars: number;
  readonly contextMemoryTrafficTokens: number;
  readonly verificationCostDollars: number;
  readonly probesExecuted: number;
}

export type RecursionStopReason =
  | 'CONFIDENCE_THRESHOLD_REACHED'
  | 'LOW_MARGINAL_VALUE_OF_INFORMATION'
  | 'BEHAVIORAL_REDUNDANCY'
  | 'DIVERSITY_COLLAPSE'
  | 'CONTRADICTORY_PROBE_NOISE'
  | 'NO_NEW_FAILURE_SIGNALS_EXPLAINED'
  | 'BUDGET_EXHAUSTED'
  | 'SAFETY_RISK_THRESHOLD_EXCEEDED'
  | 'MAX_STEPS_REACHED';

export interface RecursionBudgetDecision {
  readonly action: 'CONTINUE' | 'EXPAND_REPLICATION' | 'STOP';
  readonly stopReason?: RecursionStopReason;
  readonly expectedValueOfInformation: number;
  readonly marginalExpectedGain: number;
  readonly marginalExpectedCost: number;
  readonly poolDiversityScore: number;
  readonly recommendedRepetitions: number;
  readonly rationale: string;
}

export interface ReproducibilityManifest {
  readonly evolutionRunId: EvolutionRunId;
  readonly viHarnessCommit: string;
  readonly baseManifestId: HarnessId;
  readonly baseManifestHash: string;
  readonly finalManifestId: HarnessId;
  readonly finalManifestHash: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly environmentFingerprint: string;
  readonly taskIdentifier: string;
  readonly recursionStrategy: 'parallel' | 'sequential' | 'adaptive';
  readonly deploymentProfile: DeploymentProfileName;
  readonly budgetProfile: HarnessManifest['budgetProfile'];
  readonly librarySnapshotHash: string;
  readonly seedsUsed: ReadonlyArray<number>;
  readonly networkEgressPolicy: string;
  readonly securityProfile: HarnessManifest['securityProfile'];
  readonly resourceAccounting: EvolutionResourceAccounting;
  readonly admissionStatus: AdmissionStatus;
  readonly createdAt: string;
  readonly signature?: string;
}

// ---------------------------------------------------------------------------
// Subsystem Service Ports
// ---------------------------------------------------------------------------

export interface HarnessDiagnoser {
  diagnoseRun(params: {
    readonly runId: string;
    readonly traces: ReadonlyArray<IterationTraceRecord>;
    readonly executionResult?: ExecutionResult;
  }): ReadonlyArray<FailureSignal>;

  diagnoseAcrossRuns(
    runs: ReadonlyArray<{
      readonly runId: string;
      readonly traces: ReadonlyArray<IterationTraceRecord>;
      readonly executionResult?: ExecutionResult;
    }>,
  ): ReadonlyArray<FailureSignal>;
}

export interface HarnessProposer {
  propose(params: {
    readonly baseManifest: HarnessManifest;
    readonly failureSignals: ReadonlyArray<FailureSignal>;
    readonly libraryEntries: ReadonlyArray<ExperienceEntry>;
    readonly failedHypotheses: ReadonlyArray<HarnessChangeHypothesis>;
    readonly constitution: HarnessConstitution;
    readonly surfaceRegistry: HarnessSurfaceRegistry;
    readonly maxCandidates: number;
    readonly iterationStep: number;
  }): Promise<ReadonlyArray<ProposedCandidate>>;
}

export interface CandidateRegularizer {
  regularize(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly priorCandidates: ReadonlyArray<ProposedCandidate>;
    readonly iterationStep: number;
  }): RegularizationBatchResult;
}

export interface ProbeTaskSpec {
  readonly taskId: string;
  readonly prompt: string;
  readonly split: 'evolve' | 'held_out' | 'ood' | 'retention';
  readonly domain?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly workspacePath?: string;
  readonly repetitions?: number;
  readonly seeds?: ReadonlyArray<number>;
}


export interface HarnessProbeRunner {
  runPairedProbe(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly tasks: ReadonlyArray<ProbeTaskSpec>;
    readonly callerRole: 'proposer' | 'probe_runner' | 'admission_gate';
  }): Promise<EvidenceBundle>;
}

export interface BehavioralContrastAnalyzer {
  analyze(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly evidenceBundle: EvidenceBundle;
    readonly peerContrasts?: ReadonlyArray<BehavioralContrast>;
  }): BehavioralContrast;
}

export interface HarnessComposer {
  compose(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
    readonly surfaceRegistry: HarnessSurfaceRegistry;
    readonly constitution: HarnessConstitution;
  }): Promise<HarnessCompositionRecord>;
}

export interface HarnessCandidateSelector {
  select(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<{
      readonly manifest: HarnessManifest;
      readonly evidenceBundle: EvidenceBundle;
      readonly contrast: BehavioralContrast;
    }>;
    readonly profile: DeploymentProfileName;
  }): CandidateSelectionResult;
}

export interface HarnessAdmissionGate {
  evaluate(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidateManifest: HarnessManifest;
    readonly diffFromBase: HarnessManifestDiff;
    readonly evolveEvidence: EvidenceBundle;
    readonly heldOutEvidence?: EvidenceBundle;
    readonly oodEvidence?: EvidenceBundle;
    readonly retentionResult?: RetentionSuiteResult;
    readonly criteria: AdmissionGateCriteria;
  }): Promise<AdmissionDecision>;

  promoteToCanonicalBaseline(
    candidateManifest: HarnessManifest,
    decision: AdmissionDecision,
  ): Promise<HarnessManifest>;

  rollbackBaseline(targetManifestId?: HarnessId): Promise<HarnessManifest>;
  getCanonicalBaseline(): HarnessManifest;
}

export interface HarnessReflector {
  reflect(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly evidenceBundle: EvidenceBundle;
    readonly contrast: BehavioralContrast;
    readonly admissionDecision: AdmissionDecision;
    readonly taskDomain: string;
  }): ExperienceEntry;
}

export interface HarnessExperienceLibrary {
  record(entry: ExperienceEntry): Promise<void>;
  get(id: ExperienceEntryId): Promise<ExperienceEntry | null>;
  query(filter?: ExperienceLibraryQuery): Promise<ReadonlyArray<ExperienceEntry>>;
  deduplicateAndConsolidate(): Promise<{
    readonly mergedCount: number;
    readonly quarantinedCount: number;
  }>;
  prune(nowIso?: string): Promise<{
    readonly prunedIds: ReadonlyArray<ExperienceEntryId>;
  }>;
  invalidate(id: ExperienceEntryId, reason: string): Promise<void>;
  quarantine(id: ExperienceEntryId, reason: string): Promise<void>;
  computeSnapshotHash(): Promise<string>;
}

export interface RecursionBudgetPolicy {
  evaluateStep(params: {
    readonly stepIndex: number;
    readonly maxSteps: number;
    readonly accounting: EvolutionResourceAccounting;
    readonly budgetProfile: HarnessManifest['budgetProfile'];
    readonly contrastsSoFar: ReadonlyArray<BehavioralContrast>;
    readonly unexplainedSignalsCount: number;
    readonly hasStructuralCandidate: boolean;
  }): RecursionBudgetDecision;
}

export interface RecursionStrategyContext {
  readonly runId: EvolutionRunId;
  readonly baseManifest: HarnessManifest;
  readonly tasks: ReadonlyArray<ProbeTaskSpec>;
  readonly maxCandidatesPerStep: number;
  readonly maxSteps: number;
  readonly profile: DeploymentProfileName;
  readonly diagnoser: HarnessDiagnoser;
  readonly proposer: HarnessProposer;
  readonly regularizer: CandidateRegularizer;
  readonly probeRunner: HarnessProbeRunner;
  readonly contrastAnalyzer: BehavioralContrastAnalyzer;
  readonly composer: HarnessComposer;
  readonly selector: HarnessCandidateSelector;
  readonly budgetPolicy: RecursionBudgetPolicy;
  readonly library: HarnessExperienceLibrary;
  readonly constitution: HarnessConstitution;
  readonly surfaceRegistry: HarnessSurfaceRegistry;
  readonly initialSignals: ReadonlyArray<FailureSignal>;
}

export interface CandidateDagNode {
  readonly stepIndex: number;
  readonly manifestId: HarnessId;
  readonly parentManifestIds: ReadonlyArray<HarnessId>;
  readonly contrastId?: string;
  readonly utilityScore?: number;
}

export interface RecursionStrategyResult {
  readonly strategyName: 'parallel' | 'sequential' | 'adaptive';
  readonly selectedManifest: HarnessManifest;
  readonly selectionResult: CandidateSelectionResult;
  readonly candidateDag: ReadonlyArray<CandidateDagNode>;
  readonly allProposed: ReadonlyArray<ProposedCandidate>;
  readonly allRejectedByRegularizer: RegularizationBatchResult['rejected'];
  readonly allEvidenceBundles: ReadonlyArray<EvidenceBundle>;
  readonly allContrasts: ReadonlyArray<BehavioralContrast>;
  readonly compositions: ReadonlyArray<HarnessCompositionRecord>;
  readonly accounting: EvolutionResourceAccounting;
  readonly stopReason: RecursionStopReason;
}

export interface RecursionStrategy {
  readonly name: 'parallel' | 'sequential' | 'adaptive';
  execute(context: RecursionStrategyContext): Promise<RecursionStrategyResult>;
}
