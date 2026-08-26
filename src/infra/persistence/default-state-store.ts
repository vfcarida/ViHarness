/**
 * Default State Store.
 *
 * Implements StateStore interface:
 * Manages agent state snapshots and enforces valid transitions with transition history.
 * Enforces durable ordering: state transition is only committed after EventStore persistence succeeds.
 */
import type { StateStore, TransitionOptions } from '../../core/interfaces/state-store.js';
import type { EventStore } from '../../core/interfaces/event-store.js';
import type { TaskId, IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { AgentState, StateEvent, StateTransition } from '../../core/model/state.js';
import { StateMachine } from '../../core/state-machine/state-machine.js';
import { validateTransitionOrThrow } from '../../core/state-machine/transition-validator.js';

export interface DefaultStateStoreOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly eventStore?: EventStore;
}

export class DefaultStateStore implements StateStore {
  private readonly stateMachines = new Map<TaskId, StateMachine>();
  private readonly histories = new Map<TaskId, StateTransition[]>();
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly eventStore?: EventStore;

  constructor(options: DefaultStateStoreOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.eventStore = options.eventStore;
  }

  async getState(taskId: TaskId): Promise<AgentState | undefined> {
    const sm = this.stateMachines.get(taskId);
    return sm?.state;
  }

  async transition(
    taskId: TaskId,
    event: StateEvent,
    options?: TransitionOptions,
  ): Promise<StateTransition> {
    let sm = this.stateMachines.get(taskId);
    if (!sm) {
      sm = new StateMachine({
        taskId,
        idFactory: this.idFactory,
        clock: this.clock,
      });
      this.stateMachines.set(taskId, sm);
    }

    const fromPhase = sm.state.phase;
    const targetPhase = validateTransitionOrThrow(fromPhase, event, options?.isLlmEmitted ?? false);

    // Durable Ordering: EventStore persistence MUST succeed before state machine state is mutated.
    if (this.eventStore) {
      await this.eventStore.append({
        taskId,
        event,
        fromPhase,
        toPhase: targetPhase,
        timestamp: this.clock.now(),
      });
    }

    const transition = sm.apply(event, options);
    const history = this.histories.get(taskId) ?? [];
    history.push(transition);
    this.histories.set(taskId, history);

    return transition;
  }

  async getHistory(taskId: TaskId): Promise<ReadonlyArray<StateTransition>> {
    return this.histories.get(taskId) ?? [];
  }
}
