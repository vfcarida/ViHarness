/**
 * Parallel Recursion Strategy (Harness² Parallel Propose–Probe–Compose).
 *
 * Evaluates multiple diverse candidate directions concurrently from a shared
 * canonical baseline H0, computes contrasts across the candidate pool, composes
 * compatible improvements, and selects the Pareto-optimal winner.
 */
import { createId } from '../../../core/types/identifiers.js';
import type {
  CandidateDagNode,
  ProposedCandidate,
  RecursionStrategy,
  RecursionStrategyContext,
  RecursionStrategyResult,
  RegularizationBatchResult,
} from '../../../core/evolution/interfaces.js';
import type {
  BehavioralContrast,
  EvidenceBundle,
  HarnessCompositionRecord,
} from '../../../core/evolution/hypothesis.js';
import {
  accumulateEvidenceAccounting,
  createEmptyResourceAccounting,
} from '../adaptive-recursion-policy.js';
import { HarnessManifestToolkit } from '../manifest-toolkit.js';

export class ParallelRecursionStrategy implements RecursionStrategy {
  readonly name = 'parallel' as const;
  private readonly toolkit = new HarnessManifestToolkit();

  async execute(context: RecursionStrategyContext): Promise<RecursionStrategyResult> {
    let accounting = createEmptyResourceAccounting();
    const candidateDag: CandidateDagNode[] = [
      {
        stepIndex: 0,
        manifestId: context.baseManifest.id,
        parentManifestIds: [],
      },
    ];

    const libraryEntries = await context.library.query({
      domain: context.baseManifest.target.domain,
      language: context.baseManifest.target.language,
      failureSignals: context.initialSignals.map((s) => s.type),
      limit: 10,
    });

    // 1. Propose parallel candidate pool from canonical baseManifest
    const proposed = await context.proposer.propose({
      baseManifest: context.baseManifest,
      failureSignals: context.initialSignals,
      libraryEntries,
      failedHypotheses: [],
      constitution: context.constitution,
      surfaceRegistry: context.surfaceRegistry,
      maxCandidates: context.maxCandidatesPerStep,
      iterationStep: 0,
    });

    // 2. Regularize candidate pool
    const regBatch: RegularizationBatchResult = context.regularizer.regularize({
      baseManifest: context.baseManifest,
      candidates: proposed,
      priorCandidates: [],
      iterationStep: 0,
    });

    const allEvidenceBundles: EvidenceBundle[] = [];
    const allContrasts: BehavioralContrast[] = [];
    const compositions: HarnessCompositionRecord[] = [];
    const evaluatedPool: Array<{
      readonly manifest: ProposedCandidate['manifest'];
      readonly evidenceBundle: EvidenceBundle;
      readonly contrast: BehavioralContrast;
    }> = [];

    // 3. Probe approved candidates in parallel
    const probeResults = await Promise.all(
      regBatch.approved.map(async (candidate) => {
        const bundle = await context.probeRunner.runPairedProbe({
          baseManifest: context.baseManifest,
          candidate,
          tasks: context.tasks,
          callerRole: 'probe_runner',
        });
        return { candidate, bundle };
      }),
    );

    for (const { candidate, bundle } of probeResults) {
      accounting = accumulateEvidenceAccounting(accounting, bundle);
      allEvidenceBundles.push(bundle);

      const contrast = context.contrastAnalyzer.analyze({
        baseManifest: context.baseManifest,
        candidate,
        evidenceBundle: bundle,
        peerContrasts: allContrasts,
      });
      allContrasts.push(contrast);
      evaluatedPool.push({
        manifest: candidate.manifest,
        evidenceBundle: bundle,
        contrast,
      });
      candidateDag.push({
        stepIndex: 1,
        manifestId: candidate.manifest.id,
        parentManifestIds: [context.baseManifest.id],
        contrastId: String(contrast.id),
      });
    }

    // 4. Compose compatible improvements across the parallel pool if >= 2 candidates probed
    if (regBatch.approved.length >= 2 && allContrasts.length >= 2) {
      const composition = await context.composer.compose({
        baseManifest: context.baseManifest,
        candidates: regBatch.approved,
        contrasts: allContrasts,
        surfaceRegistry: context.surfaceRegistry,
        constitution: context.constitution,
      });
      compositions.push(composition);

      if (composition.composedManifest.contentHash !== context.baseManifest.contentHash) {
        const composedDiff = this.toolkit.diff(
          context.baseManifest,
          composition.composedManifest,
        );
        const composedCandidate: ProposedCandidate = {
          candidateId: createId<'Candidate'>(`cand_comp_${Date.now()}`),
          manifest: composition.composedManifest,
          diffFromBase: composedDiff,
          hypothesis: {
            ...regBatch.approved[0]!.hypothesis,
            id: createId<'Hypothesis'>(`hyp_comp_${Date.now()}`),
            targetComponents: composedDiff.changedSurfaces,
            rationale:
              composition.componentDecisions.map((d) => d.rationale).join('; ') ||
              'Composed candidate',
          },
        };

        const compBundle = await context.probeRunner.runPairedProbe({
          baseManifest: context.baseManifest,
          candidate: composedCandidate,
          tasks: context.tasks,
          callerRole: 'probe_runner',
        });
        accounting = accumulateEvidenceAccounting(accounting, compBundle);
        allEvidenceBundles.push(compBundle);

        const compContrast = context.contrastAnalyzer.analyze({
          baseManifest: context.baseManifest,
          candidate: composedCandidate,
          evidenceBundle: compBundle,
          peerContrasts: allContrasts,
        });
        allContrasts.push(compContrast);
        evaluatedPool.push({
          manifest: composition.composedManifest,
          evidenceBundle: compBundle,
          contrast: compContrast,
        });

        candidateDag.push({
          stepIndex: 2,
          manifestId: composition.composedManifest.id,
          parentManifestIds: regBatch.approved.map((c) => c.manifest.id),
          contrastId: String(compContrast.id),
        });
      }
    }

    // 5. Select Pareto-optimal candidate under active deployment profile
    const selectionResult = context.selector.select({
      baseManifest: context.baseManifest,
      candidates: evaluatedPool,
      profile: context.profile,
    });

    const selectedManifest =
      selectionResult.selectedCandidate?.manifest ?? context.baseManifest;

    return {
      strategyName: 'parallel',
      selectedManifest,
      selectionResult,
      candidateDag,
      allProposed: proposed,
      allRejectedByRegularizer: regBatch.rejected,
      allEvidenceBundles,
      allContrasts,
      compositions,
      accounting,
      stopReason: 'MAX_STEPS_REACHED',
    };
  }
}
