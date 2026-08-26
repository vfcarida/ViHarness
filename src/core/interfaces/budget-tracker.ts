/**
 * BudgetTracker Interface.
 *
 * Enforces per-task and per-model financial budgets.
 */
import type { TaskId } from '../types/identifiers.js';
import type { BudgetCheckResult, BudgetConfig } from '../model/cost-types.js';

export interface BudgetTracker {
  /** Check if incurring additional cost violates task or model budgets. */
  checkBudget(taskId: TaskId, modelId: string, additionalCostUSD: number): BudgetCheckResult;

  /** Record cost usage for a task and model. */
  recordUsage(taskId: TaskId, modelId: string, costUSD: number): void;

  /** Set budget limit for a specific task. */
  setTaskBudget(taskId: TaskId, budgetUSD: number): void;

  /** Set budget limit for a specific model ID. */
  setModelBudget(modelId: string, budgetUSD: number): void;

  /** Configure default budget rules. */
  configure(config: BudgetConfig): void;
}
