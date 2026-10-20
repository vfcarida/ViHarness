/**
 * Wave 4.2 — Discriminative Task Selection (`Task-CoEvolve` — High-Information Micro-Probing).
 *
 * Reduces intermediate evolution probe compute by up to ~80% by maintaining an empirical
 * `Candidate × Task` outcome matrix and selecting the subset of `evolve`-split tasks that
 * maximizes:
 *   1. Binary Shannon Discriminative Entropy: H(t) = -p log2(p) - (1-p) log2(1-p)
 *   2. Partial-Score Variance across candidates: Var(partialScore_t)
 *   3. Surface & Failure-Signal Alignment with the candidate's HarnessManifestDiff & Hypothesis
 *   4. Cost Efficiency (information gain per dollar)
 *
 * Strictly enforces the Held-Out Evaluation Boundary: only `evolve`-split tasks are eligible
 * for intermediate candidate discrimination.
 */
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type { EvidenceBundle } from '../../core/evolution/hypothesis.js';
import type {
  ProbeTaskSpec,
  ProposedCandidate,
} from '../../core/evolution/interfaces.js';

export interface TaskOutcomeObservation {
  readonly manifestId: string;
  readonly taskId: string;
  readonly success: boolean;
  readonly partialScore: number;
  readonly costDollars: number;
  readonly failureSignalsObserved: ReadonlyArray<FailureSignalType>;
}

export interface TaskDiscriminativeMetrics {
  readonly taskId: string;
  readonly trialsCount: number;
  readonly passRate: number;
  readonly shannonEntropy: number; // in [0, 1]
  readonly partialScoreVariance: number; // in [0, 1]
  readonly surfaceAlignmentScore: number; // in [0, 1]
  readonly costEfficiencyBonus: number; // in [0, 1]
  readonly compositeScore: number;
}

export interface DiscriminativeTaskSelectionResult {
  readonly selectedTasks: ReadonlyArray<ProbeTaskSpec>;
  readonly rankedMetrics: ReadonlyArray<TaskDiscriminativeMetrics>;
  readonly totalEligibleTasks: number;
  readonly estimatedComputeSavingsRatio: number;
}

export interface DiscriminativeTaskSelectorOptions {
  readonly unexploredEntropyPrior?: number;
  readonly entropyWeight?: number;
  readonly varianceWeight?: number;
  readonly alignmentWeight?: number;
  readonly costEfficiencyWeight?: number;
}

export class DiscriminativeTaskSelector {
  private readonly outcomesByTask = new Map<string, TaskOutcomeObservation[]>();
  private readonly unexploredEntropyPrior: number;
  private readonly entropyWeight: number;
  private readonly varianceWeight: number;
  private readonly alignmentWeight: number;
  private readonly costEfficiencyWeight: number;

  constructor(options?: DiscriminativeTaskSelectorOptions) {
    this.unexploredEntropyPrior = options?.unexploredEntropyPrior ?? 0.85;
    this.entropyWeight = options?.entropyWeight ?? 0.45;
    this.varianceWeight = options?.varianceWeight ?? 0.20;
    this.alignmentWeight = options?.alignmentWeight ?? 0.25;
    this.costEfficiencyWeight = options?.costEfficiencyWeight ?? 0.10;
  }

  /**
   * Records a single trial observation into the `Candidate × Task` history matrix.
   */
  recordObservation(observation: TaskOutcomeObservation): void {
    const existing = this.outcomesByTask.get(observation.taskId) ?? [];
    existing.push(observation);
    this.outcomesByTask.set(observation.taskId, existing);
  }

  /**
   * Ingests all base and candidate trial metrics from a completed `EvidenceBundle`.
   */
  recordEvidenceBundle(bundle: EvidenceBundle): void {
    for (const trial of bundle.baseTrials) {
      this.recordObservation({
        manifestId: bundle.baseManifestId,
        taskId: trial.taskId,
        success: trial.success,
        partialScore: trial.partialScore,
        costDollars: trial.costDollars,
        failureSignalsObserved: trial.failureSignalsObserved,
      });
    }
    for (const trial of bundle.candidateTrials) {
      this.recordObservation({
        manifestId: bundle.candidateManifestId,
        taskId: trial.taskId,
        success: trial.success,
        partialScore: trial.partialScore,
        costDollars: trial.costDollars,
        failureSignalsObserved: trial.failureSignalsObserved,
      });
    }
  }

  /**
   * Selects the top `maxTasks` most informative `evolve`-split tasks for probing a candidate.
   */
  selectDiscriminativeSubset(params: {
    readonly tasks: ReadonlyArray<ProbeTaskSpec>;
    readonly candidate?: ProposedCandidate;
    readonly maxTasks: number;
  }): DiscriminativeTaskSelectionResult {
    // Only 'evolve' split tasks may be used during intermediate candidate exploration
    const eligibleTasks = params.tasks.filter((t) => t.split === 'evolve');
    const maxTasks = Math.max(1, Math.min(params.maxTasks, eligibleTasks.length));

    if (eligibleTasks.length === 0) {
      return {
        selectedTasks: [],
        rankedMetrics: [],
        totalEligibleTasks: 0,
        estimatedComputeSavingsRatio: 0,
      };
    }

    const scored: Array<{
      readonly task: ProbeTaskSpec;
      readonly metrics: TaskDiscriminativeMetrics;
    }> = eligibleTasks.map((task) => ({
      task,
      metrics: this.computeTaskMetrics(task, params.candidate),
    }));

    scored.sort((a, b) => {
      if (b.metrics.compositeScore !== a.metrics.compositeScore) {
        return b.metrics.compositeScore - a.metrics.compositeScore;
      }
      return a.task.taskId.localeCompare(b.task.taskId);
    });

    const selectedTasks = scored.slice(0, maxTasks).map((s) => s.task);
    const rankedMetrics = scored.map((s) => s.metrics);
    const estimatedComputeSavingsRatio =
      eligibleTasks.length > 0
        ? Number((1 - selectedTasks.length / eligibleTasks.length).toFixed(4))
        : 0;

    return {
      selectedTasks,
      rankedMetrics,
      totalEligibleTasks: eligibleTasks.length,
      estimatedComputeSavingsRatio,
    };
  }

  /**
   * Computes binary Shannon entropy H(p) = -p log2(p) - (1-p) log2(1-p) in [0, 1].
   */
  computeBinaryShannonEntropy(passRate: number): number {
    if (passRate <= 0 || passRate >= 1) {
      return 0;
    }
    const h =
      -passRate * Math.log2(passRate) - (1 - passRate) * Math.log2(1 - passRate);
    return Number(Math.max(0, Math.min(1, h)).toFixed(4));
  }

  private computeTaskMetrics(
    task: ProbeTaskSpec,
    candidate?: ProposedCandidate,
  ): TaskDiscriminativeMetrics {
    const observations = this.outcomesByTask.get(task.taskId) ?? [];
    const n = observations.length;

    let passRate = 0.5;
    let shannonEntropy = this.unexploredEntropyPrior;
    let partialScoreVariance = 0.25;
    let costEfficiencyBonus = 0.8;

    if (n > 0) {
      const passes = observations.filter((o) => o.success).length;
      passRate = Number((passes / n).toFixed(4));
      shannonEntropy = this.computeBinaryShannonEntropy(passRate);

      const meanPartial =
        observations.reduce((sum, o) => sum + o.partialScore, 0) / n;
      const rawVar =
        n > 1
          ? observations.reduce(
              (sum, o) => sum + Math.pow(o.partialScore - meanPartial, 2),
              0,
            ) /
            (n - 1)
          : 0.1;
      // Maximum theoretical variance of a bounded [0,1] variable is 0.25
      partialScoreVariance = Number(Math.min(1, rawVar / 0.25).toFixed(4));

      const meanCost =
        observations.reduce((sum, o) => sum + o.costDollars, 0) / n;
      costEfficiencyBonus = Number(
        Math.max(0, Math.min(1, 1 / (1 + meanCost * 20))).toFixed(4),
      );
    }

    const surfaceAlignmentScore = this.computeSurfaceAlignment(
      task,
      observations,
      candidate,
    );

    const compositeScore = Number(
      (
        this.entropyWeight * shannonEntropy +
        this.varianceWeight * partialScoreVariance +
        this.alignmentWeight * surfaceAlignmentScore +
        this.costEfficiencyWeight * costEfficiencyBonus
      ).toFixed(4),
    );

    return {
      taskId: task.taskId,
      trialsCount: n,
      passRate,
      shannonEntropy,
      partialScoreVariance,
      surfaceAlignmentScore,
      costEfficiencyBonus,
      compositeScore,
    };
  }

  private computeSurfaceAlignment(
    task: ProbeTaskSpec,
    observations: ReadonlyArray<TaskOutcomeObservation>,
    candidate?: ProposedCandidate,
  ): number {
    if (!candidate) {
      return 0.5;
    }

    let score = 0.3;
    const targetSignals = new Set(candidate.hypothesis.observedFailureSignals);
    const historicalSignals = new Set<FailureSignalType>();
    for (const obs of observations) {
      for (const sig of obs.failureSignalsObserved) {
        historicalSignals.add(sig);
      }
    }

    // Boost alignment if task historically exhibited the failure signals targeted by the candidate
    for (const sig of targetSignals) {
      if (historicalSignals.has(sig)) {
        score += 0.4;
        break;
      }
    }

    // Keyword alignment between changed surfaces and task prompt
    const promptLower = task.prompt.toLowerCase();
    const changedSurfaces = candidate.diffFromBase.changedSurfaces;
    for (const surface of changedSurfaces) {
      if (
        (surface === 'routingPolicy' &&
          (promptLower.includes('architect') ||
            promptLower.includes('refactor') ||
            promptLower.includes('multi-file'))) ||
        (surface === 'contextPolicy' &&
          (promptLower.includes('context') ||
            promptLower.includes('long') ||
            promptLower.includes('memory'))) ||
        (surface === 'toolGuidance' &&
          (promptLower.includes('tool') ||
            promptLower.includes('verify') ||
            promptLower.includes('edit'))) ||
        (surface === 'skills' && promptLower.includes('workflow')) ||
        (surface === 'scripts' && promptLower.includes('test'))
      ) {
        score += 0.3;
        break;
      }
    }

    return Number(Math.min(1, score).toFixed(4));
  }
}
