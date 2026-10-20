/**
 * Sequential Recursion Strategy (Harness² Sequential Propose–Probe–Compose).
 *
 * Performs iterative Propose–Probe–Compose steps where each step builds upon the
 * refined composed manifest from the prior step, carrying accumulated behavioral
 * evidence, failed hypotheses, and a full candidate DAG history.
 */
import { createId } from '../../../core/types/identifiers.js';
import type {
  CandidateDagNode,
  ProposedCandidate,
  RecursionStopReason,
  RecursionStrategy,
  RecursionStrategyContext,
  RecursionStrategyResult,
  RegularizationBatchResult,
} from '../../../core/evolution/interfaces.js';
import type {
  BehavioralContrast,
  EvidenceBundle,
  HarnessChangeHypothesis,
  HarnessCompositionRecord,
} from '../../../core/evolution/hypothesis.js';
import {
  accumulateEvidenceAccounting,
  createEmptyResourceAccounting,
} from '../adaptive-recursion-policy.js';
import { HarnessManifestToolkit } from '../manifest-toolkit.js';

export class SequentialRecursionStrategy implements RecursionStrategy {
  readonly name = 'sequential' as const;
  private readonly toolkit = new HarnessManifestToolkit();

  async execute(context: RecursionStrategyContext): Promise<RecursionStrategyResult> {
    let accounting = createEmptyResourceAccounting();
    let currentReferenceManifest = context.baseManifest;
    let activeSignals = [...context.initialSignals];
    const failedHypotheses: HarnessChangeHypothesis[] = [];
    const allProposed: ProposedCandidate[] = [];
    const allRejectedByRegularizer: Array<RegularizationBatchResult['rejected'][number]> = [];
    const allEvidenceBundles: EvidenceBundle[] = [];
    const allContrasts: BehavioralContrast[] = [];
    const compositions: HarnessCompositionRecord[] = [];
    const evaluatedPool: Array<{
      readonly manifest: ProposedCandidate['manifest'];
      readonly evidenceBundle: EvidenceBundle;
      readonly contrast: BehavioralContrast;
    }> = [];

    const candidateDag: CandidateDagNode[] = [
      {
        stepIndex: 0,
        manifestId: context.baseManifest.id,
        parentManifestIds: [],
      },
    ];

    let stopReason: RecursionStopReason = 'MAX_STEPS_REACHED';

    for (let step = 0; step < context.maxSteps; step++) {
      const libraryEntries = await context.library.query({
        domain: currentReferenceManifest.target.domain,
        language: currentReferenceManifest.target.language,
        failureSignals: activeSignals.map((s) => s.type),
        limit: 8,
      });

      const stepProposals = await context.proposer.propose({
        baseManifest: currentReferenceManifest,
        failureSignals: activeSignals,
        libraryEntries,
        failedHypotheses,
        constitution: context.constitution,
        surfaceRegistry: context.surfaceRegistry,
        maxCandidates: Math.min(2, context.maxCandidatesPerStep),
        iterationStep: step,
      });

      if (stepProposals.length === 0) {
        stopReason = 'NO_NEW_FAILURE_SIGNALS_EXPLAINED';
        break;
      }

      const regBatch = context.regularizer.regularize({
        baseManifest: currentReferenceManifest,
        candidates: stepProposals,
        priorCandidates: allProposed,
        iterationStep: step,
      });

      allProposed.push(...stepProposals);
      allRejectedByRegularizer.push(...regBatch.rejected);

      if (regBatch.approved.length === 0) {
        stopReason = 'BEHAVIORAL_REDUNDANCY';
        break;
      }

      const stepContrasts: BehavioralContrast[] = [];
      for (const candidate of regBatch.approved) {
        const bundle = await context.probeRunner.runPairedProbe({
          baseManifest: currentReferenceManifest,
          candidate,
          tasks: context.tasks,
          callerRole: 'probe_runner',
        });
        accounting = accumulateEvidenceAccounting(accounting, bundle);
        allEvidenceBundles.push(bundle);

        const contrast = context.contrastAnalyzer.analyze({
          baseManifest: currentReferenceManifest,
          candidate,
          evidenceBundle: bundle,
          peerContrasts: allContrasts,
        });
        allContrasts.push(contrast);
        stepContrasts.push(contrast);
        evaluatedPool.push({
          manifest: candidate.manifest,
          evidenceBundle: bundle,
          contrast,
        });

        candidateDag.push({
          stepIndex: step + 1,
          manifestId: candidate.manifest.id,
          parentManifestIds: [currentReferenceManifest.id],
          contrastId: String(contrast.id),
        });

        if (contrast.hypothesisOutcome.verdict === 'contradicted') {
          failedHypotheses.push(candidate.hypothesis);
        }
      }

      // Compose step winner to carry forward into next sequential step
      const composition = await context.composer.compose({
        baseManifest: currentReferenceManifest,
        candidates: regBatch.approved,
        contrasts: stepContrasts,
        surfaceRegistry: context.surfaceRegistry,
        constitution: context.constitution,
      });
      compositions.push(composition);

      if (composition.composedManifest.contentHash !== currentReferenceManifest.contentHash) {
        const compDiff = this.toolkit.diff(
          context.baseManifest,
          composition.composedManifest,
        );
        const compCandidate: ProposedCandidate = {
          candidateId: createId<'Candidate'>(`cand_seq_${step}_${Date.now()}`),
          manifest: composition.composedManifest,
          diffFromBase: compDiff,
          hypothesis: {
            ...regBatch.approved[0]!.hypothesis,
            id: createId<'Hypothesis'>(`hyp_seq_${step}_${Date.now()}`),
            targetComponents: compDiff.changedSurfaces,
            rationale:
              composition.componentDecisions.map((d) => d.rationale).join('; ') ||
              'Composed candidate',
          },
        };

        const compBundle = await context.probeRunner.runPairedProbe({
          baseManifest: context.baseManifest,
          candidate: compCandidate,
          tasks: context.tasks,
          callerRole: 'probe_runner',
        });
        accounting = accumulateEvidenceAccounting(accounting, compBundle);
        allEvidenceBundles.push(compBundle);

        const compContrast = context.contrastAnalyzer.analyze({
          baseManifest: context.baseManifest,
          candidate: compCandidate,
          evidenceBundle: compBundle,
          peerContrasts: allContrasts,
        });
        allContrasts.push(compContrast);
        evaluatedPool.push({
          manifest: composition.composedManifest,
          evidenceBundle: compBundle,
          contrast: compContrast,
        });

        currentReferenceManifest = composition.composedManifest;
        // Filter out resolved failure signals
        const resolvedSet = new Set(compContrast.resolvedFailureSignals);
        activeSignals = activeSignals.filter((s) => !resolvedSet.has(s.type));
      }

      if (activeSignals.length === 0) {
        stopReason = 'NO_NEW_FAILURE_SIGNALS_EXPLAINED';
        break;
      }
    }

    const selectionResult = context.selector.select({
      baseManifest: context.baseManifest,
      candidates: evaluatedPool,
      profile: context.profile,
    });

    const selectedManifest =
      selectionResult.selectedCandidate?.manifest ?? context.baseManifest;

    return {
      strategyName: 'sequential',
      selectedManifest,
      selectionResult,
      candidateDag,
      allProposed,
      allRejectedByRegularizer,
      allEvidenceBundles,
      allContrasts,
      compositions,
      accounting,
      stopReason,
    };
  }
}
