/**
 * Wave 8.2 — Submodular Curriculum & Benchmark Co-Evolution (`SubmodularBenchmarkCoEvolver`).
 *
 * Prevents benchmark ceiling saturation during long-horizon recursive evolution:
 * 1. **Benchmark Saturation Detector**: Identifies when the active `evolve` task pool
 *    has saturated (`meanPassRate >= 0.92` and `interCandidateVariance <= 0.025`).
 * 2. **Compositional Multi-Constraint Task Synthesizer**: Generates harder stepping-stone
 *    tasks by pairing orthogonal `FailureSignalType` modes from historical runs.
 * 3. **Lazy-Greedy Submodular Facility-Location Selector**: Selects a budget-constrained
 *    suite $S \subseteq V$ of size $|S| \le K$ maximizing facility-location coverage
 *    $F(S) = \sum_{v \in V} \max_{s \in S} \text{sim}(v, s) + \lambda \sum_{s \in S} \text{disc}(s)$
 *    with a $(1 - 1/e)$ optimality guarantee.
 */
import type { ProbeTaskSpec } from '../../core/evolution/interfaces.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';

export interface TaskSaturationObservation {
  readonly taskId: string;
  readonly candidatePassRates: ReadonlyArray<number>;
  readonly targetedFailureSignals?: ReadonlyArray<FailureSignalType>;
}

export interface BenchmarkSaturationReport {
  readonly saturated: boolean;
  readonly meanPoolPassRate: number;
  readonly meanInterCandidateVariance: number;
  readonly saturatedTaskIds: ReadonlyArray<string>;
  readonly discriminativeTaskIds: ReadonlyArray<string>;
  readonly rationale: string;
}

export interface SubmodularSuiteSelectionResult {
  readonly selectedSuite: ReadonlyArray<ProbeTaskSpec>;
  readonly objectiveValue: number;
  readonly theoreticalApproximationGuarantee: number; // 1 - 1/e ~= 0.6321
  readonly marginalGains: ReadonlyArray<{
    readonly taskId: string;
    readonly marginalGain: number;
  }>;
}

export class SubmodularBenchmarkCoEvolver {
  private readonly saturationPassRateThreshold: number;
  private readonly maxSaturationVariance: number;

  constructor(options?: {
    readonly saturationPassRateThreshold?: number;
    readonly maxSaturationVariance?: number;
  }) {
    this.saturationPassRateThreshold =
      options?.saturationPassRateThreshold ?? 0.92;
    this.maxSaturationVariance = options?.maxSaturationVariance ?? 0.025;
  }

  /**
   * Evaluates whether the current task pool has reached ceiling saturation across candidates.
   */
  detectBenchmarkSaturation(
    observations: ReadonlyArray<TaskSaturationObservation>,
  ): BenchmarkSaturationReport {
    if (observations.length === 0) {
      return {
        saturated: false,
        meanPoolPassRate: 0,
        meanInterCandidateVariance: 0,
        saturatedTaskIds: [],
        discriminativeTaskIds: [],
        rationale: 'No task observations recorded.',
      };
    }

    const saturatedTaskIds: string[] = [];
    const discriminativeTaskIds: string[] = [];
    let passRateSum = 0;
    let varianceSum = 0;

    for (const obs of observations) {
      const rates = obs.candidatePassRates;
      if (rates.length === 0) continue;
      const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
      const variance =
        rates.reduce((s, r) => s + (r - mean) * (r - mean), 0) / rates.length;

      passRateSum += mean;
      varianceSum += variance;

      if (
        mean >= this.saturationPassRateThreshold &&
        variance <= this.maxSaturationVariance
      ) {
        saturatedTaskIds.push(obs.taskId);
      } else {
        discriminativeTaskIds.push(obs.taskId);
      }
    }

    const n = observations.length;
    const meanPoolPassRate = Number((passRateSum / n).toFixed(4));
    const meanInterCandidateVariance = Number((varianceSum / n).toFixed(4));
    const saturated =
      meanPoolPassRate >= this.saturationPassRateThreshold &&
      meanInterCandidateVariance <= this.maxSaturationVariance;

    return {
      saturated,
      meanPoolPassRate,
      meanInterCandidateVariance,
      saturatedTaskIds,
      discriminativeTaskIds,
      rationale: saturated
        ? `Benchmark pool saturated (meanPassRate=${meanPoolPassRate}, variance=${meanInterCandidateVariance}); ${saturatedTaskIds.length}/${n} tasks at ceiling.`
        : `Benchmark pool remains discriminative (meanPassRate=${meanPoolPassRate}, variance=${meanInterCandidateVariance}).`,
    };
  }

  /**
   * Synthesizes harder compositional probe tasks by combining seed tasks with pairs
   * of orthogonal failure signals.
   */
  synthesizeCompositionalTasks(params: {
    readonly seedTasks: ReadonlyArray<ProbeTaskSpec>;
    readonly targetFailureSignals: ReadonlyArray<FailureSignalType>;
    readonly maxSynthesized?: number;
  }): ReadonlyArray<ProbeTaskSpec> {
    const maxCount = params.maxSynthesized ?? 3;
    const signals =
      params.targetFailureSignals.length >= 2
        ? params.targetFailureSignals
        : ([
            ...params.targetFailureSignals,
            'verification_blind_spot',
            'loss_in_the_middle',
          ] as FailureSignalType[]);

    const synthesized: ProbeTaskSpec[] = [];
    for (
      let i = 0;
      i < params.seedTasks.length && synthesized.length < maxCount;
      i++
    ) {
      const seed = params.seedTasks[i]!;
      const sigA = signals[i % signals.length]!;
      const sigB = signals[(i + 1) % signals.length]!;

      synthesized.push({
        ...seed,
        taskId: `${seed.taskId}_comp_${sigA}_${sigB}`,
        prompt:
          `[COMPOSITIONAL BENCHMARK HARDENING: ${sigA} + ${sigB}] ${seed.prompt}\n` +
          `Additional Co-Evolved Constraints:\n` +
          `1. Enforce strict regression verification to prevent '${sigA}'.\n` +
          `2. Preserve cross-file invariant context under '${sigB}' pressure.`,
        tags: [...(seed.tags ?? []), 'co_evolved_compositional', sigA, sigB],
      });
    }

    return synthesized;
  }

  /**
   * Selects a subset of size `maxSuiteSize` ($K$) via Greedy Submodular Facility-Location
   * maximization over token/tag similarity and discriminative weight.
   */
  selectSubmodularSuite(params: {
    readonly candidateTasks: ReadonlyArray<ProbeTaskSpec>;
    readonly maxSuiteSize: number;
    readonly discriminativeBonusByTaskId?: Readonly<Record<string, number>>;
  }): SubmodularSuiteSelectionResult {
    const tasks = params.candidateTasks;
    const k = Math.max(1, Math.min(params.maxSuiteSize, tasks.length));

    if (tasks.length === 0) {
      return {
        selectedSuite: [],
        objectiveValue: 0,
        theoreticalApproximationGuarantee: Number((1 - 1 / Math.E).toFixed(4)),
        marginalGains: [],
      };
    }

    const tokenSets = tasks.map((t) => this.tokenizeTask(t));
    const simMatrix: number[][] = tasks.map((_, i) =>
      tasks.map((__, j) => this.jaccard(tokenSets[i]!, tokenSets[j]!)),
    );

    // Current max similarity coverage u_i = max_{s in S} sim(i, s)
    const currentCoverage = new Array<number>(tasks.length).fill(0);
    const selectedIndices = new Set<number>();
    const selectedSuite: ProbeTaskSpec[] = [];
    const marginalGains: Array<{
      readonly taskId: string;
      readonly marginalGain: number;
    }> = [];

    let currentObjective = 0;

    for (let step = 0; step < k; step++) {
      let bestIdx = -1;
      let bestGain = -Infinity;

      for (let candidateIdx = 0; candidateIdx < tasks.length; candidateIdx++) {
        if (selectedIndices.has(candidateIdx)) continue;

        let facilityGain = 0;
        for (let targetIdx = 0; targetIdx < tasks.length; targetIdx++) {
          const sim = simMatrix[targetIdx]![candidateIdx]!;
          if (sim > currentCoverage[targetIdx]!) {
            facilityGain += sim - currentCoverage[targetIdx]!;
          }
        }

        const task = tasks[candidateIdx]!;
        const discBonus =
          params.discriminativeBonusByTaskId?.[task.taskId] ??
          (task.tags?.includes('co_evolved_compositional') ? 0.35 : 0.1);
        const totalGain = facilityGain + discBonus;

        if (totalGain > bestGain) {
          bestGain = totalGain;
          bestIdx = candidateIdx;
        }
      }

      if (bestIdx < 0) break;

      selectedIndices.add(bestIdx);
      const chosenTask = tasks[bestIdx]!;
      selectedSuite.push(chosenTask);
      currentObjective += bestGain;

      for (let targetIdx = 0; targetIdx < tasks.length; targetIdx++) {
        currentCoverage[targetIdx] = Math.max(
          currentCoverage[targetIdx]!,
          simMatrix[targetIdx]![bestIdx]!,
        );
      }

      marginalGains.push({
        taskId: chosenTask.taskId,
        marginalGain: Number(bestGain.toFixed(4)),
      });
    }

    return {
      selectedSuite,
      objectiveValue: Number(currentObjective.toFixed(4)),
      theoreticalApproximationGuarantee: Number((1 - 1 / Math.E).toFixed(4)),
      marginalGains,
    };
  }

  private tokenizeTask(task: ProbeTaskSpec): Set<string> {
    const raw = `${task.taskId} ${task.prompt} ${(task.tags ?? []).join(' ')} ${task.domain ?? ''}`;
    const tokens = raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    return new Set(tokens);
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const item of a) {
      if (b.has(item)) inter++;
    }
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  }
}
