/**
 * Wave 4.3 — `HarnessX` Contrastive Preference & Trajectory Exporter (`ViForge` Integration).
 *
 * Bridges outer-loop Harness Evolution with inner-loop Model Weight Post-Training (`ViForge`):
 * 1. **DPO Preference Pairs**: Pairs verified winning (`chosen`) vs losing (`rejected`)
 *    paired probe trials under identical tasks and seeds (`E3_VERIFIED` / `E4_GENERALIZATION`).
 * 2. **GRPO Group Rollouts**: Groups multi-candidate trajectories per task and computes
 *    decomposed multi-objective rewards and group-normalized advantages:
 *      A_i = (R_i - mean(R_G)) / (std(R_G) + eps)
 * 3. **Model Capability Ceiling Detector & SPIN Self-Play Exporter**: Detects when failure
 *    signals persist across multiple harness exploration quadrants (indicating a model weight
 *    capability ceiling rather than a harness gap) and exports SPIN self-play records.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EvidenceLevel } from '../../core/evolution/constitution.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  CandidateExplorationQuadrant,
  FailureSignalType,
} from '../../core/evolution/failure-taxonomy.js';
import type {
  BehavioralContrast,
  EvidenceBundle,
  ProbeTrialMetrics,
} from '../../core/evolution/hypothesis.js';
import type { ProposedCandidate } from '../../core/evolution/interfaces.js';

export interface DpoTrajectorySide {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly systemPrompt: string;
  readonly toolGuidance: string;
  readonly trialMetrics: ProbeTrialMetrics;
  readonly scalarReward: number;
}

export interface DpoPreferenceRecord {
  readonly recordId: string;
  readonly taskId: string;
  readonly split: string;
  readonly seed: number;
  readonly prompt: string;
  readonly chosen: DpoTrajectorySide;
  readonly rejected: DpoTrajectorySide;
  readonly preferenceMargin: number;
  readonly evidenceLevel: EvidenceLevel;
  readonly provenanceHash: string;
  readonly createdAt: string;
}

export interface GrpoRolloutMember {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly seed: number;
  readonly verifierReward: number;
  readonly costPenalty: number;
  readonly toolErrorPenalty: number;
  readonly safetyViolationPenalty: number;
  readonly totalReward: number;
  readonly groupAdvantage: number;
  readonly outputArtifactRefs: ReadonlyArray<string>;
}

export interface GrpoRolloutGroupRecord {
  readonly groupId: string;
  readonly taskId: string;
  readonly prompt: string;
  readonly rollouts: ReadonlyArray<GrpoRolloutMember>;
  readonly groupMeanReward: number;
  readonly groupStdReward: number;
  readonly createdAt: string;
}

export interface ModelCapabilityCeilingDiagnosis {
  readonly ceilingDetected: boolean;
  readonly persistentFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly exhaustedQuadrants: ReadonlyArray<CandidateExplorationQuadrant>;
  readonly candidatesEvaluated: number;
  readonly bestAchievedPassRateDelta: number;
  readonly recommendedPostTrainingMethod: 'NONE' | 'DPO' | 'GRPO' | 'SPIN';
  readonly rationale: string;
}

export interface SpinSelfPlayRecord {
  readonly recordId: string;
  readonly taskId: string;
  readonly targetFailureSignals: ReadonlyArray<FailureSignalType>;
  readonly bestHarnessManifestId: string;
  readonly bestHarnessManifestHash: string;
  readonly systemPrompt: string;
  readonly toolGuidance: string;
  readonly failedTrialMetrics: ProbeTrialMetrics;
  readonly targetRefinementObjective: string;
  readonly createdAt: string;
}

const EVIDENCE_RANK: Readonly<Record<EvidenceLevel, number>> = {
  [EvidenceLevel.E0_REFLECTION]: 0,
  [EvidenceLevel.E1_SINGLE_CONTRAST]: 1,
  [EvidenceLevel.E2_REPLICATED_CONTRAST]: 2,
  [EvidenceLevel.E3_VERIFIED]: 3,
  [EvidenceLevel.E4_GENERALIZATION]: 4,
};

export interface ContrastivePreferenceExporterOptions {
  readonly minEvidenceLevel?: EvidenceLevel;
  readonly minPreferenceMargin?: number;
  readonly ceilingMinCandidates?: number;
}

export class ContrastivePreferenceExporter {
  private readonly minEvidenceLevel: EvidenceLevel;
  private readonly minPreferenceMargin: number;
  private readonly ceilingMinCandidates: number;

  constructor(options?: ContrastivePreferenceExporterOptions) {
    this.minEvidenceLevel = options?.minEvidenceLevel ?? EvidenceLevel.E3_VERIFIED;
    this.minPreferenceMargin = options?.minPreferenceMargin ?? 0.1;
    this.ceilingMinCandidates = options?.ceilingMinCandidates ?? 3;
  }

  /**
   * Computes a decomposed multi-objective scalar reward for a single probe trial:
   *   R(tau) = verifierScore - 0.15*costPenalty - 0.20*toolErrorPenalty - 1.0*policyViolationPenalty
   */
  computeTrialReward(trial: ProbeTrialMetrics): {
    readonly verifierReward: number;
    readonly costPenalty: number;
    readonly toolErrorPenalty: number;
    readonly safetyViolationPenalty: number;
    readonly totalReward: number;
  } {
    const verifierReward = trial.verifierPassed
      ? 1.0
      : trial.partialScore * 0.6;
    const costPenalty = Math.min(1.0, trial.costDollars / 0.1) * 0.15;
    const toolErrorPenalty = Math.min(1.0, trial.toolErrors * 0.25) * 0.2;
    const safetyViolationPenalty = trial.policyViolations * 1.0;

    const totalReward = Number(
      (
        verifierReward -
        costPenalty -
        toolErrorPenalty -
        safetyViolationPenalty
      ).toFixed(4),
    );

    return {
      verifierReward: Number(verifierReward.toFixed(4)),
      costPenalty: Number(costPenalty.toFixed(4)),
      toolErrorPenalty: Number(toolErrorPenalty.toFixed(4)),
      safetyViolationPenalty: Number(safetyViolationPenalty.toFixed(4)),
      totalReward,
    };
  }

  /**
   * Extracts DPO preference pairs (`chosen` vs `rejected`) from paired probe bundles
   * that meet or exceed `minEvidenceLevel`.
   */
  extractDpoPreferencePairs(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidateManifest: HarnessManifest;
    readonly evidenceBundle: EvidenceBundle;
    readonly taskPromptsById?: Readonly<Record<string, string>>;
  }): ReadonlyArray<DpoPreferenceRecord> {
    const { baseManifest, candidateManifest, evidenceBundle, taskPromptsById } =
      params;

    if (
      EVIDENCE_RANK[evidenceBundle.evidenceLevel] <
      EVIDENCE_RANK[this.minEvidenceLevel]
    ) {
      return [];
    }

    const pairs: DpoPreferenceRecord[] = [];
    const count = Math.min(
      evidenceBundle.baseTrials.length,
      evidenceBundle.candidateTrials.length,
    );

    for (let i = 0; i < count; i++) {
      const baseTrial = evidenceBundle.baseTrials[i];
      const candTrial = evidenceBundle.candidateTrials[i];
      if (!baseTrial || !candTrial) continue;

      if (baseTrial.taskId !== candTrial.taskId) continue;
      if (baseTrial.infrastructureError || candTrial.infrastructureError) {
        continue;
      }

      const baseReward = this.computeTrialReward(baseTrial).totalReward;
      const candReward = this.computeTrialReward(candTrial).totalReward;
      const margin = Number(Math.abs(candReward - baseReward).toFixed(4));

      if (margin < this.minPreferenceMargin) {
        continue;
      }

      const candWins = candReward > baseReward;
      const winningManifest = candWins ? candidateManifest : baseManifest;
      const losingManifest = candWins ? baseManifest : candidateManifest;
      const winningTrial = candWins ? candTrial : baseTrial;
      const losingTrial = candWins ? baseTrial : candTrial;
      const winningReward = candWins ? candReward : baseReward;
      const losingReward = candWins ? baseReward : candReward;

      if (winningTrial.policyViolations > 0) {
        continue; // Never export a policy-violating trajectory as 'chosen'
      }

      pairs.push({
        recordId: `dpo_${evidenceBundle.id}_${baseTrial.taskId}_r${baseTrial.trialIndex}`,
        taskId: baseTrial.taskId,
        split: evidenceBundle.split,
        seed: baseTrial.seed ?? 1000,
        prompt:
          taskPromptsById?.[baseTrial.taskId] ??
          `Task ${baseTrial.taskId} execution under ${winningManifest.id}`,
        chosen: {
          manifestId: winningManifest.id,
          manifestHash: winningManifest.contentHash,
          systemPrompt: String(winningManifest.components.systemPrompt.content),
          toolGuidance: String(winningManifest.components.toolGuidance.content),
          trialMetrics: winningTrial,
          scalarReward: winningReward,
        },
        rejected: {
          manifestId: losingManifest.id,
          manifestHash: losingManifest.contentHash,
          systemPrompt: String(losingManifest.components.systemPrompt.content),
          toolGuidance: String(losingManifest.components.toolGuidance.content),
          trialMetrics: losingTrial,
          scalarReward: losingReward,
        },
        preferenceMargin: margin,
        evidenceLevel: evidenceBundle.evidenceLevel,
        provenanceHash: evidenceBundle.provenanceHash,
        createdAt: new Date().toISOString(),
      });
    }

    return pairs;
  }

  /**
   * Builds GRPO group rollout records with group-normalized advantages across base and candidate harnesses.
   */
  extractGrpoRolloutGroups(params: {
    readonly baseManifest: HarnessManifest;
    readonly evaluations: ReadonlyArray<{
      readonly candidateManifest: HarnessManifest;
      readonly evidenceBundle: EvidenceBundle;
    }>;
    readonly taskPromptsById?: Readonly<Record<string, string>>;
  }): ReadonlyArray<GrpoRolloutGroupRecord> {
    const rawByTask = new Map<
      string,
      Array<{
        readonly manifest: HarnessManifest;
        readonly trial: ProbeTrialMetrics;
      }>
    >();

    const baseAddedForTask = new Set<string>();
    for (const ev of params.evaluations) {
      for (const bt of ev.evidenceBundle.baseTrials) {
        if (bt.infrastructureError) continue;
        const key = `${bt.taskId}:${bt.trialIndex}`;
        if (!baseAddedForTask.has(key)) {
          baseAddedForTask.add(key);
          const list = rawByTask.get(bt.taskId) ?? [];
          list.push({ manifest: params.baseManifest, trial: bt });
          rawByTask.set(bt.taskId, list);
        }
      }
      for (const ct of ev.evidenceBundle.candidateTrials) {
        if (ct.infrastructureError) continue;
        const list = rawByTask.get(ct.taskId) ?? [];
        list.push({ manifest: ev.candidateManifest, trial: ct });
        rawByTask.set(ct.taskId, list);
      }
    }

    const groups: GrpoRolloutGroupRecord[] = [];
    for (const [taskId, items] of rawByTask.entries()) {
      if (items.length < 2) continue;

      const decomposed = items.map((item) => ({
        item,
        reward: this.computeTrialReward(item.trial),
      }));

      const n = decomposed.length;
      const meanReward =
        decomposed.reduce((s, d) => s + d.reward.totalReward, 0) / n;
      const variance =
        decomposed.reduce(
          (s, d) => s + Math.pow(d.reward.totalReward - meanReward, 2),
          0,
        ) / Math.max(1, n - 1);
      const stdReward = Math.sqrt(variance);
      const eps = 1e-6;

      const rollouts: GrpoRolloutMember[] = decomposed.map(({ item, reward }) => ({
        manifestId: item.manifest.id,
        manifestHash: item.manifest.contentHash,
        seed: item.trial.seed ?? 1000,
        verifierReward: reward.verifierReward,
        costPenalty: reward.costPenalty,
        toolErrorPenalty: reward.toolErrorPenalty,
        safetyViolationPenalty: reward.safetyViolationPenalty,
        totalReward: reward.totalReward,
        groupAdvantage: Number(
          ((reward.totalReward - meanReward) / (stdReward + eps)).toFixed(4),
        ),
        outputArtifactRefs: item.trial.outputArtifactRefs,
      }));


      groups.push({
        groupId: `grpo_${taskId}_${Date.now()}`,
        taskId,
        prompt: params.taskPromptsById?.[taskId] ?? `Task ${taskId}`,
        rollouts,
        groupMeanReward: Number(meanReward.toFixed(4)),
        groupStdReward: Number(stdReward.toFixed(4)),
        createdAt: new Date().toISOString(),
      });
    }

    return groups;
  }

  /**
   * Diagnoses whether persistent failure signals across candidate harnesses indicate a
   * Model Capability Ceiling (requiring inner-loop weight optimization via `ViForge`)
   * and generates SPIN self-play refinement records when a ceiling is detected.
   */
  diagnoseCapabilityCeilingAndExtractSpin(params: {
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
    readonly evidenceBundles: ReadonlyArray<EvidenceBundle>;
  }): {
    readonly diagnosis: ModelCapabilityCeilingDiagnosis;
    readonly spinRecords: ReadonlyArray<SpinSelfPlayRecord>;
  } {
    const { candidates, contrasts, evidenceBundles } = params;
    const quadrantsExplored = new Set<CandidateExplorationQuadrant>(
      candidates.map((c) => c.hypothesis.quadrant),
    );

    const bestPassDelta =
      contrasts.length > 0
        ? Math.max(...contrasts.map((c) => c.passRateDelta))
        : 0;

    // Identify failure signals that were targeted by hypotheses but NEVER resolved
    const targetedSignals = new Set<FailureSignalType>();
    for (const c of candidates) {
      for (const sig of c.hypothesis.observedFailureSignals) {
        targetedSignals.add(sig);
      }
    }

    const resolvedSignals = new Set<FailureSignalType>();
    for (const contrast of contrasts) {
      for (const sig of contrast.resolvedFailureSignals) {
        resolvedSignals.add(sig);
      }
    }

    const persistentSignals = Array.from(targetedSignals).filter(
      (sig) => !resolvedSignals.has(sig),
    );

    const ceilingDetected =
      candidates.length >= this.ceilingMinCandidates &&
      bestPassDelta <= 0.02 &&
      persistentSignals.length > 0;

    const recommendedPostTrainingMethod: 'NONE' | 'DPO' | 'GRPO' | 'SPIN' =
      !ceilingDetected
        ? 'NONE'
        : bestPassDelta <= 0
          ? 'SPIN'
          : quadrantsExplored.size >= 3
            ? 'GRPO'
            : 'DPO';

    const diagnosis: ModelCapabilityCeilingDiagnosis = {
      ceilingDetected,
      persistentFailureSignals: persistentSignals,
      exhaustedQuadrants: Array.from(quadrantsExplored),
      candidatesEvaluated: candidates.length,
      bestAchievedPassRateDelta: Number(bestPassDelta.toFixed(4)),
      recommendedPostTrainingMethod,
      rationale: ceilingDetected
        ? `Model Capability Ceiling detected: ${candidates.length} harness candidates across [${Array.from(quadrantsExplored).join(', ')}] achieved max passDelta=${(bestPassDelta * 100).toFixed(1)}% and failed to resolve [${persistentSignals.join(', ')}]. Recommend ${recommendedPostTrainingMethod} weight optimization in ViForge.`
        : 'Harness-level mutations remain effective; no model capability ceiling detected.',
    };

    const spinRecords: SpinSelfPlayRecord[] = [];
    if (ceilingDetected && candidates.length > 0) {
      const bestCand = candidates[0]!;
      for (const bundle of evidenceBundles) {
        for (const failedTrial of bundle.candidateTrials.filter(
          (t) => !t.success && !t.infrastructureError,
        )) {
          spinRecords.push({
            recordId: `spin_${bundle.id}_${failedTrial.taskId}_r${failedTrial.trialIndex}`,
            taskId: failedTrial.taskId,
            targetFailureSignals: persistentSignals,
            bestHarnessManifestId: bestCand.manifest.id,
            bestHarnessManifestHash: bestCand.manifest.contentHash,
            systemPrompt: String(bestCand.manifest.components.systemPrompt.content),
            toolGuidance: String(bestCand.manifest.components.toolGuidance.content),
            failedTrialMetrics: failedTrial,
            targetRefinementObjective: `Eliminate persistent [${persistentSignals.join(', ')}] under frozen harness ${bestCand.manifest.id}.`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    return { diagnosis, spinRecords };
  }

  /**
   * Exports DPO, GRPO, and SPIN datasets to JSONL files for direct ingestion by `ViForge`.
   */
  async exportToJsonlFiles(params: {
    readonly outputDir: string;
    readonly dpoRecords: ReadonlyArray<DpoPreferenceRecord>;
    readonly grpoGroups: ReadonlyArray<GrpoRolloutGroupRecord>;
    readonly spinRecords: ReadonlyArray<SpinSelfPlayRecord>;
  }): Promise<{
    readonly dpoFilePath: string;
    readonly grpoFilePath: string;
    readonly spinFilePath: string;
  }> {
    await fs.mkdir(params.outputDir, { recursive: true });
    const dpoFilePath = path.join(params.outputDir, 'dpo_preferences.jsonl');
    const grpoFilePath = path.join(params.outputDir, 'grpo_groups.jsonl');
    const spinFilePath = path.join(params.outputDir, 'spin_ceiling_records.jsonl');

    await fs.writeFile(
      dpoFilePath,
      params.dpoRecords.map((r) => JSON.stringify(r)).join('\n') +
        (params.dpoRecords.length > 0 ? '\n' : ''),
      'utf-8',
    );
    await fs.writeFile(
      grpoFilePath,
      params.grpoGroups.map((g) => JSON.stringify(g)).join('\n') +
        (params.grpoGroups.length > 0 ? '\n' : ''),
      'utf-8',
    );
    await fs.writeFile(
      spinFilePath,
      params.spinRecords.map((s) => JSON.stringify(s)).join('\n') +
        (params.spinRecords.length > 0 ? '\n' : ''),
      'utf-8',
    );

    return { dpoFilePath, grpoFilePath, spinFilePath };
  }
}
