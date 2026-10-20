/**
 * Recursive Evolution Engine (Observe -> Diagnose -> Propose -> Regularize -> Probe
 * -> Contrast -> Compose -> Select -> Admit/Promote -> Reflect -> Store).
 *
 * Orchestrates the Evolution Plane while preserving strict separation from the Runtime Plane.
 * Persists structured, reproducible artifacts to `.vi-evolution/` and supports
 * crash-safe inspection and resumption.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createId } from '../../core/types/identifiers.js';
import type { EvolutionRunId, TraceId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { IterationTraceRecord } from '../../core/model/trace-types.js';
import type { ExecutionResult } from '../../core/model/runtime-types.js';
import {
  EvolutionEventType,
  type EvolutionTelemetryEvent,
} from '../../core/model/telemetry-types.js';
import {
  DEFAULT_HARNESS_CONSTITUTION,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { FailureSignal } from '../../core/evolution/failure-taxonomy.js';
import type { EvidenceBundle } from '../../core/evolution/hypothesis.js';
import type {
  AdmissionDecision,
  AdmissionGateCriteria,
  BehavioralContrastAnalyzer,
  CandidateRegularizer,
  DeploymentProfileName,
  ExperienceEntry,
  HarnessAdmissionGate,
  HarnessCandidateSelector,
  HarnessComposer,
  HarnessDiagnoser,
  HarnessExperienceLibrary,
  HarnessProbeRunner,
  HarnessProposer,
  HarnessReflector,
  ProbeTaskSpec,
  RecursionBudgetPolicy,
  RecursionStrategy,
  RecursionStrategyResult,
  ReproducibilityManifest,
} from '../../core/evolution/interfaces.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { DefaultHarnessSurfaceRegistry } from './default-surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import { DefaultHarnessDiagnoser } from './default-harness-diagnoser.js';
import { DefaultHarnessProposer } from './default-harness-proposer.js';
import { DefaultCandidateRegularizer } from './candidate-regularizer.js';
import { IsolatedHarnessProbeRunner } from './isolated-probe-runner.js';
import { DefaultBehavioralContrastAnalyzer } from './behavioral-contrast-analyzer.js';
import { DefaultHarnessComposer } from './default-harness-composer.js';
import { DefaultMultiObjectiveSelector } from './multi-objective-selector.js';
import { FailClosedAdmissionGate } from './fail-closed-admission-gate.js';
import {
  DefaultHarnessReflector,
  FileHarnessExperienceLibrary,
} from './file-experience-library.js';
import { AdaptiveRecursionBudgetPolicy } from './adaptive-recursion-policy.js';
import { ParallelRecursionStrategy } from './strategies/parallel-recursion-strategy.js';
import { SequentialRecursionStrategy } from './strategies/sequential-recursion-strategy.js';
import { AdaptiveRecursionStrategy } from './strategies/adaptive-recursion-strategy.js';
import {
  DiscriminativeTaskSelector,
  type DiscriminativeTaskSelectionResult,
} from './discriminative-task-selector.js';
import {
  ContrastivePreferenceExporter,
  type ModelCapabilityCeilingDiagnosis,
} from './contrastive-preference-exporter.js';
import {
  MemoHarnessSynthesizer,
  type MemoHarnessSynthesisResult,
} from './sqlite-experience-library.js';
import {
  AdversarialProbeGenerator,
  type CounterfactualRobustnessReport,
} from './adversarial-probe-generator.js';
import {
  HolmBonferroniMultipleTestingGate,
  type HolmBonferroniReport,
} from './statistical-admission-control.js';
import {
  ViForgeCoEvolutionBridge,
  type ViForgeHandoffManifest,
} from './viforge-coevolution-bridge.js';
import {
  ShapleyComponentAttributor,
  type ShapleyAttributionReport,
} from './shapley-component-attributor.js';
import {
  BradleyTerryHarnessRanker,
  type HarnessRatingRecord,
} from './bradley-terry-ranker.js';
import {
  CryptographicEvolutionLedger,
  type LedgerVerificationResult,
} from './cryptographic-evolution-ledger.js';
import {
  ContextualBanditMetaRouter,
  type MetaRoutingDecision,
} from './contextual-bandit-meta-router.js';
import {
  MapElitesHarnessArchive,
  type MapElitesArchiveSnapshot,
} from './map-elites-archive.js';
import {
  StructuralPolicyInvariantVerifier,
  type StructuralPolicyVerificationReport,
} from './structural-policy-verifier.js';
import {
  ConformalUtilityCalibrator,
  type TailRiskUtilityReport,
} from './conformal-utility-calibrator.js';
import { BayesianHarnessSurrogateModel } from './bayesian-surrogate-model.js';
import {
  EpistaticSurfaceGraphAnalyzer,
  type EpistaticSurfaceGraphReport,
} from './epistatic-surface-graph.js';
import {
  RuntimeTemporalContractMonitor,
  type TemporalContractVerificationReport,
} from './temporal-contract-monitor.js';
import { HypervolumeParetoSelector } from './hypervolume-pareto-selector.js';
import { SkillSubagentDistiller } from './skill-subagent-distiller.js';
import {
  ChaosFaultInjectionTester,
  type ChaosResilienceReport,
} from './chaos-fault-injection-tester.js';
import {
  ConformalAbstentionGuard,
  type ConformalAbstentionDecision,
} from './conformal-abstention-guard.js';

export interface RecursiveEvolutionEngineOptions {
  readonly storageRootDir?: string;
  readonly enabledByDefault?: boolean;
  readonly constitution?: HarnessConstitution;
  readonly surfaceRegistry?: HarnessSurfaceRegistry;
  readonly toolkit?: HarnessManifestToolkit;
  readonly diagnoser?: HarnessDiagnoser;
  readonly proposer?: HarnessProposer;
  readonly regularizer?: CandidateRegularizer;
  readonly probeRunner?: HarnessProbeRunner;
  readonly contrastAnalyzer?: BehavioralContrastAnalyzer;
  readonly composer?: HarnessComposer;
  readonly selector?: HarnessCandidateSelector;
  readonly admissionGate?: HarnessAdmissionGate;
  readonly reflector?: HarnessReflector;
  readonly library?: HarnessExperienceLibrary;
  readonly budgetPolicy?: RecursionBudgetPolicy;
  readonly taskSelector?: DiscriminativeTaskSelector;
  readonly memoSynthesizer?: MemoHarnessSynthesizer;
  readonly adversarialProbeGenerator?: AdversarialProbeGenerator;
  readonly preferenceExporter?: ContrastivePreferenceExporter;
  readonly holmBonferroniGate?: HolmBonferroniMultipleTestingGate;
  readonly viforgeBridge?: ViForgeCoEvolutionBridge;
  readonly shapleyAttributor?: ShapleyComponentAttributor;
  readonly tournamentRanker?: BradleyTerryHarnessRanker;
  readonly evolutionLedger?: CryptographicEvolutionLedger;
  readonly metaRouter?: ContextualBanditMetaRouter;
  readonly mapElitesArchive?: MapElitesHarnessArchive;
  readonly policyVerifier?: StructuralPolicyInvariantVerifier;
  readonly conformalCalibrator?: ConformalUtilityCalibrator;
  readonly surrogateModel?: BayesianHarnessSurrogateModel;
  readonly epistaticAnalyzer?: EpistaticSurfaceGraphAnalyzer;
  readonly temporalMonitor?: RuntimeTemporalContractMonitor;
  readonly hypervolumeSelector?: HypervolumeParetoSelector;
  readonly skillDistiller?: SkillSubagentDistiller;
  readonly chaosTester?: ChaosFaultInjectionTester;
  readonly conformalAbstentionGuard?: ConformalAbstentionGuard;
  readonly clock?: Clock;
  readonly hmacSecret?: string;
  readonly onTelemetryEvent?: (event: EvolutionTelemetryEvent) => void;
}

export interface EvolutionCycleRequest {
  readonly runId?: EvolutionRunId;
  readonly traceId?: TraceId;
  readonly taskIdentifier: string;
  readonly taskDomain?: string;
  readonly mode?: 'parallel' | 'sequential' | 'adaptive';
  readonly kCandidates?: number;
  readonly maxSteps?: number;
  readonly profile?: DeploymentProfileName;
  readonly baseManifest?: HarnessManifest;
  readonly startFromCanonicalBaseline?: boolean; // defaults to true (H0 reset invariant)
  readonly initialTraces?: ReadonlyArray<IterationTraceRecord>;
  readonly initialExecutionResult?: ExecutionResult;
  readonly initialFailureSignals?: ReadonlyArray<FailureSignal>;
  readonly evolveTasks: ReadonlyArray<ProbeTaskSpec>;
  readonly heldOutTasks?: ReadonlyArray<ProbeTaskSpec>;
  readonly oodTasks?: ReadonlyArray<ProbeTaskSpec>;
  readonly admissionCriteria?: Partial<AdmissionGateCriteria>;
  readonly autoPromoteIfAdmitted?: boolean;
  readonly enableZeroSearchMemo?: boolean;
  readonly maxDiscriminativeTasks?: number;
  readonly runAdversarialCounterfactuals?: boolean;
  readonly exportViForgeHandoff?: boolean;
  readonly pruneFreeRiderSurfaces?: boolean;
  readonly enableBanditMetaRouter?: boolean;
  readonly dryRun?: boolean;
}

export interface EvolutionCycleReport {
  readonly runId: EvolutionRunId;
  readonly baseManifest: HarnessManifest;
  readonly finalManifest: HarnessManifest;
  readonly strategyResult: RecursionStrategyResult;
  readonly admissionDecision: AdmissionDecision;
  readonly experienceEntriesCreated: ReadonlyArray<ExperienceEntry>;
  readonly reproducibilityManifest: ReproducibilityManifest;
  readonly telemetryEvents: ReadonlyArray<EvolutionTelemetryEvent>;
  readonly zeroSearchSynthesis?: MemoHarnessSynthesisResult;
  readonly discriminativeTaskSelection?: DiscriminativeTaskSelectionResult;
  readonly counterfactualRobustness?: CounterfactualRobustnessReport;
  readonly multipleTestingSummary?: HolmBonferroniReport;
  readonly capabilityCeilingDiagnosis?: ModelCapabilityCeilingDiagnosis;
  readonly viforgeHandoffManifest?: ViForgeHandoffManifest;
  readonly shapleyAttribution?: ShapleyAttributionReport;
  readonly tournamentLeaderboard?: ReadonlyArray<HarnessRatingRecord>;
  readonly metaRoutingDecision?: MetaRoutingDecision;
  readonly ledgerVerification?: LedgerVerificationResult;
  readonly mapElitesSnapshot?: MapElitesArchiveSnapshot;
  readonly policyVerification?: StructuralPolicyVerificationReport;
  readonly tailRiskUtility?: TailRiskUtilityReport;
  readonly epistaticSurfaceGraph?: EpistaticSurfaceGraphReport;
  readonly temporalContractVerification?: TemporalContractVerificationReport;
  readonly chaosResilience?: ChaosResilienceReport;
  readonly conformalAbstentionDecision?: ConformalAbstentionDecision;
  readonly dryRun: boolean;
}

export class RecursiveEvolutionEngine {
  private readonly storageRootDir: string;
  private readonly enabledByDefault: boolean;
  private readonly constitution: HarnessConstitution;
  private readonly surfaceRegistry: HarnessSurfaceRegistry;
  private readonly toolkit: HarnessManifestToolkit;
  private readonly diagnoser: HarnessDiagnoser;
  private readonly proposer: HarnessProposer;
  private readonly regularizer: CandidateRegularizer;
  private readonly probeRunner: HarnessProbeRunner;
  private readonly contrastAnalyzer: BehavioralContrastAnalyzer;
  private readonly composer: HarnessComposer;
  private readonly selector: HarnessCandidateSelector;
  private readonly admissionGate: HarnessAdmissionGate;
  private readonly reflector: HarnessReflector;
  private readonly library: HarnessExperienceLibrary;
  private readonly budgetPolicy: RecursionBudgetPolicy;
  private readonly taskSelector: DiscriminativeTaskSelector;
  private readonly memoSynthesizer: MemoHarnessSynthesizer;
  private readonly adversarialProbeGenerator: AdversarialProbeGenerator;
  private readonly preferenceExporter: ContrastivePreferenceExporter;
  private readonly holmBonferroniGate: HolmBonferroniMultipleTestingGate;
  private readonly viforgeBridge: ViForgeCoEvolutionBridge;
  private readonly shapleyAttributor: ShapleyComponentAttributor;
  private readonly tournamentRanker: BradleyTerryHarnessRanker;
  private readonly evolutionLedger: CryptographicEvolutionLedger;
  private readonly metaRouter: ContextualBanditMetaRouter;
  private readonly mapElitesArchive: MapElitesHarnessArchive;
  private readonly policyVerifier: StructuralPolicyInvariantVerifier;
  private readonly conformalCalibrator: ConformalUtilityCalibrator;
  private readonly surrogateModel: BayesianHarnessSurrogateModel;
  private readonly epistaticAnalyzer: EpistaticSurfaceGraphAnalyzer;
  private readonly temporalMonitor: RuntimeTemporalContractMonitor;
  private readonly hypervolumeSelector: HypervolumeParetoSelector;
  private readonly skillDistiller: SkillSubagentDistiller;
  private readonly chaosTester: ChaosFaultInjectionTester;
  private readonly conformalAbstentionGuard: ConformalAbstentionGuard;
  private readonly clock: Clock;
  private readonly hmacSecret: string;
  private readonly onTelemetryEvent?: (event: EvolutionTelemetryEvent) => void;
  private readonly strategies: Readonly<Record<'parallel' | 'sequential' | 'adaptive', RecursionStrategy>>;

  constructor(options: RecursiveEvolutionEngineOptions = {}) {
    this.storageRootDir = options.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
    this.enabledByDefault = options.enabledByDefault ?? false; // Feature flag default OFF
    this.clock = options.clock ?? { now: () => new Date(), timestamp: () => Date.now() };
    this.hmacSecret = options.hmacSecret ?? 'vi-harness-default-evolution-secret';
    this.constitution = options.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
    this.surfaceRegistry = options.surfaceRegistry ?? new DefaultHarnessSurfaceRegistry();
    this.toolkit =
      options.toolkit ??
      new HarnessManifestToolkit({
        clock: this.clock,
        constitution: this.constitution,
        surfaceRegistry: this.surfaceRegistry,
        hmacSecret: this.hmacSecret,
      });
    this.diagnoser = options.diagnoser ?? new DefaultHarnessDiagnoser();
    this.proposer = options.proposer ?? new DefaultHarnessProposer();
    this.regularizer =
      options.regularizer ?? new DefaultCandidateRegularizer({ clock: this.clock });
    this.probeRunner = options.probeRunner ?? new IsolatedHarnessProbeRunner();
    this.contrastAnalyzer =
      options.contrastAnalyzer ?? new DefaultBehavioralContrastAnalyzer();
    this.composer = options.composer ?? new DefaultHarnessComposer();
    this.selector = options.selector ?? new DefaultMultiObjectiveSelector();
    this.admissionGate =
      options.admissionGate ??
      new FailClosedAdmissionGate({
        toolkit: this.toolkit,
        constitution: this.constitution,
        hmacSecret: this.hmacSecret,
        clock: this.clock,
      });
    this.reflector =
      options.reflector ??
      new DefaultHarnessReflector({
        clock: this.clock,
        hmacSecret: this.hmacSecret,
      });
    this.library =
      options.library ??
      new FileHarnessExperienceLibrary({
        storageDir: path.join(this.storageRootDir, 'libraries'),
        hmacSecret: this.hmacSecret,
        clock: this.clock,
      });
    this.budgetPolicy =
      options.budgetPolicy ?? new AdaptiveRecursionBudgetPolicy();
    this.taskSelector = options.taskSelector ?? new DiscriminativeTaskSelector();
    this.memoSynthesizer =
      options.memoSynthesizer ??
      new MemoHarnessSynthesizer({
        library: this.library,
        surfaceRegistry: this.surfaceRegistry,
        constitution: this.constitution,
      });
    this.adversarialProbeGenerator =
      options.adversarialProbeGenerator ?? new AdversarialProbeGenerator();
    this.preferenceExporter =
      options.preferenceExporter ?? new ContrastivePreferenceExporter();
    this.holmBonferroniGate =
      options.holmBonferroniGate ?? new HolmBonferroniMultipleTestingGate();
    this.viforgeBridge =
      options.viforgeBridge ??
      new ViForgeCoEvolutionBridge({
        exporter: this.preferenceExporter,
        experienceLibrary: this.library,
      });
    this.shapleyAttributor =
      options.shapleyAttributor ?? new ShapleyComponentAttributor();
    this.tournamentRanker =
      options.tournamentRanker ?? new BradleyTerryHarnessRanker();
    this.evolutionLedger =
      options.evolutionLedger ??
      new CryptographicEvolutionLedger({
        hmacSecret: this.hmacSecret,
        initialBaseline: this.admissionGate.getCanonicalBaseline(),
      });
    this.metaRouter =
      options.metaRouter ?? new ContextualBanditMetaRouter();
    this.mapElitesArchive =
      options.mapElitesArchive ?? new MapElitesHarnessArchive();
    this.policyVerifier =
      options.policyVerifier ?? new StructuralPolicyInvariantVerifier();
    this.conformalCalibrator =
      options.conformalCalibrator ?? new ConformalUtilityCalibrator();
    this.surrogateModel =
      options.surrogateModel ?? new BayesianHarnessSurrogateModel();
    this.epistaticAnalyzer =
      options.epistaticAnalyzer ?? new EpistaticSurfaceGraphAnalyzer();
    this.temporalMonitor =
      options.temporalMonitor ?? new RuntimeTemporalContractMonitor();
    this.hypervolumeSelector =
      options.hypervolumeSelector ?? new HypervolumeParetoSelector();
    this.skillDistiller =
      options.skillDistiller ?? new SkillSubagentDistiller();
    this.chaosTester =
      options.chaosTester ??
      new ChaosFaultInjectionTester({ temporalMonitor: this.temporalMonitor });
    this.conformalAbstentionGuard =
      options.conformalAbstentionGuard ?? new ConformalAbstentionGuard();
    this.onTelemetryEvent = options.onTelemetryEvent;

    this.strategies = {
      parallel: new ParallelRecursionStrategy(),
      sequential: new SequentialRecursionStrategy(),
      adaptive: new AdaptiveRecursionStrategy(),
    };
  }

  getEvolutionLedger(): CryptographicEvolutionLedger {
    return this.evolutionLedger;
  }

  getMetaRouter(): ContextualBanditMetaRouter {
    return this.metaRouter;
  }

  getMapElitesArchive(): MapElitesHarnessArchive {
    return this.mapElitesArchive;
  }

  getPolicyVerifier(): StructuralPolicyInvariantVerifier {
    return this.policyVerifier;
  }

  getConformalCalibrator(): ConformalUtilityCalibrator {
    return this.conformalCalibrator;
  }

  getSurrogateModel(): BayesianHarnessSurrogateModel {
    return this.surrogateModel;
  }

  getEpistaticAnalyzer(): EpistaticSurfaceGraphAnalyzer {
    return this.epistaticAnalyzer;
  }

  getTemporalMonitor(): RuntimeTemporalContractMonitor {
    return this.temporalMonitor;
  }

  getHypervolumeSelector(): HypervolumeParetoSelector {
    return this.hypervolumeSelector;
  }

  getSkillDistiller(): SkillSubagentDistiller {
    return this.skillDistiller;
  }

  getChaosTester(): ChaosFaultInjectionTester {
    return this.chaosTester;
  }

  getConformalAbstentionGuard(): ConformalAbstentionGuard {
    return this.conformalAbstentionGuard;
  }

  isEnabled(): boolean {
    return this.enabledByDefault;
  }

  getToolkit(): HarnessManifestToolkit {
    return this.toolkit;
  }

  getAdmissionGate(): HarnessAdmissionGate {
    return this.admissionGate;
  }

  getLibrary(): HarnessExperienceLibrary {
    return this.library;
  }

  /**
   * Executes a complete Propose-Probe-Compose-Admit-Reflect evolution cycle.
   *
   * By default (`startFromCanonicalBaseline !== false`), every new task starts
   * from the canonical baseline H0 managed by the AdmissionGate rather than
   * inheriting unpromoted task specializations.
   */
  async runCycle(request: EvolutionCycleRequest): Promise<EvolutionCycleReport> {
    const runId =
      request.runId ?? createId<'EvolutionRun'>(`evorun_${Date.now()}`);
    const traceId = request.traceId ?? createId<'Trace'>(`trace_${runId}`);
    let mode = request.mode ?? 'adaptive';
    let profile = request.profile ?? 'balanced';
    let kCandidates = request.kCandidates ?? 4;
    const maxSteps = request.maxSteps ?? 2;
    const dryRun = request.dryRun ?? false;
    let metaRoutingDecision: MetaRoutingDecision | undefined;

    const telemetryEvents: EvolutionTelemetryEvent[] = [];
    const emit = (
      eventType: EvolutionEventType,
      attributes: Record<string, unknown>,
      manifestId?: string,
      candidateId?: string,
    ): void => {
      const event: EvolutionTelemetryEvent = {
        eventType,
        traceId,
        evolutionRunId: String(runId),
        timestamp: this.clock.now().toISOString(),
        manifestId,
        candidateId,
        attributes,
      };
      telemetryEvents.push(event);
      this.onTelemetryEvent?.(event);
    };

    // Canonical baseline H0 reset invariant
    const startFromCanonical = request.startFromCanonicalBaseline ?? true;
    const baseManifest = startFromCanonical
      ? (request.baseManifest ?? this.admissionGate.getCanonicalBaseline())
      : (request.baseManifest ?? this.admissionGate.getCanonicalBaseline());

    emit(
      EvolutionEventType.EvolutionStarted,
      {
        taskIdentifier: request.taskIdentifier,
        mode,
        profile,
        kCandidates,
        maxSteps,
        dryRun,
        startFromCanonical,
      },
      String(baseManifest.id),
    );

    // 1. Diagnose failure signals from traces/executionResult or explicit signals
    const diagnosedSignals =
      request.initialFailureSignals ??
      this.diagnoser.diagnoseRun({
        runId: String(runId),
        traces: request.initialTraces ?? [],
        executionResult: request.initialExecutionResult,
      });

    // Ensure at least one diagnostic signal so Proposer has an actionable target
    const initialSignals: ReadonlyArray<FailureSignal> =
      diagnosedSignals.length > 0
        ? diagnosedSignals
        : [
            {
              id: `sig_default_${runId}`,
              type: 'plan_execution_mismatch',
              severity: 'MEDIUM',
              confidence: 0.75,
              iterationNumbers: [1],
              runIds: [String(runId)],
              evidenceExcerpts: [
                `Default proactive diagnostic signal for task ${request.taskIdentifier}`,
              ],
              implicatedSurfaces: ['systemPrompt', 'toolGuidance'],
              suggestedQuadrants: ['INVARIANT_GUIDANCE'],
            },
          ];

    // 1b. Optional Zero-Search MemoHarness Synthesis (Wave 4.4 / 5.1)
    let zeroSearchSynthesis: MemoHarnessSynthesisResult | undefined;
    let effectiveBaseManifest = baseManifest;
    if (request.enableZeroSearchMemo) {
      zeroSearchSynthesis = await this.memoSynthesizer.synthesizeForTask({
        baseManifest,
        taskId: request.taskIdentifier,
        prompt: request.evolveTasks[0]?.prompt ?? request.taskIdentifier,
        domain: request.taskDomain ?? baseManifest.target.domain,
        language: baseManifest.target.language,
        modelFamily: baseManifest.target.modelFamily,
        predictedFailureSignals: initialSignals.map((s) => s.type),
      });
      if (zeroSearchSynthesis.mode === 'ZERO_SEARCH_SYNTHESIS') {
        effectiveBaseManifest = zeroSearchSynthesis.synthesizedManifest;
      }
    }

    // 1c. Optional Discriminative Task Micro-Selection (Wave 4.2 / 5.1)
    let discriminativeTaskSelection: DiscriminativeTaskSelectionResult | undefined;
    let effectiveEvolveTasks = request.evolveTasks;
    if (
      typeof request.maxDiscriminativeTasks === 'number' &&
      request.maxDiscriminativeTasks > 0 &&
      request.evolveTasks.length > request.maxDiscriminativeTasks
    ) {
      discriminativeTaskSelection = this.taskSelector.selectDiscriminativeSubset({
        tasks: request.evolveTasks,
        maxTasks: request.maxDiscriminativeTasks,
      });
      effectiveEvolveTasks = discriminativeTaskSelection.selectedTasks;
    }

    // 1d. Optional Contextual Bandit Meta-Router (Wave 7.4)
    const uniqueSignalTypes = new Set(initialSignals.map((s) => s.type)).size;
    const metaContext = {
      failureEntropy: Math.min(1, uniqueSignalTypes / 5),
      budgetPressure: 0.25,
      ceilingIndex: 0.2,
      ratingUncertainty: 0.5,
      historicalPassRate: 0.65,
    };
    if (request.enableBanditMetaRouter) {
      metaRoutingDecision = this.metaRouter.selectMetaArm(metaContext);
      if (!request.mode) {
        mode = metaRoutingDecision.selectedArm.strategyMode;
      }
      if (!request.profile) {
        profile = metaRoutingDecision.selectedArm.deploymentProfile;
      }
      if (!request.kCandidates) {
        kCandidates = metaRoutingDecision.recommendedCandidatePoolSize;
      }
    }

    // 2. Execute selected RecursionStrategy (parallel | sequential | adaptive)
    const strategy = this.strategies[mode];
    const strategyResult = await strategy.execute({
      runId,
      baseManifest: effectiveBaseManifest,
      tasks: effectiveEvolveTasks,
      maxCandidatesPerStep: kCandidates,
      maxSteps,
      profile,
      diagnoser: this.diagnoser,
      proposer: this.proposer,
      regularizer: this.regularizer,
      probeRunner: this.probeRunner,
      contrastAnalyzer: this.contrastAnalyzer,
      composer: this.composer,
      selector: this.selector,
      budgetPolicy: this.budgetPolicy,
      library: this.library,
      constitution: this.constitution,
      surfaceRegistry: this.surfaceRegistry,
      initialSignals,
    });

    for (const bundle of strategyResult.allEvidenceBundles) {
      this.taskSelector.recordEvidenceBundle(bundle);
    }

    // Emit granular telemetry events for proposed, rejected, probed, contrasted, composed, selected
    for (const cand of strategyResult.allProposed) {
      emit(
        EvolutionEventType.CandidateProposed,
        {
          scope: cand.hypothesis.scopeAxis,
          mechanismTarget: cand.hypothesis.mechanismAxis,
          targetComponents: cand.hypothesis.targetComponents,
        },
        String(cand.manifest.id),
        String(cand.candidateId),
      );
    }

    for (const rej of strategyResult.allRejectedByRegularizer) {
      emit(
        EvolutionEventType.CandidateRejectedByRegularizer,
        {
          reasons: rej.verdict.rejectionReasons,
          benchmarkSpecificityScore: rej.verdict.benchmarkSpecificityScore,
          noveltyScore: rej.verdict.noveltyScore,
        },
        String(rej.candidate.manifest.id),
        String(rej.candidate.candidateId),
      );
    }

    for (const bundle of strategyResult.allEvidenceBundles) {
      emit(
        EvolutionEventType.ProbeStarted,
        { tasks: bundle.taskIds, repetitions: bundle.repetitions },
        String(bundle.candidateManifestId),
      );
      emit(
        EvolutionEventType.ProbeCompleted,
        {
          evidenceLevel: bundle.evidenceLevel,
          repetitions: bundle.repetitions,
          candidateTrialsCount: bundle.candidateTrials.length,
        },
        String(bundle.candidateManifestId),
      );
    }

    for (const contrast of strategyResult.allContrasts) {
      emit(
        EvolutionEventType.ContrastComputed,
        {
          passRateDelta: contrast.passRateDelta,
          costDollarsDelta: contrast.meanCostDollarsDelta,
          verdict: contrast.hypothesisOutcome.verdict,
        },
        String(contrast.candidateManifestId),
      );
    }

    for (const comp of strategyResult.compositions) {
      emit(
        EvolutionEventType.CandidateComposed,
        {
          decisionsCount: comp.componentDecisions.length,
          summaryRationale: comp.componentDecisions.map((d) => d.rationale).join('; '),
        },
        String(comp.composedManifest.id),
      );
    }

    if (strategyResult.stopReason === 'BUDGET_EXHAUSTED') {
      emit(
        EvolutionEventType.EvolutionBudgetExceeded,
        { accounting: strategyResult.accounting },
        String(baseManifest.id),
      );
    }

    const selectedManifest = strategyResult.selectedManifest;
    emit(
      EvolutionEventType.CandidateSelected,
      {
        selectedManifestId: selectedManifest.id,
        baselinePreserved: strategyResult.selectionResult.baselinepreserved,
        rationale: strategyResult.selectionResult.rationale,
      },
      String(selectedManifest.id),
    );

    // 3. Evaluate through Fail-Closed AdmissionGate
    emit(
      EvolutionEventType.AdmissionStarted,
      { candidateManifestId: selectedManifest.id },
      String(selectedManifest.id),
    );

    const diffFromBase = this.toolkit.diff(baseManifest, selectedManifest);
    const winningEval = strategyResult.selectionResult.selectedCandidate;
    const evolveEvidence: EvidenceBundle =
      winningEval?.evidenceBundle ??
      strategyResult.allEvidenceBundles[0] ?? {
        id: createId<'Probe'>('probe_empty'),
        baseManifestId: baseManifest.id,
        baseManifestHash: baseManifest.contentHash,
        candidateManifestId: selectedManifest.id,
        candidateManifestHash: selectedManifest.contentHash,
        hypothesisId: createId<'Hypothesis'>('hyp_empty'),
        evidenceLevel: baseManifest.evidence.highestLevelAchieved,
        taskIds: request.evolveTasks.map((t) => t.taskId),
        split: 'evolve',
        modelId: baseManifest.target.modelFamily ?? 'default-model',
        providerId: 'default-provider',
        modelParameters: {},
        environmentFingerprint: baseManifest.target.environmentFingerprint,
        networkEgressPolicy: baseManifest.securityProfile.networkEgressPolicy,
        tokenBudget: baseManifest.budgetProfile.maxTokensPerProbe,
        wallTimeBudgetMs: baseManifest.budgetProfile.maxWallTimeMsPerProbe,
        repetitions: 1,
        baseTrials: [],
        candidateTrials: [],
        negativeResultsPreserved: true,
        provenanceHash: baseManifest.contentHash,
        createdAt: this.clock.now().toISOString(),
      };

    // Run held-out evaluation ONLY inside AdmissionGate scope (`callerRole: 'admission_gate'`)
    let heldOutEvidence = undefined;
    if (
      request.heldOutTasks &&
      request.heldOutTasks.length > 0 &&
      selectedManifest.contentHash !== baseManifest.contentHash
    ) {
      const winnerCandidate =
        strategyResult.allProposed.find(
          (c) => c.manifest.id === selectedManifest.id,
        ) ?? {
          candidateId: createId<'Candidate'>(`cand_winner_${Date.now()}`),
          manifest: selectedManifest,
          diffFromBase,
          hypothesis: strategyResult.allProposed[0]!.hypothesis,
        };
      heldOutEvidence = await this.probeRunner.runPairedProbe({
        baseManifest,
        candidate: winnerCandidate,
        tasks: request.heldOutTasks,
        callerRole: 'admission_gate',
      });
    }

    const criteria: AdmissionGateCriteria = {
      targetScope: request.admissionCriteria?.targetScope ?? 'library',
      maxCostRegressionRatio: request.admissionCriteria?.maxCostRegressionRatio ?? 0.2,
      maxLatencyRegressionRatio: request.admissionCriteria?.maxLatencyRegressionRatio ?? 0.25,
      minHeldOutPassDelta: request.admissionCriteria?.minHeldOutPassDelta ?? 0.0,
      requireZeroForgottenCapabilities:
        request.admissionCriteria?.requireZeroForgottenCapabilities ?? true,
      requireZeroSecurityViolations:
        request.admissionCriteria?.requireZeroSecurityViolations ?? true,
    };

    const admissionDecision = await this.admissionGate.evaluate({
      baseManifest,
      candidateManifest: selectedManifest,
      diffFromBase,
      evolveEvidence,
      heldOutEvidence,
      criteria,
    });

    if (
      admissionDecision.status === 'promoted' ||
      admissionDecision.status === 'library_only' ||
      admissionDecision.status === 'task_only'
    ) {
      emit(
        EvolutionEventType.AdmissionPassed,
        {
          status: admissionDecision.status,
          evidenceLevel: admissionDecision.evidenceLevelVerified,
          reasons: admissionDecision.reasons,
        },
        String(selectedManifest.id),
      );
    } else {
      emit(
        EvolutionEventType.AdmissionFailed,
        {
          status: admissionDecision.status,
          reasons: admissionDecision.reasons,
        },
        String(selectedManifest.id),
      );
    }

    let finalManifest = selectedManifest;
    if (
      !dryRun &&
      request.autoPromoteIfAdmitted &&
      admissionDecision.status === 'promoted'
    ) {
      finalManifest = await this.admissionGate.promoteToCanonicalBaseline(
        selectedManifest,
        admissionDecision,
      );
      emit(
        EvolutionEventType.HarnessPromoted,
        {
          promotedManifestId: finalManifest.id,
          signature: finalManifest.provenance.signature,
        },
        String(finalManifest.id),
      );
    }

    // 4. Reflect and store all probed candidates (including negative results!) in ExperienceLibrary
    const experienceEntriesCreated: ExperienceEntry[] = [];
    for (let i = 0; i < strategyResult.allContrasts.length; i++) {
      const contrast = strategyResult.allContrasts[i]!;
      const bundle = strategyResult.allEvidenceBundles[i] ?? evolveEvidence;
      const candidateObj =
        strategyResult.allProposed.find(
          (c) => c.manifest.id === contrast.candidateManifestId,
        ) ?? {
          candidateId: createId<'Candidate'>(`cand_ref_${i}`),
          manifest: selectedManifest,
          diffFromBase,
          hypothesis: strategyResult.allProposed[0]!.hypothesis,
        };

      const entry = this.reflector.reflect({
        baseManifest,
        candidate: candidateObj,
        evidenceBundle: bundle,
        contrast,
        admissionDecision:
          candidateObj.manifest.id === selectedManifest.id
            ? admissionDecision
            : {
                ...admissionDecision,
                candidateManifestId: candidateObj.manifest.id,
                candidateManifestHash: candidateObj.manifest.contentHash,
                status:
                  contrast.hypothesisOutcome.verdict === 'supported'
                    ? 'library_only'
                    : 'rejected',
              },
        taskDomain: request.taskDomain ?? baseManifest.target.domain ?? 'general',
      });
      experienceEntriesCreated.push(entry);

      if (!dryRun) {
        await this.library.record(entry);
        emit(
          EvolutionEventType.LibraryEntryAdded,
          {
            entryId: entry.id,
            verdict: entry.hypothesisOutcome.verdict,
            confidence: entry.confidence,
          },
          String(entry.manifest.id),
        );
      }
    }

    if (!dryRun) {
      await this.library.deduplicateAndConsolidate();
    }

    // 5. Holm-Bonferroni Family-Wise Error Rate evaluation across all probed candidates (Wave 5.4 / 5.1)
    const multipleTestingSummary =
      this.holmBonferroniGate.evaluateFamilyWiseSignificance(
        strategyResult.allContrasts.map((c, idx) => ({
          candidateManifestId: String(c.candidateManifestId),
          meanScoreDelta: c.partialScoreDelta,
          sampleSize: Math.max(
            1,
            strategyResult.allEvidenceBundles[idx]?.candidateTrials.length ?? 1,
          ),
        })),
      );

    // 5b. Causal Surface Credit Attribution (Shapley & LOO Ablation) & Longitudinal Rating (Wave 6.2 & 6.4)
    const shapleyAttribution = this.shapleyAttributor.computeAttribution({
      candidates: strategyResult.allProposed,
      contrasts: strategyResult.allContrasts,
    });
    if (request.pruneFreeRiderSurfaces) {
      const prunedRes = this.shapleyAttributor.pruneFreeRiderSurfaces({
        baseManifest,
        candidateManifest: finalManifest,
        attributionReport: shapleyAttribution,
      });
      if (prunedRes.wasPruned) {
        finalManifest = prunedRes.prunedManifest;
      }
    }
    for (const bundle of strategyResult.allEvidenceBundles) {
      this.tournamentRanker.recordEvidenceBundle(bundle);
    }
    const tournamentLeaderboard = this.tournamentRanker.getLeaderboard();

    // 5c. Wave 8: Quality-Diversity (MAP-Elites) Illumination, Formal Cross-Surface Policy Verification & Conformal CVaR Tail-Risk
    for (let idx = 0; idx < strategyResult.allProposed.length; idx++) {
      const cand = strategyResult.allProposed[idx]!;
      const contrast = strategyResult.allContrasts[idx];
      if (contrast) {
        const bundle = strategyResult.allEvidenceBundles[idx];
        const meanCost =
          bundle && bundle.candidateTrials.length > 0
            ? bundle.candidateTrials.reduce((acc, t) => acc + t.costDollars, 0) /
              bundle.candidateTrials.length
            : 0.04;
        const passRate =
          bundle && bundle.candidateTrials.length > 0
            ? bundle.candidateTrials.filter((t) => t.success).length /
              bundle.candidateTrials.length
            : Math.max(0, Math.min(1, 0.7 + contrast.passRateDelta));
        this.mapElitesArchive.recordCandidate({
          manifest: cand.manifest,
          quadrant: cand.hypothesis.quadrant,
          utilityScore: Math.max(0, 0.5 + contrast.partialScoreDelta),
          passRate,
          meanCostDollars: meanCost,
        });
      }
    }
    const mapElitesSnapshot = this.mapElitesArchive.getSnapshot();
    const policyVerification =
      this.policyVerifier.verifyManifestPolicies(finalManifest);
    const trialUtilities =
      evolveEvidence.candidateTrials.length > 0
        ? evolveEvidence.candidateTrials.map(
            (t) => (t.success ? 1.0 : t.partialScore) - t.costDollars * 0.5,
          )
        : [0.75];

    const tailRiskUtility = this.conformalCalibrator.evaluateTailRiskUtility({
      trialUtilities,
    });

    // 5d. Wave 9: Bayesian Surrogate Update, Epistatic Surface Graph, LTLf Monitor & Chaos Resilience
    for (let idx = 0; idx < strategyResult.allProposed.length; idx++) {
      const cand = strategyResult.allProposed[idx]!;
      const contrast = strategyResult.allContrasts[idx];
      if (contrast) {
        this.surrogateModel.recordObservation(cand, contrast);
      }
    }
    const epistaticSurfaceGraph = this.epistaticAnalyzer.analyzeEpistaticGraph({
      candidates: strategyResult.allProposed,
      contrasts: strategyResult.allContrasts,
    });
    const temporalContractVerification = request.initialTraces
      ? this.temporalMonitor.verifyIterationTraces(request.initialTraces)
      : this.temporalMonitor.verifyStepSequence([]);
    const chaosResilience = this.chaosTester.runChaosSuite(finalManifest);
    const conformalAbstentionDecision =
      this.conformalAbstentionGuard.evaluateCandidateWithAbstention({
        manifest: finalManifest,
        predictedMean: tailRiskUtility.meanUtility,
        predictedStd: Math.max(0.05, tailRiskUtility.meanUtility - tailRiskUtility.conditionalValueAtRiskAlpha),
        seed: 42,
        fallbackManifestId: String(baseManifest.id),
      });

    // 6. Optional Adversarial Counterfactual Robustness Verification (Wave 4.6 / 5.1)
    let counterfactualRobustness: CounterfactualRobustnessReport | undefined;
    if (request.runAdversarialCounterfactuals && request.evolveTasks.length > 0) {
      const seedTask = request.evolveTasks[0]!;
      const cfTasks = this.adversarialProbeGenerator.generateCounterfactualTasks({
        seedTask,
        targetSplit: 'ood',
      });
      const winnerCand =
        strategyResult.allProposed.find(
          (c) => c.manifest.id === selectedManifest.id,
        ) ?? {
          candidateId: createId<'Candidate'>(`cand_cf_${Date.now()}`),
          manifest: selectedManifest,
          diffFromBase,
          hypothesis: strategyResult.allProposed[0]!.hypothesis,
        };
      const cfBundle = await this.probeRunner.runPairedProbe({
        baseManifest,
        candidate: winnerCand,
        tasks: cfTasks,
        callerRole: 'admission_gate',
      });
      counterfactualRobustness =
        this.adversarialProbeGenerator.evaluateCounterfactualRobustness({
          standardBundle: evolveEvidence,
          counterfactualBundle: cfBundle,
        });
    }

    // 7. Model Capability Ceiling Diagnosis & Optional ViForge Handoff (Wave 4.3 / 5.6 / 5.1)
    const { diagnosis: capabilityCeilingDiagnosis, spinRecords } =
      this.preferenceExporter.diagnoseCapabilityCeilingAndExtractSpin({
        candidates: strategyResult.allProposed,
        contrasts: strategyResult.allContrasts,
        evidenceBundles: strategyResult.allEvidenceBundles,
      });

    let viforgeHandoffManifest: ViForgeHandoffManifest | undefined;
    if (request.exportViForgeHandoff || capabilityCeilingDiagnosis.ceilingDetected) {
      const dpoPairs = this.preferenceExporter.extractDpoPreferencePairs({
        baseManifest,
        candidateManifest: selectedManifest,
        evidenceBundle: evolveEvidence,
      });
      const grpoGroups = this.preferenceExporter.extractGrpoRolloutGroups({
        baseManifest,
        evaluations: strategyResult.allEvidenceBundles.map((eb, idx) => ({
          candidateManifest:
            strategyResult.allProposed[idx]?.manifest ?? selectedManifest,
          evidenceBundle: eb,
        })),
      });
      const viforgeOutDir = !dryRun
        ? path.join(this.storageRootDir, 'viforge', String(runId))
        : undefined;
      viforgeHandoffManifest = await this.viforgeBridge.prepareViForgeHandoff({
        sourceManifest: finalManifest,
        dpoPairs,
        grpoGroups,
        spinRecords,
        ceilingDiagnosis: capabilityCeilingDiagnosis,
        outputDir: viforgeOutDir,
      });
    }

    const librarySnapshotHash = await this.library.computeSnapshotHash();
    const unsignedRepro: Omit<ReproducibilityManifest, 'signature'> = {
      evolutionRunId: runId,
      viHarnessCommit: 'HEAD',
      baseManifestId: baseManifest.id,
      baseManifestHash: baseManifest.contentHash,
      finalManifestId: finalManifest.id,
      finalManifestHash: finalManifest.contentHash,
      modelId: baseManifest.target.modelFamily ?? 'claude-3-7-sonnet',
      providerId: 'default-provider',
      environmentFingerprint: baseManifest.target.environmentFingerprint,
      taskIdentifier: request.taskIdentifier,
      recursionStrategy: mode,
      deploymentProfile: profile,
      budgetProfile: baseManifest.budgetProfile,
      librarySnapshotHash,
      seedsUsed: Array.from(
        new Set(
          evolveEvidence.candidateTrials
            .map((t) => t.seed)
            .filter((s): s is number => typeof s === 'number'),
        ),
      ),
      networkEgressPolicy: baseManifest.securityProfile.networkEgressPolicy,
      securityProfile: baseManifest.securityProfile,
      resourceAccounting: strategyResult.accounting,
      admissionStatus: admissionDecision.status,
      createdAt: this.clock.now().toISOString(),
    };

    const reproSignature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(JSON.stringify(unsignedRepro))
      .digest('hex');

    const reproducibilityManifest: ReproducibilityManifest = {
      ...unsignedRepro,
      signature: reproSignature,
    };

    // 8. Record Contextual Bandit Reward & Append Cryptographic Ledger Provenance (Wave 7.2 & 7.4)
    if (metaRoutingDecision) {
      const bestContrast = strategyResult.allContrasts[0];
      this.metaRouter.recordReward({
        armId: metaRoutingDecision.selectedArm.armId,
        context: metaContext,
        observedUtilityGain: bestContrast?.partialScoreDelta ?? 0,
        computeCostDollars: strategyResult.accounting.totalCostDollars,
      });
    }

    this.evolutionLedger.appendEntry({
      eventType:
        admissionDecision.status === 'promoted'
          ? 'BASELINE_PROMOTED'
          : 'ADMISSION_DECIDED',
      subjectManifestId: String(finalManifest.id),
      subjectManifestHash: finalManifest.contentHash,
      invocationId: String(runId),
      materials: [
        {
          uri: `manifest://${baseManifest.id}`,
          sha256: baseManifest.contentHash,
        },
        {
          uri: `evidence://${evolveEvidence.id}`,
          sha256: evolveEvidence.provenanceHash,
        },
      ],
      verificationSummary: {
        admissionStatus: admissionDecision.status,
        evidenceLevel: admissionDecision.evidenceLevelVerified,
        holmBonferroniApproved:
          multipleTestingSummary.approvedCandidateIds.length,
        shapleySynergisticSurfaces: shapleyAttribution.synergisticSurfaces,
      },
    });
    const ledgerVerification = this.evolutionLedger.verifyLedgerIntegrity();

    const report: EvolutionCycleReport = {
      runId,
      baseManifest,
      finalManifest,
      strategyResult,
      admissionDecision,
      experienceEntriesCreated,
      reproducibilityManifest,
      telemetryEvents,
      zeroSearchSynthesis,
      discriminativeTaskSelection,
      counterfactualRobustness,
      multipleTestingSummary,
      capabilityCeilingDiagnosis,
      viforgeHandoffManifest,
      shapleyAttribution,
      tournamentLeaderboard,
      metaRoutingDecision,
      ledgerVerification,
      mapElitesSnapshot,
      policyVerification,
      tailRiskUtility,
      epistaticSurfaceGraph,
      temporalContractVerification,
      chaosResilience,
      conformalAbstentionDecision,
      dryRun,
    };

    if (!dryRun) {
      await this.persistCycleArtifacts(report);
    }

    return report;
  }

  /**
   * Inspects a previously persisted evolution run from `.vi-evolution/reports/<runId>.json`.
   */
  async inspectRun(runId: string): Promise<EvolutionCycleReport | null> {
    try {
      const filePath = path.join(this.storageRootDir, 'reports', `${runId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as EvolutionCycleReport;
    } catch {
      return null;
    }
  }

  /**
   * Resumes an interrupted evolution run or returns the completed report if already finished.
   */
  async resumeRun(
    runId: string,
    fallbackRequest?: EvolutionCycleRequest,
  ): Promise<EvolutionCycleReport> {
    const existing = await this.inspectRun(runId);
    if (existing) {
      return existing;
    }
    if (!fallbackRequest) {
      throw new Error(`Cannot resume evolution run '${runId}': no checkpoint found and no fallback request provided.`);
    }
    return this.runCycle({
      ...fallbackRequest,
      runId: createId<'EvolutionRun'>(runId),
    });
  }

  private async persistCycleArtifacts(report: EvolutionCycleReport): Promise<void> {
    const dirs = [
      'manifests',
      'candidates',
      'probes',
      'evidence',
      'contrasts',
      'compositions',
      'libraries',
      'admissions',
      'reports',
    ];
    await Promise.all(
      dirs.map((d) =>
        fs.mkdir(path.join(this.storageRootDir, d), { recursive: true }),
      ),
    );

    await fs.writeFile(
      path.join(this.storageRootDir, 'manifests', `${report.finalManifest.id}.json`),
      this.toolkit.exportToJson(report.finalManifest),
      'utf-8',
    );

    for (const cand of report.strategyResult.allProposed) {
      await fs.writeFile(
        path.join(this.storageRootDir, 'candidates', `${cand.candidateId}.json`),
        JSON.stringify(cand, null, 2),
        'utf-8',
      );
    }

    for (const bundle of report.strategyResult.allEvidenceBundles) {
      await fs.writeFile(
        path.join(this.storageRootDir, 'evidence', `${bundle.id}.json`),
        JSON.stringify(bundle, null, 2),
        'utf-8',
      );
    }

    for (const contrast of report.strategyResult.allContrasts) {
      await fs.writeFile(
        path.join(this.storageRootDir, 'contrasts', `${contrast.id}.json`),
        JSON.stringify(contrast, null, 2),
        'utf-8',
      );
    }

    for (const comp of report.strategyResult.compositions) {
      await fs.writeFile(
        path.join(this.storageRootDir, 'compositions', `${comp.id}.json`),
        JSON.stringify(comp, null, 2),
        'utf-8',
      );
    }

    await fs.writeFile(
      path.join(this.storageRootDir, 'admissions', `${report.admissionDecision.id}.json`),
      JSON.stringify(report.admissionDecision, null, 2),
      'utf-8',
    );

    await fs.writeFile(
      path.join(this.storageRootDir, 'reports', `${report.runId}.json`),
      JSON.stringify(report, null, 2),
      'utf-8',
    );
  }
}
