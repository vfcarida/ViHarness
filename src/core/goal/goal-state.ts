/**
 * Goal State Machine & Domain Types.
 *
 * Implements DeepSeek Harness and Prime Agent goal lifecycle:
 * - Monotonic revisions for Compare-And-Set (CAS) concurrency control.
 * - Goal phases: active -> paused -> blocked -> completed -> cleared.
 * - Multi-dimensional budgets: tokenBudget, costBudget, maxRounds.
 * - Policy-owned lower-kebab-case blocker codes with human-readable explanations.
 */
import type { GoalId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Goal Phases
// ---------------------------------------------------------------------------

export type GoalPhase = 'active' | 'paused' | 'blocked' | 'completed' | 'cleared';

// ---------------------------------------------------------------------------
// Standard Blocker Codes (from DeepSeek Harness)
// ---------------------------------------------------------------------------

export type BlockerCode =
  | 'provider-limit' // Context window or provider rate limit exceeded
  | 'budget-exhausted' // Token, cost, or round budget hit
  | 'execution-error' // Unrecoverable tool/runtime failure
  | 'human-input-needed' // Requires user intervention/clarification
  | 'dependency-blocked' // Waiting on external system or parent task
  | string;

// ---------------------------------------------------------------------------
// Compare-and-set fence (from DSH)
// ---------------------------------------------------------------------------

export interface GoalRef {
  readonly id: GoalId;
  readonly revision: number;
}

// ---------------------------------------------------------------------------
// Lifecycle Goal Model
// ---------------------------------------------------------------------------

export interface LifecycleGoal {
  readonly id: GoalId;
  readonly revision: number; // Monotonic, for compare-and-set
  readonly description: string;
  readonly phase: GoalPhase;

  // Budgets (from Prime Agent)
  readonly tokenBudget?: number;
  readonly costBudget?: number;
  readonly maxRounds: number; // From DSH (default: 256)

  // Tracking
  readonly roundsStarted: number;
  readonly tokensUsed: number;
  readonly costUsed: number;

  // Blocking (from DSH)
  readonly blockerCode?: BlockerCode;
  readonly blockerReason?: string;

  readonly createdAt: number;
  readonly updatedAt: number;
}

export const DEFAULT_MAX_ROUNDS = 256;

// ---------------------------------------------------------------------------
// Phase Transition Rules
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Readonly<Record<GoalPhase, ReadonlySet<GoalPhase>>> = {
  active: new Set<GoalPhase>(['paused', 'blocked', 'completed', 'cleared', 'active']),
  paused: new Set<GoalPhase>(['active', 'completed', 'cleared', 'paused']),
  blocked: new Set<GoalPhase>(['active', 'completed', 'cleared', 'blocked']),
  completed: new Set<GoalPhase>(['cleared', 'completed']),
  cleared: new Set<GoalPhase>(['cleared']),
};

export function canTransitionGoalPhase(from: GoalPhase, to: GoalPhase): boolean {
  const allowed = LEGAL_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}
