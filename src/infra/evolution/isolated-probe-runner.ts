/**
 * Isolated Harness Probe Runner (Milestone B — Propose–Probe–Compose).
 *
 * Materializes immutable base and candidate HarnessManifests into isolated workspaces,
 * enforces identical budgets and restricted network egress, blocks access to held-out
 * partitions during proposal/probing, supports multiple repetitions for variance
 * estimation, and emits signed EvidenceBundles (E1..E4).
 */
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import type { IdFactory, ProbeId } from '../../core/types/identifiers.js';
import { EvidenceLevel } from '../../core/evolution/constitution.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  EvidenceBundle,
  ProbeTrialMetrics,
} from '../../core/evolution/hypothesis.js';
import type {
  HarnessProbeRunner,
  ProposedCandidate,
  ProbeTaskSpec,
} from '../../core/evolution/interfaces.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import { WorkspaceIsolationManager } from '../eval/workspace-isolation.js';
import { AuditIntegritySigner } from '../security/audit-integrity-signer.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';
import type { WaldSprtStoppingRule } from './statistical-admission-control.js';

export type ProbeTrialExecutor = (params: {
  readonly manifest: HarnessManifest;
  readonly materializedConfig: Record<string, unknown>;
  readonly task: ProbeTaskSpec;
  readonly trialIndex: number;
  readonly seed: number;
  readonly workspacePath: string;
}) => Promise<ProbeTrialMetrics>;

export interface IsolatedProbeRunnerOptions {
  readonly idFactory?: IdFactory;
  readonly workspaceIsolation?: WorkspaceIsolationManager;
  readonly auditSigner?: AuditIntegritySigner;
  readonly trialExecutor?: ProbeTrialExecutor;
  readonly defaultRepetitions?: number;
  readonly modelId?: string;
  readonly providerId?: string;
  readonly sprtStoppingRule?: WaldSprtStoppingRule;
}

export class IsolatedHarnessProbeRunner implements HarnessProbeRunner {
  private readonly idFactory: IdFactory;
  private readonly workspaceIsolation: WorkspaceIsolationManager;
  private readonly auditSigner: AuditIntegritySigner;
  private readonly trialExecutor: ProbeTrialExecutor;
  private readonly defaultRepetitions: number;
  private readonly modelId: string;
  private readonly providerId: string;
  private readonly sprtStoppingRule?: WaldSprtStoppingRule;

  constructor(options?: IsolatedProbeRunnerOptions) {
    this.idFactory = options?.idFactory ?? new UuidV7IdFactory();
    this.workspaceIsolation =
      options?.workspaceIsolation ?? new WorkspaceIsolationManager();
    this.auditSigner = options?.auditSigner ?? new AuditIntegritySigner();
    this.trialExecutor =
      options?.trialExecutor ?? this.defaultDeterministicTrialExecutor.bind(this);
    this.defaultRepetitions = options?.defaultRepetitions ?? 1;
    this.modelId = options?.modelId ?? 'deterministic-probe-model';
    this.providerId = options?.providerId ?? 'vi-harness-probe';
    this.sprtStoppingRule = options?.sprtStoppingRule;
  }

  async runPairedProbe(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidate: ProposedCandidate;
    readonly tasks: ReadonlyArray<ProbeTaskSpec>;
    readonly callerRole: 'proposer' | 'probe_runner' | 'admission_gate';
  }): Promise<EvidenceBundle> {
    const { baseManifest, candidate, tasks, callerRole } = params;

    if (tasks.length === 0) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_PROBE_FAILED,
        category: ErrorCategory.EVOLUTION,
        message: 'Cannot execute probe: task list is empty.',
      });
    }

    // 1. Enforce Held-Out Evaluation Boundary (HarnessOpt-Bench invariant)
    const touchesHeldOut = tasks.some((t) => t.split === 'held_out');
    if (touchesHeldOut && callerRole !== 'admission_gate') {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_HELD_OUT_ACCESS_DENIED,
        category: ErrorCategory.EVOLUTION,
        message: `Caller '${callerRole}' attempted to access inaccessible held_out evaluation split during candidate exploration.`,
        context: {
          callerRole,
          candidateId: candidate.candidateId,
          heldOutTaskIds: tasks.filter((t) => t.split === 'held_out').map((t) => t.taskId),
        },
      });
    }

    // 2. Validate & freeze both manifests before probing
    HarnessManifestToolkit.assertValid(baseManifest);
    HarnessManifestToolkit.assertValid(candidate.manifest);
    const frozenBase = HarnessManifestToolkit.freeze(baseManifest);
    const frozenCandidate = HarnessManifestToolkit.freeze(candidate.manifest);

    // 3. Enforce restricted network egress during benchmark probes
    if (
      frozenCandidate.securityProfile.networkEgressPolicy !== 'DENY_ALL' &&
      frozenCandidate.securityProfile.networkEgressPolicy !== 'ALLOWLIST_ONLY' &&
      frozenCandidate.securityProfile.networkEgressPolicy !== 'RESTRICTED_BENCHMARK'
    ) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
        category: ErrorCategory.EVOLUTION,
        message: 'Unrestricted network egress is prohibited during candidate probes.',
      });
    }

    const baseConfig = HarnessManifestToolkit.materializeExecutionConfig(frozenBase);
    const candidateConfig =
      HarnessManifestToolkit.materializeExecutionConfig(frozenCandidate);

    const baseTrials: ProbeTrialMetrics[] = [];
    const candidateTrials: ProbeTrialMetrics[] = [];
    let maxRepetitionsUsed = 1;

    // 4. Execute paired trials in isolated workspaces under identical budgets & seeds
    outerLoop: for (const task of tasks) {
      const reps = Math.max(1, task.repetitions ?? this.defaultRepetitions);
      if (reps > maxRepetitionsUsed) maxRepetitionsUsed = reps;

      for (let r = 0; r < reps; r++) {
        const seed = task.seeds?.[r] ?? 1000 + r;

        const baseWs = await this.workspaceIsolation.createIsolatedWorkspace({
          suiteId: 'evo-probe',
          taskId: task.taskId,
          harness: frozenBase.id,
          runIndex: r,
          sourceRepositoryPath: task.workspacePath,
        });

        const candWs = await this.workspaceIsolation.createIsolatedWorkspace({
          suiteId: 'evo-probe',
          taskId: task.taskId,
          harness: frozenCandidate.id,
          runIndex: r,
          sourceRepositoryPath: task.workspacePath,
        });

        try {
          const baseResult = await this.trialExecutor({
            manifest: frozenBase,
            materializedConfig: baseConfig,
            task,
            trialIndex: r,
            seed,
            workspacePath: baseWs.workspacePath,
          });
          baseTrials.push(baseResult);

          const candResult = await this.trialExecutor({
            manifest: frozenCandidate,
            materializedConfig: candidateConfig,
            task,
            trialIndex: r,
            seed,
            workspacePath: candWs.workspacePath,
          });
          candidateTrials.push(candResult);
        } finally {
          await baseWs.cleanup();
          await candWs.cleanup();
        }

        if (this.sprtStoppingRule) {
          const sprtVerdict = this.sprtStoppingRule.evaluatePairedTrials({
            baseTrials,
            candidateTrials,
          });
          if (sprtVerdict.decision === 'STOP_REJECT_INFERIOR') {
            break outerLoop;
          }
        }
      }
    }


    // 5. Determine achieved EvidenceLevel (E1 .. E4)
    const primarySplit = tasks[0]!.split;
    const allCandVerified =
      candidateTrials.length > 0 &&
      candidateTrials.every((t) => t.verifierPassed && !t.infrastructureError);

    let evidenceLevel = EvidenceLevel.E1_SINGLE_CONTRAST;
    if (maxRepetitionsUsed >= 2) {
      evidenceLevel = EvidenceLevel.E2_REPLICATED_CONTRAST;
    }
    if (allCandVerified) {
      evidenceLevel = EvidenceLevel.E3_VERIFIED;
    }
    if (
      allCandVerified &&
      (primarySplit === 'held_out' || primarySplit === 'ood')
    ) {
      evidenceLevel = EvidenceLevel.E4_GENERALIZATION;
    }

    const probeId = this.idFactory.create<'Probe'>() as ProbeId;
    const createdAt = new Date().toISOString();

    const provenanceHash = HarnessManifestToolkit.computeHash({
      probeId,
      baseManifestHash: frozenBase.contentHash,
      candidateManifestHash: frozenCandidate.contentHash,
      hypothesisId: candidate.hypothesis.id,
      taskIds: tasks.map((t) => t.taskId),
      split: primarySplit,
      baseTrials,
      candidateTrials,
    });

    const signed = this.auditSigner.sign({ probeId, provenanceHash });

    return {
      id: probeId,
      evidenceLevel,
      baseManifestId: frozenBase.id,
      baseManifestHash: frozenBase.contentHash,
      candidateManifestId: frozenCandidate.id,
      candidateManifestHash: frozenCandidate.contentHash,
      hypothesisId: candidate.hypothesis.id,
      taskIds: tasks.map((t) => t.taskId),
      split: primarySplit,
      modelId: this.modelId,
      providerId: this.providerId,
      modelParameters: { temperature: 0.2 },
      environmentFingerprint: frozenCandidate.target.environmentFingerprint,
      networkEgressPolicy: frozenCandidate.securityProfile.networkEgressPolicy,
      tokenBudget: frozenCandidate.budgetProfile.maxTokensPerProbe,
      wallTimeBudgetMs: frozenCandidate.budgetProfile.maxWallTimeMsPerProbe,
      repetitions: maxRepetitionsUsed,
      baseTrials,
      candidateTrials,
      negativeResultsPreserved: true,
      createdAt,
      provenanceHash,
      signature: signed.signature,
    };
  }

  /**
   * Default deterministic trial simulator used when no external LLM runtime is injected.
   */
  private async defaultDeterministicTrialExecutor(params: {
    readonly manifest: HarnessManifest;
    readonly materializedConfig: Record<string, unknown>;
    readonly task: ProbeTaskSpec;
    readonly trialIndex: number;
    readonly seed: number;
  }): Promise<ProbeTrialMetrics> {
    const { manifest, materializedConfig, task, trialIndex } = params;
    const isBaseline = manifest.provenance.createdBy === 'baseline';
    const hasArchitectMode = materializedConfig['architectMode'] === true;
    const hasCustomSkills = manifest.components.skills.length > 1;
    const hasCustomScripts = manifest.components.scripts.length > 0;
    const hasTighterCompaction =
      Number(materializedConfig['compactionThreshold'] ?? 0.8) <= 0.7;

    const qualityBoost =
      (hasArchitectMode ? 0.15 : 0) +
      (hasCustomSkills ? 0.1 : 0) +
      (hasCustomScripts ? 0.1 : 0) +
      (!isBaseline ? 0.05 : 0);

    const baseScore = 0.75;
    const partialScore = Math.min(1.0, baseScore + qualityBoost);
    const success = partialScore >= 0.8;

    const promptTokens = hasTighterCompaction ? 4200 : 5400;
    const completionTokens = 650;
    const cachedTokens = materializedConfig['enablePrefixCaching'] !== false ? 3400 : 800;
    const totalTokens = promptTokens + completionTokens;
    const costDollars = Number((totalTokens * 0.000003).toFixed(5));

    return {
      trialIndex,
      taskId: task.taskId,
      seed: params.seed,
      success,
      partialScore,
      verifierPassed: success,
      iterationCount: hasArchitectMode ? 3 : 4,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      cacheHitRatio: cachedTokens / promptTokens,
      modelCalls: hasArchitectMode ? 4 : 4,
      toolCalls: 5,
      toolErrors: isBaseline ? 1 : 0,
      policyViolations: 0,
      regressionsDetected: 0,
      oscillationsDetected: 0,
      durationMs: hasTighterCompaction ? 1100 : 1400,
      costDollars,
      contextMemoryTrafficTokens: totalTokens * 2,
      verificationCostDollars: Number((costDollars * 0.2).toFixed(5)),
      finalPhase: success ? 'DONE' : 'FAILED',
      failureSignalsObserved: success ? [] : ['tool_error'],
      outputArtifactRefs: [`probe-${manifest.id}-${task.taskId}-r${trialIndex}`],
    };
  }
}
