/**
 * Domain identifier types.
 *
 * All identifiers are branded strings backed by UUIDv7 at runtime.
 * The IdFactory interface abstracts generation so the implementation
 * (UUIDv7 today) can be replaced without changing domain models.
 */
import type { Brand } from './branded.js';

// ---------------------------------------------------------------------------
// Generic branded identifier
// ---------------------------------------------------------------------------

/** A branded string identifier parameterized by entity type. */
export type Id<T extends string = string> = Brand<string, T>;

// ---------------------------------------------------------------------------
// Domain-specific identifier types
// ---------------------------------------------------------------------------

export type TaskId = Id<'Task'>;
export type GoalId = Id<'Goal'>;
export type ExecutionId = Id<'Execution'>;
export type StateId = Id<'State'>;
export type ContextId = Id<'Context'>;
export type CheckpointId = Id<'Checkpoint'>;
export type EvidenceId = Id<'Evidence'>;
export type TraceId = Id<'Trace'>;
export type IterationId = Id<'Iteration'>;
export type ToolCallId = Id<'ToolCall'>;
export type SubagentId = Id<'Subagent'>;
export type HypothesisId = Id<'Hypothesis'>;
export type DecisionId = Id<'Decision'>;
export type ActionId = Id<'Action'>;
export type FailureId = Id<'Failure'>;
export type EscalationId = Id<'Escalation'>;
export type RegressionId = Id<'Regression'>;
export type ConstraintId = Id<'Constraint'>;
export type MemoryId = Id<'Memory'>;
export type SessionId = Id<'Session'>;
export type HarnessId = Id<'Harness'>;
export type CandidateId = Id<'Candidate'>;
export type ProbeId = Id<'Probe'>;
export type ContrastId = Id<'Contrast'>;
export type CompositionId = Id<'Composition'>;
export type AdmissionId = Id<'Admission'>;
export type ExperienceEntryId = Id<'ExperienceEntry'>;
export type EvolutionRunId = Id<'EvolutionRun'>;
export type SurfaceId = Id<'Surface'>;

// ---------------------------------------------------------------------------
// IdFactory — abstraction over ID generation
// ---------------------------------------------------------------------------

/**
 * Factory for creating domain identifiers.
 *
 * Implementations must produce time-ordered, globally-unique IDs.
 * The current canonical implementation uses UUIDv7.
 */
export interface IdFactory {
  /** Create a new unique identifier. */
  create<T extends string = string>(): Id<T>;
}

/**
 * Helper to brand a string literal or deterministic identifier as `Id<T>`.
 */
export function createId<T extends string = string>(value: string): Id<T> {
  return value as Id<T>;
}

