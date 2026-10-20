/**
 * Wave 8.4 — Automated Lineage Regression Bisector & Surgical Excision Patcher
 * (`LineageBisectionDiagnoser`).
 *
 * When a multi-generation harness lineage $[H_0, H_1, \dots, H_k]$ exhibits a delayed
 * regression on a task or canary stage where $H_0$ passes (`predicate(H_0) === true`)
 * and $H_k$ fails (`predicate(H_k) === false`):
 * 1. **$\mathcal{O}(\log_2 k)$ Binary Search Bisection**: Pinpoints the exact culprit
 *    transition $H_{i^*-1} \to H_{i^*}$ in at most $\lceil \log_2 k \rceil + 2$ evaluations.
 * 2. **Surgical Excision Patch Synthesis ($H_k \setminus \Delta_{i^*}$)**: Reverts only the
 *    surfaces modified in $H_{i^*-1} \to H_{i^*}$ back to their $H_{i^*-1}$ values while
 *    preserving all non-conflicting downstream improvements accumulated in $H_{i^*+1} \dots H_k$.
 */
import { createId } from '../../core/types/identifiers.js';
import type {
  HarnessComponents,
  HarnessManifest,
  HarnessManifestDiff,
} from '../../core/evolution/harness-manifest.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export type LineageHealthPredicate = (
  manifest: HarnessManifest,
) => Promise<boolean> | boolean;

export interface LineageBisectionReport {
  readonly regressionIsolated: boolean;
  readonly culpritIndex: number;
  readonly lastGoodManifest: HarnessManifest;
  readonly firstBadManifest: HarnessManifest;
  readonly culpritDiff: HarnessManifestDiff;
  readonly offendingSurfaces: ReadonlyArray<string>;
  readonly probesExecutedCount: number;
  readonly probedManifestIds: ReadonlyArray<string>;
  readonly excisedManifest: HarnessManifest;
  readonly excisedManifestPassedPredicate: boolean;
  readonly rationale: string;
}

export class LineageBisectionDiagnoser {
  /**
   * Performs binary search over an ordered lineage $[H_0, H_1, \dots, H_k]$ to isolate
   * the first regressing ancestor $H_{i^*}$ and synthesizes a surgically excised manifest
   * $H_k \setminus \Delta_{i^*}$.
   */
  async bisectAndExcise(params: {
    readonly lineage: ReadonlyArray<HarnessManifest>;
    readonly healthPredicate: LineageHealthPredicate;
  }): Promise<LineageBisectionReport> {
    const { lineage, healthPredicate } = params;
    if (lineage.length < 2) {
      const single =
        lineage[0] ?? HarnessManifestToolkit.createCanonicalBaselineManifest();
      return {
        regressionIsolated: false,
        culpritIndex: 0,
        lastGoodManifest: single,
        firstBadManifest: single,
        culpritDiff: HarnessManifestToolkit.diff(single, single),
        offendingSurfaces: [],
        probesExecutedCount: 0,
        probedManifestIds: [],
        excisedManifest: single,
        excisedManifestPassedPredicate: true,
        rationale: 'Lineage has fewer than 2 manifests; bisection not applicable.',
      };
    }

    const probedManifestIds: string[] = [];
    const evalManifest = async (idx: number): Promise<boolean> => {
      const m = lineage[idx]!;
      probedManifestIds.push(String(m.id));
      return await healthPredicate(m);
    };

    // Binary search invariant: low is known GOOD (true), high is known BAD (false)
    let low = 0;
    let high = lineage.length - 1;

    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      const passed = await evalManifest(mid);
      if (passed) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const lastGoodManifest = lineage[low]!;
    const firstBadManifest = lineage[high]!;
    const headManifest = lineage[lineage.length - 1]!;
    const culpritDiff = HarnessManifestToolkit.diff(
      lastGoodManifest,
      firstBadManifest,
    );
    const offendingSurfaces = culpritDiff.changedSurfaces;

    const excisedManifest = this.synthesizeSurgicalExcision({
      headManifest,
      lastGoodManifest,
      offendingSurfaces,
    });

    probedManifestIds.push(String(excisedManifest.id));
    const excisedManifestPassedPredicate =
      await healthPredicate(excisedManifest);

    return {
      regressionIsolated: true,
      culpritIndex: high,
      lastGoodManifest,
      firstBadManifest,
      culpritDiff,
      offendingSurfaces,
      probesExecutedCount: probedManifestIds.length,
      probedManifestIds,
      excisedManifest,
      excisedManifestPassedPredicate,
      rationale: `Bisected ${lineage.length}-generation lineage in ${probedManifestIds.length} probes: regression introduced at index ${high} ('${lastGoodManifest.id}' -> '${firstBadManifest.id}') on surfaces [${offendingSurfaces.join(', ')}]. Surgical excision passed=${excisedManifestPassedPredicate}.`,
    };
  }

  /**
   * Reverts only `offendingSurfaces` on `headManifest` back to their values in `lastGoodManifest`,
   * preserving all other evolved surfaces in `headManifest`.
   */
  synthesizeSurgicalExcision(params: {
    readonly headManifest: HarnessManifest;
    readonly lastGoodManifest: HarnessManifest;
    readonly offendingSurfaces: ReadonlyArray<string>;
  }): HarnessManifest {
    const { headManifest, lastGoodManifest, offendingSurfaces } = params;
    if (offendingSurfaces.length === 0) {
      return headManifest;
    }

    const overrides: Record<string, unknown> = {};
    for (const surfaceId of offendingSurfaces) {
      const key = surfaceId as keyof HarnessComponents;
      if (key in lastGoodManifest.components) {
        overrides[key] = lastGoodManifest.components[key];
      }
    }

    return HarnessManifestToolkit.clone(headManifest, {
      newId: createId<'Harness'>(`${headManifest.id}-excised`),
      createdBy: 'composer',
      componentOverrides: overrides as Partial<HarnessComponents>,
    });
  }
}
