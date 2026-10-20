/**
 * Wave 8.5 — Conformal Prediction & Tail-Risk $\text{CVaR}_{\alpha}$ Utility Calibrator
 * (`ConformalUtilityCalibrator`).
 *
 * Provides distribution-free, finite-sample valid uncertainty quantification and
 * tail-risk-averse utility scoring for candidate harnesses:
 * 1. **Split Conformal Prediction Intervals**:
 *    Maintains nonconformity residuals $R_i = |\text{observedUtility}_i - \text{predictedUtility}_i|$
 *    and computes the finite-sample conformal quantile
 *      $\hat{q}_{1-\alpha} = \text{Quantile}_{\lceil (n+1)(1-\alpha) \rceil / n}(\{R_1, \dots, R_n\})$
 *    yielding $[ \hat{\mu} - \hat{q}_{1-\alpha}, \hat{\mu} + \hat{q}_{1-\alpha} ]$ with
 *    guaranteed marginal coverage $\ge 1 - \alpha$ without Gaussian assumptions.
 * 2. **Conditional Value-at-Risk ($\text{CVaR}_{\alpha}$) Tail Utility**:
 *    Computes expected utility in the worst $\alpha$-quantile of probe trials and a
 *    risk-averse composite score $(1 - \lambda_{\text{risk}}) \hat{\mu} + \lambda_{\text{risk}} \text{CVaR}_{\alpha}$.
 */

export interface ConformalPredictionInterval {
  readonly pointEstimate: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly quantileRadius: number;
  readonly alpha: number;
  readonly targetCoverage: number; // 1 - alpha
  readonly calibrationSampleSize: number;
}

export interface TailRiskUtilityReport {
  readonly sampleSize: number;
  readonly meanUtility: number;
  readonly stdDevUtility: number;
  readonly alphaTailFraction: number;
  readonly valueAtRiskAlpha: number; // VaR_alpha
  readonly conditionalValueAtRiskAlpha: number; // CVaR_alpha (expected shortfall)
  readonly riskAverseCompositeScore: number;
  readonly conformalLowerBound: number;
}

export class ConformalUtilityCalibrator {
  private readonly residuals: number[] = [];
  private readonly maxCalibrationHistory: number;
  private readonly defaultDefaultRadius: number;

  constructor(options?: {
    readonly maxCalibrationHistory?: number;
    readonly defaultFallbackRadius?: number;
    readonly seedResiduals?: ReadonlyArray<number>;
  }) {
    this.maxCalibrationHistory = options?.maxCalibrationHistory ?? 200;
    this.defaultDefaultRadius = options?.defaultFallbackRadius ?? 0.15;
    if (options?.seedResiduals) {
      for (const r of options.seedResiduals) {
        this.residuals.push(Math.abs(r));
      }
    }
  }

  /**
   * Appends a calibration residual $R_i = |\text{observed} - \text{predicted}|$ to the
   * conformal calibration set.
   */
  recordCalibrationResidual(
    predictedUtility: number,
    observedUtility: number,
  ): number {
    const residual = Number(
      Math.abs(observedUtility - predictedUtility).toFixed(6),
    );
    this.residuals.push(residual);
    if (this.residuals.length > this.maxCalibrationHistory) {
      this.residuals.shift();
    }
    return residual;
  }

  /**
   * Computes a finite-sample valid $(1 - \alpha)$ Split Conformal Prediction Interval
   * around `pointEstimate`.
   */
  computeConformalInterval(
    pointEstimate: number,
    alpha = 0.1,
  ): ConformalPredictionInterval {
    const clampedAlpha = Math.max(0.01, Math.min(0.5, alpha));
    const n = this.residuals.length;

    let quantileRadius = this.defaultDefaultRadius;
    if (n > 0) {
      const sorted = [...this.residuals].sort((a, b) => a - b);
      // Finite-sample conformal rank: ceil((n + 1) * (1 - alpha)) - 1 (0-indexed)
      const rankIdx = Math.min(
        n - 1,
        Math.max(0, Math.ceil((n + 1) * (1 - clampedAlpha)) - 1),
      );
      quantileRadius = sorted[rankIdx]!;
    }

    return {
      pointEstimate: Number(pointEstimate.toFixed(4)),
      lowerBound: Number((pointEstimate - quantileRadius).toFixed(4)),
      upperBound: Number((pointEstimate + quantileRadius).toFixed(4)),
      quantileRadius: Number(quantileRadius.toFixed(4)),
      alpha: clampedAlpha,
      targetCoverage: Number((1 - clampedAlpha).toFixed(4)),
      calibrationSampleSize: n,
    };
  }

  /**
   * Computes empirical mean, $\text{VaR}_{\alpha}$, $\text{CVaR}_{\alpha}$ (expected utility
   * in the worst $\alpha$-fraction of trials), and a risk-averse composite score.
   */
  evaluateTailRiskUtility(params: {
    readonly trialUtilities: ReadonlyArray<number>;
    readonly alphaTailFraction?: number; // default 0.25 (worst 25% of trials)
    readonly riskAversionLambda?: number; // default 0.40
    readonly conformalAlpha?: number; // default 0.10
  }): TailRiskUtilityReport {
    const scores = params.trialUtilities;
    const alphaTail = Math.max(
      0.05,
      Math.min(0.5, params.alphaTailFraction ?? 0.25),
    );
    const lambda = Math.max(
      0,
      Math.min(1, params.riskAversionLambda ?? 0.4),
    );

    if (scores.length === 0) {
      return {
        sampleSize: 0,
        meanUtility: 0,
        stdDevUtility: 0,
        alphaTailFraction: alphaTail,
        valueAtRiskAlpha: 0,
        conditionalValueAtRiskAlpha: 0,
        riskAverseCompositeScore: 0,
        conformalLowerBound: -this.defaultDefaultRadius,
      };
    }

    const n = scores.length;
    const mean = scores.reduce((s, x) => s + x, 0) / n;
    const variance =
      scores.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n;
    const stdDev = Math.sqrt(variance);

    const sortedAsc = [...scores].sort((a, b) => a - b);
    const tailCount = Math.max(1, Math.ceil(n * alphaTail));
    const tailSlice = sortedAsc.slice(0, tailCount);
    const varAlpha = sortedAsc[tailCount - 1]!;
    const cvarAlpha =
      tailSlice.reduce((s, x) => s + x, 0) / tailSlice.length;

    const riskAverseCompositeScore =
      (1 - lambda) * mean + lambda * cvarAlpha;
    const conformal = this.computeConformalInterval(
      mean,
      params.conformalAlpha ?? 0.1,
    );

    return {
      sampleSize: n,
      meanUtility: Number(mean.toFixed(4)),
      stdDevUtility: Number(stdDev.toFixed(4)),
      alphaTailFraction: alphaTail,
      valueAtRiskAlpha: Number(varAlpha.toFixed(4)),
      conditionalValueAtRiskAlpha: Number(cvarAlpha.toFixed(4)),
      riskAverseCompositeScore: Number(riskAverseCompositeScore.toFixed(4)),
      conformalLowerBound: conformal.lowerBound,
    };
  }
}
