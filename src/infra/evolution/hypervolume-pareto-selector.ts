/**
 * Wave 9.4 — Multi-Objective Hypervolume Contribution & Augmented Tchebycheff Selector
 * (`HypervolumeParetoSelector`).
 *
 * Overcomes the geometric limitation of linear weighted scalarization (which cannot
 * identify Pareto-optimal candidates in non-convex frontier regions) by combining:
 * 1. **Dominated Hypervolume ($\text{HV}(\mathcal{P}, \mathbf{r})$) & Marginal Hypervolume
 *    Contribution ($\Delta\text{HV}(H_i, \mathcal{P}, \mathbf{r})$)** in 5D normalized utility space.
 * 2. **Augmented Tchebycheff Scalarization**:
 *    $L_{\text{Tcheb}}(H, \mathbf{w}, \mathbf{z}^*) = \max_{m} \{ w_m |z^*_m - u_m(H)| \} + \rho \sum_m w_m |z^*_m - u_m(H)|$
 *    where smaller Tchebycheff distance to the utopia point $\mathbf{z}^* = (1,1,1,1,1)$ is better.
 */
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { MultiObjectiveVector } from '../../core/evolution/interfaces.js';

export interface HypervolumeCandidateInput {
  readonly manifest: HarnessManifest;
  readonly vector: MultiObjectiveVector;
}

export interface HypervolumeCandidateScore {
  readonly manifestId: string;
  readonly manifest: HarnessManifest;
  readonly utility5D: ReadonlyArray<number>; // [quality, costEfficiency, latencyEfficiency, reliability, safety] in [0,1]^5
  readonly paretoNonDominated: boolean;
  readonly marginalHypervolumeContribution: number;
  readonly tchebycheffDistance: number;
}

export interface HypervolumeSelectionReport {
  readonly totalEnsembleHypervolume: number;
  readonly paretoFrontierIds: ReadonlyArray<string>;
  readonly selectedByHypervolume: HypervolumeCandidateScore;
  readonly selectedByTchebycheff: HypervolumeCandidateScore;
  readonly candidateScores: ReadonlyArray<HypervolumeCandidateScore>;
}

export class HypervolumeParetoSelector {
  private readonly augmentationRho: number;

  constructor(options?: { readonly augmentationRho?: number }) {
    this.augmentationRho = options?.augmentationRho ?? 0.05;
  }

  /**
   * Converts a `MultiObjectiveVector` (where cost/latency/toolError/regression are penalties)
   * into a 5D maximization utility vector $\mathbf{u} \in [0, 1]^5$.
   */
  toMaximizationUtility5D(vec: MultiObjectiveVector): ReadonlyArray<number> {
    const uQuality = Math.max(0, Math.min(1, vec.qualityScore));
    const uCost = Math.max(0, Math.min(1, 1 - vec.costScore));
    const uLatency = Math.max(0, Math.min(1, 1 - vec.latencyScore));
    const uReliability = Math.max(
      0,
      Math.min(1, 1 - 0.5 * vec.toolErrorPenalty - 0.5 * vec.regressionPenalty),
    );
    const safetyUtility = Math.max(0, Math.min(1, 1 - vec.safetyRiskPenalty));
    const generalizationUtility = Math.max(0, Math.min(1, (vec.generalizationBonus + 1) / 2));
    const uSafety = Math.max(
      0,
      Math.min(1, 0.7 * safetyUtility + 0.3 * generalizationUtility),
    );
    return [
      Number(uQuality.toFixed(4)),
      Number(uCost.toFixed(4)),
      Number(uLatency.toFixed(4)),
      Number(uReliability.toFixed(4)),
      Number(uSafety.toFixed(4)),
    ];
  }

  /**
   * Evaluates the Pareto frontier, total dominated hypervolume, per-candidate marginal
   * hypervolume contribution $\Delta\text{HV}(H_i)$, and Augmented Tchebycheff distance.
   */
  evaluatePopulation(params: {
    readonly candidates: ReadonlyArray<HypervolumeCandidateInput>;
    readonly weights5D?: ReadonlyArray<number>; // defaults to balanced [0.35, 0.15, 0.15, 0.15, 0.20]
  }): HypervolumeSelectionReport {
    if (params.candidates.length === 0) {
      throw new Error('HypervolumeParetoSelector requires at least 1 candidate.');
    }

    const weights = params.weights5D ?? [0.35, 0.15, 0.15, 0.15, 0.2];
    const points = params.candidates.map((c) => ({
      manifest: c.manifest,
      u: this.toMaximizationUtility5D(c.vector),
    }));

    // 1. Identify non-dominated Pareto set in 5D maximization space
    const nonDominatedFlags = points.map((p, i) => {
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        if (this.dominates(points[j]!.u, p.u)) {
          return false;
        }
      }
      return true;
    });

    const allUtilities = points.map((p) => p.u);
    const totalEnsembleHypervolume = this.computeHypervolume(allUtilities);

    const candidateScores: HypervolumeCandidateScore[] = points.map(
      (p, idx) => {
        const withoutIdx = allUtilities.filter((_, j) => j !== idx);
        const hvWithout = this.computeHypervolume(withoutIdx);
        const marginalHv = Math.max(0, totalEnsembleHypervolume - hvWithout);
        const tchebDist = this.computeAugmentedTchebycheff(p.u, weights);

        return {
          manifestId: String(p.manifest.id),
          manifest: p.manifest,
          utility5D: p.u,
          paretoNonDominated: nonDominatedFlags[idx]!,
          marginalHypervolumeContribution: Number(marginalHv.toFixed(5)),
          tchebycheffDistance: Number(tchebDist.toFixed(5)),
        };
      },
    );

    const sortedByHv = [...candidateScores].sort((a, b) => {
      if (
        b.marginalHypervolumeContribution !== a.marginalHypervolumeContribution
      ) {
        return (
          b.marginalHypervolumeContribution - a.marginalHypervolumeContribution
        );
      }
      return a.tchebycheffDistance - b.tchebycheffDistance;
    });

    const sortedByTcheb = [...candidateScores].sort(
      (a, b) => a.tchebycheffDistance - b.tchebycheffDistance,
    );

    return {
      totalEnsembleHypervolume: Number(totalEnsembleHypervolume.toFixed(5)),
      paretoFrontierIds: candidateScores
        .filter((c) => c.paretoNonDominated)
        .map((c) => c.manifestId),
      selectedByHypervolume: sortedByHv[0]!,
      selectedByTchebycheff: sortedByTcheb[0]!,
      candidateScores,
    };
  }

  /**
   * Computes exact/deterministic quasi-Monte-Carlo Halton hypervolume in $[0, 1]^5$
   * relative to nadir reference point $\mathbf{r} = (0,0,0,0,0)$.
   */
  computeHypervolume(points: ReadonlyArray<ReadonlyArray<number>>): number {
    if (points.length === 0) return 0;
    if (points.length === 1) {
      return points[0]!.reduce((prod, v) => prod * Math.max(0, v), 1);
    }

    // Deterministic Halton low-discrepancy sequence in [0, 1]^5 (primes 2, 3, 5, 7, 11)
    const primes = [2, 3, 5, 7, 11];
    const sampleCount = 600;
    let dominatedCount = 0;

    for (let s = 1; s <= sampleCount; s++) {
      const sample = primes.map((prime) => this.halton(s, prime));
      let dominatedBySome = false;
      for (const pt of points) {
        if (
          sample[0]! <= pt[0]! &&
          sample[1]! <= pt[1]! &&
          sample[2]! <= pt[2]! &&
          sample[3]! <= pt[3]! &&
          sample[4]! <= pt[4]!
        ) {
          dominatedBySome = true;
          break;
        }
      }
      if (dominatedBySome) {
        dominatedCount += 1;
      }
    }

    return dominatedCount / sampleCount;
  }

  private computeAugmentedTchebycheff(
    u: ReadonlyArray<number>,
    weights: ReadonlyArray<number>,
  ): number {
    let maxWeightedGap = 0;
    let sumWeightedGap = 0;
    for (let m = 0; m < u.length; m++) {
      const w = weights[m] ?? 0.2;
      const gap = w * Math.abs(1.0 - (u[m] ?? 0));
      if (gap > maxWeightedGap) {
        maxWeightedGap = gap;
      }
      sumWeightedGap += gap;
    }
    return maxWeightedGap + this.augmentationRho * sumWeightedGap;
  }

  private dominates(
    a: ReadonlyArray<number>,
    b: ReadonlyArray<number>,
  ): boolean {
    let strictlyBetterInOne = false;
    for (let i = 0; i < a.length; i++) {
      if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
      if ((a[i] ?? 0) > (b[i] ?? 0)) strictlyBetterInOne = true;
    }
    return strictlyBetterInOne;
  }

  private halton(index: number, base: number): number {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  }
}
