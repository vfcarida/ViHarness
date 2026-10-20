/**
 * Adaptive Recursion Strategy (VoI-Driven Hybrid Propose–Probe–Compose).
 *
 * Uses `RecursionBudgetPolicy` (Expected Value of Information) at every step to
 * decide whether to:
 * - CONTINUE exploring new candidate hypotheses
 * - EXPAND_REPLICATION (run replicated probes on high-uncertainty or structural candidates)
 * - STOP early when confidence is high, marginal VoI is low, or diversity collapses.
 */
import type {
  CandidateDagNode,
  ProbeTaskSpec,
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

export class AdaptiveRecursionStrategy implements RecursionStrategy {
  readonly name = 'adaptive' as const;

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
    let recommendedReps = 1;

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
        maxCandidates: context.maxCandidatesPerStep,
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

      const hasStructuralCandidate = regBatch.approved.some(
        (c) => c.hypothesis.mechanismAxis === 'STRUCTURAL',
      );

      // Evaluate budget policy before running expensive probes
      const preDecision = context.budgetPolicy.evaluateStep({
        stepIndex: step,
        maxSteps: context.maxSteps,
        accounting,
        budgetProfile: context.baseManifest.budgetProfile,
        contrastsSoFar: allContrasts,
        unexplainedSignalsCount: activeSignals.length,
        hasStructuralCandidate,
      });

      if (preDecision.action === 'STOP') {
        stopReason = preDecision.stopReason ?? 'LOW_MARGINAL_VALUE_OF_INFORMATION';
        break;
      }

      if (preDecision.action === 'EXPAND_REPLICATION') {
        recommendedReps = Math.max(recommendedReps, preDecision.recommendedRepetitions);
      }

      const tasksWithReplication: ReadonlyArray<ProbeTaskSpec> = context.tasks.map((t) => ({
        ...t,
        repetitions: Math.max(t.repetitions ?? 1, recommendedReps),
      }));

      const stepContrasts: BehavioralContrast[] = [];
      for (const candidate of regBatch.approved) {
        const bundle = await context.probeRunner.runPairedProbe({
          baseManifest: context.baseManifest,
          candidate,
          tasks: tasksWithReplication,
          callerRole: 'probe_runner',
        });
        accounting = accumulateEvidenceAccounting(accounting, bundle);
        allEvidenceBundles.push(bundle);

        const contrast = context.contrastAnalyzer.analyze({
          baseManifest: context.baseManifest,
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
        } else if (contrast.hypothesisOutcome.verdict === 'supported') {
          const resolved = new Set(contrast.resolvedFailureSignals);
          activeSignals = activeSignals.filter((s) => !resolved.has(s.type));
        }
      }

      const composition = await context.composer.compose({
        baseManifest: currentReferenceManifest,
        candidates: regBatch.approved,
        contrasts: stepContrasts,
        surfaceRegistry: context.surfaceRegistry,
        constitution: context.constitution,
      });
      compositions.push(composition);
      if (composition.composedManifest.contentHash !== currentReferenceManifest.contentHash) {
        currentReferenceManifest = composition.composedManifest;
      }

      // Post-step budget check
      const postDecision = context.budgetPolicy.evaluateStep({
        stepIndex: step + 1,
        maxSteps: context.maxSteps,
        accounting,
        budgetProfile: context.baseManifest.budgetProfile,
        contrastsSoFar: allContrasts,
        unexplainedSignalsCount: activeSignals.length,
        hasStructuralCandidate,
      });

      if (postDecision.action === 'STOP') {
        stopReason = postDecision.stopReason ?? 'CONFIDENCE_THRESHOLD_REACHED';
        break;
      }
      if (postDecision.action === 'EXPAND_REPLICATION') {
        recommendedReps = Math.max(recommendedReps, postDecision.recommendedRepetitions);
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
      strategyName: 'adaptive',
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
