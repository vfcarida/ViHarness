/**
 * Wave 6.3 — Online Canary Deployment & Sequential CUSUM Rollback Controller (`CanaryDeploymentController`).
 *
 * Mitigates production distribution-shift and delayed regression risks (`THREAT E-19` & `E-21`)
 * after a candidate harness is admitted:
 * 1. **Staged Traffic Routing (`10% -> 25% -> 50% -> 100%`)**: Deterministically routes
 *    incoming tasks to either `stableManifest` ($H_{\text{stable}}$) or `canaryManifest`
 *    ($H_{\text{canary}}$) using SHA-256 task-hash bucketing.
 * 2. **Sequential Page-Hinkley / CUSUM Change-Point Detector**: Continuously monitors
 *    canary pass-rate degradation, cost inflation, and policy/safety violations.
 * 3. **Fail-Closed Auto-Rollback & Quarantine**: Immediately invokes
 *    `admissionGate.rollbackBaseline()` and `experienceLibrary.quarantine()` if the
 *    sequential CUSUM alarm threshold $h$ is breached, or promotes the canary to the next
 *    rollout stage once `minTrialsPerStage` is met without alarm.
 */
import * as crypto from 'node:crypto';
import type { ExperienceEntryId } from '../../core/types/identifiers.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type {
  HarnessAdmissionGate,
  HarnessExperienceLibrary,
} from '../../core/evolution/interfaces.js';

export type CanaryRolloutStage = 0 | 10 | 25 | 50 | 100;

export interface CanaryTrialObservation {
  readonly taskId: string;
  readonly servedBy: 'STABLE' | 'CANARY';
  readonly success: boolean;
  readonly costDollars: number;
  readonly latencyMs: number;
  readonly policyViolations: number;
  readonly safetyViolations: number;
}

export interface CanaryHealthSnapshot {
  readonly active: boolean;
  readonly stagePercentage: CanaryRolloutStage;
  readonly stableManifestId: string;
  readonly canaryManifestId?: string;
  readonly canaryExperienceId?: ExperienceEntryId;
  readonly stableTrialsCount: number;
  readonly canaryTrialsCount: number;
  readonly stablePassRate: number;
  readonly canaryPassRate: number;
  readonly cusumDegradationScore: number;
  readonly cusumThresholdH: number;
  readonly status: 'IDLE' | 'HEALTHY_ROLLOUT' | 'PROMOTED_100' | 'ROLLED_BACK_ALARM';
  readonly lastActionRationale: string;
}

export interface CanaryControllerOptions {
  readonly admissionGate?: HarnessAdmissionGate;
  readonly experienceLibrary?: HarnessExperienceLibrary;
  readonly minTrialsPerStage?: number;
  readonly cusumDriftAllowanceK?: number; // slack parameter k, default 0.05
  readonly cusumAlarmThresholdH?: number; // decision threshold h, default 0.35
  readonly maxCostMultiplier?: number; // max ratio of canary cost to stable cost, default 1.35
}

const ROLLOUT_LADDER: ReadonlyArray<CanaryRolloutStage> = [10, 25, 50, 100];

export class CanaryDeploymentController {
  private readonly admissionGate?: HarnessAdmissionGate;
  private readonly experienceLibrary?: HarnessExperienceLibrary;
  private readonly minTrialsPerStage: number;
  private readonly cusumK: number;
  private readonly cusumH: number;
  private readonly maxCostMultiplier: number;

  private stableManifest: HarnessManifest;
  private canaryManifest?: HarnessManifest;
  private canaryExperienceId?: ExperienceEntryId;
  private stagePercentage: CanaryRolloutStage = 0;
  private status: CanaryHealthSnapshot['status'] = 'IDLE';
  private lastActionRationale = 'No active canary rollout.';

  private stableTrials: CanaryTrialObservation[] = [];
  private canaryTrials: CanaryTrialObservation[] = [];
  private cusumScore = 0;

  constructor(
    initialStableManifest: HarnessManifest,
    options?: CanaryControllerOptions,
  ) {
    this.stableManifest = initialStableManifest;
    this.admissionGate = options?.admissionGate;
    this.experienceLibrary = options?.experienceLibrary;
    this.minTrialsPerStage = options?.minTrialsPerStage ?? 4;
    this.cusumK = options?.cusumDriftAllowanceK ?? 0.05;
    this.cusumH = options?.cusumAlarmThresholdH ?? 0.35;
    this.maxCostMultiplier = options?.maxCostMultiplier ?? 1.35;
  }

  /**
   * Starts a staged canary rollout for a newly admitted candidate manifest at 10% traffic.
   */
  startCanaryRollout(params: {
    readonly canaryManifest: HarnessManifest;
    readonly canaryExperienceId?: ExperienceEntryId;
    readonly initialStage?: CanaryRolloutStage;
  }): CanaryHealthSnapshot {
    this.canaryManifest = params.canaryManifest;
    this.canaryExperienceId = params.canaryExperienceId;
    this.stagePercentage = params.initialStage ?? 10;
    this.status = 'HEALTHY_ROLLOUT';
    this.stableTrials = [];
    this.canaryTrials = [];
    this.cusumScore = 0;
    this.lastActionRationale = `Started canary rollout for '${params.canaryManifest.id}' at ${this.stagePercentage}% traffic.`;
    return this.getSnapshot();
  }

  /**
   * Deterministically routes a task ID to either STABLE or CANARY according to the current
   * rollout stage percentage.
   */
  routeTask(taskId: string): {
    readonly target: 'STABLE' | 'CANARY';
    readonly manifest: HarnessManifest;
    readonly bucket: number;
  } {
    const hashHex = crypto
      .createHash('sha256')
      .update(taskId)
      .digest('hex')
      .slice(0, 8);
    const bucket = parseInt(hashHex, 16) % 100;

    if (
      this.canaryManifest &&
      (this.status === 'HEALTHY_ROLLOUT' || this.status === 'PROMOTED_100') &&
      bucket < this.stagePercentage
    ) {
      return {
        target: 'CANARY',
        manifest: this.canaryManifest,
        bucket,
      };
    }

    return {
      target: 'STABLE',
      manifest: this.stableManifest,
      bucket,
    };
  }

  /**
   * Records a live production execution outcome, updates the sequential Page-Hinkley / CUSUM
   * statistic, and automatically triggers rollback or stage advancement when warranted.
   */
  async recordOutcome(
    observation: CanaryTrialObservation,
  ): Promise<CanaryHealthSnapshot> {
    if (observation.servedBy === 'STABLE') {
      this.stableTrials.push(observation);
      return this.getSnapshot();
    }

    this.canaryTrials.push(observation);

    // 1. Immediate zero-tolerance check on safety or policy violations
    if (observation.safetyViolations > 0 || observation.policyViolations > 0) {
      await this.triggerAutoRollback(
        `Immediate fail-closed canary rollback: observed safetyViolations=${observation.safetyViolations}, policyViolations=${observation.policyViolations} on task '${observation.taskId}'.`,
      );
      return this.getSnapshot();
    }

    // 2. Update sequential one-sided CUSUM statistic: S_t = max(0, S_{t-1} + (targetPassRate - y_t - k))
    const referencePassRate = this.computePassRate(this.stableTrials, 0.85);
    const y = observation.success ? 1.0 : 0.0;
    const instantaneousDrop = referencePassRate - y - this.cusumK;
    this.cusumScore = Number(
      Math.max(0, this.cusumScore + instantaneousDrop).toFixed(4),
    );

    if (this.cusumScore >= this.cusumH) {
      await this.triggerAutoRollback(
        `Sequential CUSUM alarm triggered (S_t=${this.cusumScore} >= h=${this.cusumH}): canary pass rate (${(this.computePassRate(this.canaryTrials, 0) * 100).toFixed(1)}%) degraded below reference (${(referencePassRate * 100).toFixed(1)}%).`,
      );
      return this.getSnapshot();
    }

    // 3. Check cost inflation guard once minimum trials are observed
    if (
      this.canaryTrials.length >= this.minTrialsPerStage &&
      this.stableTrials.length > 0
    ) {
      const meanStableCost =
        this.stableTrials.reduce((s, t) => s + t.costDollars, 0) /
        this.stableTrials.length;
      const meanCanaryCost =
        this.canaryTrials.reduce((s, t) => s + t.costDollars, 0) /
        this.canaryTrials.length;

      if (
        meanStableCost > 0 &&
        meanCanaryCost > meanStableCost * this.maxCostMultiplier
      ) {
        await this.triggerAutoRollback(
          `Canary cost inflation rollback: meanCanaryCost ($${meanCanaryCost.toFixed(4)}) exceeded ${this.maxCostMultiplier}x meanStableCost ($${meanStableCost.toFixed(4)}).`,
        );
        return this.getSnapshot();
      }
    }

    // 4. Advance rollout stage if healthy and sufficient trials collected at current stage
    const stageIdx = ROLLOUT_LADDER.indexOf(this.stagePercentage);
    const requiredTrialsForAdvance =
      (stageIdx + 1) * this.minTrialsPerStage;
    if (
      this.status === 'HEALTHY_ROLLOUT' &&
      this.canaryTrials.length >= requiredTrialsForAdvance
    ) {
      this.advanceStage();
    }

    return this.getSnapshot();
  }

  getSnapshot(): CanaryHealthSnapshot {
    return {
      active: this.status === 'HEALTHY_ROLLOUT',
      stagePercentage: this.stagePercentage,
      stableManifestId: String(this.stableManifest.id),
      canaryManifestId: this.canaryManifest
        ? String(this.canaryManifest.id)
        : undefined,
      canaryExperienceId: this.canaryExperienceId,
      stableTrialsCount: this.stableTrials.length,
      canaryTrialsCount: this.canaryTrials.length,
      stablePassRate: this.computePassRate(this.stableTrials, 1.0),
      canaryPassRate: this.computePassRate(this.canaryTrials, 1.0),
      cusumDegradationScore: this.cusumScore,
      cusumThresholdH: this.cusumH,
      status: this.status,
      lastActionRationale: this.lastActionRationale,
    };
  }

  private advanceStage(): void {
    const idx = ROLLOUT_LADDER.indexOf(this.stagePercentage);
    if (idx < 0 || idx >= ROLLOUT_LADDER.length - 1) {
      this.stagePercentage = 100;
      this.status = 'PROMOTED_100';
      if (this.canaryManifest) {
        this.stableManifest = this.canaryManifest;
      }
      this.lastActionRationale = `Canary '${this.canaryManifest?.id}' completed 100% rollout with zero CUSUM alarms (S_t=${this.cusumScore}) and is now canonical stable baseline.`;
      return;
    }

    const nextStage = ROLLOUT_LADDER[idx + 1]!;
    this.stagePercentage = nextStage;
    if (nextStage === 100) {
      this.status = 'PROMOTED_100';
      if (this.canaryManifest) {
        this.stableManifest = this.canaryManifest;
      }
      this.lastActionRationale = `Canary '${this.canaryManifest?.id}' promoted to 100% canonical traffic.`;
    } else {
      this.lastActionRationale = `Canary '${this.canaryManifest?.id}' advanced to ${nextStage}% traffic after ${this.canaryTrials.length} healthy trials.`;
    }
  }

  private async triggerAutoRollback(reason: string): Promise<void> {
    this.stagePercentage = 0;
    this.status = 'ROLLED_BACK_ALARM';
    this.lastActionRationale = reason;

    if (this.admissionGate) {
      try {
        this.stableManifest = await this.admissionGate.rollbackBaseline(
          this.stableManifest.id,
        );
      } catch {
        // Keep current stableManifest if admissionGate has no prior history
      }
    }

    if (this.experienceLibrary && this.canaryExperienceId) {
      await this.experienceLibrary.quarantine(this.canaryExperienceId, reason);
    }
  }

  private computePassRate(
    trials: ReadonlyArray<CanaryTrialObservation>,
    fallback: number,
  ): number {
    if (trials.length === 0) return fallback;
    const passed = trials.filter((t) => t.success).length;
    return Number((passed / trials.length).toFixed(4));
  }
}
