/**
 * Wave 9.2 — Causal Discovery & Epistatic Surface Interaction Graph
 * (`EpistaticSurfaceGraphAnalyzer`).
 *
 * Computes 2nd-order Shapley-Taylor Epistatic Interaction Indices ($\mathcal{I}_{i,j}$)
 * across pairs of modified harness surfaces:
 *   $\mathcal{I}_{i,j} = \mathbb{E}[U \mid \{i, j\} \subseteq S] - \mathbb{E}[U \mid i \in S, j \notin S] - \mathbb{E}[U \mid j \in S, i \notin S] + \mathbb{E}[U \mid i \notin S, j \notin S]$
 *
 * Identifies:
 * - **Synergistic Co-Adapted Modules** ($\mathcal{I}_{i,j} \ge \tau_{\text{synergy}}$):
 *   Surface pairs that amplify each other and should be composed as an atomic unit.
 * - **Antagonistic Epistatic Conflicts** ($\mathcal{I}_{i,j} \le -\tau_{\text{conflict}}$):
 *   Surface pairs that interfere destructively when combined in the same manifest.
 */
import type { BehavioralContrast } from '../../core/evolution/hypothesis.js';
import type { ProposedCandidate } from '../../core/evolution/interfaces.js';

export interface EpistaticPairEdge {
  readonly surfaceA: string;
  readonly surfaceB: string;
  readonly interactionIndex: number; // I_{A, B}
  readonly classification:
    | 'SYNERGISTIC_COADAPTATION'
    | 'ANTAGONISTIC_CONFLICT'
    | 'ADDITIVE_INDEPENDENT';
  readonly jointSampleCount: number;
}

export interface EpistaticSurfaceGraphReport {
  readonly edges: ReadonlyArray<EpistaticPairEdge>;
  readonly synergisticModules: ReadonlyArray<ReadonlyArray<string>>;
  readonly conflictPairs: ReadonlyArray<{
    readonly surfaceA: string;
    readonly surfaceB: string;
    readonly interactionIndex: number;
  }>;
  readonly rationale: string;
}

export class EpistaticSurfaceGraphAnalyzer {
  private readonly synergyThreshold: number;
  private readonly conflictThreshold: number;

  constructor(options?: {
    readonly synergyThreshold?: number;
    readonly conflictThreshold?: number;
  }) {
    this.synergyThreshold = options?.synergyThreshold ?? 0.04;
    this.conflictThreshold = options?.conflictThreshold ?? -0.04;
  }

  /**
   * Computes 2nd-order epistatic interaction edges across all modified surface pairs
   * observed in `(candidates, contrasts)`.
   */
  analyzeEpistaticGraph(params: {
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
  }): EpistaticSurfaceGraphReport {
    const contrastByManifest = new Map<string, BehavioralContrast>();
    for (const c of params.contrasts) {
      contrastByManifest.set(String(c.candidateManifestId), c);
    }

    const observations: Array<{
      readonly surfaces: Set<string>;
      readonly utilityDelta: number;
    }> = [];
    const distinctSurfaces = new Set<string>();

    for (const cand of params.candidates) {
      const contrast = contrastByManifest.get(String(cand.manifest.id));
      const changed =
        cand.diffFromBase.changedSurfaces.length > 0
          ? cand.diffFromBase.changedSurfaces
          : cand.hypothesis.targetComponents;
      for (const s of changed) {
        distinctSurfaces.add(s);
      }
      const utilityDelta = contrast
        ? contrast.partialScoreDelta * 0.7 +
          contrast.passRateDelta * 0.3 -
          Math.max(0, contrast.meanCostDollarsDelta) * 0.2
        : 0;
      observations.push({
        surfaces: new Set(changed),
        utilityDelta,
      });
    }

    const surfaceList = Array.from(distinctSurfaces).sort();
    const edges: EpistaticPairEdge[] = [];
    const conflictPairs: Array<{
      readonly surfaceA: string;
      readonly surfaceB: string;
      readonly interactionIndex: number;
    }> = [];
    const synergisticModules: Array<ReadonlyArray<string>> = [];

    for (let i = 0; i < surfaceList.length; i++) {
      for (let j = i + 1; j < surfaceList.length; j++) {
        const sA = surfaceList[i]!;
        const sB = surfaceList[j]!;

        const both: number[] = [];
        const onlyA: number[] = [];
        const onlyB: number[] = [];
        const neither: number[] = [];

        for (const obs of observations) {
          const hasA = obs.surfaces.has(sA);
          const hasB = obs.surfaces.has(sB);
          if (hasA && hasB) both.push(obs.utilityDelta);
          else if (hasA) onlyA.push(obs.utilityDelta);
          else if (hasB) onlyB.push(obs.utilityDelta);
          else neither.push(obs.utilityDelta);
        }

        const meanBoth = this.mean(both, 0);
        const meanOnlyA = this.mean(onlyA, 0);
        const meanOnlyB = this.mean(onlyB, 0);
        const meanNeither = this.mean(neither, 0);

        const interactionIndex = Number(
          (meanBoth - meanOnlyA - meanOnlyB + meanNeither).toFixed(4),
        );

        let classification: EpistaticPairEdge['classification'] =
          'ADDITIVE_INDEPENDENT';
        if (interactionIndex >= this.synergyThreshold && both.length > 0) {
          classification = 'SYNERGISTIC_COADAPTATION';
          synergisticModules.push([sA, sB]);
        } else if (interactionIndex <= this.conflictThreshold) {
          classification = 'ANTAGONISTIC_CONFLICT';
          conflictPairs.push({
            surfaceA: sA,
            surfaceB: sB,
            interactionIndex,
          });
        }

        edges.push({
          surfaceA: sA,
          surfaceB: sB,
          interactionIndex,
          classification,
          jointSampleCount: both.length,
        });
      }
    }

    return {
      edges,
      synergisticModules,
      conflictPairs,
      rationale: `Analyzed ${edges.length} surface pair(s): ${synergisticModules.length} synergistic module(s) and ${conflictPairs.length} antagonistic conflict(s).`,
    };
  }

  /**
   * Checks a proposed set of composed surfaces against the epistatic graph and filters
   * out lower-priority surfaces involved in antagonistic conflicts.
   */
  filterAntagonisticConflicts(params: {
    readonly proposedSurfaces: ReadonlyArray<string>;
    readonly graphReport: EpistaticSurfaceGraphReport;
  }): {
    readonly compatibleSurfaces: ReadonlyArray<string>;
    readonly droppedSurfaces: ReadonlyArray<string>;
  } {
    const active = new Set(params.proposedSurfaces);
    const dropped: string[] = [];

    for (const conflict of params.graphReport.conflictPairs) {
      if (active.has(conflict.surfaceA) && active.has(conflict.surfaceB)) {
        // Drop the second surface in the conflicting pair to preserve compatibility
        active.delete(conflict.surfaceB);
        dropped.push(conflict.surfaceB);
      }
    }

    return {
      compatibleSurfaces: Array.from(active),
      droppedSurfaces: dropped,
    };
  }

  private mean(arr: ReadonlyArray<number>, fallback: number): number {
    if (arr.length === 0) return fallback;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }
}
