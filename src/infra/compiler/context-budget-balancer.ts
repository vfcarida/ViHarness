/**
 * Dynamic Context Budget Balancer.
 *
 * Implements phase-aware adaptive token allocation across the four context tiers (L0-L3)
 * inspired by Claude Code (arXiv:2604.14228) and Prime Agent.
 *
 * Tiers:
 * - L0: Hot state (active task, modified files, current error stack, immediate observation)
 * - L1: Working memory (current execution plan, active hypothesis, recent decision records)
 * - L2: Episodic history (prior iteration attempts, failure trajectories, historical tool results)
 * - L3: Repository knowledge (coding standards, architectural invariants, AST symbol map)
 */
import { ContextTier } from '../../core/model/context.js';
import { AgentPhase } from '../../core/model/state.js';

export interface TierAllocation {
  readonly maxTokens: number;
  readonly ratio: number;
  readonly minFloorTokens: number;
}

export interface BalancedContextBudget {
  readonly totalMaxTokens: number;
  readonly phase: AgentPhase | string;
  readonly allocations: Record<ContextTier, TierAllocation>;
}

export class ContextBudgetBalancer {
  /**
   * Compute optimal token allocations per tier based on agent phase and total token budget.
   */
  static balance(totalBudgetTokens: number, phase: AgentPhase | string): BalancedContextBudget {
    const total = Math.max(500, totalBudgetTokens);

    let l0Ratio = 0.35;
    let l1Ratio = 0.25;
    let l2Ratio = 0.15;
    let l3Ratio = 0.25;

    const normalizedPhase = String(phase).toUpperCase();

    if (normalizedPhase.includes('DISCOVER') || normalizedPhase.includes('PLAN')) {
      // Planning needs broad repo architecture and outline
      l0Ratio = 0.25;
      l1Ratio = 0.25;
      l2Ratio = 0.1;
      l3Ratio = 0.4;
    } else if (
      normalizedPhase.includes('ACT') ||
      normalizedPhase.includes('EXECUTE') ||
      normalizedPhase.includes('IMPLEMENT')
    ) {
      // Implementation needs deep focus on active files and current plan step
      l0Ratio = 0.45;
      l1Ratio = 0.25;
      l2Ratio = 0.1;
      l3Ratio = 0.2;
    } else if (normalizedPhase.includes('REPAIR') || normalizedPhase.includes('FIX')) {
      // Repair needs error stack traces, failure evidence, and prior failed attempts
      l0Ratio = 0.45;
      l1Ratio = 0.15;
      l2Ratio = 0.25;
      l3Ratio = 0.15;
    } else if (normalizedPhase.includes('VERIFY') || normalizedPhase.includes('ACCEPT')) {
      // Verification needs test evidence, diff summaries, and acceptance criteria
      l0Ratio = 0.4;
      l1Ratio = 0.3;
      l2Ratio = 0.1;
      l3Ratio = 0.2;
    }

    const minFloor = Math.max(50, Math.floor(total * 0.05));

    const allocations: Record<ContextTier, TierAllocation> = {
      [ContextTier.L0_HOT]: {
        maxTokens: Math.max(minFloor, Math.floor(total * l0Ratio)),
        ratio: l0Ratio,
        minFloorTokens: minFloor,
      },
      [ContextTier.L1_WORKING]: {
        maxTokens: Math.max(minFloor, Math.floor(total * l1Ratio)),
        ratio: l1Ratio,
        minFloorTokens: minFloor,
      },
      [ContextTier.L2_EPISODIC]: {
        maxTokens: Math.max(minFloor, Math.floor(total * l2Ratio)),
        ratio: l2Ratio,
        minFloorTokens: minFloor,
      },
      [ContextTier.L3_REPOSITORY]: {
        maxTokens: Math.max(minFloor, Math.floor(total * l3Ratio)),
        ratio: l3Ratio,
        minFloorTokens: minFloor,
      },
    };

    return {
      totalMaxTokens: total,
      phase,
      allocations,
    };
  }
}
