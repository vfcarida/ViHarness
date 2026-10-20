/**
 * Wave 5.4 — Sequential Statistical Control (`Wald SPRT` & `Holm-Bonferroni` Multiple-Testing Gate).
 *
 * Provides rigorous statistical guarantees for recursive harness evolution:
 * 1. `WaldSprtStoppingRule`: Sequential Probability Ratio Test (SPRT) for early stopping
 *    of paired probe repetitions when a candidate is provably inferior (`STOP_REJECT_INFERIOR`)
 *    or provably superior (`STOP_ACCEPT_SUPERIOR`) relative to baseline H0.
 * 2. `HolmBonferroniMultipleTestingGate`: Controls the Family-Wise Error Rate (FWER) across
 *    M candidate hypotheses evaluated in a single evolution run, preventing harness p-hacking
 *    ("What Does a Harness Buy? Tokens, Mostly" / HarnessOpt-Bench).
 */
import type { ProbeTrialMetrics } from '../../core/evolution/hypothesis.js';

export type SprtDecisionType =
  | 'CONTINUE_SAMPLING'
  | 'STOP_ACCEPT_SUPERIOR'
  | 'STOP_REJECT_INFERIOR';

export interface SprtEvaluationResult {
  readonly decision: SprtDecisionType;
  readonly logLikelihoodRatio: number;
  readonly upperBoundaryA: number;
  readonly lowerBoundaryB: number;
  readonly meanDelta: number;
  readonly trialsEvaluated: number;
  readonly rationale: string;
}

export interface WaldSprtOptions {
  readonly alpha?: number; // Type I error rate (false positive), default 0.05
  readonly beta?: number; // Type II error rate (false negative), default 0.10
  readonly minEffectDelta?: number; // Target minimum improvement delta_1, default 0.10
  readonly assumedVariance?: number; // Assumed paired difference variance sigma^2, default 0.08
  readonly minTrialsBeforeStop?: number; // Minimum paired trials before SPRT can stop, default 2
}

export class WaldSprtStoppingRule {
  private readonly alpha: number;
  private readonly beta: number;
  private readonly minEffectDelta: number;
  private readonly assumedVariance: number;
  private readonly minTrialsBeforeStop: number;
  private readonly upperBoundaryA: number;
  private readonly lowerBoundaryB: number;

  constructor(options?: WaldSprtOptions) {
    this.alpha = options?.alpha ?? 0.05;
    this.beta = options?.beta ?? 0.10;
    this.minEffectDelta = options?.minEffectDelta ?? 0.10;
    this.assumedVariance = options?.assumedVariance ?? 0.08;
    this.minTrialsBeforeStop = options?.minTrialsBeforeStop ?? 2;
    this.upperBoundaryA = Number(
      Math.log((1 - this.beta) / this.alpha).toFixed(4),
    );
    this.lowerBoundaryB = Number(
      Math.log(this.beta / (1 - this.alpha)).toFixed(4),
    );
  }

  /**
   * Evaluates sequential paired trials between base and candidate harnesses.
   * Tests H0: delta <= 0 against H1: delta >= minEffectDelta.
   */
  evaluatePairedTrials(params: {
    readonly baseTrials: ReadonlyArray<ProbeTrialMetrics>;
    readonly candidateTrials: ReadonlyArray<ProbeTrialMetrics>;
  }): SprtEvaluationResult {
    const n = Math.min(params.baseTrials.length, params.candidateTrials.length);
    if (n === 0) {
      return {
        decision: 'CONTINUE_SAMPLING',
        logLikelihoodRatio: 0,
        upperBoundaryA: this.upperBoundaryA,
        lowerBoundaryB: this.lowerBoundaryB,
        meanDelta: 0,
        trialsEvaluated: 0,
        rationale: 'No paired trials evaluated yet.',
      };
    }

    let sumDiff = 0;
    let llr = 0;
    const d1 = this.minEffectDelta;
    const sigma2 = Math.max(1e-4, this.assumedVariance);

    for (let i = 0; i < n; i++) {
      const b = params.baseTrials[i];
      const c = params.candidateTrials[i];
      if (!b || !c) continue;
      const diff = c.partialScore - b.partialScore;
      sumDiff += diff;
      // Gaussian log-likelihood increment for H1 (mean = d1) vs H0 (mean = 0)
      llr += (d1 * (diff - d1 / 2)) / sigma2;
    }

    const meanDelta = Number((sumDiff / n).toFixed(4));
    const roundedLlr = Number(llr.toFixed(4));

    if (n < this.minTrialsBeforeStop) {
      return {
        decision: 'CONTINUE_SAMPLING',
        logLikelihoodRatio: roundedLlr,
        upperBoundaryA: this.upperBoundaryA,
        lowerBoundaryB: this.lowerBoundaryB,
        meanDelta,
        trialsEvaluated: n,
        rationale: `Evaluated ${n}/${this.minTrialsBeforeStop} minimum trials before early-stopping is active.`,
      };
    }

    if (roundedLlr <= this.lowerBoundaryB) {
      return {
        decision: 'STOP_REJECT_INFERIOR',
        logLikelihoodRatio: roundedLlr,
        upperBoundaryA: this.upperBoundaryA,
        lowerBoundaryB: this.lowerBoundaryB,
        meanDelta,
        trialsEvaluated: n,
        rationale: `Wald SPRT crossed lower boundary (${roundedLlr} <= ${this.lowerBoundaryB}) after ${n} trials (meanDelta=${meanDelta}); candidate is statistically inferior.`,
      };
    }

    if (roundedLlr >= this.upperBoundaryA) {
      return {
        decision: 'STOP_ACCEPT_SUPERIOR',
        logLikelihoodRatio: roundedLlr,
        upperBoundaryA: this.upperBoundaryA,
        lowerBoundaryB: this.lowerBoundaryB,
        meanDelta,
        trialsEvaluated: n,
        rationale: `Wald SPRT crossed upper boundary (${roundedLlr} >= ${this.upperBoundaryA}) after ${n} trials (meanDelta=${meanDelta}); candidate superiority confirmed.`,
      };
    }

    return {
      decision: 'CONTINUE_SAMPLING',
      logLikelihoodRatio: roundedLlr,
      upperBoundaryA: this.upperBoundaryA,
      lowerBoundaryB: this.lowerBoundaryB,
      meanDelta,
      trialsEvaluated: n,
      rationale: `Wald SPRT within continuation region (${this.lowerBoundaryB} < ${roundedLlr} < ${this.upperBoundaryA}); continue sampling.`,
    };
  }
}

export interface CandidateHypothesisTestInput {
  readonly candidateManifestId: string;
  readonly meanScoreDelta: number;
  readonly sampleSize: number;
  readonly stdDevDelta?: number;
}

export interface HolmBonferroniCandidateVerdict {
  readonly candidateManifestId: string;
  readonly rank: number;
  readonly zStatistic: number;
  readonly pValue: number;
  readonly adjustedAlpha: number;
  readonly significantUnderFwer: boolean;
}

export interface HolmBonferroniReport {
  readonly familyWiseAlpha: number;
  readonly totalHypothesesTested: number;
  readonly verdicts: ReadonlyArray<HolmBonferroniCandidateVerdict>;
  readonly approvedCandidateIds: ReadonlyArray<string>;
}

export class HolmBonferroniMultipleTestingGate {
  private readonly familyWiseAlpha: number;

  constructor(options?: { readonly familyWiseAlpha?: number }) {
    this.familyWiseAlpha = options?.familyWiseAlpha ?? 0.05;
  }

  /**
   * Applies the Holm-Bonferroni step-down multiple-testing correction across M candidates.
   */
  evaluateFamilyWiseSignificance(
    inputs: ReadonlyArray<CandidateHypothesisTestInput>,
  ): HolmBonferroniReport {
    const m = inputs.length;
    if (m === 0) {
      return {
        familyWiseAlpha: this.familyWiseAlpha,
        totalHypothesesTested: 0,
        verdicts: [],
        approvedCandidateIds: [],
      };
    }

    const withStats = inputs.map((item) => {
      const n = Math.max(1, item.sampleSize);
      const sd = Math.max(0.05, item.stdDevDelta ?? 0.2);
      const se = sd / Math.sqrt(n);
      const z = item.meanScoreDelta / se;
      const pValue = this.oneSidedNormalPValue(z);
      return {
        item,
        zStatistic: Number(z.toFixed(4)),
        pValue: Number(pValue.toFixed(6)),
      };
    });

    // Sort by ascending p-value
    withStats.sort((a, b) => a.pValue - b.pValue);

    const verdicts: HolmBonferroniCandidateVerdict[] = [];
    const approvedCandidateIds: string[] = [];
    let stepDownStopped = false;

    for (let k = 0; k < m; k++) {
      const entry = withStats[k];
      if (!entry) continue;
      const adjustedAlpha = Number(
        (this.familyWiseAlpha / (m - k)).toFixed(6),
      );
      const passesStep =
        !stepDownStopped &&
        entry.item.meanScoreDelta > 0 &&
        entry.pValue <= adjustedAlpha;

      if (!passesStep) {
        stepDownStopped = true;
      } else {
        approvedCandidateIds.push(entry.item.candidateManifestId);
      }

      verdicts.push({
        candidateManifestId: entry.item.candidateManifestId,
        rank: k + 1,
        zStatistic: entry.zStatistic,
        pValue: entry.pValue,
        adjustedAlpha,
        significantUnderFwer: passesStep,
      });
    }

    return {
      familyWiseAlpha: this.familyWiseAlpha,
      totalHypothesesTested: m,
      verdicts,
      approvedCandidateIds,
    };
  }

  /**
   * Abramowitz & Stegun normal survival function 1 - Phi(z) for one-sided hypothesis test.
   */
  private oneSidedNormalPValue(z: number): number {
    if (z <= 0) return 0.5 + Math.min(0.4999, Math.abs(z) * 0.15);
    const t = 1 / (1 + 0.2316419 * z);
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const prob =
      d *
      t *
      (0.3193815 +
        t *
          (-0.3565638 +
            t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return Math.max(0, Math.min(1, prob));
  }
}
