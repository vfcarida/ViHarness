import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultStateStore,
  DefaultEventStore,
  DefaultExecutionJournal,
  DefaultRecoveryManager,
  DefaultResumeManager,
  DefaultCheckpointStore,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  AgentPhase,
  ActionType,
  ActionResultStatus,
  ActionExecutionStatus,
  RecoveryPolicy,
  StateEvent,
} from '../../../src/core/index.js';
import type { TaskId, ActionProposal } from '../../../src/core/index.js';

describe('Persistence and Crash Recovery Subsystem', () => {
  let stateStore: DefaultStateStore;
  let eventStore: DefaultEventStore;
  let journal: DefaultExecutionJournal;
  let checkpointStore: DefaultCheckpointStore;
  let recoveryManager: DefaultRecoveryManager;
  let resumeManager: DefaultResumeManager;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let taskId: TaskId;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));

    stateStore = new DefaultStateStore({ idFactory, clock });
    eventStore = new DefaultEventStore({ idFactory });
    journal = new DefaultExecutionJournal({ idFactory, clock });
    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    recoveryManager = new DefaultRecoveryManager();

    resumeManager = new DefaultResumeManager({
      stateStore,
      checkpointStore,
      idFactory,
      clock,
    });

    taskId = idFactory.create<'Task'>();
  });

  function createSampleProposal(
    type: ActionType = ActionType.FILE_READ,
    description: string = 'Read main.ts',
    irreversible = false,
  ): ActionProposal {
    return {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type,
      description,
      parameters: { path: 'src/main.ts' },
      irreversible,
      proposedAt: clock.now(),
    };
  }

  it('should detect crash before tool execution (proposal logged but not started)', async () => {
    const proposal = createSampleProposal();
    const execId = await journal.logProposal(proposal, false);

    // Simulate crash before logStart
    const interrupted = await journal.getInterruptedEntries(taskId);
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]!.executionId).toBe(execId);
    expect(interrupted[0]!.status).toBe(ActionExecutionStatus.PROPOSED);
  });

  it('should detect crash during tool execution (logStart called, crash before completion)', async () => {
    const proposal = createSampleProposal();
    const execId = await journal.logProposal(proposal, false);
    await journal.logStart(execId);

    // Simulate crash during execution
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    expect(analysis.interruptedEntries).toHaveLength(1);
    expect(analysis.interruptedEntries[0]!.status).toBe(ActionExecutionStatus.RUNNING);
    expect(analysis.recommendedPolicy).toBe(RecoveryPolicy.RETRY_SAFE);
  });

  it('should classify crash after tool execution completion as COMPLETED (no interrupted entries)', async () => {
    const proposal = createSampleProposal();
    const execId = await journal.logProposal(proposal, false);
    await journal.logStart(execId);
    await journal.logCompletion(execId, {
      actionId: execId,
      status: ActionResultStatus.SUCCESS,
      output: 'file content',
      durationMs: 10,
      executedAt: clock.now(),
      metadata: {},
    });

    const interrupted = await journal.getInterruptedEntries(taskId);
    expect(interrupted).toHaveLength(0);

    const entry = await journal.getEntry(execId);
    expect(entry?.status).toBe(ActionExecutionStatus.COMPLETED);
  });

  it('should enforce REQUIRE_REVIEW policy when destructive action crashes mid-execution', async () => {
    const destructiveProposal = createSampleProposal(
      ActionType.FILE_DELETE,
      'Delete production data',
      true,
    );

    const execId = await journal.logProposal(destructiveProposal, true);
    await journal.logStart(execId);

    // Crash during destructive operation
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );

    expect(analysis.requiresHumanReview).toBe(true);
    expect(analysis.recommendedPolicy).toBe(RecoveryPolicy.REQUIRE_REVIEW);

    const decision = recoveryManager.createRecoveryDecision(analysis);
    expect(decision.action).toBe('ESCALATE');
    expect(decision.recoveryPolicy).toBe(RecoveryPolicy.REQUIRE_REVIEW);
    expect(decision.rationale).toContain('Human review required');
  });

  it('should recover state from checkpoint after crash', async () => {
    // Record state transitions to reach PLAN phase, then create checkpoint
    await stateStore.transition(taskId, StateEvent.START); // INIT -> EXPLORE
    await stateStore.transition(taskId, StateEvent.EXPLORE_COMPLETE); // EXPLORE -> PLAN
    const currentState = (await stateStore.getState(taskId))!;

    const cp = await checkpointStore.create({
      taskId,
      iteration: 1,
      state: currentState,
      reason: 'Post-plan milestone',
    });

    // Crash happens
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    const decision = recoveryManager.createRecoveryDecision(analysis);

    expect(decision.targetCheckpointId).toBe(cp.id);

    const resumeResult = await resumeManager.resumeTask(taskId, decision);
    expect(resumeResult.resumedFromCheckpoint).toBe(cp.id);
    expect(resumeResult.state.phase).toBe(AgentPhase.PLAN);
  });

  it('should support event sourcing replay via EventStore', async () => {
    await eventStore.append({
      taskId,
      event: StateEvent.START,
      fromPhase: AgentPhase.INIT,
      toPhase: AgentPhase.EXPLORE,
      timestamp: clock.now(),
    });

    await eventStore.append({
      taskId,
      event: StateEvent.EXPLORE_COMPLETE,
      fromPhase: AgentPhase.EXPLORE,
      toPhase: AgentPhase.PLAN,
      timestamp: clock.now(),
    });

    const events = await eventStore.getEvents(taskId);
    expect(events).toHaveLength(2);
    expect(events[0]!.sequenceNumber).toBe(1);
    expect(events[1]!.sequenceNumber).toBe(2);
    expect(events[1]!.toPhase).toBe(AgentPhase.PLAN);
  });
});
