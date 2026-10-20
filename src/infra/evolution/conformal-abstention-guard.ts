/**
 * Wave 10 / Total-Convergence — Honest-by-Construction Split Conformal Abstention
 * & Cryptographic Reproducibility Manifest (`ConformalAbstentionGuard`).
 *
 * Implements distribution-free Split Conformal Prediction (Vovk et al., 2005;
 * Angelopoulos & Bates, 2021) paired with an explicit Honest-by-Construction
 * Abstention & Fallback Guard:
 * 1. Calibrates normalized non-conformity scores $s_i = |y_i - \hat{\mu}_i| / \max(\hat{\sigma}_i, \epsilon)$
 *    and computes finite-sample quantile $\hat{q}_{1-\alpha}$ at level $\lceil (n+1)(1-\alpha) \rceil / n$.
 * 2. Forms guaranteed prediction intervals $[L_{1-\alpha}(H), U_{1-\alpha}(H)] = [\hat{\mu} \mp \hat{q}_{1-\alpha}\hat{\sigma}]$.
 * 3. Abstains and falls back to canonical baseline $H_0$ (`shouldAbstain: true`) whenever
 *    inputs violate domain assumptions, epistemic uncertainty exceeds $\tau_\sigma$, or
 *    the conformal lower bound $L_{1-\alpha}(H) < \tau_{\text{floor}}$.
 * 4. Emits a deterministic SHA-256 Cryptographic Reproducibility Manifest.
 */
import * as crypto from 'node:crypto';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';

export interface ConformalCalibrationResidual {
  readonly candidateId: string;
  readonly predictedMean: number;
  readonly predictedStd: number;
  readonly observedUtility: number;
}

export interface CryptographicReproducibilityManifest {
  readonly schemaVersion: '1.0.0';
  readonly seed: number;
  readonly alpha: number;
  readonly calibrationSampleCount: number;
  readonly empiricalQuantile: number;
  readonly manifestId: string;
  readonly componentTreeSha256: string;
  readonly reproducibilityHash: string;
}

export interface ConformalAbstentionDecision {
  readonly manifestId: string;
  readonly alpha: number;
  readonly empiricalQuantile: number;
  readonly conformalLowerBound: number;
  readonly conformalUpperBound: number;
  readonly intervalWidth: number;
  readonly shouldAbstain: boolean;
  readonly abstentionReason:
    | 'NONE'
    | 'DOMAIN_ASSUMPTION_VIOLATION'
    | 'EXCESSIVE_EPISTEMIC_UNCERTAINTY'
    | 'INTERVAL_WIDTH_EXCEEDED'
    | 'CONFORMAL_LOWER_BOUND_BELOW_FLOOR';
  readonly fallbackManifestId: string;
  readonly reproducibilityManifest: CryptographicReproducibilityManifest;
}

export class ConformalAbstentionGuard {
  private readonly alpha: number;
  private readonly minConformalLowerBound: number;
  private readonly maxEpistemicUncertainty: number;
  private readonly maxIntervalWidth: number;
  private readonly defaultUnseenQuantile: number;
  private readonly residuals: ConformalCalibrationResidual[] = [];

  constructor(options?: {
    readonly alpha?: number;
    readonly minConformalLowerBound?: number;
    readonly maxEpistemicUncertainty?: number;
    readonly maxIntervalWidth?: number;
    readonly defaultUnseenQuantile?: number;
  }) {
    this.alpha = options?.alpha ?? 0.1;
    this.minConformalLowerBound = options?.minConformalLowerBound ?? -0.05;
    this.maxEpistemicUncertainty = options?.maxEpistemicUncertainty ?? 0.45;
    this.maxIntervalWidth = options?.maxIntervalWidth ?? 0.9;
    this.defaultUnseenQuantile = options?.defaultUnseenQuantile ?? 1.645;
  }

  /**
   * Records a calibration residual $(y_i, \hat{\mu}_i, \hat{\sigma}_i)$ from an evaluated candidate.
   */
  recordCalibrationSample(sample: ConformalCalibrationResidual): void {
    if (
      !Number.isFinite(sample.predictedMean) ||
      !Number.isFinite(sample.predictedStd) ||
      !Number.isFinite(sample.observedUtility) ||
      sample.predictedStd < 0
    ) {
      return;
    }
    this.residuals.push(sample);
  }

  /**
   * Computes the finite-sample split conformal quantile $\hat{q}_{1-\alpha}$:
   * $\hat{q}_{1-\alpha} = s_{(\lceil (n+1)(1-\alpha) \rceil)}$ over sorted normalized residuals.
   */
  computeEmpiricalQuantile(alphaOverride?: number): number {
    const alpha = alphaOverride ?? this.alpha;
    const n = this.residuals.length;
    if (n === 0) {
      return this.defaultUnseenQuantile;
    }

    const scores = this.residuals
      .map((r) => {
        const denom = Math.max(r.predictedStd, 1e-4);
        return Math.abs(r.observedUtility - r.predictedMean) / denom;
      })
      .sort((a, b) => a - b);

    const rank = Math.min(n, Math.max(1, Math.ceil((n + 1) * (1 - alpha))));
    return Number((scores[rank - 1] ?? this.defaultUnseenQuantile).toFixed(6));
  }

  /**
   * Evaluates a candidate manifest with Honest-by-Construction abstention and generates
   * a deterministic Cryptographic Reproducibility Manifest.
   */
  evaluateCandidateWithAbstention(params: {
    readonly manifest: HarnessManifest;
    readonly predictedMean: number;
    readonly predictedStd: number;
    readonly seed?: number;
    readonly fallbackManifestId?: string;
  }): ConformalAbstentionDecision {
    const seed = params.seed ?? 42;
    const fallbackManifestId = params.fallbackManifestId ?? 'H0';
    const q = this.computeEmpiricalQuantile(this.alpha);

    // 1. Domain assumption & numerical sanity validation
    const validInputs =
      Number.isFinite(params.predictedMean) &&
      Number.isFinite(params.predictedStd) &&
      params.predictedStd >= 0 &&
      this.alpha > 0 &&
      this.alpha < 1;

    if (!validInputs) {
      const repro = this.buildReproducibilityManifest({
        manifest: params.manifest,
        seed,
        empiricalQuantile: q,
      });
      return {
        manifestId: String(params.manifest.id),
        alpha: this.alpha,
        empiricalQuantile: q,
        conformalLowerBound: -1,
        conformalUpperBound: 1,
        intervalWidth: 2,
        shouldAbstain: true,
        abstentionReason: 'DOMAIN_ASSUMPTION_VIOLATION',
        fallbackManifestId,
        reproducibilityManifest: repro,
      };
    }

    const radius = q * params.predictedStd;
    const lower = Number((params.predictedMean - radius).toFixed(6));
    const upper = Number((params.predictedMean + radius).toFixed(6));
    const width = Number((upper - lower).toFixed(6));

    let shouldAbstain = false;
    let abstentionReason: ConformalAbstentionDecision['abstentionReason'] = 'NONE';

    if (params.predictedStd > this.maxEpistemicUncertainty) {
      shouldAbstain = true;
      abstentionReason = 'EXCESSIVE_EPISTEMIC_UNCERTAINTY';
    } else if (width > this.maxIntervalWidth) {
      shouldAbstain = true;
      abstentionReason = 'INTERVAL_WIDTH_EXCEEDED';
    } else if (lower < this.minConformalLowerBound) {
      shouldAbstain = true;
      abstentionReason = 'CONFORMAL_LOWER_BOUND_BELOW_FLOOR';
    }

    const reproducibilityManifest = this.buildReproducibilityManifest({
      manifest: params.manifest,
      seed,
      empiricalQuantile: q,
    });

    return {
      manifestId: String(params.manifest.id),
      alpha: this.alpha,
      empiricalQuantile: q,
      conformalLowerBound: lower,
      conformalUpperBound: upper,
      intervalWidth: width,
      shouldAbstain,
      abstentionReason,
      fallbackManifestId,
      reproducibilityManifest,
    };
  }

  /**
   * Builds a deterministic SHA-256 Cryptographic Reproducibility Manifest over the
   * harness component tree and conformal calibration state.
   */
  buildReproducibilityManifest(params: {
    readonly manifest: HarnessManifest;
    readonly seed: number;
    readonly empiricalQuantile?: number;
  }): CryptographicReproducibilityManifest {
    const q = params.empiricalQuantile ?? this.computeEmpiricalQuantile(this.alpha);
    const c = params.manifest.components;
    const componentHashes = [
      `sys:${c.systemPrompt.contentHash}`,
      `guard:${c.guardrails.contentHash}`,
      `mem:${c.memoryPolicy.contentHash}`,
      `tool:${c.toolGuidance.contentHash}`,
      `ctx:${c.contextPolicy?.contentHash ?? 'none'}`,
      `route:${c.routingPolicy?.contentHash ?? 'none'}`,
      `ver:${c.verificationPolicy?.contentHash ?? 'none'}`,
      `sched:${c.toolSchedulingPolicy?.contentHash ?? 'none'}`,
      `skills:${c.skills.map((s) => s.contentHash).join(',')}`,
      `subs:${c.subagents.map((s) => s.contentHash).join(',')}`,
      `scripts:${c.scripts.map((s) => s.contentHash).join(',')}`,
      `plugins:${c.plugins.map((s) => s.contentHash).join(',')}`,
    ].join('|');

    const componentTreeSha256 = crypto
      .createHash('sha256')
      .update(componentHashes)
      .digest('hex');

    const canonicalPayload = JSON.stringify({
      schemaVersion: '1.0.0',
      seed: params.seed,
      alpha: this.alpha,
      calibrationSampleCount: this.residuals.length,
      empiricalQuantile: q,
      manifestId: String(params.manifest.id),
      componentTreeSha256,
    });

    const reproducibilityHash = crypto
      .createHash('sha256')
      .update(canonicalPayload)
      .digest('hex');

    return {
      schemaVersion: '1.0.0',
      seed: params.seed,
      alpha: this.alpha,
      calibrationSampleCount: this.residuals.length,
      empiricalQuantile: q,
      manifestId: String(params.manifest.id),
      componentTreeSha256,
      reproducibilityHash,
    };
  }

  getCalibrationSampleCount(): number {
    return this.residuals.length;
  }
}
