/**
 * Wave 4.6 — Adversarial Counterfactual Probe Generator (`Meta-Harness` / `HarnessOpt-Bench`).
 *
 * Synthesizes counterfactual perturbed probe tasks from seed `ProbeTaskSpec` items across
 * three adversarial perturbation modes:
 * 1. `EDGE_CASE_INJECTION`: Appends boundary/null/empty-input invariants to expose incomplete fixes.
 * 2. `IDENTIFIER_RENAMING_TRAP`: Perturbs superficial symbol/variable naming hints so memorized
 *    hardcoded patches fail while semantic symbol-lookup harnesses succeed.
 * 3. `STRICT_REGRESSION_ASSERTION`: Enforces zero-regression verification on adjacent callers.
 *
 * Also evaluates paired standard vs counterfactual `EvidenceBundle` results to detect
 * coincidental or overfitted passes.
 */
import type { EvidenceBundle } from '../../core/evolution/hypothesis.js';
import type { ProbeTaskSpec } from '../../core/evolution/interfaces.js';

export type AdversarialPerturbationType =
  | 'EDGE_CASE_INJECTION'
  | 'IDENTIFIER_RENAMING_TRAP'
  | 'STRICT_REGRESSION_ASSERTION';

export interface AdversarialProbeTaskSpec extends ProbeTaskSpec {
  readonly sourceTaskId: string;
  readonly perturbationType: AdversarialPerturbationType;
  readonly expectedInvariantCheck: string;
}

export interface CounterfactualRobustnessReport {
  readonly standardPassRate: number;
  readonly counterfactualPassRate: number;
  readonly robustnessRetentionRatio: number;
  readonly robustnessDrop: number;
  readonly coincidentalPassDetected: boolean;
  readonly summary: string;
}

export class AdversarialProbeGenerator {
  /**
   * Generates counterfactual perturbed probe tasks from a seed `ProbeTaskSpec`.
   * Rejects `held_out` seed tasks when called outside the admission gate to prevent split leakage.
   */
  generateCounterfactualTasks(params: {
    readonly seedTask: ProbeTaskSpec;
    readonly perturbations?: ReadonlyArray<AdversarialPerturbationType>;
    readonly targetSplit?: 'evolve' | 'ood';
  }): ReadonlyArray<AdversarialProbeTaskSpec> {
    if (params.seedTask.split === 'held_out') {
      throw new Error(
        `Cannot generate counterfactual exploration probes from held_out task '${params.seedTask.taskId}'.`,
      );
    }

    const perturbations: ReadonlyArray<AdversarialPerturbationType> =
      params.perturbations ?? [
        'EDGE_CASE_INJECTION',
        'IDENTIFIER_RENAMING_TRAP',
        'STRICT_REGRESSION_ASSERTION',
      ];
    const split = params.targetSplit ?? 'ood';

    return perturbations.map((perturbationType) =>
      this.applyPerturbation(params.seedTask, perturbationType, split),
    );
  }

  /**
   * Compares a candidate's performance on standard probes vs counterfactual adversarial probes
   * to detect brittle or coincidental passes.
   */
  evaluateCounterfactualRobustness(params: {
    readonly standardBundle: EvidenceBundle;
    readonly counterfactualBundle: EvidenceBundle;
    readonly maxAllowedDrop?: number;
  }): CounterfactualRobustnessReport {
    const maxDrop = params.maxAllowedDrop ?? 0.35;

    const stdCand = params.standardBundle.candidateTrials.filter(
      (t) => !t.infrastructureError,
    );
    const cfCand = params.counterfactualBundle.candidateTrials.filter(
      (t) => !t.infrastructureError,
    );

    const standardPassRate =
      stdCand.length > 0
        ? Number(
            (
              stdCand.filter((t) => t.success && t.verifierPassed).length /
              stdCand.length
            ).toFixed(4),
          )
        : 0;

    const counterfactualPassRate =
      cfCand.length > 0
        ? Number(
            (
              cfCand.filter((t) => t.success && t.verifierPassed).length /
              cfCand.length
            ).toFixed(4),
          )
        : 0;

    const robustnessRetentionRatio =
      standardPassRate > 0
        ? Number((counterfactualPassRate / standardPassRate).toFixed(4))
        : 1;
    const robustnessDrop = Number(
      Math.max(0, standardPassRate - counterfactualPassRate).toFixed(4),
    );
    const coincidentalPassDetected =
      standardPassRate >= 0.75 && robustnessDrop > maxDrop;

    return {
      standardPassRate,
      counterfactualPassRate,
      robustnessRetentionRatio,
      robustnessDrop,
      coincidentalPassDetected,
      summary: coincidentalPassDetected
        ? `Coincidental/brittle pass detected: standardPassRate=${(standardPassRate * 100).toFixed(1)}% dropped to ${(counterfactualPassRate * 100).toFixed(1)}% under counterfactual perturbations (drop=${(robustnessDrop * 100).toFixed(1)}%).`
        : `Counterfactual robustness verified: standard=${(standardPassRate * 100).toFixed(1)}%, counterfactual=${(counterfactualPassRate * 100).toFixed(1)}% (retention=${(robustnessRetentionRatio * 100).toFixed(1)}%).`,
    };
  }

  private applyPerturbation(
    seedTask: ProbeTaskSpec,
    perturbationType: AdversarialPerturbationType,
    split: 'evolve' | 'ood',
  ): AdversarialProbeTaskSpec {
    switch (perturbationType) {
      case 'EDGE_CASE_INJECTION':
        return {
          ...seedTask,
          taskId: `${seedTask.taskId}__cf_edge`,
          split,
          sourceTaskId: seedTask.taskId,
          perturbationType,
          prompt:
            `${seedTask.prompt}\n\n[Counterfactual Edge-Case Requirement]: Ensure the solution handles empty inputs, boundary values (0, -1, MAX_SAFE_INTEGER), and malformed payloads without throwing unhandled exceptions.`,
          expectedInvariantCheck:
            'Must validate boundary/empty inputs and pass edge-case unit assertions.',
        };

      case 'IDENTIFIER_RENAMING_TRAP':
        return {
          ...seedTask,
          taskId: `${seedTask.taskId}__cf_rename`,
          split,
          sourceTaskId: seedTask.taskId,
          perturbationType,
          prompt:
            `${seedTask.prompt}\n\n[Counterfactual Symbol Indirection]: Do not rely on hardcoded line numbers or assumed symbol names; dynamically discover target identifiers via symbol search before editing.`,
          expectedInvariantCheck:
            'Must locate symbols via AST/search tools rather than hardcoded string literals.',
        };

      case 'STRICT_REGRESSION_ASSERTION':
        return {
          ...seedTask,
          taskId: `${seedTask.taskId}__cf_regression`,
          split,
          sourceTaskId: seedTask.taskId,
          perturbationType,
          prompt:
            `${seedTask.prompt}\n\n[Counterfactual Regression Invariant]: Preserve all existing public function signatures, return types, and side-effect invariants across callers, and run the full verification suite.`,
          expectedInvariantCheck:
            'Zero public signature breakage and full verification suite pass.',
        };
    }
  }
}
