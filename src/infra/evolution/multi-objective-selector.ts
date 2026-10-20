/**
 * Multi-Objective Candidate Selector & Pareto Frontier Calculator.
 *
 * Evaluates candidates across 5 separate objective dimensions (Quality, Efficiency,
 * Reliability, Generalization, Security) and maintains the non-dominated Pareto frontier.
 *
 * Reference utility function (kept configurable per deployment profile):
 *   U(H) = w_q·Q − w_c·C − w_l·L − w_e·E_tool − w_s·R_safety − w_r·R_regression + w_g·G_OOD
 */
import type {
  HarnessCandidateSelector,
  CandidateSelectionResult,
  DeploymentProfileName,
  EvaluatedCandidate,
  MultiObjectiveVector,
  MultiObjectiveWeights,
} from '../../core/evolution/interfaces.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  EvidenceBundle,
  BehavioralContrast,
} from '../../core/evolution/hypothesis.js';
import type { HarnessId } from '../../core/types/identifiers.js';

export const DEPLOYMENT_PROFILE_WEIGHTS: Readonly<
  Record<DeploymentProfileName, MultiObjectiveWeights>
> = Object.freeze({
  quality_first: {
    quality: 0.45,
    cost: 0.05,
    latency: 0.05,
    toolReliability: 0.1,
    safety: 0.15,
    regression: 0.1,
    generalization: 0.1,
  },
  balanced: {
    quality: 0.3,
    cost: 0.15,
    latency: 0.1,
    toolReliability: 0.1,
    safety: 0.15,
    regression: 0.1,
    generalization: 0.1,
  },
  low_cost: {
    quality: 0.2,
    cost: 0.35,
    latency: 0.1,
    toolReliability: 0.1,
    safety: 0.1,
    regression: 0.1,
    generalization: 0.05,
  },
  low_latency: {
    quality: 0.2,
    cost: 0.1,
    latency: 0.35,
    toolReliability: 0.1,
    safety: 0.1,
    regression: 0.1,
    generalization: 0.05,
  },
  high_assurance: {
    quality: 0.25,
    cost: 0.05,
    latency: 0.05,
    toolReliability: 0.15,
    safety: 0.3,
    regression: 0.15,
    generalization: 0.05,
  },
});

export class DefaultMultiObjectiveSelector implements HarnessCandidateSelector {
  private readonly profileWeights: Readonly<
    Record<DeploymentProfileName, MultiObjectiveWeights>
  >;

  constructor(
    customWeights?: Partial<Record<DeploymentProfileName, MultiObjectiveWeights>>,
  ) {
    this.profileWeights = {
      ...DEPLOYMENT_PROFILE_WEIGHTS,
      ...customWeights,
    };
  }

  select(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<{
      readonly manifest: HarnessManifest;
      readonly evidenceBundle: EvidenceBundle;
      readonly contrast: BehavioralContrast;
    }>;
    readonly profile: DeploymentProfileName;
  }): CandidateSelectionResult {
    if (params.candidates.length === 0) {
      return {
        activeProfile: params.profile,
        selectedCandidate: null,
        paretoFrontier: [],
        allEvaluated: [],
        baselinepreserved: true,
        rationale: 'No candidates provided for selection; preserving baseline.',
      };
    }

    const rawEvaluated = params.candidates.map((item) => {
      const objectives = this.computeObjectives(item.evidenceBundle, item.contrast);
      const utilityByProfile: Record<DeploymentProfileName, number> = {
        quality_first: this.computeUtility(objectives, this.profileWeights.quality_first),
        balanced: this.computeUtility(objectives, this.profileWeights.balanced),
        low_cost: this.computeUtility(objectives, this.profileWeights.low_cost),
        low_latency: this.computeUtility(objectives, this.profileWeights.low_latency),
        high_assurance: this.computeUtility(objectives, this.profileWeights.high_assurance),
      };
      return {
        manifest: item.manifest,
        evidenceBundle: item.evidenceBundle,
        contrast: item.contrast,
        objectives,
        utilityByProfile,
      };
    });

    const allEvaluated: EvaluatedCandidate[] = rawEvaluated.map((cand) => {
      const dominatedByIds: HarnessId[] = [];
      for (const other of rawEvaluated) {
        if (other.manifest.id === cand.manifest.id) continue;
        if (this.dominates(other.objectives, cand.objectives)) {
          dominatedByIds.push(other.manifest.id);
        }
      }
      return {
        ...cand,
        isParetoOptimal: dominatedByIds.length === 0,
        dominatedByIds,
      };
    });

    const paretoFrontier = allEvaluated.filter((c) => c.isParetoOptimal);

    const safeViable = paretoFrontier.filter(
      (c) =>
        c.objectives.safetyRiskPenalty === 0 &&
        c.contrast.hypothesisOutcome.verdict !== 'contradicted',
    );

    if (safeViable.length === 0) {
      return {
        activeProfile: params.profile,
        selectedCandidate: null,
        paretoFrontier,
        allEvaluated,
        baselinepreserved: true,
        rationale:
          'All Pareto-optimal candidates either introduced safety violations or had contradicted hypotheses; preserving baseline.',
      };
    }

    const ranked = [...safeViable].sort((a, b) => {
      const utilDiff =
        b.utilityByProfile[params.profile] - a.utilityByProfile[params.profile];
      if (Math.abs(utilDiff) > 1e-6) {
        return utilDiff;
      }
      if (a.objectives.costScore !== b.objectives.costScore) {
        return a.objectives.costScore - b.objectives.costScore;
      }
      return a.manifest.id.localeCompare(b.manifest.id);
    });

    const best = ranked[0]!;
    const baseTrials = best.evidenceBundle.baseTrials;
    const baseMeanScore =
      baseTrials.length > 0
        ? baseTrials.reduce((s, t) => s + t.partialScore, 0) / baseTrials.length
        : 0.5;

    const baselineObjectives: MultiObjectiveVector = {
      qualityScore: baseMeanScore,
      costScore: 0.25,
      latencyScore: 0.25,
      toolErrorPenalty: 0.0,
      safetyRiskPenalty: 0.0,
      regressionPenalty: 0.0,
      generalizationBonus: 0.0,
      variancePenalty: best.contrast.candidateVariance,
    };
    const baselineUtility = this.computeUtility(
      baselineObjectives,
      this.profileWeights[params.profile],
    );
    const bestUtility = best.utilityByProfile[params.profile];

    if (bestUtility <= baselineUtility) {
      return {
        activeProfile: params.profile,
        selectedCandidate: null,
        paretoFrontier,
        allEvaluated,
        baselinepreserved: true,
        rationale: `Best candidate ${best.manifest.id} utility (${bestUtility.toFixed(4)}) did not exceed baseline utility (${baselineUtility.toFixed(4)}) under profile '${params.profile}'.`,
      };
    }

    return {
      activeProfile: params.profile,
      selectedCandidate: best,
      paretoFrontier,
      allEvaluated,
      baselinepreserved: false,
      rationale: `Selected Pareto-optimal candidate ${best.manifest.id} with utility ${bestUtility.toFixed(4)} vs baseline ${baselineUtility.toFixed(4)} under profile '${params.profile}'.`,
    };
  }

  computeObjectives(
    bundle: EvidenceBundle,
    contrast: BehavioralContrast,
  ): MultiObjectiveVector {
    const candTrials = bundle.candidateTrials;
    const candMeanScore =
      candTrials.length > 0
        ? candTrials.reduce((s, t) => s + t.partialScore, 0) / candTrials.length
        : Math.max(0, Math.min(1, 0.5 + contrast.passRateDelta));

    const qualityScore = Math.max(0, Math.min(1, candMeanScore));

    const costScore = Math.max(
      0,
      Math.min(1, Number((0.25 + contrast.meanCostDollarsDelta * 5).toFixed(4))),
    );

    const latencyScore = Math.max(
      0,
      Math.min(1, Number((0.25 + contrast.meanLatencyMsDelta / 10000).toFixed(4))),
    );

    const toolErrorPenalty = Math.max(
      0,
      Math.min(1, contrast.toolErrorRateDelta > 0 ? contrast.toolErrorRateDelta : 0),
    );

    const safetyRiskPenalty = Math.max(
      0,
      Math.min(1, contrast.policyViolationDelta > 0 ? 1.0 : 0.0),
    );

    const regressionPenalty = Math.max(
      0,
      Math.min(
        1,
        contrast.regressionDelta > 0
          ? 1.0
          : contrast.passRateDelta < 0
            ? Math.abs(contrast.passRateDelta)
            : 0,
      ),
    );

    const effectiveDelta = Math.max(contrast.passRateDelta, contrast.partialScoreDelta);
    const generalizationBonus =
      effectiveDelta > 0 && contrast.hypothesisOutcome.verdict === 'supported'
        ? Math.min(1, Number((effectiveDelta * 0.8).toFixed(4)))
        : 0;

    return {
      qualityScore,
      costScore,
      latencyScore,
      toolErrorPenalty,
      safetyRiskPenalty,
      regressionPenalty,
      generalizationBonus,
      variancePenalty: Math.max(0, Math.min(1, contrast.candidateVariance)),
    };
  }

  computeUtility(
    v: MultiObjectiveVector,
    w: MultiObjectiveWeights,
  ): number {
    const raw =
      w.quality * v.qualityScore -
      w.cost * v.costScore -
      w.latency * v.latencyScore -
      w.toolReliability * v.toolErrorPenalty -
      w.safety * v.safetyRiskPenalty -
      w.regression * v.regressionPenalty +
      w.generalization * v.generalizationBonus -
      0.05 * v.variancePenalty;
    return Number(raw.toFixed(6));
  }

  private dominates(a: MultiObjectiveVector, b: MultiObjectiveVector): boolean {
    const aNoWorse =
      a.qualityScore >= b.qualityScore &&
      a.costScore <= b.costScore &&
      a.latencyScore <= b.latencyScore &&
      a.toolErrorPenalty <= b.toolErrorPenalty &&
      a.safetyRiskPenalty <= b.safetyRiskPenalty &&
      a.regressionPenalty <= b.regressionPenalty &&
      a.generalizationBonus >= b.generalizationBonus;

    if (!aNoWorse) return false;

    const aStrictlyBetter =
      a.qualityScore > b.qualityScore ||
      a.costScore < b.costScore ||
      a.latencyScore < b.latencyScore ||
      a.toolErrorPenalty < b.toolErrorPenalty ||
      a.safetyRiskPenalty < b.safetyRiskPenalty ||
      a.regressionPenalty < b.regressionPenalty ||
      a.generalizationBonus > b.generalizationBonus;

    return aStrictlyBetter;
  }
}
