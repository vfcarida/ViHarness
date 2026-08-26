/**
 * Goal Service with Compare-And-Set (CAS) Mutations.
 *
 * Implements DeepSeek Harness and Prime Agent goal lifecycle management:
 * - Atomic CAS enforcement: any mutation with a stale revision is rejected.
 * - Process-local activation: goals start disarmed on fresh process boot; mutations
 *   to pause, block, complete, and clear disarm activation; resume re-arms activation.
 * - Full event emission on every state change for durable audit and replay.
 */
import type { GoalId } from '../types/identifiers.js';
import type { IdFactory } from '../types/identifiers.js';
import type { Clock } from '../interfaces/clock.js';
import type { LifecycleGoal, GoalRef, GoalPhase, BlockerCode } from './goal-state.js';
import { DEFAULT_MAX_ROUNDS, canTransitionGoalPhase } from './goal-state.js';
import type { GoalChangeEvent, GoalMutation } from './goal-events.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export interface CreateGoalOpts {
  readonly id?: GoalId;
  readonly description: string;
  readonly tokenBudget?: number;
  readonly costBudget?: number;
  readonly maxRounds?: number;
}

export interface GoalEdit {
  readonly description?: string;
  readonly tokenBudget?: number;
  readonly costBudget?: number;
  readonly maxRounds?: number;
}

export interface GoalView {
  readonly goal: LifecycleGoal;
  readonly ref: GoalRef;
  readonly isArmed: boolean;
}

export type GoalChangeListener = (event: GoalChangeEvent) => void;

export interface GoalServiceOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class GoalService {
  private readonly goals = new Map<GoalId, LifecycleGoal>();
  private readonly agentGoalMap = new Map<string, GoalId>();
  // Process-local activation set — NEVER persisted
  private readonly activatedGoals = new Set<GoalId>();
  private readonly listeners = new Set<GoalChangeListener>();

  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(options: GoalServiceOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  /**
   * Subscribe to goal change events.
   */
  on(event: 'goal/change', listener: GoalChangeListener): () => void {
    if (event === 'goal/change') {
      this.listeners.add(listener);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(goal: LifecycleGoal, mutation: GoalMutation): void {
    const event: GoalChangeEvent = {
      goal,
      mutation,
      timestamp: this.clock.now().getTime(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in goal change listener:', err);
      }
    }
  }

  /**
   * Create a new goal for an agent with initial revision 1 and active phase.
   * Arms activation process-locally.
   */
  create(agentId: string, opts: CreateGoalOpts): LifecycleGoal {
    const id = opts.id ?? this.idFactory.create<'Goal'>();
    const now = this.clock.now().getTime();

    const goal: LifecycleGoal = {
      id,
      revision: 1,
      description: opts.description,
      phase: 'active',
      tokenBudget: opts.tokenBudget,
      costBudget: opts.costBudget,
      maxRounds: opts.maxRounds ?? DEFAULT_MAX_ROUNDS,
      roundsStarted: 0,
      tokensUsed: 0,
      costUsed: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.goals.set(id, goal);
    this.agentGoalMap.set(agentId, id);
    this.activatedGoals.add(id);

    this.emitChange(goal, { kind: 'create' });
    return goal;
  }

  /**
   * Compare-and-set lookup helper. Throws if goal missing or revision stale.
   */
  private getAndValidateCas(ref: GoalRef): LifecycleGoal {
    const current = this.goals.get(ref.id);
    if (!current) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Goal with ID [${ref.id}] not found`,
      });
    }

    if (current.revision !== ref.revision) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Stale GoalRef: expected revision ${current.revision}, got ${ref.revision}`,
      });
    }

    return current;
  }

  /**
   * Edit goal properties with CAS fence.
   */
  edit(ref: GoalRef, updates: GoalEdit): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    const now = this.clock.now().getTime();

    const fields: string[] = [];
    if (updates.description !== undefined) fields.push('description');
    if (updates.tokenBudget !== undefined) fields.push('tokenBudget');
    if (updates.costBudget !== undefined) fields.push('costBudget');
    if (updates.maxRounds !== undefined) fields.push('maxRounds');

    const updated: LifecycleGoal = {
      ...current,
      description: updates.description ?? current.description,
      tokenBudget: updates.tokenBudget !== undefined ? updates.tokenBudget : current.tokenBudget,
      costBudget: updates.costBudget !== undefined ? updates.costBudget : current.costBudget,
      maxRounds: updates.maxRounds !== undefined ? updates.maxRounds : current.maxRounds,
      revision: current.revision + 1,
      updatedAt: now,
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'edit', fields });
    return updated;
  }

  /**
   * Pause an active goal. Disarms activation.
   */
  pause(ref: GoalRef): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    this.validateTransition(current.phase, 'paused');

    this.activatedGoals.delete(ref.id);
    const updated: LifecycleGoal = {
      ...current,
      phase: 'paused',
      revision: current.revision + 1,
      updatedAt: this.clock.now().getTime(),
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'pause' });
    return updated;
  }

  /**
   * Resume a paused or blocked goal. Rejects if rounds or token budget are exhausted.
   * Re-arms activation process-locally.
   */
  resume(ref: GoalRef): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    this.validateTransition(current.phase, 'active');

    // Reject resume if rounds are exhausted
    if (current.roundsStarted >= current.maxRounds) {
      throw new HarnessError({
        code: ErrorCode.POLICY_DENIED,
        category: ErrorCategory.POLICY,
        message: `Cannot resume goal: round budget exhausted (${current.roundsStarted}/${current.maxRounds} rounds)`,
      });
    }

    // Reject resume if token budget is exhausted
    if (current.tokenBudget && current.tokensUsed >= current.tokenBudget) {
      throw new HarnessError({
        code: ErrorCode.POLICY_DENIED,
        category: ErrorCategory.POLICY,
        message: `Cannot resume goal: token budget exhausted (${current.tokensUsed}/${current.tokenBudget} tokens)`,
      });
    }

    // Re-arm activation
    this.activatedGoals.add(ref.id);

    const updated: LifecycleGoal = {
      ...current,
      phase: 'active',
      blockerCode: undefined,
      blockerReason: undefined,
      revision: current.revision + 1,
      updatedAt: this.clock.now().getTime(),
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'resume' });
    return updated;
  }

  /**
   * Block a goal with a policy code and human-readable reason. Disarms activation.
   */
  block(ref: GoalRef, code: BlockerCode, reason: string): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    this.validateTransition(current.phase, 'blocked');

    this.activatedGoals.delete(ref.id);

    const updated: LifecycleGoal = {
      ...current,
      phase: 'blocked',
      blockerCode: code,
      blockerReason: reason,
      revision: current.revision + 1,
      updatedAt: this.clock.now().getTime(),
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'block', code, reason });
    return updated;
  }

  /**
   * Complete an active goal. Disarms activation.
   */
  complete(ref: GoalRef): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    this.validateTransition(current.phase, 'completed');

    this.activatedGoals.delete(ref.id);

    const updated: LifecycleGoal = {
      ...current,
      phase: 'completed',
      revision: current.revision + 1,
      updatedAt: this.clock.now().getTime(),
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'complete' });
    return updated;
  }

  /**
   * Clear a goal (terminal state). Disarms activation.
   */
  clear(ref: GoalRef): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    this.validateTransition(current.phase, 'cleared');

    this.activatedGoals.delete(ref.id);

    const updated: LifecycleGoal = {
      ...current,
      phase: 'cleared',
      revision: current.revision + 1,
      updatedAt: this.clock.now().getTime(),
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, { kind: 'clear' });
    return updated;
  }

  /**
   * Record token and cost usage against a goal with CAS fence.
   */
  recordUsage(
    ref: GoalRef,
    usage: { tokens: number; cost: number; roundsIncrement?: number },
  ): LifecycleGoal {
    const current = this.getAndValidateCas(ref);
    const now = this.clock.now().getTime();

    const roundsIncrement = usage.roundsIncrement ?? 0;

    const updated: LifecycleGoal = {
      ...current,
      tokensUsed: current.tokensUsed + usage.tokens,
      costUsed: current.costUsed + usage.cost,
      roundsStarted: current.roundsStarted + roundsIncrement,
      revision: current.revision + 1,
      updatedAt: now,
    };

    this.goals.set(ref.id, updated);
    this.emitChange(updated, {
      kind: 'record-usage',
      tokens: usage.tokens,
      cost: usage.cost,
      round: roundsIncrement > 0 ? updated.roundsStarted : undefined,
    });
    return updated;
  }

  /**
   * Get goal view by agent ID.
   */
  get(agentId: string): GoalView | null {
    const goalId = this.agentGoalMap.get(agentId);
    if (!goalId) return null;
    return this.getById(goalId);
  }

  /**
   * Get goal view by Goal ID.
   */
  getById(goalId: GoalId): GoalView | null {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    return {
      goal,
      ref: { id: goal.id, revision: goal.revision },
      isArmed: this.activatedGoals.has(goal.id),
    };
  }

  /**
   * Check if a goal is currently armed in this process.
   */
  isArmed(goalId: GoalId): boolean {
    return this.activatedGoals.has(goalId);
  }

  /**
   * Arm a goal process-locally.
   */
  arm(goalId: GoalId): void {
    if (this.goals.has(goalId)) {
      this.activatedGoals.add(goalId);
    }
  }

  /**
   * Disarm a goal process-locally.
   */
  disarm(goalId: GoalId): void {
    this.activatedGoals.delete(goalId);
  }

  /**
   * Disarms all goals in-memory to simulate process restart.
   */
  disarmAll(): void {
    this.activatedGoals.clear();
  }

  private validateTransition(from: GoalPhase, to: GoalPhase): void {
    if (!canTransitionGoalPhase(from, to)) {
      throw new HarnessError({
        code: ErrorCode.STATE_INVALID_TRANSITION,
        category: ErrorCategory.STATE,
        message: `Illegal goal phase transition: cannot transition from '${from}' to '${to}'`,
      });
    }
  }
}
