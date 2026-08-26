/**
 * Transition table — the explicit, exhaustive whitelist of valid state transitions.
 *
 * INVARIANT: If a (from, event) → to mapping is not in this table,
 * the transition is INVALID and will be rejected by the validator.
 *
 * The LLM must never directly set an arbitrary terminal state.
 * All terminal states are reached through explicit events.
 */
import { AgentPhase, StateEvent } from '../model/state.js';

// ---------------------------------------------------------------------------
// Transition rule — a single allowed transition
// ---------------------------------------------------------------------------

export interface TransitionRule {
  readonly from: AgentPhase;
  readonly event: StateEvent;
  readonly to: AgentPhase;
}

// ---------------------------------------------------------------------------
// Canonical transition table
// ---------------------------------------------------------------------------

export const TRANSITION_TABLE: ReadonlyArray<TransitionRule> = [
  // === INIT ===
  { from: AgentPhase.INIT, event: StateEvent.START, to: AgentPhase.EXPLORE },
  { from: AgentPhase.INIT, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },

  // === EXPLORE ===
  { from: AgentPhase.EXPLORE, event: StateEvent.EXPLORE_COMPLETE, to: AgentPhase.PLAN },
  { from: AgentPhase.EXPLORE, event: StateEvent.PLAN_READY, to: AgentPhase.IMPLEMENT },
  { from: AgentPhase.EXPLORE, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.EXPLORE, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.EXPLORE, event: StateEvent.BUDGET_EXHAUSTED, to: AgentPhase.BUDGET_EXCEEDED },

  // === PLAN ===
  { from: AgentPhase.PLAN, event: StateEvent.PLAN_READY, to: AgentPhase.IMPLEMENT },
  { from: AgentPhase.PLAN, event: StateEvent.RESET_TO_EXPLORE, to: AgentPhase.EXPLORE },
  { from: AgentPhase.PLAN, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.PLAN, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.PLAN, event: StateEvent.BUDGET_EXHAUSTED, to: AgentPhase.BUDGET_EXCEEDED },

  // === IMPLEMENT ===
  { from: AgentPhase.IMPLEMENT, event: StateEvent.IMPLEMENTATION_COMPLETE, to: AgentPhase.VERIFY },
  { from: AgentPhase.IMPLEMENT, event: StateEvent.BLOCK, to: AgentPhase.BLOCKED },
  { from: AgentPhase.IMPLEMENT, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.IMPLEMENT, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  {
    from: AgentPhase.IMPLEMENT,
    event: StateEvent.BUDGET_EXHAUSTED,
    to: AgentPhase.BUDGET_EXCEEDED,
  },
  {
    from: AgentPhase.IMPLEMENT,
    event: StateEvent.REGRESSION_FOUND,
    to: AgentPhase.REGRESSION_DETECTED,
  },
  { from: AgentPhase.IMPLEMENT, event: StateEvent.MARK_FAILED, to: AgentPhase.FAILED },

  // === VERIFY ===
  { from: AgentPhase.VERIFY, event: StateEvent.VERIFICATION_PASSED, to: AgentPhase.DONE },
  { from: AgentPhase.VERIFY, event: StateEvent.VERIFICATION_FAILED, to: AgentPhase.REPAIR },
  { from: AgentPhase.VERIFY, event: StateEvent.BLOCK, to: AgentPhase.BLOCKED },
  { from: AgentPhase.VERIFY, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  {
    from: AgentPhase.VERIFY,
    event: StateEvent.REGRESSION_FOUND,
    to: AgentPhase.REGRESSION_DETECTED,
  },
  { from: AgentPhase.VERIFY, event: StateEvent.NO_PROGRESS, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.VERIFY, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.VERIFY, event: StateEvent.BUDGET_EXHAUSTED, to: AgentPhase.BUDGET_EXCEEDED },
  { from: AgentPhase.VERIFY, event: StateEvent.MARK_DONE, to: AgentPhase.DONE },

  // === REPAIR ===
  { from: AgentPhase.REPAIR, event: StateEvent.REPAIR_COMPLETE, to: AgentPhase.VERIFY },
  { from: AgentPhase.REPAIR, event: StateEvent.RESET_TO_EXPLORE, to: AgentPhase.EXPLORE },
  { from: AgentPhase.REPAIR, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  {
    from: AgentPhase.REPAIR,
    event: StateEvent.MAX_REPAIRS_EXCEEDED,
    to: AgentPhase.HUMAN_REQUIRED,
  },
  {
    from: AgentPhase.REPAIR,
    event: StateEvent.OSCILLATION_FOUND,
    to: AgentPhase.OSCILLATION_DETECTED,
  },
  { from: AgentPhase.REPAIR, event: StateEvent.NO_PROGRESS, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.REPAIR, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.REPAIR, event: StateEvent.BUDGET_EXHAUSTED, to: AgentPhase.BUDGET_EXCEEDED },
  {
    from: AgentPhase.REPAIR,
    event: StateEvent.REGRESSION_FOUND,
    to: AgentPhase.REGRESSION_DETECTED,
  },
  { from: AgentPhase.REPAIR, event: StateEvent.MARK_FAILED, to: AgentPhase.FAILED },

  // === BLOCKED ===
  { from: AgentPhase.BLOCKED, event: StateEvent.UNBLOCK, to: AgentPhase.IMPLEMENT },
  { from: AgentPhase.BLOCKED, event: StateEvent.ESCALATE, to: AgentPhase.HUMAN_REQUIRED },
  { from: AgentPhase.BLOCKED, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.BLOCKED, event: StateEvent.BUDGET_EXHAUSTED, to: AgentPhase.BUDGET_EXCEEDED },

  // === HUMAN_REQUIRED ===
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.HUMAN_RESPONDED, to: AgentPhase.PLAN },
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.RETRY, to: AgentPhase.REPAIR },
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.RESET_TO_EXPLORE, to: AgentPhase.EXPLORE },
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.CANCEL, to: AgentPhase.CANCELLED },
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.MARK_DONE, to: AgentPhase.DONE },
  { from: AgentPhase.HUMAN_REQUIRED, event: StateEvent.MARK_FAILED, to: AgentPhase.FAILED },

  // === Terminal states have NO outbound transitions. ===
  // DONE, BUDGET_EXCEEDED, REGRESSION_DETECTED, OSCILLATION_DETECTED,
  // CANCELLED, FAILED — intentionally absent from `from` column.
];

// ---------------------------------------------------------------------------
// Lookup index — built once for O(1) validation
// ---------------------------------------------------------------------------

function buildTransitionIndex(
  rules: ReadonlyArray<TransitionRule>,
): ReadonlyMap<string, AgentPhase> {
  const index = new Map<string, AgentPhase>();
  for (const rule of rules) {
    const key = `${rule.from}::${rule.event}`;
    index.set(key, rule.to);
  }
  return index;
}

/** O(1) lookup: (from, event) → to phase, or undefined if invalid. */
export const TRANSITION_INDEX: ReadonlyMap<string, AgentPhase> =
  buildTransitionIndex(TRANSITION_TABLE);

/**
 * Look up the target phase for a given (from, event) pair.
 * Returns undefined if the transition is not in the whitelist.
 */
export function lookupTransition(from: AgentPhase, event: StateEvent): AgentPhase | undefined {
  return TRANSITION_INDEX.get(`${from}::${event}`);
}
