/**
 * Adaptive Context Budget Allocator.
 *
 * Dynamically scales token budgets based on task complexity, preventing expensive
 * over-allocation for simple bug fixes while ensuring deep context for multi-file refactors.
 */
import { BaselineScenarioCategory } from '../../core/model/benchmark-types.js';
import type { ContextBudget } from '../../core/model/compiler-types.js';

export class AdaptiveContextBudget {
  /**
   * Compute adaptive token budget for context compilation.
   */
  static computeBudget(
    category: BaselineScenarioCategory,
    iteration: number,
    modelMaxTokens = 128000,
  ): ContextBudget {
    let targetTokens = 8000;

    switch (category) {
      case BaselineScenarioCategory.SMALL_BUG:
        targetTokens = 4000;
        break;
      case BaselineScenarioCategory.TEST_REPAIR:
        targetTokens = 6000;
        break;
      case BaselineScenarioCategory.MEDIUM_FEATURE:
        targetTokens = 8000;
        break;
      case BaselineScenarioCategory.SECURITY_SENSITIVE_CHANGE:
        targetTokens = 10000;
        break;
      case BaselineScenarioCategory.REGRESSION_REPAIR:
        targetTokens = 12000;
        break;
      case BaselineScenarioCategory.MULTI_FILE_REFACTOR:
        targetTokens = 16000;
        break;
      case BaselineScenarioCategory.LONG_DEBUGGING_TASK:
        targetTokens = Math.min(24000 + iteration * 1000, 32000);
        break;
    }

    const totalBudgetTokens = Math.min(targetTokens, modelMaxTokens);

    return {
      maxTokens: totalBudgetTokens,
      softLimitTokens: Math.floor(totalBudgetTokens * 0.8),
      tierBudgets: {
        system: Math.floor(totalBudgetTokens * 0.2),
        task: Math.floor(totalBudgetTokens * 0.25),
        observation: Math.floor(totalBudgetTokens * 0.35),
        memory: Math.floor(totalBudgetTokens * 0.2),
      },
    };
  }
}
