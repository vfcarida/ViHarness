/**
 * Dual Model Cost Evaluator.
 *
 * Compares token consumption and cost between:
 * 1. Single Model (All-Frontier / Monolithic): 100% of iterations routed to expensive frontier model.
 * 2. Dual Model (Architect / Editor): Architect model on planning, Editor model on code generation/repair.
 *
 * Calculates quantitative token savings, dollar savings, and percentage reduction.
 */
import type { ModelDescriptor } from '../../core/model/model-io.js';
import type { IterationRecord } from '../../core/model/runtime-types.js';
import { AgentPhase } from '../../core/model/state.js';

export interface PhaseCostBreakdown {
  readonly sequenceNumber: number;
  readonly phase: AgentPhase;
  readonly modelRole: 'ARCHITECT' | 'EDITOR';
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly dualModelCostDollars: number;
  readonly monolithicCostDollars: number;
}

export interface DualModelEvaluationReport {
  readonly totalIterations: number;
  readonly dualModelTotalCostDollars: number;
  readonly monolithicTotalCostDollars: number;
  readonly dollarSavings: number;
  readonly costSavingsPercentage: number;
  readonly totalTokens: number;
  readonly phaseBreakdown: ReadonlyArray<PhaseCostBreakdown>;
  readonly summary: string;
}

export class DualModelCostEvaluator {
  /**
   * Evaluate cost savings of dual-model vs monolithic execution based on actual iteration records.
   */
  static evaluate(
    iterations: ReadonlyArray<IterationRecord>,
    architectDescriptor: ModelDescriptor,
    editorDescriptor: ModelDescriptor,
  ): DualModelEvaluationReport {
    let dualModelTotalCost = 0;
    let monolithicTotalCost = 0;
    let totalTokens = 0;
    const phaseBreakdown: PhaseCostBreakdown[] = [];

    for (const iter of iterations) {
      const usage = iter.tokenUsage ??
        (iter as any).tokensUsed ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const inputTokens = usage.inputTokens;
      const outputTokens = usage.outputTokens;
      const iterTokens = usage.totalTokens ?? inputTokens + outputTokens;
      totalTokens += iterTokens;

      const isArchitectPhase =
        iter.stateBefore === AgentPhase.PLAN || iter.stateAfter === AgentPhase.PLAN;

      const modelRole = isArchitectPhase ? 'ARCHITECT' : 'EDITOR';
      const activeDescriptor = isArchitectPhase ? architectDescriptor : editorDescriptor;

      // Dual model cost for this iteration
      const dualCost =
        (inputTokens / 1000) * activeDescriptor.costPer1kInputTokensDollars +
        (outputTokens / 1000) * activeDescriptor.costPer1kOutputTokensDollars;

      // Monolithic cost (always using high-end frontier architect model)
      const monoCost =
        (inputTokens / 1000) * architectDescriptor.costPer1kInputTokensDollars +
        (outputTokens / 1000) * architectDescriptor.costPer1kOutputTokensDollars;

      dualModelTotalCost += dualCost;
      monolithicTotalCost += monoCost;

      phaseBreakdown.push({
        sequenceNumber: iter.sequenceNumber,
        phase: iter.stateBefore,
        modelRole,
        modelId: activeDescriptor.id,
        inputTokens,
        outputTokens,
        totalTokens: iterTokens,
        dualModelCostDollars: dualCost,
        monolithicCostDollars: monoCost,
      });
    }

    const dollarSavings = Math.max(0, monolithicTotalCost - dualModelTotalCost);
    const costSavingsPercentage =
      monolithicTotalCost > 0 ? (dollarSavings / monolithicTotalCost) * 100 : 0;

    const summary =
      `Dual-Model Execution (${architectDescriptor.id} + ${editorDescriptor.id}): ` +
      `Total Cost: $${dualModelTotalCost.toFixed(4)} vs Monolithic ($${architectDescriptor.id}): $${monolithicTotalCost.toFixed(4)}. ` +
      `Cost Savings: $${dollarSavings.toFixed(4)} (${costSavingsPercentage.toFixed(1)}% reduction).`;

    return {
      totalIterations: iterations.length,
      dualModelTotalCostDollars: dualModelTotalCost,
      monolithicTotalCostDollars: monolithicTotalCost,
      dollarSavings,
      costSavingsPercentage,
      totalTokens,
      phaseBreakdown,
      summary,
    };
  }
}
