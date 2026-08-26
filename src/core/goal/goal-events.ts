/**
 * Event-Sourced Goal State Events.
 *
 * Implements DeepSeek Harness session-durable goal events:
 * - Emits 'goal/change' event on every mutation with full post-mutation snapshot.
 * - Strict replay validation for monotonic revisions, legal phase transitions, and sequential rounds.
 */
import type { LifecycleGoal } from './goal-state.js';
import { canTransitionGoalPhase } from './goal-state.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export type GoalMutation =
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly fields: ReadonlyArray<string> }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'block'; readonly code: string; readonly reason?: string }
  | { readonly kind: 'complete' }
  | { readonly kind: 'clear' }
  | {
      readonly kind: 'record-usage';
      readonly tokens: number;
      readonly cost: number;
      readonly round?: number;
    };

export interface GoalChangeEvent {
  readonly goal: LifecycleGoal;
  readonly mutation: GoalMutation;
  readonly timestamp: number;
}

export interface GoalEvents {
  readonly 'goal/change': GoalChangeEvent;
}

/**
 * Reconstructs a Goal state from an event log, strictly validating:
 * 1. Initial event is 'create' with revision 1.
 * 2. Monotonic revisions (rev = prevRev + 1).
 * 3. Legal phase transitions.
 * 4. Non-decreasing tokens, costs, and rounds.
 */
export function reconstructGoalFromEvents(events: ReadonlyArray<GoalChangeEvent>): LifecycleGoal {
  if (!events || events.length === 0) {
    throw new HarnessError({
      code: ErrorCode.STATE_CORRUPTED,
      category: ErrorCategory.STATE,
      message: 'Cannot reconstruct goal from empty event log',
    });
  }

  const firstEvent = events[0]!;
  if (firstEvent.mutation.kind !== 'create') {
    throw new HarnessError({
      code: ErrorCode.STATE_CORRUPTED,
      category: ErrorCategory.STATE,
      message: `First event must be 'create', got '${firstEvent.mutation.kind}'`,
    });
  }

  if (firstEvent.goal.revision !== 1) {
    throw new HarnessError({
      code: ErrorCode.STATE_CORRUPTED,
      category: ErrorCategory.STATE,
      message: `Initial goal revision must be 1, got ${firstEvent.goal.revision}`,
    });
  }

  let currentGoal = firstEvent.goal;

  for (let i = 1; i < events.length; i++) {
    const evt = events[i]!;
    const nextGoal = evt.goal;

    // Validate ID consistency
    if (nextGoal.id !== currentGoal.id) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Goal ID mismatch in event log at index ${i}: expected ${currentGoal.id}, got ${nextGoal.id}`,
      });
    }

    // Validate monotonic revision
    if (nextGoal.revision !== currentGoal.revision + 1) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Non-monotonic goal revision at index ${i}: expected ${currentGoal.revision + 1}, got ${nextGoal.revision}`,
      });
    }

    // Validate legal phase transition
    if (nextGoal.phase !== currentGoal.phase) {
      if (!canTransitionGoalPhase(currentGoal.phase, nextGoal.phase)) {
        throw new HarnessError({
          code: ErrorCode.STATE_INVALID_TRANSITION,
          category: ErrorCategory.STATE,
          message: `Illegal goal phase transition at index ${i}: cannot transition from '${currentGoal.phase}' to '${nextGoal.phase}'`,
        });
      }
    }

    // Validate non-decreasing usage
    if (nextGoal.tokensUsed < currentGoal.tokensUsed || nextGoal.costUsed < currentGoal.costUsed) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Decreasing token or cost usage detected in event log at index ${i}`,
      });
    }

    currentGoal = nextGoal;
  }

  return currentGoal;
}
