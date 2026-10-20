/**
 * Wave 6.2 — Causal Surface Credit Assignment & Auto-Ablation Pruning (`ShapleyComponentAttributor`).
 *
 * Solves the multi-surface credit assignment and "free-rider mutation" problem in
 * recursive harness evolution ("What Does a Harness Buy? Tokens, Mostly"):
 * 1. Treats each candidate harness mutation as a coalition $S \subseteq \mathcal{S}$ of
 *    modified evolvable surfaces with observed coalition value:
 *      v(S) = passRateDelta + 0.5 * partialScoreDelta - costPenaltyWeight * costDollarsDelta
 * 2. Computes empirical Shapley values $\phi_j$ and Leave-One-Out (LOO) counterfactual
 *    ablation deltas across the evaluated candidate pool.
 * 3. Classifies each surface into `SYNERGISTIC_CONTRIBUTOR`, `NEUTRAL_FREE_RIDER`, or
 *    `PARASITIC_DEGRADER`, and provides `pruneFreeRiderSurfaces()` to strip non-contributing
 *    mutations before promotion to canonical baseline `H0`.
 */
import type { HarnessId } from '../../core/types/identifiers.js';
import type {
  HarnessComponents,
  HarnessManifest,
} from '../../core/evolution/harness-manifest.js';
import type { BehavioralContrast } from '../../core/evolution/hypothesis.js';
import type { ProposedCandidate } from '../../core/evolution/interfaces.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export type SurfaceAttributionRole =
  | 'SYNERGISTIC_CONTRIBUTOR'
  | 'NEUTRAL_FREE_RIDER'
  | 'PARASITIC_DEGRADER';

export interface SurfaceCreditRecord {
  readonly surfaceId: string;
  readonly shapleyValue: number;
  readonly leaveOneOutDelta: number;
  readonly appearancesCount: number;
  readonly meanStandaloneOrCoalitionGain: number;
  readonly meanCostDollarsDelta: number;
  readonly role: SurfaceAttributionRole;
  readonly rationale: string;
}

export interface ShapleyAttributionReport {
  readonly totalCandidatesAnalyzed: number;
  readonly surfaceCredits: ReadonlyArray<SurfaceCreditRecord>;
  readonly synergisticSurfaces: ReadonlyArray<string>;
  readonly freeRiderSurfaces: ReadonlyArray<string>;
  readonly parasiticSurfaces: ReadonlyArray<string>;
}

export interface PrunedHarnessResult {
  readonly originalManifest: HarnessManifest;
  readonly prunedManifest: HarnessManifest;
  readonly retainedSurfaces: ReadonlyArray<string>;
  readonly strippedSurfaces: ReadonlyArray<string>;
  readonly wasPruned: boolean;
}

export interface ShapleyComponentAttributorOptions {
  readonly minPositiveCreditThreshold?: number;
  readonly costPenaltyWeight?: number;
}

export class ShapleyComponentAttributor {
  private readonly minPositiveCreditThreshold: number;
  private readonly costPenaltyWeight: number;

  constructor(options?: ShapleyComponentAttributorOptions) {
    this.minPositiveCreditThreshold = options?.minPositiveCreditThreshold ?? 0.01;
    this.costPenaltyWeight = options?.costPenaltyWeight ?? 0.5;
  }

  /**
   * Computes empirical Shapley values and Leave-One-Out counterfactual credit for every
   * evolvable surface modified across the candidate pool.
   */
  computeAttribution(params: {
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
  }): ShapleyAttributionReport {
    const contrastByManifestId = new Map<string, BehavioralContrast>();
    for (const contrast of params.contrasts) {
      contrastByManifestId.set(String(contrast.candidateManifestId), contrast);
    }

    interface CoalitionObservation {
      readonly surfaces: ReadonlyArray<string>;
      readonly surfaceSet: ReadonlySet<string>;
      readonly utilityGain: number;
      readonly costDelta: number;
    }

    const coalitions: CoalitionObservation[] = [];
    const allSurfaces = new Set<string>();

    for (const cand of params.candidates) {
      const contrast = contrastByManifestId.get(String(cand.manifest.id));
      if (!contrast) continue;
      const changed = cand.diffFromBase.changedSurfaces;
      if (changed.length === 0) continue;

      for (const s of changed) {
        allSurfaces.add(s);
      }

      const safetyPenalty = Math.max(0, contrast.policyViolationDelta ?? 0) * 1.0;
      const utilityGain = Number(
        (
          contrast.passRateDelta * 0.65 +
          contrast.partialScoreDelta * 0.35 -
          this.costPenaltyWeight * Math.max(0, contrast.meanCostDollarsDelta) -
          safetyPenalty
        ).toFixed(6),
      );

      coalitions.push({
        surfaces: changed,
        surfaceSet: new Set(changed),
        utilityGain,
        costDelta: contrast.meanCostDollarsDelta,
      });
    }

    const surfaceCredits: SurfaceCreditRecord[] = [];
    for (const surfaceId of Array.from(allSurfaces).sort()) {
      const withSurface = coalitions.filter((c) => c.surfaceSet.has(surfaceId));
      const withoutSurface = coalitions.filter((c) => !c.surfaceSet.has(surfaceId));

      const appearancesCount = withSurface.length;
      if (appearancesCount === 0) continue;

      // 1. Empirical Shapley marginal contribution across coalition sizes
      let weightedMarginalSum = 0;
      let weightTotal = 0;

      for (const cWith of withSurface) {
        const k = cWith.surfaces.length;
        if (k === 1) {
          // Standalone singleton coalition v({j}) - v(empty=0)
          weightedMarginalSum += cWith.utilityGain * 1.5;
          weightTotal += 1.5;
        } else {
          // Find closest subset coalition S \ {j} if evaluated, else divide coalition value equally
          const complementSurfaces = cWith.surfaces.filter((s) => s !== surfaceId);
          const matchingSubCoalition = withoutSurface.find(
            (cWithout) =>
              cWithout.surfaces.length === complementSurfaces.length &&
              complementSurfaces.every((s) => cWithout.surfaceSet.has(s)),
          );
          if (matchingSubCoalition) {
            const marginal = cWith.utilityGain - matchingSubCoalition.utilityGain;
            weightedMarginalSum += marginal * 2.0;
            weightTotal += 2.0;
          } else {
            weightedMarginalSum += cWith.utilityGain / k;
            weightTotal += 1.0;
          }
        }
      }

      const shapleyValue = Number(
        (weightTotal > 0 ? weightedMarginalSum / weightTotal : 0).toFixed(4),
      );

      const meanWith =
        withSurface.reduce((s, c) => s + c.utilityGain, 0) / withSurface.length;
      const meanWithout =
        withoutSurface.length > 0
          ? withoutSurface.reduce((s, c) => s + c.utilityGain, 0) /
            withoutSurface.length
          : 0;
      const leaveOneOutDelta = Number((meanWith - meanWithout).toFixed(4));
      const meanCostDollarsDelta = Number(
        (
          withSurface.reduce((s, c) => s + c.costDelta, 0) / withSurface.length
        ).toFixed(4),
      );

      let role: SurfaceAttributionRole;
      if (shapleyValue >= this.minPositiveCreditThreshold) {
        role = 'SYNERGISTIC_CONTRIBUTOR';
      } else if (shapleyValue < -this.minPositiveCreditThreshold) {
        role = 'PARASITIC_DEGRADER';
      } else {
        role = 'NEUTRAL_FREE_RIDER';
      }

      surfaceCredits.push({
        surfaceId,
        shapleyValue,
        leaveOneOutDelta,
        appearancesCount,
        meanStandaloneOrCoalitionGain: Number(meanWith.toFixed(4)),
        meanCostDollarsDelta,
        role,
        rationale:
          role === 'SYNERGISTIC_CONTRIBUTOR'
            ? `Surface '${surfaceId}' contributed positive Shapley credit (${shapleyValue >= 0 ? '+' : ''}${shapleyValue}) across ${appearancesCount} candidate(s).`
            : role === 'PARASITIC_DEGRADER'
              ? `Surface '${surfaceId}' degraded utility (Shapley=${shapleyValue}, LOO=${leaveOneOutDelta}); candidate for ablation.`
              : `Surface '${surfaceId}' acted as a neutral free-rider (Shapley=${shapleyValue} <= ${this.minPositiveCreditThreshold}); strip to minimize harness bloat.`,
      });
    }

    surfaceCredits.sort((a, b) => b.shapleyValue - a.shapleyValue);

    return {
      totalCandidatesAnalyzed: coalitions.length,
      surfaceCredits,
      synergisticSurfaces: surfaceCredits
        .filter((s) => s.role === 'SYNERGISTIC_CONTRIBUTOR')
        .map((s) => s.surfaceId),
      freeRiderSurfaces: surfaceCredits
        .filter((s) => s.role === 'NEUTRAL_FREE_RIDER')
        .map((s) => s.surfaceId),
      parasiticSurfaces: surfaceCredits
        .filter((s) => s.role === 'PARASITIC_DEGRADER')
        .map((s) => s.surfaceId),
    };
  }

  /**
   * Strips `NEUTRAL_FREE_RIDER` and `PARASITIC_DEGRADER` surface mutations from a candidate
   * `HarnessManifest`, reverting them to `baseManifest` while preserving all
   * `SYNERGISTIC_CONTRIBUTOR` surfaces.
   */
  pruneFreeRiderSurfaces(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidateManifest: HarnessManifest;
    readonly attributionReport: ShapleyAttributionReport;
  }): PrunedHarnessResult {
    const diff = HarnessManifestToolkit.diff(
      params.baseManifest,
      params.candidateManifest,
    );
    if (diff.changedSurfaces.length <= 1) {
      return {
        originalManifest: params.candidateManifest,
        prunedManifest: params.candidateManifest,
        retainedSurfaces: diff.changedSurfaces,
        strippedSurfaces: [],
        wasPruned: false,
      };
    }

    const toStrip = new Set([
      ...params.attributionReport.freeRiderSurfaces,
      ...params.attributionReport.parasiticSurfaces,
    ]);

    const retainedSurfaces = diff.changedSurfaces.filter((s) => !toStrip.has(s));
    const strippedSurfaces = diff.changedSurfaces.filter((s) => toStrip.has(s));

    // Never strip all surfaces if at least one changed surface exists and none met threshold
    if (retainedSurfaces.length === 0 || strippedSurfaces.length === 0) {
      return {
        originalManifest: params.candidateManifest,
        prunedManifest: params.candidateManifest,
        retainedSurfaces: diff.changedSurfaces,
        strippedSurfaces: [],
        wasPruned: false,
      };
    }

    const componentOverrides: Record<string, unknown> = {};
    for (const surfaceId of retainedSurfaces) {
      const key = surfaceId as keyof HarnessComponents;
      componentOverrides[key] = params.candidateManifest.components[key];
    }

    const prunedId =
      `${params.candidateManifest.id}-ablation-pruned` as HarnessId;
    const prunedManifest = HarnessManifestToolkit.clone(params.baseManifest, {
      newId: prunedId,
      createdBy: 'composer',
      componentOverrides: componentOverrides as Partial<HarnessComponents>,
    });

    return {
      originalManifest: params.candidateManifest,
      prunedManifest,
      retainedSurfaces,
      strippedSurfaces,
      wasPruned: true,
    };
  }
}
