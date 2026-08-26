/**
 * Context Budget Balancer Unit Tests.
 *
 * Verifies phase-adaptive token distribution between L0, L1, L2, and L3 context tiers.
 */
import { describe, it, expect } from 'vitest';
import { ContextBudgetBalancer } from '../../../src/infra/index.js';
import { ContextTier } from '../../../src/core/index.js';

describe('ContextBudgetBalancer Unit Tests', () => {
  it('allocates larger repository (L3) share during DISCOVER and PLAN phases', () => {
    const budget = ContextBudgetBalancer.balance(8000, 'PLAN');
    expect(budget.totalMaxTokens).toBe(8000);
    expect(budget.allocations[ContextTier.L3_REPOSITORY].ratio).toBe(0.4);
    expect(budget.allocations[ContextTier.L3_REPOSITORY].maxTokens).toBe(3200);
  });

  it('allocates larger hot state (L0) and error share during REPAIR and FIX phases', () => {
    const budget = ContextBudgetBalancer.balance(10000, 'REPAIR');
    expect(budget.allocations[ContextTier.L0_HOT].ratio).toBe(0.45);
    expect(budget.allocations[ContextTier.L0_HOT].maxTokens).toBe(4500);
    expect(budget.allocations[ContextTier.L2_EPISODIC].ratio).toBe(0.25);
  });

  it('enforces non-starvation minimum floor tokens across all tiers', () => {
    const budget = ContextBudgetBalancer.balance(1000, 'ACT');
    for (const tier of Object.values(ContextTier)) {
      expect(budget.allocations[tier].maxTokens).toBeGreaterThanOrEqual(
        budget.allocations[tier].minFloorTokens,
      );
    }
  });
});
