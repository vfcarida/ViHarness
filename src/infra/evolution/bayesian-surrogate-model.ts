/**
 * Wave 9.1 — Surrogate-Assisted Bayesian Acquisition & Zero-Probe Pre-Screening
 * (`BayesianHarnessSurrogateModel`).
 *
 * Accelerates multi-candidate evolution by maintaining an online Bayesian Ridge /
 * Gaussian Process surrogate over structural 16-dimensional feature embeddings of
 * `HarnessManifestDiff` and `HarnessChangeHypothesis`.
 *
 * Given $N$ proposed candidates, predicts posterior utility delta $\mathcal{N}(\hat{\mu}(\mathbf{x}), \hat{\sigma}^2(\mathbf{x}))$
 * and computes:
 * - **Expected Improvement ($\text{EI}$)**: $\mathbb{E}[\max(0, \Delta(\mathbf{x}) - \Delta^*)]$
 * - **Upper Confidence Bound ($\text{UCB}$)**: $\hat{\mu}(\mathbf{x}) + \kappa \hat{\sigma}(\mathbf{x})$
 *
 * Pre-screens large candidate pools ($N \gg K$) at zero LLM probe cost.
 */
import type {
  BehavioralContrast,
  HarnessChangeHypothesis,
} from '../../core/evolution/hypothesis.js';
import type { ProposedCandidate } from '../../core/evolution/interfaces.js';
import type { HarnessManifestDiff } from '../../core/evolution/harness-manifest.js';

export interface SurrogatePrediction {
  readonly candidateId: string;
  readonly manifestId: string;
  readonly posteriorMeanDelta: number;
  readonly posteriorStdDev: number;
  readonly expectedImprovement: number;
  readonly upperConfidenceBound: number;
  readonly featureVector: ReadonlyArray<number>;
}

export interface SurrogatePreScreenResult {
  readonly selectedCandidates: ReadonlyArray<ProposedCandidate>;
  readonly deferredCandidates: ReadonlyArray<ProposedCandidate>;
  readonly predictions: ReadonlyArray<SurrogatePrediction>;
  readonly bestHistoricalDelta: number;
  readonly observationCount: number;
}

const CANONICAL_SURFACES = [
  'systemPrompt',
  'guardrails',
  'memoryPolicy',
  'toolGuidance',
  'subagents',
  'skills',
  'scripts',
  'plugins',
  'contextPolicy',
  'routingPolicy',
  'verificationPolicy',
  'toolSchedulingPolicy',
] as const;

const FEATURE_DIM = 16; // 12 surfaces + 4 quadrant/complexity features

export class BayesianHarnessSurrogateModel {
  private readonly ridgeLambda: number;
  private readonly priorNoiseStd: number;
  private readonly defaultKappa: number;
  private readonly observations: Array<{
    readonly features: ReadonlyArray<number>;
    readonly utilityDelta: number;
  }> = [];
  private bestHistoricalDelta = 0.0;

  constructor(options?: {
    readonly ridgeLambda?: number;
    readonly priorNoiseStd?: number;
    readonly defaultKappa?: number;
  }) {
    this.ridgeLambda = options?.ridgeLambda ?? 1.0;
    this.priorNoiseStd = options?.priorNoiseStd ?? 0.15;
    this.defaultKappa = options?.defaultKappa ?? 1.25;
  }

  /**
   * Encodes a `(HarnessManifestDiff, HarnessChangeHypothesis)` pair into a normalized
   * 16-dimensional feature vector $\mathbf{x} \in \mathbb{R}^{16}$.
   */
  featurizeCandidate(
    diff: HarnessManifestDiff,
    hypothesis: HarnessChangeHypothesis,
  ): ReadonlyArray<number> {
    const vec = new Array<number>(FEATURE_DIM).fill(0);
    const changedSet = new Set(diff.changedSurfaces);

    for (let i = 0; i < CANONICAL_SURFACES.length; i++) {
      const surfaceId = CANONICAL_SURFACES[i]!;
      vec[i] = changedSet.has(surfaceId) ? 1.0 : 0.0;
    }

    // Feature 12: Scope Axis (INVARIANT = 1.0, DOMAIN_SPECIFIC = 0.5)
    vec[12] = hypothesis.scopeAxis === 'INVARIANT' ? 1.0 : 0.5;
    // Feature 13: Mechanism Axis (STRUCTURAL = 1.0, GUIDANCE = 0.5)
    vec[13] = hypothesis.mechanismAxis === 'STRUCTURAL' ? 1.0 : 0.5;
    // Feature 14: Normalized surface edit count
    vec[14] = Math.min(1.0, diff.changedSurfaces.length / 4);
    // Feature 15: Normalized unit change magnitude
    vec[15] = Math.min(1.0, diff.totalUnitsChanged / 25);

    return vec;
  }

  /**
   * Records an empirical `(ProposedCandidate, BehavioralContrast)` observation into the
   * surrogate's posterior kernel memory.
   */
  recordObservation(
    candidate: ProposedCandidate,
    contrast: BehavioralContrast,
  ): void {
    const features = this.featurizeCandidate(
      candidate.diffFromBase,
      candidate.hypothesis,
    );
    const utilityDelta =
      contrast.partialScoreDelta * 0.7 +
      contrast.passRateDelta * 0.3 -
      Math.max(0, contrast.meanCostDollarsDelta) * 0.2;

    this.observations.push({
      features,
      utilityDelta: Number(utilityDelta.toFixed(6)),
    });
    if (utilityDelta > this.bestHistoricalDelta) {
      this.bestHistoricalDelta = Number(utilityDelta.toFixed(6));
    }
  }

  /**
   * Predicts posterior mean $\hat{\mu}(\mathbf{x})$, standard deviation $\hat{\sigma}(\mathbf{x})$,
   * Expected Improvement ($\text{EI}$), and Upper Confidence Bound ($\text{UCB}$) for a candidate.
   */
  predictCandidate(
    candidate: ProposedCandidate,
    explorationKappa = this.defaultKappa,
  ): SurrogatePrediction {
    const x = this.featurizeCandidate(
      candidate.diffFromBase,
      candidate.hypothesis,
    );

    if (this.observations.length === 0) {
      // Cold-start prior: slight structural bonus + wide uncertainty
      const priorMean = Number(
        (0.04 * x[12]! + 0.03 * x[13]! - 0.02 * x[15]!).toFixed(4),
      );
      const priorStd = Number(this.priorNoiseStd.toFixed(4));
      const ei = this.computeExpectedImprovement(
        priorMean,
        priorStd,
        this.bestHistoricalDelta,
      );
      return {
        candidateId: String(candidate.candidateId),
        manifestId: String(candidate.manifest.id),
        posteriorMeanDelta: priorMean,
        posteriorStdDev: priorStd,
        expectedImprovement: ei,
        upperConfidenceBound: Number(
          (priorMean + explorationKappa * priorStd).toFixed(4),
        ),
        featureVector: x,
      };
    }

    // Nadaraya-Watson / RBF Gaussian Process kernel regression over historical observations
    let weightSum = 0;
    let weightedDeltaSum = 0;
    let maxSimilarity = 0;

    for (const obs of this.observations) {
      const sqDist = this.squaredEuclidean(x, obs.features);
      const kernelWeight = Math.exp(-sqDist / (2 * this.ridgeLambda));
      weightSum += kernelWeight;
      weightedDeltaSum += kernelWeight * obs.utilityDelta;
      if (kernelWeight > maxSimilarity) {
        maxSimilarity = kernelWeight;
      }
    }

    const posteriorMean =
      weightSum > 1e-6 ? weightedDeltaSum / weightSum : 0.0;
    // Posterior variance shrinks as kernel similarity to observed points increases
    const informationGainFactor = Math.max(
      0.08,
      Math.sqrt(Math.max(0.01, 1.0 - maxSimilarity * 0.85)),
    );
    const posteriorStd = this.priorNoiseStd * informationGainFactor;

    const ei = this.computeExpectedImprovement(
      posteriorMean,
      posteriorStd,
      this.bestHistoricalDelta,
    );
    const ucb = posteriorMean + explorationKappa * posteriorStd;

    return {
      candidateId: String(candidate.candidateId),
      manifestId: String(candidate.manifest.id),
      posteriorMeanDelta: Number(posteriorMean.toFixed(4)),
      posteriorStdDev: Number(posteriorStd.toFixed(4)),
      expectedImprovement: Number(ei.toFixed(4)),
      upperConfidenceBound: Number(ucb.toFixed(4)),
      featureVector: x,
    };
  }

  /**
   * Ranks a pool of proposed candidates by Expected Improvement + UCB and returns
   * the top `maxSelected` candidates for physical probing.
   */
  preScreenCandidates(params: {
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly maxSelected: number;
    readonly explorationKappa?: number;
  }): SurrogatePreScreenResult {
    const kappa = params.explorationKappa ?? this.defaultKappa;
    const scored = params.candidates.map((cand) => ({
      cand,
      pred: this.predictCandidate(cand, kappa),
    }));

    scored.sort((a, b) => {
      if (b.pred.expectedImprovement !== a.pred.expectedImprovement) {
        return b.pred.expectedImprovement - a.pred.expectedImprovement;
      }
      return b.pred.upperConfidenceBound - a.pred.upperConfidenceBound;
    });

    const k = Math.max(1, Math.min(params.maxSelected, scored.length));
    return {
      selectedCandidates: scored.slice(0, k).map((s) => s.cand),
      deferredCandidates: scored.slice(k).map((s) => s.cand),
      predictions: scored.map((s) => s.pred),
      bestHistoricalDelta: this.bestHistoricalDelta,
      observationCount: this.observations.length,
    };
  }

  private computeExpectedImprovement(
    mean: number,
    std: number,
    bestSoFar: number,
  ): number {
    if (std <= 1e-8) {
      return Math.max(0, mean - bestSoFar);
    }
    const z = (mean - bestSoFar) / std;
    const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const cdf = 0.5 * (1 + this.erf(z / Math.SQRT2));
    const ei = (mean - bestSoFar) * cdf + std * pdf;
    return Number(Math.max(0, ei).toFixed(4));
  }

  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    const absX = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * absX);
    const poly =
      t *
      (0.254829592 +
        t *
          (-0.284496736 +
            t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return sign * (1 - poly * Math.exp(-absX * absX));
  }

  private squaredEuclidean(
    a: ReadonlyArray<number>,
    b: ReadonlyArray<number>,
  ): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      sum += d * d;
    }
    return sum;
  }
}
