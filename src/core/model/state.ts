/**
 * Agent state domain types — expanded.
 *
 * "The agent is not a persistent conversation. The agent is a stateful,
 * evidence-driven state machine."
 *
 * This module defines the 14 canonical phases of the agent, the events
 * that trigger transitions between them, and the state / transition
 * value objects that make every move auditable.
 *
 * IMPORTANT: The LLM must never directly set an arbitrary terminal state.
 * All transitions pass through the transition validator.
 */
import type { StateId, TaskId, IterationId, EvidenceId } from '../types/identifiers.js';

// ---------------------------------------------------------------------------
// Agent phase — the 14 canonical states of the state machine
// ---------------------------------------------------------------------------

export enum AgentPhase {
  /** Initial state — goal accepted, no work started. */
  INIT = 'INIT',

  /** Exploring the problem space, reading files, building understanding. */
  EXPLORE = 'EXPLORE',

  /** Formulating a plan / hypothesis for how to solve the task. */
  PLAN = 'PLAN',

  /** Executing the plan — writing code, running tools. */
  IMPLEMENT = 'IMPLEMENT',

  /** Running verification — tests, lint, build, type-check. */
  VERIFY = 'VERIFY',

  /** Fixing failures found during verification. */
  REPAIR = 'REPAIR',

  /** Task completed successfully — terminal state. */
  DONE = 'DONE',

  /** Waiting on external input — tool unavailable, dependency, etc. */
  BLOCKED = 'BLOCKED',

  /** Escalated to a human — terminal until human responds. */
  HUMAN_REQUIRED = 'HUMAN_REQUIRED',

  /** Cost or iteration budget exhausted — terminal. */
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',

  /** Verification showed previously-passing checks now fail — terminal. */
  REGRESSION_DETECTED = 'REGRESSION_DETECTED',

  /** Agent is cycling between the same states without progress — terminal. */
  OSCILLATION_DETECTED = 'OSCILLATION_DETECTED',

  /** Externally cancelled — terminal. */
  CANCELLED = 'CANCELLED',

  /** Unrecoverable failure — terminal. */
  FAILED = 'FAILED',
}

// ---------------------------------------------------------------------------
// Terminal phase set — no transitions out of these phases
// ---------------------------------------------------------------------------

export const TERMINAL_PHASES: ReadonlySet<AgentPhase> = new Set([
  AgentPhase.DONE,
  AgentPhase.BUDGET_EXCEEDED,
  AgentPhase.REGRESSION_DETECTED,
  AgentPhase.OSCILLATION_DETECTED,
  AgentPhase.CANCELLED,
  AgentPhase.FAILED,
]);

// ---------------------------------------------------------------------------
// Phases that can be resumed after human intervention
// ---------------------------------------------------------------------------

export const HUMAN_RESUMABLE_PHASES: ReadonlySet<AgentPhase> = new Set([
  AgentPhase.HUMAN_REQUIRED,
  AgentPhase.BLOCKED,
]);

// ---------------------------------------------------------------------------
// State events — triggers for transitions
// ---------------------------------------------------------------------------

export enum StateEvent {
  // Lifecycle
  START = 'START',
  CANCEL = 'CANCEL',

  // Planning
  EXPLORE_COMPLETE = 'EXPLORE_COMPLETE',
  PLAN_READY = 'PLAN_READY',

  // Execution
  IMPLEMENTATION_COMPLETE = 'IMPLEMENTATION_COMPLETE',

  // Verification
  VERIFICATION_PASSED = 'VERIFICATION_PASSED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',

  // Repair
  REPAIR_COMPLETE = 'REPAIR_COMPLETE',

  // Blocking — runtime-only, fired when a required resource is unavailable
  BLOCK = 'BLOCK',

  // Human
  ESCALATE = 'ESCALATE',
  HUMAN_RESPONDED = 'HUMAN_RESPONDED',
  UNBLOCK = 'UNBLOCK',

  // Loop control (runtime-generated, never LLM-generated)
  BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
  REGRESSION_FOUND = 'REGRESSION_FOUND',
  OSCILLATION_FOUND = 'OSCILLATION_FOUND',
  NO_PROGRESS = 'NO_PROGRESS',
  MAX_REPAIRS_EXCEEDED = 'MAX_REPAIRS_EXCEEDED',

  // Terminal
  MARK_DONE = 'MARK_DONE',
  MARK_FAILED = 'MARK_FAILED',

  // Re-entry
  RETRY = 'RETRY',
  RESET_TO_EXPLORE = 'RESET_TO_EXPLORE',
}

// ---------------------------------------------------------------------------
// Events that only the runtime (never the LLM) may emit
// ---------------------------------------------------------------------------

export const RUNTIME_ONLY_EVENTS: ReadonlySet<StateEvent> = new Set([
  StateEvent.BUDGET_EXHAUSTED,
  StateEvent.REGRESSION_FOUND,
  StateEvent.OSCILLATION_FOUND,
  StateEvent.NO_PROGRESS,
  StateEvent.MAX_REPAIRS_EXCEEDED,
  StateEvent.CANCEL,
  StateEvent.BLOCK, // Blocking is a runtime decision, not an LLM decision
  StateEvent.MARK_DONE, // Marking done is a runtime verification decision, not an LLM decision
  StateEvent.VERIFICATION_PASSED, // Verification passed is an empirical test outcome, not an LLM decision
]);

// ---------------------------------------------------------------------------
// Agent state — immutable snapshot of where the agent is
// ---------------------------------------------------------------------------

export interface AgentState {
  readonly id: StateId;
  readonly taskId: TaskId;
  readonly phase: AgentPhase;
  readonly previousPhase: AgentPhase | null;
  readonly iterationId: IterationId;
  readonly iterationCount: number;
  readonly repairCount: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ---------------------------------------------------------------------------
// State transition — an immutable, recorded move between phases
// ---------------------------------------------------------------------------

export interface StateTransition {
  readonly id: string;
  readonly from: AgentPhase;
  readonly to: AgentPhase;
  readonly event: StateEvent;
  readonly timestamp: Date;
  readonly stateId: StateId;
  readonly evidenceIds: ReadonlyArray<EvidenceId>;
  readonly metadata: Readonly<Record<string, unknown>>;
}
