import { describe, it, expect, beforeEach } from 'vitest';
import { DefaultCostTracker } from '../../../src/infra/cost/default-cost-tracker.js';
import { DefaultBudgetTracker } from '../../../src/infra/cost/default-budget-tracker.js';
import { AdaptiveContextBudget } from '../../../src/infra/optimization/adaptive-context-budget.js';
import { BaselineScenarioCategory } from '../../../src/core/model/benchmark-types.js';
import type { TaskId } from '../../../src/core/types/identifiers.js';

describe('Cost, Budget & Adaptive Optimization Unit Suite', () => {
  describe('DefaultCostTracker', () => {
    let costTracker: DefaultCostTracker;
    const taskId1 = 'task-cost-1' as TaskId;
    const taskId2 = 'task-cost-2' as TaskId;

    beforeEach(() => {
      costTracker = new DefaultCostTracker();
    });

    it('1. Calculates pricing for known default models (GPT-4o, Claude 3.5 Sonnet)', () => {
      const estimateGpt4o = costTracker.calculateCost('openai', 'gpt-4o', 1000, 500);
      expect(estimateGpt4o.hasPricing).toBe(true);
      expect(estimateGpt4o.estimatedCostUSD).toBeGreaterThan(0);

      const estimateSonnet = costTracker.calculateCost(
        'anthropic',
        'claude-3-5-sonnet',
        2000,
        1000,
      );
      expect(estimateSonnet.hasPricing).toBe(true);
      expect(estimateSonnet.estimatedCostUSD).toBeGreaterThan(0);
    });

    it('2. Gracefully handles unregistered models by returning 0.0 with hasPricing: false', () => {
      const estimateUnknown = costTracker.calculateCost(
        'custom',
        'unregistered-model-xyz',
        5000,
        2000,
      );
      expect(estimateUnknown.hasPricing).toBe(false);
      expect(estimateUnknown.estimatedCostUSD).toBe(0.0);
    });

    it('3. Supports custom pricing registration and overrides', () => {
      costTracker.registerPricing('custom-cheap-llm', {
        promptPricePerMillion: 1.0,
        completionPricePerMillion: 2.0,
      });

      const estimate = costTracker.calculateCost(
        'custom',
        'custom-cheap-llm',
        1_000_000,
        1_000_000,
      );
      expect(estimate.hasPricing).toBe(true);
      expect(estimate.estimatedCostUSD).toBeCloseTo(3.0, 4);
    });

    it('4. Accumulates costs per task and across all tasks', () => {
      costTracker.recordCost(taskId1, 'openai', 'gpt-4o', 0.05);
      costTracker.recordCost(taskId1, 'openai', 'gpt-4o', 0.03);
      costTracker.recordCost(taskId2, 'anthropic', 'claude-3-5-sonnet', 0.12);

      expect(costTracker.getTotalCost(taskId1)).toBeCloseTo(0.08, 4);
      expect(costTracker.getTotalCost(taskId2)).toBeCloseTo(0.12, 4);
      expect(costTracker.getTotalCost()).toBeCloseTo(0.2, 4);
    });
  });

  describe('DefaultBudgetTracker', () => {
    let budgetTracker: DefaultBudgetTracker;
    const taskId = 'task-budget-1' as TaskId;

    beforeEach(() => {
      budgetTracker = new DefaultBudgetTracker({
        warningThreshold: 0.8,
        modelBudgetUSD: {
          'gpt-4o': 1.0,
        },
      });
      budgetTracker.setTaskBudget(taskId, 0.5); // $0.50 task budget
    });

    it('5. Allows execution below warning threshold', () => {
      const check = budgetTracker.checkBudget(taskId, 'gpt-4o', 0.2);
      expect(check.allowed).toBe(true);
      expect(check.warning).toBe(false);
    });

    it('6. Dispatches warning when projected cost reaches warningThreshold (80%)', () => {
      // 0.40 / 0.50 = 80%
      const check = budgetTracker.checkBudget(taskId, 'gpt-4o', 0.4);
      expect(check.allowed).toBe(true);
      expect(check.warning).toBe(true);
      expect(check.warningMessage).toContain('80%');
    });

    it('7. Disallows execution when projected cost exceeds budget limit', () => {
      // Record 0.35 usage first
      budgetTracker.recordUsage(taskId, 'gpt-4o', 0.35);

      // Next call would add 0.20 -> projected 0.55 > 0.50
      const check = budgetTracker.checkBudget(taskId, 'gpt-4o', 0.2);
      expect(check.allowed).toBe(false);
      expect(check.errorMessage).toContain('Task budget limit');
    });

    it('8. Enforces model-specific budget limits', () => {
      const task2 = 'task-budget-2' as TaskId;
      budgetTracker.setTaskBudget(task2, 10.0); // high task budget

      // Model limit for gpt-4o is $1.00
      budgetTracker.recordUsage(task2, 'gpt-4o', 0.9);
      const check = budgetTracker.checkBudget(task2, 'gpt-4o', 0.15); // 0.90 + 0.15 = 1.05 > 1.00
      expect(check.allowed).toBe(false);
      expect(check.errorMessage).toContain('Model [gpt-4o] budget limit');
    });
  });

  describe('AdaptiveContextBudget', () => {
    it('9. Scales token budget based on scenario category and bounds to modelMaxTokens', () => {
      const smallBug = AdaptiveContextBudget.computeBudget(BaselineScenarioCategory.SMALL_BUG, 1);
      expect(smallBug.maxTokens).toBe(4000);
      expect(smallBug.softLimitTokens).toBe(3200);

      const refactor = AdaptiveContextBudget.computeBudget(
        BaselineScenarioCategory.MULTI_FILE_REFACTOR,
        1,
      );
      expect(refactor.maxTokens).toBe(16000);

      const boundedSmallModel = AdaptiveContextBudget.computeBudget(
        BaselineScenarioCategory.MULTI_FILE_REFACTOR,
        1,
        8000,
      );
      expect(boundedSmallModel.maxTokens).toBe(8000);
    });
  });
});
