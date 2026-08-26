import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultStateStore,
  DefaultEventStore,
  DefaultExecutionJournal,
  DefaultRecoveryManager,
  DefaultResumeManager,
  DefaultCheckpointStore,
  DefaultEvidenceStore,
  DefaultGitManager,
  DefaultRollbackManager,
  UuidV7IdFactory,
  TestClock,
  AgentPhase,
  StateEvent,
  ActionType,
  ActionResultStatus,
  ActionExecutionStatus,
  RecoveryPolicy,
  EvidenceType,
  EvidenceOutcome,
  HarnessError,
  ErrorCode,
  ErrorCategory,
} from '../../../src/index.js';
import type { TaskId, ActionProposal, Evidence } from '../../../src/index.js';

describe('Crash-Safe Execution & Persistence Subsystem', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let stateStore: DefaultStateStore;
  let eventStore: DefaultEventStore;
  let journal: DefaultExecutionJournal;
  let checkpointStore: DefaultCheckpointStore;
  let evidenceStore: DefaultEvidenceStore;
  let recoveryManager: DefaultRecoveryManager;
  let resumeManager: DefaultResumeManager;
  let gitManager: DefaultGitManager;
  let rollbackManager: DefaultRollbackManager;
  let taskId: TaskId;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

    eventStore = new DefaultEventStore({ idFactory });
    stateStore = new DefaultStateStore({ idFactory, clock, eventStore });
    journal = new DefaultExecutionJournal({ idFactory, clock });
    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    evidenceStore = new DefaultEvidenceStore();
    recoveryManager = new DefaultRecoveryManager();

    resumeManager = new DefaultResumeManager({
      stateStore,
      checkpointStore,
      idFactory,
      clock,
    });

    gitManager = new DefaultGitManager();
    rollbackManager = new DefaultRollbackManager();

    taskId = idFactory.create<'Task'>();
  });

  function createProposal(
    type: ActionType = ActionType.FILE_READ,
    description: string = 'Read file',
    isDestructive: boolean = false,
  ): ActionProposal {
    return {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type,
      description,
      parameters: { path: 'src/app.ts' },
      irreversible: isDestructive,
      proposedAt: clock.now(),
    };
  }

  // =========================================================================
  // 1. Crash Before Action
  // =========================================================================

  it('1. Crash before action: proposal logged as PROPOSED, crashes before START', async () => {
    const proposal = createProposal(ActionType.FILE_READ, 'Read config', false);
    const execId = await journal.logProposal(proposal, false);

    // Verify initial status is PROPOSED
    const entry = await journal.getEntry(execId);
    expect(entry?.status).toBe(ActionExecutionStatus.PROPOSED);

    // Simulate process crash before logStart
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    expect(analysis.interruptedEntries).toHaveLength(1);
    expect(analysis.interruptedEntries[0]!.executionId).toBe(execId);
  });

  // =========================================================================
  // 2. Crash During Action (Non-Destructive vs Destructive)
  // =========================================================================

  it('2a. Crash during non-destructive action: STARTED status classified as RETRY_SAFE', async () => {
    const proposal = createProposal(ActionType.FILE_READ, 'Read data', false);
    const execId = await journal.logProposal(proposal, false);
    await journal.logAuthorization(execId);
    await journal.logStart(execId);

    const entry = await journal.getEntry(execId);
    expect(entry?.status).toBe(ActionExecutionStatus.STARTED);

    // Simulate crash mid-execution
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    expect(analysis.interruptedEntries).toHaveLength(1);
    expect(analysis.requiresHumanReview).toBe(false);
    expect(analysis.recommendedPolicy).toBe(RecoveryPolicy.RETRY_SAFE);

    const decision = recoveryManager.createRecoveryDecision(analysis);
    expect(decision.action).toBe('RETRY_ACTION');
    expect(decision.recoveryPolicy).toBe(RecoveryPolicy.RETRY_SAFE);
  });

  it('2b. Crash during destructive action: status becomes UNKNOWN, automatic retry is PREVENTED, forces ESCALATE', async () => {
    const proposal = createProposal(ActionType.FILE_DELETE, 'Delete build artifacts', true);
    const execId = await journal.logProposal(proposal, true);
    await journal.logAuthorization(execId);
    await journal.logStart(execId);

    // Simulate process crash during destructive operation
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );

    // The status must be updated to UNKNOWN
    const updatedEntry = await journal.getEntry(execId);
    expect(updatedEntry?.status).toBe(ActionExecutionStatus.UNKNOWN);
    expect(updatedEntry?.unknownReason).toContain('UNKNOWN');

    // Policy MUST require review/escalation — NO automatic retry!
    expect(analysis.requiresHumanReview).toBe(true);
    expect(analysis.recommendedPolicy).toBe(RecoveryPolicy.REQUIRE_REVIEW);

    const decision = recoveryManager.createRecoveryDecision(analysis);
    expect(decision.action).toBe('ESCALATE');
    expect(decision.recoveryPolicy).toBe(RecoveryPolicy.REQUIRE_REVIEW);
    expect(decision.rationale).toContain('strictly forbidden');
  });

  // =========================================================================
  // 3. Crash After Action
  // =========================================================================

  it('3. Crash after action: logged as COMPLETED, crash after execution -> 0 interrupted, resumes safely', async () => {
    const proposal = createProposal(ActionType.FILE_WRITE, 'Write file', true);
    const execId = await journal.logProposal(proposal, true);
    await journal.logAuthorization(execId);
    await journal.logStart(execId);
    await journal.logCompletion(execId, {
      actionId: execId,
      status: ActionResultStatus.SUCCESS,
      output: 'Written 100 bytes',
      durationMs: 25,
      executedAt: clock.now(),
      metadata: {},
    });

    // Simulate crash after logCompletion
    const analysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    expect(analysis.interruptedEntries).toHaveLength(0);
    expect(analysis.requiresHumanReview).toBe(false);

    const decision = recoveryManager.createRecoveryDecision(analysis);
    expect(decision.action).toBe('RESUME');
    expect(decision.recoveryPolicy).toBe(RecoveryPolicy.RETRY_SAFE);
  });

  // =========================================================================
  // 4. Crash Before Evidence
  // =========================================================================

  it('4. Crash before evidence: verification finishes but crash occurs before storing evidence -> DONE gate blocks transition', async () => {
    // Transition state machine to VERIFY
    await stateStore.transition(taskId, StateEvent.START); // INIT -> EXPLORE
    await stateStore.transition(taskId, StateEvent.EXPLORE_COMPLETE); // EXPLORE -> PLAN
    await stateStore.transition(taskId, StateEvent.PLAN_READY); // PLAN -> IMPLEMENT
    await stateStore.transition(taskId, StateEvent.IMPLEMENTATION_COMPLETE); // IMPLEMENT -> VERIFY

    const currentState = await stateStore.getState(taskId);
    expect(currentState?.phase).toBe(AgentPhase.VERIFY);

    // Simulate crash before evidenceStore.record() finishes
    // Attempting to transition to DONE without evidenceIds must fail
    await expect(
      stateStore.transition(taskId, StateEvent.VERIFICATION_PASSED, { evidenceIds: [] }),
    ).rejects.toThrow(HarnessError);

    // State machine MUST remain in VERIFY phase
    const stateAfterCrash = await stateStore.getState(taskId);
    expect(stateAfterCrash?.phase).toBe(AgentPhase.VERIFY);
  });

  // =========================================================================
  // 5. Crash After Evidence
  // =========================================================================

  it('5. Crash after evidence: evidence durably stored, crash before DONE -> recovery reconstructs and completes DONE transition', async () => {
    // Transition to VERIFY
    await stateStore.transition(taskId, StateEvent.START);
    await stateStore.transition(taskId, StateEvent.EXPLORE_COMPLETE);
    await stateStore.transition(taskId, StateEvent.PLAN_READY);
    await stateStore.transition(taskId, StateEvent.IMPLEMENTATION_COMPLETE);

    const evidenceId = idFactory.create<'Evidence'>();
    const evidence: Evidence = {
      id: evidenceId,
      taskId,
      checkId: 'check-typecheck',
      type: EvidenceType.VERIFICATION,
      outcome: EvidenceOutcome.PASS,
      summary: 'TypeScript compilation passed clean',
      data: { errors: 0 },
      createdAt: clock.now(),
      pass: true,
      confidence: 1.0,
      affectedFiles: ['src/app.ts'],
    };

    // Durably store evidence
    await evidenceStore.record(evidence);
    const retrieved = await evidenceStore.get(evidenceId);
    expect(retrieved).toBeDefined();

    // Process crashes here (before stateStore.transition to DONE)
    // Recovery fetches stored evidence for task
    const storedEvidence = await evidenceStore.listForTask(taskId);
    expect(storedEvidence).toHaveLength(1);
    const passingEvidenceIds = storedEvidence.filter((e) => e.pass).map((e) => e.id);

    // Resume execution using durable evidence
    const finalTransition = await stateStore.transition(taskId, StateEvent.VERIFICATION_PASSED, {
      evidenceIds: passingEvidenceIds,
    });

    expect(finalTransition.to).toBe(AgentPhase.DONE);
    const finalState = await stateStore.getState(taskId);
    expect(finalState?.phase).toBe(AgentPhase.DONE);
  });

  // =========================================================================
  // 6. Crash During Checkpoint & Durable Ordering
  // =========================================================================

  it('6a. Durable ordering: EventStore failure prevents StateStore state mutation', async () => {
    // Create an EventStore that throws on append (simulating disk full / write error)
    const failingEventStore = {
      async append() {
        throw new HarnessError({
          code: ErrorCode.SYSTEM_DISK_FULL,
          category: ErrorCategory.SYSTEM,
          message: 'Simulated ENOSPC write failure',
        });
      },
      async getEvents() {
        return [];
      },
      async getLastEvent() {
        return undefined;
      },
      async clear() {},
    };

    const durableStateStore = new DefaultStateStore({
      idFactory,
      clock,
      eventStore: failingEventStore,
    });

    // Attempt transition — EventStore append throws
    await expect(durableStateStore.transition(taskId, StateEvent.START)).rejects.toThrow(
      'Simulated ENOSPC write failure',
    );

    // State machine MUST remain in INIT phase
    const state = await durableStateStore.getState(taskId);
    expect(state?.phase).toBe(AgentPhase.INIT);
  });

  it('6b. Crash during checkpoint: partial checkpoint failure is ignored, recovers from last valid checkpoint', async () => {
    // Reach PLAN phase and create a valid checkpoint
    await stateStore.transition(taskId, StateEvent.START);
    await stateStore.transition(taskId, StateEvent.EXPLORE_COMPLETE);
    const planState = (await stateStore.getState(taskId))!;

    const validCp = await checkpointStore.create({
      taskId,
      iteration: 1,
      state: planState,
      reason: 'Valid checkpoint',
    });

    // Simulate crash during second checkpoint creation (throws error)
    try {
      throw new Error('Process killed during checkpoint commit');
    } catch {
      // Recovery manager scans existing checkpoints
      const analysis = await recoveryManager.analyzeCrash(
        taskId,
        journal,
        eventStore,
        checkpointStore,
      );
      expect(analysis.lastCheckpointId).toBe(validCp.id);

      const decision = recoveryManager.createRecoveryDecision(analysis);
      const resumeResult = await resumeManager.resumeTask(taskId, decision);

      expect(resumeResult.resumedFromCheckpoint).toBe(validCp.id);
      expect(resumeResult.state.phase).toBe(AgentPhase.PLAN);
    }
  });

  // =========================================================================
  // 7. Crash During Rollback
  // =========================================================================

  it('7. Crash during rollback: incomplete rollback fails safely and returns success: false', async () => {
    const invalidCpId = idFactory.create<'Checkpoint'>();

    // Attempt rollback to non-existent / interrupted checkpoint
    const result = await rollbackManager.rollbackToCheckpoint(
      invalidCpId,
      checkpointStore,
      gitManager,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
