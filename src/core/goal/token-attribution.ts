// Pattern: Goal budgets & token attribution (ref: Prime Agent)
/**
 * Subagent Token Attribution & Hierarchical Tree (from Prime Agent).
 *
 * Implements tree-wide token and cost attribution for subagents:
 * - When a subagent completes, its usage is attributed to the parent turn that spawned it.
 * - Builds a hierarchical `TokenTree` separating own usage from children usage.
 * - Guarantees tree reconcilability: `tree.totalTokens === sum(all nodes.tokensOwn)`.
 */
import type { ExecutionId, GoalId } from '../types/identifiers.js';

export interface TokenAttribution {
  readonly parentExecutionId: ExecutionId;
  readonly parentTurn: number;
  readonly childExecutionId: ExecutionId;
  readonly childGoalId?: GoalId;
  readonly childTotalTokens: number;
  readonly childTotalCost: number;
  readonly childRounds: number;
}

export interface TokenNode {
  readonly executionId: ExecutionId;
  readonly goalId?: GoalId;
  readonly tokensOwn: number;
  tokensChildren: number;
  readonly costOwn: number;
  costChildren: number;
  readonly children: TokenNode[];
}

export interface TokenTree {
  readonly root: TokenNode;
  readonly totalTokens: number;
  readonly totalCost: number;
}

export interface ReconcileResult {
  readonly isReconciled: boolean;
  readonly totalTokensTree: number;
  readonly totalTokensOwnSum: number;
  readonly totalCostTree: number;
  readonly totalCostOwnSum: number;
}

export class TokenAttributionTracker {
  private readonly attributions = new Map<ExecutionId, TokenAttribution[]>();
  private readonly childNodeMap = new Map<
    ExecutionId,
    { tokensOwn: number; costOwn: number; goalId?: GoalId }
  >();

  /**
   * Record a completed subagent's token and cost attribution to its parent execution.
   */
  recordAttribution(attribution: TokenAttribution): void {
    const list = this.attributions.get(attribution.parentExecutionId) ?? [];
    list.push(attribution);
    this.attributions.set(attribution.parentExecutionId, list);

    this.childNodeMap.set(attribution.childExecutionId, {
      tokensOwn: attribution.childTotalTokens,
      costOwn: attribution.childTotalCost,
      goalId: attribution.childGoalId,
    });
  }

  /**
   * Build a hierarchical TokenTree starting from the root execution.
   */
  buildTree(root: {
    executionId: ExecutionId;
    tokensOwn: number;
    costOwn: number;
    goalId?: GoalId;
  }): TokenTree {
    const rootNode: TokenNode = {
      executionId: root.executionId,
      goalId: root.goalId,
      tokensOwn: root.tokensOwn,
      tokensChildren: 0,
      costOwn: root.costOwn,
      costChildren: 0,
      children: [],
    };

    this.populateChildren(rootNode);

    const totalTokens = rootNode.tokensOwn + rootNode.tokensChildren;
    const totalCost = rootNode.costOwn + rootNode.costChildren;

    return {
      root: rootNode,
      totalTokens,
      totalCost,
    };
  }

  private populateChildren(parent: TokenNode): void {
    const directChildren = this.attributions.get(parent.executionId) ?? [];

    for (const attr of directChildren) {
      const childData = this.childNodeMap.get(attr.childExecutionId);
      const tokensOwn = childData ? childData.tokensOwn : attr.childTotalTokens;
      const costOwn = childData ? childData.costOwn : attr.childTotalCost;

      const childNode: TokenNode = {
        executionId: attr.childExecutionId,
        goalId: attr.childGoalId ?? childData?.goalId,
        tokensOwn,
        tokensChildren: 0,
        costOwn,
        costChildren: 0,
        children: [],
      };

      // Recurse for nested child subagents
      this.populateChildren(childNode);

      parent.children.push(childNode);
      parent.tokensChildren += childNode.tokensOwn + childNode.tokensChildren;
      parent.costChildren += childNode.costOwn + childNode.costChildren;
    }
  }

  /**
   * Statically reconciles a TokenTree by summing all nodes' `tokensOwn` and `costOwn`
   * and asserting exact match with `tree.totalTokens` and `tree.totalCost`.
   */
  static reconcileTree(tree: TokenTree): ReconcileResult {
    let totalTokensOwnSum = 0;
    let totalCostOwnSum = 0;

    function traverse(node: TokenNode): void {
      totalTokensOwnSum += node.tokensOwn;
      totalCostOwnSum += node.costOwn;
      for (const child of node.children) {
        traverse(child);
      }
    }

    traverse(tree.root);

    const tokensMatch = totalTokensOwnSum === tree.totalTokens;
    const costMatch = Math.abs(totalCostOwnSum - tree.totalCost) < 1e-6;

    return {
      isReconciled: tokensMatch && costMatch,
      totalTokensTree: tree.totalTokens,
      totalTokensOwnSum,
      totalCostTree: tree.totalCost,
      totalCostOwnSum,
    };
  }
}
