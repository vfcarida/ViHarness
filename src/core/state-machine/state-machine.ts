/**
 * Pure domain state machine.
 *
 * This is the heart of the agent runtime: a deterministic,
 * infrastructure-independent state machine that:
 *
 * 1. Holds the current AgentState (immutable snapshots)
 * 2. Validates and applies transitions
 * 3. Records a full, replayable transition history
 *
 * No I/O, no side effects, no async — pure domain logic.
 */
import type { TaskId, EvidenceId, IdFactory } from '../types/identifiers.js';
import type { Clock } from '../interfaces/clock.js';
import { AgentPhase, StateEvent, TERMINAL_PHASES } from '../model/state.js';
import type { AgentState, StateTransition } from '../model/state.js';
import { validateTransitionOrThrow } from './transition-validator.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class StateMachine {
  private _state: AgentState;
  private readonly _history: StateTransition[];
  private readonly _idFactory: IdFactory;
  private readonly _clock: Clock;

  constructor(params: {
    taskId: TaskId;
    idFactory: IdFactory;
    clock: Clock;
    initialPhase?: AgentPhase;
  }) {
    this._idFactory = params.idFactory;
    this._clock = params.clock;
    this._history = [];

    const now = this._clock.now();
    this._state = {
      id: this._idFactory.create<'State'>(),
      taskId: params.taskId,
      phase: params.initialPhase ?? AgentPhase.INIT,
      previousPhase: null,
      iterationId: this._idFactory.create<'Iteration'>(),
      iterationCount: 0,
      repairCount: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  // -------------------------------------------------------------------------
  // Read accessors
  // -------------------------------------------------------------------------

  /** Current state snapshot. */
  get state(): AgentState {
    return this._state;
  }

  /** Current phase. */
  get phase(): AgentPhase {
    return this._state.phase;
  }

  /** Whether the machine is in a terminal state. */
  get isTerminal(): boolean {
    return TERMINAL_PHASES.has(this._state.phase);
  }

  /** Full transition history (oldest first). */
  get history(): ReadonlyArray<StateTransition> {
    return this._history;
  }

  /** Number of transitions that have occurred. */
  get transitionCount(): number {
    return this._history.length;
  }

  // -------------------------------------------------------------------------
  // Transition
  // -------------------------------------------------------------------------

  /**
   * Apply a state event, producing a transition.
   *
   * @param event - The event to apply.
   * @param options - Optional metadata and evidence.
   * @param options.isLlmEmitted - Whether the LLM generated this event.
   * @param options.evidenceIds - Evidence supporting this transition.
   * @param options.metadata - Additional metadata for the transition.
   * @returns The recorded transition.
   * @throws HarnessError if the transition is invalid.
   */
  apply(
    event: StateEvent,
    options?: {
      isLlmEmitted?: boolean;
      evidenceIds?: ReadonlyArray<EvidenceId>;
      metadata?: Record<string, unknown>;
    },
  ): StateTransition {
    const targetPhase = validateTransitionOrThrow(
      this._state.phase,
      event,
      options?.isLlmEmitted ?? false,
    );

    // DONE evidence gate: transitioning to DONE via automated verification
    // requires at least one evidence ID. The agent must prove task completion with empirical evidence.
    // (Human override path from HUMAN_REQUIRED allows direct MARK_DONE without evidence).
    if (
      targetPhase === AgentPhase.DONE &&
      (event === StateEvent.VERIFICATION_PASSED ||
        (event === StateEvent.MARK_DONE && this._state.phase !== AgentPhase.HUMAN_REQUIRED)) &&
      (!options?.evidenceIds || options.evidenceIds.length === 0)
    ) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message:
          'Transition to DONE requires at least one verified evidenceId. The agent must prove task completion with empirical evidence.',
        context: { from: this._state.phase, event, evidenceIds: options?.evidenceIds ?? [] },
      });
    }

    const now = this._clock.now();
    const previousPhase = this._state.phase;

    const transition: StateTransition = {
      id: this._idFactory.create(),
      from: previousPhase,
      to: targetPhase,
      event,
      timestamp: now,
      stateId: this._state.id,
      evidenceIds: options?.evidenceIds ?? [],
      metadata: options?.metadata ?? {},
    };

    // Compute new state
    const newIterationCount =
      targetPhase === AgentPhase.VERIFY
        ? this._state.iterationCount + 1
        : this._state.iterationCount;

    const newRepairCount =
      targetPhase === AgentPhase.REPAIR
        ? this._state.repairCount + 1
        : targetPhase === AgentPhase.IMPLEMENT || targetPhase === AgentPhase.PLAN
          ? 0 // Reset repair count when starting fresh
          : this._state.repairCount;

    const newIterationId =
      targetPhase === AgentPhase.VERIFY
        ? this._idFactory.create<'Iteration'>()
        : this._state.iterationId;

    this._state = {
      id: this._idFactory.create<'State'>(),
      taskId: this._state.taskId,
      phase: targetPhase,
      previousPhase,
      iterationId: newIterationId,
      iterationCount: newIterationCount,
      repairCount: newRepairCount,
      metadata: options?.metadata ?? this._state.metadata,
      createdAt: this._state.createdAt,
      updatedAt: now,
    };

    this._history.push(transition);
    return transition;
  }

  // -------------------------------------------------------------------------
  // Serialization — for persistence and deterministic replay
  // -------------------------------------------------------------------------

  /**
   * Serialize the state machine to a plain object for persistence.
   */
  toSnapshot(): StateMachineSnapshot {
    return {
      state: this._state,
      history: [...this._history],
    };
  }

  /**
   * Restore a state machine from a serialized snapshot.
   */
  static fromSnapshot(
    snapshot: StateMachineSnapshot,
    idFactory: IdFactory,
    clock: Clock,
  ): StateMachine {
    const machine = new StateMachine({
      taskId: snapshot.state.taskId,
      idFactory,
      clock,
      initialPhase: AgentPhase.INIT,
    });

    // Overwrite internal state directly
    machine._state = snapshot.state;
    machine._history.length = 0;
    machine._history.push(...snapshot.history);

    return machine;
  }
}

// ---------------------------------------------------------------------------
// Snapshot type — serializable representation
// ---------------------------------------------------------------------------

export interface StateMachineSnapshot {
  readonly state: AgentState;
  readonly history: ReadonlyArray<StateTransition>;
}
