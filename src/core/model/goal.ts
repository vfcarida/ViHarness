/**
 * Goal domain type.
 *
 * A Goal is the top-level unit of work. It comes from the user, CI, or IDE.
 * Goals decompose into Tasks. Goals carry constraints (budget, time, policy).
 */
import type { GoalId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Goal status
// ---------------------------------------------------------------------------

export enum GoalStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ---------------------------------------------------------------------------
// Goal constraints — bounds on how the goal may be pursued
// ---------------------------------------------------------------------------

export interface GoalConstraints {
  /** Maximum number of agent iterations. */
  readonly maxIterations: number;

  /** Maximum cost in dollars (across all model calls). */
  readonly maxCostDollars: number;

  /** Maximum wall-clock duration in milliseconds. */
  readonly maxDurationMs: number;

  /**
   * Absolute deadline expressed as a duration in milliseconds from goal creation.
   * Semantically equivalent to `maxDurationMs` but named to align with TBench task timeout field.
   */
  readonly deadlineMs?: number;

  /** Maximum consecutive repair attempts before escalating. */
  readonly maxRepairAttempts: number;

  /** Maximum consecutive no-progress iterations before terminating. */
  readonly maxNoProgressIterations: number;

  /** Whether to allow the agent to proceed to DONE without verification. */
  readonly requireVerification: boolean;

  /** Whether to enforce autonomous Test-Driven Development (Red-Green reproducer verification). */
  readonly requireTdd?: boolean;
}

// ---------------------------------------------------------------------------
// Default constraints — conservative defaults
// ---------------------------------------------------------------------------

export const DEFAULT_GOAL_CONSTRAINTS: Readonly<GoalConstraints> = {
  maxIterations: 50,
  maxCostDollars: 10.0,
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
  maxRepairAttempts: 5,
  maxNoProgressIterations: 3,
  requireVerification: true,
};

// ---------------------------------------------------------------------------
// Goal — the top-level work unit
// ---------------------------------------------------------------------------

export interface Goal {
  readonly id: GoalId;
  readonly description: string;
  readonly constraints: GoalConstraints;
  readonly status: GoalStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}
