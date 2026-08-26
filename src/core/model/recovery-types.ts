/**
 * Persistence & Crash Recovery Domain Types.
 *
 * "State must be recoverable from durable records.
 * Do not silently repeat destructive operations whose previous execution status is unknown."
 *
 * Defines execution status classifications, recovery policies (RETRY_SAFE, REQUIRE_REVIEW, RECONCILE, ABORT),
 * JournalEntries, StateEventRecords, RecoveryAnalysis, and RecoveryDecisions.
 */
import type { ExecutionId, TaskId, CheckpointId } from '../types/identifiers.js';
import type { AgentPhase, StateEvent } from './state.js';
import type { ActionProposal, ActionResult } from './action.js';

/**
 * Action Execution Lifecycle Statuses.
 *
 * Canonical sequence:
 * PROPOSED -> AUTHORIZED -> STARTED -> (COMPLETED | FAILED | UNKNOWN)
 *
 * UNKNOWN represents an operation whose actual side-effect status is uncertain
 * (e.g. process crashed while in STARTED state for a destructive action).
 */
export enum ActionExecutionStatus {
  PROPOSED = 'PROPOSED',
  AUTHORIZED = 'AUTHORIZED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

// Backward compatibility runtime aliases (prevents ESLint enum duplicate errors)
(ActionExecutionStatus as unknown as Record<string, string>).RUNNING =
  ActionExecutionStatus.STARTED;
(ActionExecutionStatus as unknown as Record<string, string>).UNCERTAIN =
  ActionExecutionStatus.UNKNOWN;
(ActionExecutionStatus as unknown as Record<string, string>).INTERRUPTED =
  ActionExecutionStatus.UNKNOWN;

export enum RecoveryPolicy {
  RETRY_SAFE = 'RETRY_SAFE',
  REQUIRE_REVIEW = 'REQUIRE_REVIEW',
  RECONCILE = 'RECONCILE',
  ABORT = 'ABORT',
}

export interface JournalEntry {
  readonly executionId: ExecutionId;
  readonly taskId: TaskId;
  readonly iteration: number;
  readonly actionProposal: ActionProposal;
  readonly status: ActionExecutionStatus;
  readonly isDestructive: boolean;
  readonly startedAt: Date;
  readonly authorizedAt?: Date;
  readonly completedAt?: Date;
  readonly result?: ActionResult;
  readonly error?: string;
  readonly unknownReason?: string;
}

export interface StateEventRecord {
  readonly id: string;
  readonly taskId: TaskId;
  readonly event: StateEvent;
  readonly fromPhase: AgentPhase;
  readonly toPhase: AgentPhase;
  readonly timestamp: Date;
  readonly sequenceNumber: number;
}

export interface RecoveryAnalysis {
  readonly taskId: TaskId;
  readonly interruptedEntries: ReadonlyArray<JournalEntry>;
  readonly lastCheckpointId?: CheckpointId;
  readonly lastVerifiedSequence: number;
  readonly recommendedPolicy: RecoveryPolicy;
  readonly requiresHumanReview: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface RecoveryDecision {
  readonly action: 'RESUME' | 'RETRY_ACTION' | 'SKIP_ACTION' | 'ROLLBACK' | 'ESCALATE';
  readonly targetCheckpointId?: CheckpointId;
  readonly recoveryPolicy: RecoveryPolicy;
  readonly rationale: string;
}
