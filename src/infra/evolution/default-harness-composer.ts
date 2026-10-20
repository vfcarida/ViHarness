/**
 * Default Harness Composer (Milestone B — Propose–Probe–Compose).
 *
 * Performs component-wise selective composition across candidate harnesses
 * based on empirical BehavioralContrast evidence.
 *
 * Never uses naive string concatenation: each component decision (preserve_baseline,
 * select_candidate, combine_candidates, reject_all) is explicitly linked to
 * supporting ContrastIds and validated against the SurfaceRegistry and Constitution.
 */
import type {
  CompositionId,
  HarnessId,
  IdFactory,
} from '../../core/types/identifiers.js';
import type { HarnessConstitution } from '../../core/evolution/constitution.js';
import type {
  HarnessManifest,
  HarnessComponents,
  ComponentRef,
} from '../../core/evolution/harness-manifest.js';
import type {
  BehavioralContrast,
  ComponentCompositionDecision,
  HarnessCompositionRecord,
} from '../../core/evolution/hypothesis.js';
import type {
  HarnessComposer,
  ProposedCandidate,
} from '../../core/evolution/interfaces.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';

export class DefaultHarnessComposer implements HarnessComposer {
  private readonly idFactory: IdFactory;

  constructor(options?: { readonly idFactory?: IdFactory }) {
    this.idFactory = options?.idFactory ?? new UuidV7IdFactory();
  }

  async compose(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidates: ReadonlyArray<ProposedCandidate>;
    readonly contrasts: ReadonlyArray<BehavioralContrast>;
    readonly surfaceRegistry: HarnessSurfaceRegistry;
    readonly constitution: HarnessConstitution;
  }): Promise<HarnessCompositionRecord> {
    const {
      baseManifest,
      candidates,
      contrasts,
      surfaceRegistry,
      constitution,
    } = params;

    const contrastByCandidateManifestId = new Map<HarnessId, BehavioralContrast>();
    for (const c of contrasts) {
      contrastByCandidateManifestId.set(c.candidateManifestId, c);
    }

    // Rank candidates by net empirical utility (supported verdict, positive score delta, lower token delta)
    const supportedCandidates: Array<{
      readonly candidate: ProposedCandidate;
      readonly contrast: BehavioralContrast;
      readonly score: number;
    }> = [];
    const rejectedCandidateIds: HarnessId[] = [];

    for (const cand of candidates) {
      const contrast = contrastByCandidateManifestId.get(cand.manifest.id);
      if (
        !contrast ||
        contrast.hypothesisOutcome.verdict !== 'supported' ||
        contrast.regressionDelta > 0 ||
        contrast.policyViolationDelta > 0
      ) {
        rejectedCandidateIds.push(cand.manifest.id);
        continue;
      }

      const netScore =
        contrast.passRateDelta * 100 +
        contrast.partialScoreDelta * 50 -
        contrast.meanCostDollarsDelta * 10 -
        contrast.toolErrorRateDelta * 25;

      supportedCandidates.push({
        candidate: cand,
        contrast,
        score: netScore,
      });
    }

    supportedCandidates.sort((a, b) => b.score - a.score);

    const componentDecisions: ComponentCompositionDecision[] = [];
    const overrides: Record<string, unknown> = {};

    const allSurfaces = [
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

    const arraySurfaceSet = new Set(['subagents', 'skills', 'scripts', 'plugins']);

    for (const surfaceId of allSurfaces) {
      // Find all supported candidates that modified this surface
      const touching = supportedCandidates.filter((item) =>
        item.candidate.diffFromBase.changedSurfaces.includes(surfaceId),
      );

      if (touching.length === 0) {
        componentDecisions.push({
          surfaceId,
          action: supportedCandidates.length === 0 ? 'reject_all' : 'preserve_baseline',
          selectedFromManifestIds: [baseManifest.id],
          supportingContrastIds: [],
          rationale:
            supportedCandidates.length === 0
              ? 'No candidate achieved supported empirical contrast; preserved baseline.'
              : `No supported candidate modified surface '${surfaceId}'; preserved baseline.`,
        });
        continue;
      }

      if (arraySurfaceSet.has(surfaceId) && touching.length > 1) {
        // Combine compatible array items across supported candidates without duplicates
        const mergedMap = new Map<string, ComponentRef>();
        const baseItems = baseManifest.components[
          surfaceId as 'subagents' | 'skills' | 'scripts' | 'plugins'
        ];
        for (const item of baseItems) {
          mergedMap.set(item.id, item);
        }
        const selectedManifestIds: HarnessId[] = [];
        const supportingContrastIds = touching.map((t) => t.contrast.id);

        for (const t of touching) {
          selectedManifestIds.push(t.candidate.manifest.id);
          const candItems =
            t.candidate.manifest.components[
              surfaceId as 'subagents' | 'skills' | 'scripts' | 'plugins'
            ];
          for (const item of candItems) {
            mergedMap.set(item.id, item);
          }
        }

        overrides[surfaceId] = Array.from(mergedMap.values());
        componentDecisions.push({
          surfaceId,
          action: 'combine_candidates',
          selectedFromManifestIds: selectedManifestIds,
          supportingContrastIds,
          rationale: `Combined compatible '${surfaceId}' components from ${selectedManifestIds.length} empirically supported candidates.`,
        });
      } else {
        // Singleton surface (or single supported array modifier): pick highest-scoring supported candidate
        const winner = touching[0]!;
        overrides[surfaceId] = winner.candidate.manifest.components[surfaceId];
        componentDecisions.push({
          surfaceId,
          action: 'select_candidate',
          selectedFromManifestIds: [winner.candidate.manifest.id],
          supportingContrastIds: [winner.contrast.id],
          rationale: `Selected '${surfaceId}' from candidate '${winner.candidate.manifest.id}' supported by contrast '${winner.contrast.id}' (${winner.contrast.summary}).`,
        });
      }
    }

    const compositionId = this.idFactory.create<'Composition'>() as CompositionId;
    const composedManifestId = `harness-composed-${compositionId.slice(0, 8)}` as HarnessId;

    const composedManifest =
       Object.keys(overrides).length > 0
        ? HarnessManifestToolkit.clone(baseManifest, {
            newId: composedManifestId,
            createdBy: 'composer',
            componentOverrides: overrides as Partial<HarnessComponents>,
          })
        : baseManifest;

    // Validate composed manifest against SurfaceRegistry and Constitution
    HarnessManifestToolkit.assertValid(
      composedManifest,
      surfaceRegistry,
      constitution,
    );

    const manifestDiffFromBase = HarnessManifestToolkit.diff(
      baseManifest,
      composedManifest,
      surfaceRegistry,
    );

    return {
      id: compositionId,
      baseManifestId: baseManifest.id,
      inputCandidateIds: candidates.map((c) => c.manifest.id),
      composedManifest,
      manifestDiffFromBase,
      componentDecisions,
      rejectedCandidateIds,
      createdAt: new Date().toISOString(),
    };
  }
}
