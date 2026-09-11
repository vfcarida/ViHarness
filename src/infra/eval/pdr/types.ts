/**
 * Parallel-Distill-Refine (PDR) Types for Test-Time Compute Scaling.
 *
 * Implements SOTA 2026 Test-Time Compute / Sequential Rollout Scaling:
 * Trajectory distillation across speculative rollouts prevents duplicate exploratory errors
 * and accelerates convergence.
 */

export interface RolloutFinding {
  readonly rolloutIndex: number;
  readonly workspacePath: string;
  readonly success: boolean;
  readonly failedCommands: ReadonlyArray<string>;
  readonly errorSnippets: ReadonlyArray<string>;
  readonly modifiedFiles: ReadonlyArray<string>;
  readonly compilerWarnings: number;
  readonly testPassRate: number;
  readonly distilledSummary: string;
}

export interface BlackboardReport {
  readonly totalRolloutsRecorded: number;
  readonly findings: ReadonlyArray<RolloutFinding>;
  readonly injectedGuidance: string;
}
