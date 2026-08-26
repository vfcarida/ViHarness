/**
 * AgentRuntime interface.
 *
 * Top-level orchestration contract for executing goals.
 * "The agent is not a persistent conversation. The agent is a stateful,
 * evidence-driven state machine."
 */
import type { ExecutionId } from '../types/identifiers.js';
import type { Goal } from '../model/goal.js';
import type { ExecutionOptions, ExecutionResult, AgentEvent } from '../model/runtime-types.js';

export interface AgentObserver {
  onEvent(event: AgentEvent): void;
}

export interface AgentRuntime {
  /** Execute a goal through the stateful agent loop. */
  execute(goal: Goal, options?: ExecutionOptions): Promise<ExecutionResult>;

  /** Pause execution (preserves durable state for resume). */
  pause(executionId: ExecutionId): Promise<void>;

  /** Resume a paused execution (optionally from a checkpoint). */
  resume(executionId: ExecutionId, options?: ExecutionOptions): Promise<ExecutionResult>;

  /** Abort an active execution. */
  abort(executionId: ExecutionId): Promise<void>;

  /** Subscribe to observable runtime events. Returns unsubscribe function. */
  subscribe(observer: AgentObserver): () => void;
}
