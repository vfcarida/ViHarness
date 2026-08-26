/**
 * Event-Sourced Goal Lifecycle, Token Budgets, CAS & Token Attribution Tests (P006).
 *
 * Validates:
 * 1. Goal CRUD & Phase Transitions (active, paused, blocked, completed, cleared).
 * 2. Compare-and-Set (CAS) Concurrency & Stale Ref Rejection.
 * 3. Round Budget (maxRounds) & Graceful Blocking.
 * 4. Token & Cost Budgets per Goal.
 * 5. All 5 Standard Blocker Codes.
 * 6. Process-Local Activation & Disarming on Restart.
 * 7. Event-Sourced Replay & Authoritative State Reconstruction.
 * 8. Subagent Token Attribution & Reconcilable Token Tree.
 * 9. LoopControl Goal Budget Evaluation & Termination Priority.
 */
import { describe, it, expect } from 'vitest';
import {
  GoalService,
  DEFAULT_MAX_ROUNDS,
  canTransitionGoalPhase,
  reconstructGoalFromEvents,
  DefaultGoalContinuationDriver,
  TokenAttributionTracker,
  evaluateLoopControl,
  checkGoalRoundBudget,
  checkGoalTokenBudget,
  checkGoalCostBudget,
  DEFAULT_GOAL_CONSTRAINTS,
  AgentPhase,
  TerminationReason,
} from '../../../src/core/index.js';
import type { GoalChangeEvent, TokenAttribution, LifecycleGoal } from '../../../src/core/index.js';
import { UuidV7IdFactory, TestClock } from '../../../src/infra/index.js';

describe('Event-Sourced Goal Lifecycle + Token Budgets + Attribution (P006)', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  function createService(): GoalService {
    return new GoalService({ idFactory, clock });
  }

  // =========================================================================
  // 1. Goal CRUD & Phase Lifecycle
  // =========================================================================
  describe('1. Goal CRUD & Phase Lifecycle', () => {
    it('1.1 should create an active goal with revision 1 and default maxRounds', () => {
      const service = createService();
      const goal = service.create('agent-1', {
        description: 'Build authentication module',
        tokenBudget: 100000,
        costBudget: 5.0,
      });

      expect(goal.id).toBeDefined();
      expect(goal.revision).toBe(1);
      expect(goal.description).toBe('Build authentication module');
      expect(goal.phase).toBe('active');
      expect(goal.maxRounds).toBe(DEFAULT_MAX_ROUNDS);
      expect(goal.roundsStarted).toBe(0);
      expect(goal.tokensUsed).toBe(0);
      expect(goal.costUsed).toBe(0);
      expect(service.isArmed(goal.id)).toBe(true);
    });

    it('1.2 should edit goal properties and increment revision monotonically', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Original task' });

      const updated = service.edit(
        { id: goal.id, revision: goal.revision },
        { description: 'Updated task description', tokenBudget: 50000, maxRounds: 100 },
      );

      expect(updated.revision).toBe(2);
      expect(updated.description).toBe('Updated task description');
      expect(updated.tokenBudget).toBe(50000);
      expect(updated.maxRounds).toBe(100);
    });

    it('1.3 should pause goal and disarm activation', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });
      expect(service.isArmed(goal.id)).toBe(true);

      const paused = service.pause({ id: goal.id, revision: goal.revision });
      expect(paused.phase).toBe('paused');
      expect(paused.revision).toBe(2);
      expect(service.isArmed(goal.id)).toBe(false);
    });

    it('1.4 should resume paused goal and re-arm activation', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });
      const paused = service.pause({ id: goal.id, revision: goal.revision });

      const resumed = service.resume({ id: paused.id, revision: paused.revision });
      expect(resumed.phase).toBe('active');
      expect(resumed.revision).toBe(3);
      expect(service.isArmed(goal.id)).toBe(true);
    });

    it('1.5 should complete an active goal and disarm activation', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const completed = service.complete({ id: goal.id, revision: goal.revision });
      expect(completed.phase).toBe('completed');
      expect(completed.revision).toBe(2);
      expect(service.isArmed(goal.id)).toBe(false);
    });

    it('1.6 should clear a goal into terminal cleared state and disarm', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const cleared = service.clear({ id: goal.id, revision: goal.revision });
      expect(cleared.phase).toBe('cleared');
      expect(cleared.revision).toBe(2);
      expect(service.isArmed(goal.id)).toBe(false);
    });

    it('1.7 should lookup goal view by agentId and by goalId', () => {
      const service = createService();
      const goal = service.create('agent-x', { description: 'Specialized task' });

      const byAgent = service.get('agent-x');
      expect(byAgent).not.toBeNull();
      expect(byAgent?.goal.id).toBe(goal.id);
      expect(byAgent?.ref.revision).toBe(1);
      expect(byAgent?.isArmed).toBe(true);

      const byId = service.getById(goal.id);
      expect(byId?.goal.description).toBe('Specialized task');
    });
  });

  // =========================================================================
  // 2. Compare-and-Set (CAS) Concurrency & Stale Ref Rejection
  // =========================================================================
  describe('2. Compare-and-Set (CAS) Concurrency', () => {
    it('2.1 should reject edit with stale revision', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Initial' });

      // First valid edit moves revision from 1 -> 2
      service.edit({ id: goal.id, revision: 1 }, { description: 'Update 1' });

      // Stale edit with revision 1 must be rejected
      expect(() => {
        service.edit({ id: goal.id, revision: 1 }, { description: 'Stale update' });
      }).toThrow(/Stale GoalRef/);
    });

    it('2.2 should reject pause with stale revision', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Initial' });
      service.edit({ id: goal.id, revision: 1 }, { description: 'Update 1' });

      expect(() => {
        service.pause({ id: goal.id, revision: 1 });
      }).toThrow(/Stale GoalRef/);
    });

    it('2.3 should reject block with stale revision', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Initial' });
      service.edit({ id: goal.id, revision: 1 }, { description: 'Update 1' });

      expect(() => {
        service.block({ id: goal.id, revision: 1 }, 'provider-limit', 'Rate limit');
      }).toThrow(/Stale GoalRef/);
    });

    it('2.4 should prevent concurrent mutation race conditions with CAS', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Initial' });

      // Two concurrent tasks grab ref at revision 1
      const refTaskA = { id: goal.id, revision: 1 };
      const refTaskB = { id: goal.id, revision: 1 };

      // Task A succeeds
      const resultA = service.edit(refTaskA, { description: 'Task A wins' });
      expect(resultA.revision).toBe(2);

      // Task B fails
      expect(() => {
        service.edit(refTaskB, { description: 'Task B conflict' });
      }).toThrow(/Stale GoalRef/);
    });
  });

  // =========================================================================
  // 3. Blocking Codes & Explanations
  // =========================================================================
  describe('3. Standard Blocker Codes & Policy Blocking', () => {
    it('3.1 should support provider-limit blocker code', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'provider-limit',
        'Model context window of 128k exceeded',
      );

      expect(blocked.phase).toBe('blocked');
      expect(blocked.blockerCode).toBe('provider-limit');
      expect(blocked.blockerReason).toBe('Model context window of 128k exceeded');
      expect(service.isArmed(goal.id)).toBe(false);
    });

    it('3.2 should support budget-exhausted blocker code', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'budget-exhausted',
        'Token ceiling of 200,000 reached',
      );

      expect(blocked.blockerCode).toBe('budget-exhausted');
      expect(blocked.blockerReason).toContain('200,000');
    });

    it('3.3 should support execution-error blocker code', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'execution-error',
        'Unrecoverable container sandbox failure',
      );

      expect(blocked.blockerCode).toBe('execution-error');
      expect(blocked.blockerReason).toContain('sandbox failure');
    });

    it('3.4 should support human-input-needed blocker code', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'human-input-needed',
        'Requires user confirmation for destructive migration',
      );

      expect(blocked.blockerCode).toBe('human-input-needed');
      expect(blocked.blockerReason).toContain('confirmation');
    });

    it('3.5 should support dependency-blocked blocker code', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'dependency-blocked',
        'Waiting on schema migration subagent',
      );

      expect(blocked.blockerCode).toBe('dependency-blocked');
      expect(blocked.blockerReason).toContain('schema migration');
    });

    it('3.6 should clear blocker code upon resume', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });
      const blocked = service.block(
        { id: goal.id, revision: 1 },
        'human-input-needed',
        'Need input',
      );

      const resumed = service.resume({ id: blocked.id, revision: blocked.revision });
      expect(resumed.phase).toBe('active');
      expect(resumed.blockerCode).toBeUndefined();
      expect(resumed.blockerReason).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Round Budget & GoalContinuationDriver
  // =========================================================================
  describe('4. Round Budget & GoalContinuationDriver', () => {
    it('4.1 should admit rounds when within maxRounds budget', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task', maxRounds: 5 });
      const driver = new DefaultGoalContinuationDriver(service);

      // Round 1 admission
      const admitted1 = driver.admitRound({ id: goal.id, revision: 1 });
      expect(admitted1).toBe(true);

      const view1 = service.getById(goal.id);
      expect(view1?.goal.roundsStarted).toBe(1);
      expect(view1?.goal.revision).toBe(2);

      // Round 2 admission
      const admitted2 = driver.admitRound({ id: goal.id, revision: 2 });
      expect(admitted2).toBe(true);
      expect(service.getById(goal.id)?.goal.roundsStarted).toBe(2);
    });

    it('4.2 should gracefully block goal when maxRounds is exhausted', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task', maxRounds: 2 });
      const driver = new DefaultGoalContinuationDriver(service);

      // Admit round 1
      driver.admitRound({ id: goal.id, revision: 1 }); // roundsStarted = 1, rev = 2
      // Admit round 2
      driver.admitRound({ id: goal.id, revision: 2 }); // roundsStarted = 2, rev = 3

      // Attempt round 3 (exceeds maxRounds of 2)
      const admitted3 = driver.admitRound({ id: goal.id, revision: 3 });
      expect(admitted3).toBe(false);

      // Verify goal was gracefully blocked
      const finalView = service.getById(goal.id);
      expect(finalView?.goal.phase).toBe('blocked');
      expect(finalView?.goal.blockerCode).toBe('budget-exhausted');
      expect(finalView?.goal.blockerReason).toContain('Round budget exhausted');
    });

    it('4.3 should reject resume if rounds are already exhausted', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task', maxRounds: 1 });
      const driver = new DefaultGoalContinuationDriver(service);

      driver.admitRound({ id: goal.id, revision: 1 }); // roundsStarted = 1, rev = 2
      driver.admitRound({ id: goal.id, revision: 2 }); // blocks goal, rev = 3

      const blockedView = service.getById(goal.id)!;
      expect(blockedView.goal.phase).toBe('blocked');

      expect(() => {
        service.resume({ id: goal.id, revision: blockedView.goal.revision });
      }).toThrow(/round budget exhausted/);
    });

    it('4.4 should reject admission if goal is paused or disarmed', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });
      const driver = new DefaultGoalContinuationDriver(service);

      const paused = service.pause({ id: goal.id, revision: 1 });

      const admitted = driver.admitRound({ id: goal.id, revision: paused.revision });
      expect(admitted).toBe(false);
    });
  });

  // =========================================================================
  // 5. Token & Cost Budgets
  // =========================================================================
  describe('5. Token & Cost Budgets', () => {
    it('5.1 should record token and cost usage with monotonic revisions', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });

      const updated = service.recordUsage(
        { id: goal.id, revision: 1 },
        { tokens: 1500, cost: 0.05 },
      );

      expect(updated.tokensUsed).toBe(1500);
      expect(updated.costUsed).toBe(0.05);
      expect(updated.revision).toBe(2);
    });

    it('5.2 should block goal when token budget is exhausted via driver', () => {
      const service = createService();
      const goal = service.create('agent-1', {
        description: 'Task',
        tokenBudget: 5000,
      });
      const driver = new DefaultGoalContinuationDriver(service);

      // Record 5000 tokens
      const updated = service.recordUsage(
        { id: goal.id, revision: 1 },
        { tokens: 5000, cost: 0.1 },
      );

      const admitted = driver.admitRound({ id: goal.id, revision: updated.revision });
      expect(admitted).toBe(false);

      const finalView = service.getById(goal.id);
      expect(finalView?.goal.phase).toBe('blocked');
      expect(finalView?.goal.blockerCode).toBe('budget-exhausted');
      expect(finalView?.goal.blockerReason).toContain('Token budget exhausted');
    });

    it('5.3 should block goal when cost budget is exhausted via driver', () => {
      const service = createService();
      const goal = service.create('agent-1', {
        description: 'Task',
        costBudget: 1.0,
      });
      const driver = new DefaultGoalContinuationDriver(service);

      // Record $1.05 cost
      const updated = service.recordUsage(
        { id: goal.id, revision: 1 },
        { tokens: 1000, cost: 1.05 },
      );

      const admitted = driver.admitRound({ id: goal.id, revision: updated.revision });
      expect(admitted).toBe(false);

      const finalView = service.getById(goal.id);
      expect(finalView?.goal.phase).toBe('blocked');
      expect(finalView?.goal.blockerCode).toBe('budget-exhausted');
      expect(finalView?.goal.blockerReason).toContain('Cost budget exhausted');
    });
  });

  // =========================================================================
  // 6. Process-Local Activation & Disarming
  // =========================================================================
  describe('6. Process-Local Activation & Crash Recovery', () => {
    it('6.1 should disarm all goals on simulated process restart', () => {
      const service = createService();
      const goal1 = service.create('agent-1', { description: 'Task 1' });
      const goal2 = service.create('agent-2', { description: 'Task 2' });

      expect(service.isArmed(goal1.id)).toBe(true);
      expect(service.isArmed(goal2.id)).toBe(true);

      // Simulate crash/restart
      service.disarmAll();

      expect(service.isArmed(goal1.id)).toBe(false);
      expect(service.isArmed(goal2.id)).toBe(false);
    });

    it('6.2 should require explicit resume mutation to re-arm disarmed goal', () => {
      const service = createService();
      const goal = service.create('agent-1', { description: 'Task' });
      const driver = new DefaultGoalContinuationDriver(service);

      // Crash restart -> disarmed
      service.disarmAll();

      // Admission rejected when disarmed
      expect(driver.admitRound({ id: goal.id, revision: 1 })).toBe(false);

      // Pause and resume re-arms
      const paused = service.pause({ id: goal.id, revision: 1 });
      const resumed = service.resume({ id: goal.id, revision: paused.revision });

      expect(service.isArmed(goal.id)).toBe(true);
      expect(driver.admitRound({ id: goal.id, revision: resumed.revision })).toBe(true);
    });
  });

  // =========================================================================
  // 7. Event-Sourced Replay & Authoritative State Reconstruction
  // =========================================================================
  describe('7. Event-Sourced Replay', () => {
    it('7.1 should emit goal/change events on every mutation', () => {
      const service = createService();
      const events: GoalChangeEvent[] = [];
      service.on('goal/change', (e) => events.push(e));

      const goal = service.create('agent-1', { description: 'Event task' });
      const edited = service.edit({ id: goal.id, revision: 1 }, { tokenBudget: 25000 });
      const used = service.recordUsage(
        { id: goal.id, revision: edited.revision },
        { tokens: 500, cost: 0.01 },
      );
      service.complete({ id: goal.id, revision: used.revision });

      expect(events).toHaveLength(4);
      expect(events[0]?.mutation.kind).toBe('create');
      expect(events[1]?.mutation.kind).toBe('edit');
      expect(events[2]?.mutation.kind).toBe('record-usage');
      expect(events[3]?.mutation.kind).toBe('complete');
    });

    it('7.2 should reconstruct identical state from sequential event log replay', () => {
      const service = createService();
      const events: GoalChangeEvent[] = [];
      service.on('goal/change', (e) => events.push(e));

      const goal = service.create('agent-1', { description: 'Replay task', maxRounds: 50 });
      const edited = service.edit({ id: goal.id, revision: 1 }, { tokenBudget: 80000 });
      const used = service.recordUsage(
        { id: goal.id, revision: edited.revision },
        { tokens: 12000, cost: 0.24, roundsIncrement: 3 },
      );
      const blocked = service.block(
        { id: goal.id, revision: used.revision },
        'dependency-blocked',
        'Waiting on upstream',
      );
      const resumed = service.resume({ id: goal.id, revision: blocked.revision });
      const finalGoal = service.complete({ id: goal.id, revision: resumed.revision });

      // Replay all events
      const reconstructed = reconstructGoalFromEvents(events);

      expect(reconstructed.id).toBe(finalGoal.id);
      expect(reconstructed.revision).toBe(finalGoal.revision);
      expect(reconstructed.phase).toBe('completed');
      expect(reconstructed.tokensUsed).toBe(12000);
      expect(reconstructed.costUsed).toBe(0.24);
      expect(reconstructed.roundsStarted).toBe(3);
      expect(reconstructed.tokenBudget).toBe(80000);
      expect(reconstructed.maxRounds).toBe(50);
    });

    it('7.3 should throw error if event log starts without create or has revision gaps', () => {
      const dummyGoal: LifecycleGoal = {
        id: idFactory.create<'Goal'>(),
        revision: 2, // invalid start
        description: 'Corrupted',
        phase: 'active',
        maxRounds: 256,
        roundsStarted: 0,
        tokensUsed: 0,
        costUsed: 0,
        createdAt: 0,
        updatedAt: 0,
      };

      const corruptedEvents: GoalChangeEvent[] = [
        { goal: dummyGoal, mutation: { kind: 'edit', fields: [] }, timestamp: 0 },
      ];

      expect(() => {
        reconstructGoalFromEvents(corruptedEvents);
      }).toThrow(/First event must be 'create'/);
    });
  });

  // =========================================================================
  // 8. Subagent Token Attribution & Reconcilable Tree
  // =========================================================================
  describe('8. Subagent Token Attribution & Hierarchical TokenTree', () => {
    it('8.1 should record child subagent token attribution to parent turn', () => {
      const tracker = new TokenAttributionTracker();

      const rootExecId = idFactory.create<'Execution'>();
      const childExecId = idFactory.create<'Execution'>();

      const attribution: TokenAttribution = {
        parentExecutionId: rootExecId,
        parentTurn: 2,
        childExecutionId: childExecId,
        childTotalTokens: 4500,
        childTotalCost: 0.09,
        childRounds: 3,
      };

      tracker.recordAttribution(attribution);

      const tree = tracker.buildTree({
        executionId: rootExecId,
        tokensOwn: 2000,
        costOwn: 0.04,
      });

      expect(tree.totalTokens).toBe(6500); // 2000 own + 4500 child
      expect(tree.totalCost).toBeCloseTo(0.13, 5);
      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children[0]?.tokensOwn).toBe(4500);
    });

    it('8.2 should build multi-level nested subagent tree and reconcile totals', () => {
      const tracker = new TokenAttributionTracker();

      const rootId = idFactory.create<'Execution'>();
      const exploreChildId = idFactory.create<'Execution'>();
      const coderChildId = idFactory.create<'Execution'>();
      const testerNestedId = idFactory.create<'Execution'>();

      // Root spawns Explore Subagent
      tracker.recordAttribution({
        parentExecutionId: rootId,
        parentTurn: 1,
        childExecutionId: exploreChildId,
        childTotalTokens: 3000,
        childTotalCost: 0.06,
        childRounds: 2,
      });

      // Root spawns Coder Subagent
      tracker.recordAttribution({
        parentExecutionId: rootId,
        parentTurn: 3,
        childExecutionId: coderChildId,
        childTotalTokens: 7000,
        childTotalCost: 0.14,
        childRounds: 4,
      });

      // Coder Subagent spawns Tester Subagent (nested level 2)
      tracker.recordAttribution({
        parentExecutionId: coderChildId,
        parentTurn: 2,
        childExecutionId: testerNestedId,
        childTotalTokens: 2500,
        childTotalCost: 0.05,
        childRounds: 1,
      });

      const tree = tracker.buildTree({
        executionId: rootId,
        tokensOwn: 5000,
        costOwn: 0.1,
      });

      // Total tokens = Root (5000) + Explore (3000) + Coder (7000) + Tester (2500) = 17500
      expect(tree.totalTokens).toBe(17500);
      expect(tree.totalCost).toBeCloseTo(0.35, 5);

      // Verify exact tree reconciliation: sum(all nodes.tokensOwn) === tree.totalTokens
      const reconcile = TokenAttributionTracker.reconcileTree(tree);
      expect(reconcile.isReconciled).toBe(true);
      expect(reconcile.totalTokensTree).toBe(reconcile.totalTokensOwnSum);
      expect(reconcile.totalCostTree).toBeCloseTo(reconcile.totalCostOwnSum, 5);
    });
  });

  // =========================================================================
  // 9. LoopControl Budget Enforcement Hierarchy
  // =========================================================================
  describe('9. LoopControl Budget Enforcement', () => {
    it('9.1 should terminate with budget-exhausted when goal maxRounds is reached', () => {
      const decision = checkGoalRoundBudget(256, 256, 10);
      expect(decision.terminal).toBe(true);
      expect(decision.reason).toBe(TerminationReason.MAX_ITERATIONS);
      expect(decision.evidence[0]?.data?.['blockerCode']).toBe('budget-exhausted');
      expect(decision.evidence[0]?.description).toContain('Goal round budget exhausted');
    });

    it('9.2 should terminate with budget-exhausted when goal tokenBudget is reached', () => {
      const decision = checkGoalTokenBudget(150000, 100000, 5);
      expect(decision.terminal).toBe(true);
      expect(decision.reason).toBe(TerminationReason.MAX_COST);
      expect(decision.evidence[0]?.data?.['blockerCode']).toBe('budget-exhausted');
      expect(decision.evidence[0]?.description).toContain('Goal token budget exhausted');
    });

    it('9.3 should terminate with budget-exhausted when goal costBudget is reached', () => {
      const decision = checkGoalCostBudget(5.5, 5.0, 8);
      expect(decision.terminal).toBe(true);
      expect(decision.reason).toBe(TerminationReason.MAX_COST);
      expect(decision.evidence[0]?.data?.['blockerCode']).toBe('budget-exhausted');
      expect(decision.evidence[0]?.description).toContain('Goal cost budget exhausted');
    });

    it('9.4 should prioritize Goal budgets before Global execution budgets in evaluateLoopControl', () => {
      const goal: LifecycleGoal = {
        id: idFactory.create<'Goal'>(),
        revision: 1,
        description: 'Strict budget goal',
        phase: 'active',
        maxRounds: 5,
        tokenBudget: 10000,
        costBudget: 0.5,
        roundsStarted: 5, // Exhausted!
        tokensUsed: 10000,
        costUsed: 0.5,
        createdAt: clock.now().getTime(),
        updatedAt: clock.now().getTime(),
      };

      const decision = evaluateLoopControl({
        state: {
          taskId: idFactory.create<'Task'>(),
          phase: AgentPhase.IMPLEMENT,
          repairCount: 0,
          iterationCount: 2, // Not yet at global max iterations (50)
          lastAction: null,
          lastOutcome: null,
          history: [],
          updatedAt: clock.now(),
        },
        constraints: {
          ...DEFAULT_GOAL_CONSTRAINTS,
          maxIterations: 50,
        },
        iterations: [],
        transitions: [],
        elapsedMs: 5000,
        totalCostDollars: 0.1,
        goal,
      });

      expect(decision.terminal).toBe(true);
      expect(decision.evidence[0]?.data?.['blockerCode']).toBe('budget-exhausted');
      expect(decision.evidence[0]?.description).toContain('Goal round budget exhausted');
    });
  });
});
