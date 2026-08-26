// Pattern: Goal budgets & token attribution (ref: Prime Agent)
/**
 * Default Budget Tracker.
 *
 * Implements BudgetTracker interface:
 * Enforces per-task and per-model financial budgets, emitting warnings at configurable thresholds
 * (default 80%) and disallowing execution when budget limits are exceeded.
 */
import type { BudgetTracker } from '../../core/interfaces/budget-tracker.js';
import type { TaskId } from '../../core/types/identifiers.js';
import type { BudgetCheckResult, BudgetConfig } from '../../core/model/cost-types.js';

export class DefaultBudgetTracker implements BudgetTracker {
  private readonly taskBudgets = new Map<TaskId, number>();
  private readonly modelBudgets = new Map<string, number>();
  private readonly taskCosts = new Map<TaskId, number>();
  private readonly modelCosts = new Map<string, number>();
  private warningThreshold = 0.8;

  constructor(config?: BudgetConfig) {
    if (config) {
      this.configure(config);
    }
  }

  configure(config: BudgetConfig): void {
    if (config.warningThreshold !== undefined) {
      this.warningThreshold = config.warningThreshold;
    }
    if (config.modelBudgetUSD) {
      for (const [model, budget] of Object.entries(config.modelBudgetUSD)) {
        this.modelBudgets.set(model.toLowerCase(), budget);
      }
    }
  }

  setTaskBudget(taskId: TaskId, budgetUSD: number): void {
    this.taskBudgets.set(taskId, budgetUSD);
  }

  setModelBudget(modelId: string, budgetUSD: number): void {
    this.modelBudgets.set(modelId.toLowerCase(), budgetUSD);
  }

  recordUsage(taskId: TaskId, modelId: string, costUSD: number): void {
    const taskCurrent = this.taskCosts.get(taskId) ?? 0;
    this.taskCosts.set(taskId, taskCurrent + costUSD);

    const modelKey = modelId.toLowerCase();
    const modelCurrent = this.modelCosts.get(modelKey) ?? 0;
    this.modelCosts.set(modelKey, modelCurrent + costUSD);
  }

  checkBudget(taskId: TaskId, modelId: string, additionalCostUSD: number): BudgetCheckResult {
    const currentTaskCost = this.taskCosts.get(taskId) ?? 0;
    const newTaskCost = currentTaskCost + additionalCostUSD;
    const taskBudget = this.taskBudgets.get(taskId);

    const modelKey = modelId.toLowerCase();
    const currentModelCost = this.modelCosts.get(modelKey) ?? 0;
    const newModelCost = currentModelCost + additionalCostUSD;
    const modelBudget = this.modelBudgets.get(modelKey);

    // 1. Check task budget limit
    if (taskBudget !== undefined) {
      if (newTaskCost > taskBudget) {
        return {
          allowed: false,
          warning: false,
          currentCostUSD: currentTaskCost,
          newCostUSD: newTaskCost,
          budgetUSD: taskBudget,
          errorMessage: `Task budget limit of $${taskBudget.toFixed(2)} exceeded (projected: $${newTaskCost.toFixed(2)})`,
        };
      }
      if (newTaskCost >= taskBudget * this.warningThreshold) {
        return {
          allowed: true,
          warning: true,
          currentCostUSD: currentTaskCost,
          newCostUSD: newTaskCost,
          budgetUSD: taskBudget,
          warningMessage: `Task budget warning: projected cost $${newTaskCost.toFixed(2)} reaches ${(this.warningThreshold * 100).toFixed(0)}% of $${taskBudget.toFixed(2)} limit`,
        };
      }
    }

    // 2. Check model budget limit
    if (modelBudget !== undefined) {
      if (newModelCost > modelBudget) {
        return {
          allowed: false,
          warning: false,
          currentCostUSD: currentModelCost,
          newCostUSD: newModelCost,
          budgetUSD: modelBudget,
          errorMessage: `Model [${modelId}] budget limit of $${modelBudget.toFixed(2)} exceeded (projected: $${newModelCost.toFixed(2)})`,
        };
      }
      if (newModelCost >= modelBudget * this.warningThreshold) {
        return {
          allowed: true,
          warning: true,
          currentCostUSD: currentModelCost,
          newCostUSD: newModelCost,
          budgetUSD: modelBudget,
          warningMessage: `Model [${modelId}] budget warning: projected cost $${newModelCost.toFixed(2)} reaches ${(this.warningThreshold * 100).toFixed(0)}% of $${modelBudget.toFixed(2)} limit`,
        };
      }
    }

    return {
      allowed: true,
      warning: false,
      currentCostUSD: currentTaskCost,
      newCostUSD: newTaskCost,
    };
  }
}
