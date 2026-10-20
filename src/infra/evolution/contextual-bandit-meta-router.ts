/**
 * Wave 7.4 — Contextual Bandit Meta-Strategy Router (`ContextualBanditMetaRouter`).
 *
 * Dynamically selects the optimal `(strategyMode, deploymentProfile, explorationBudget)`
 * tuple for each recursive evolution cycle using Disjoint LinUCB / Ridge Regression
 * over a 5-dimensional context feature vector $\mathbf{x}_t \in [0, 1]^5$:
 *   1. `failureEntropy`: diversity of diagnosed failure signals
 *   2. `budgetPressure`: fraction of compute budget already consumed
 *   3. `ceilingIndex`: model capability saturation index (`ContrastivePreferenceExporter`)
 *   4. `ratingUncertainty`: normalized Glicko-2 $\text{RD}_H / 350$
 *   5. `historicalPassRate`: baseline pass rate on current task distribution
 */
import type { DeploymentProfileName } from '../../core/evolution/interfaces.js';

export type EvolutionStrategyMode = 'parallel' | 'sequential' | 'adaptive';

export interface MetaRouterContextFeatures {
  readonly failureEntropy: number; // [0, 1]
  readonly budgetPressure: number; // [0, 1]
  readonly ceilingIndex: number; // [0, 1]
  readonly ratingUncertainty: number; // [0, 1]
  readonly historicalPassRate: number; // [0, 1]
}

export interface MetaArmDefinition {
  readonly armId: string;
  readonly strategyMode: EvolutionStrategyMode;
  readonly deploymentProfile: DeploymentProfileName;
  readonly defaultCandidatePoolSize: number;
}

export interface MetaRoutingDecision {
  readonly selectedArm: MetaArmDefinition;
  readonly expectedReward: number;
  readonly ucbBonus: number;
  readonly ucbScore: number;
  readonly recommendedCandidatePoolSize: number;
  readonly rationale: string;
}

export interface MetaArmStats {
  readonly arm: MetaArmDefinition;
  readonly pullsCount: number;
  readonly meanObservedReward: number;
  readonly weights: ReadonlyArray<number>;
}

const DEFAULT_META_ARMS: ReadonlyArray<MetaArmDefinition> = [
  {
    armId: 'adaptive:balanced',
    strategyMode: 'adaptive',
    deploymentProfile: 'balanced',
    defaultCandidatePoolSize: 3,
  },
  {
    armId: 'parallel:quality_first',
    strategyMode: 'parallel',
    deploymentProfile: 'quality_first',
    defaultCandidatePoolSize: 4,
  },
  {
    armId: 'sequential:high_assurance',
    strategyMode: 'sequential',
    deploymentProfile: 'high_assurance',
    defaultCandidatePoolSize: 2,
  },
  {
    armId: 'adaptive:low_cost',
    strategyMode: 'adaptive',
    deploymentProfile: 'low_cost',
    defaultCandidatePoolSize: 2,
  },
  {
    armId: 'parallel:low_latency',
    strategyMode: 'parallel',
    deploymentProfile: 'low_latency',
    defaultCandidatePoolSize: 3,
  },
];

interface ArmLinearModel {
  readonly arm: MetaArmDefinition;
  // Diagonal ridge precision matrix A_diag (d=5) + reward correlation vector b (d=5)
  readonly aDiag: number[];
  readonly bVec: number[];
  pullsCount: number;
  rewardSum: number;
}

export class ContextualBanditMetaRouter {
  private readonly alpha: number;
  private readonly costPenaltyWeight: number;
  private readonly models = new Map<string, ArmLinearModel>();

  constructor(options?: {
    readonly alpha?: number; // exploration parameter, default 0.35
    readonly costPenaltyWeight?: number; // default 0.15
    readonly arms?: ReadonlyArray<MetaArmDefinition>;
  }) {
    this.alpha = options?.alpha ?? 0.35;
    this.costPenaltyWeight = options?.costPenaltyWeight ?? 0.15;
    const arms = options?.arms ?? DEFAULT_META_ARMS;

    for (const arm of arms) {
      // Seed structural domain priors into bVec so cold-start routing is sensible
      const priorB = this.buildStructuralPrior(arm);
      this.models.set(arm.armId, {
        arm,
        aDiag: [1.0, 1.0, 1.0, 1.0, 1.0],
        bVec: priorB,
        pullsCount: 0,
        rewardSum: 0,
      });
    }
  }

  /**
   * Selects the meta-arm maximizing $\hat{\theta}_a^\top \mathbf{x} + \alpha \sqrt{\mathbf{x}^\top \mathbf{A}_a^{-1} \mathbf{x}}$.
   */
  selectMetaArm(context: MetaRouterContextFeatures): MetaRoutingDecision {
    const x = this.toVector(context);
    let bestArm: MetaArmDefinition | undefined;
    let bestExpected = -Infinity;
    let bestBonus = 0;
    let bestUcb = -Infinity;

    for (const model of this.models.values()) {
      let expected = 0;
      let varianceQuad = 0;
      for (let i = 0; i < x.length; i++) {
        const thetaI = model.bVec[i]! / model.aDiag[i]!;
        expected += thetaI * x[i]!;
        varianceQuad += (x[i]! * x[i]!) / model.aDiag[i]!;
      }

      const bonus = this.alpha * Math.sqrt(Math.max(0, varianceQuad));
      const ucb = expected + bonus;

      if (ucb > bestUcb) {
        bestUcb = ucb;
        bestExpected = expected;
        bestBonus = bonus;
        bestArm = model.arm;
      }
    }

    const chosen = bestArm ?? DEFAULT_META_ARMS[0]!;
    const budgetScale = context.budgetPressure > 0.7 ? -1 : context.failureEntropy > 0.6 ? 1 : 0;
    const recommendedCandidatePoolSize = Math.max(
      1,
      Math.min(6, chosen.defaultCandidatePoolSize + budgetScale),
    );

    return {
      selectedArm: chosen,
      expectedReward: Number(bestExpected.toFixed(4)),
      ucbBonus: Number(bestBonus.toFixed(4)),
      ucbScore: Number(bestUcb.toFixed(4)),
      recommendedCandidatePoolSize,
      rationale: `LinUCB selected '${chosen.armId}' (UCB=${bestUcb.toFixed(3)}, E[r]=${bestExpected.toFixed(3)}, bonus=${bestBonus.toFixed(3)}) for context [entropy=${context.failureEntropy.toFixed(2)}, budgetPressure=${context.budgetPressure.toFixed(2)}, ceiling=${context.ceilingIndex.toFixed(2)}].`,
    };
  }

  /**
   * Updates the ridge-regression posterior for `armId` given the observed utility gain and cost.
   */
  recordReward(params: {
    readonly armId: string;
    readonly context: MetaRouterContextFeatures;
    readonly observedUtilityGain: number;
    readonly computeCostDollars: number;
  }): MetaArmStats | null {
    const model = this.models.get(params.armId);
    if (!model) return null;

    const x = this.toVector(params.context);
    const netReward = Math.max(
      -1,
      Math.min(
        1,
        params.observedUtilityGain -
          this.costPenaltyWeight * Math.max(0, params.computeCostDollars),
      ),
    );

    for (let i = 0; i < x.length; i++) {
      model.aDiag[i] = model.aDiag[i]! + x[i]! * x[i]!;
      model.bVec[i] = model.bVec[i]! + netReward * x[i]!;
    }
    model.pullsCount += 1;
    model.rewardSum += netReward;

    return this.toStats(model);
  }

  getArmLeaderboard(): ReadonlyArray<MetaArmStats> {
    const list = Array.from(this.models.values()).map((m) => this.toStats(m));
    list.sort((a, b) => b.meanObservedReward - a.meanObservedReward);
    return list;
  }

  private toVector(c: MetaRouterContextFeatures): number[] {
    const clamp = (v: number): number => Math.max(0, Math.min(1, v));
    return [
      clamp(c.failureEntropy),
      clamp(c.budgetPressure),
      clamp(c.ceilingIndex),
      clamp(c.ratingUncertainty),
      clamp(c.historicalPassRate),
    ];
  }

  private buildStructuralPrior(arm: MetaArmDefinition): number[] {
    // [failureEntropy, budgetPressure, ceilingIndex, ratingUncertainty, historicalPassRate]
    switch (arm.armId) {
      case 'parallel:quality_first':
        return [0.35, -0.25, -0.1, 0.3, 0.1];
      case 'adaptive:low_cost':
        return [0.05, 0.45, 0.25, 0.05, 0.15];
      case 'sequential:high_assurance':
        return [0.15, 0.1, 0.1, 0.2, 0.35];
      case 'parallel:low_latency':
        return [0.1, 0.3, 0.15, 0.1, 0.2];
      case 'adaptive:balanced':
      default:
        return [0.25, 0.2, 0.15, 0.2, 0.2];
    }
  }

  private toStats(model: ArmLinearModel): MetaArmStats {
    const weights = model.bVec.map((b, idx) =>
      Number((b / model.aDiag[idx]!).toFixed(4)),
    );
    const meanObservedReward =
      model.pullsCount > 0
        ? Number((model.rewardSum / model.pullsCount).toFixed(4))
        : Number(
            (weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(4),
          );
    return {
      arm: model.arm,
      pullsCount: model.pullsCount,
      meanObservedReward,
      weights,
    };
  }
}
