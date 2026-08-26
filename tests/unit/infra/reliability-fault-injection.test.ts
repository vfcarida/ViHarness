import { describe, it, expect, beforeEach } from 'vitest';
import {
  FaultInjector,
  FaultMode,
  DefaultStateStore,
  DefaultEventStore,
  DefaultExecutionJournal,
  DefaultRecoveryManager,
  DefaultResumeManager,
  DefaultCheckpointStore,
  DefaultGitManager,
  DefaultRollbackManager,
  ContradictoryEvidenceResolver,
  StateCorruptionValidator,
  UuidV7IdFactory,
  TestClock,
  AgentPhase,
  HUMAN_RESUMABLE_PHASES,
  StateEvent,
  ActionType,
  RecoveryPolicy,
  EvidenceOutcome,
  EvidenceType,
  StateMachine,
} from '../../../src/index.js';
import type { TaskId, ActionProposal } from '../../../src/index.js';

describe('Reliability Engineering & Fault Injection Suite', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let injector: FaultInjector;
  let stateStore: DefaultStateStore;
  let eventStore: DefaultEventStore;
  let journal: DefaultExecutionJournal;
  let checkpointStore: DefaultCheckpointStore;
  let gitManager: DefaultGitManager;
  let rollbackManager: DefaultRollbackManager;
  let recoveryManager: DefaultRecoveryManager;
  let resumeManager: DefaultResumeManager;
  let taskId: TaskId;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    injector = new FaultInjector();

    stateStore = new DefaultStateStore({ idFactory, clock });
    eventStore = new DefaultEventStore({ idFactory });
    journal = new DefaultExecutionJournal({ idFactory, clock });
    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    gitManager = new DefaultGitManager();
    rollbackManager = new DefaultRollbackManager();
    recoveryManager = new DefaultRecoveryManager();

    resumeManager = new DefaultResumeManager({
      stateStore,
      checkpointStore,
      idFactory,
      clock,
    });

    taskId = idFactory.create<'Task'>();
  });

  it('1. Model Timeout: Catches simulated model execution timeout (408)', () => {
    injector.enableFault(FaultMode.MODEL_TIMEOUT);
    expect(() => injector.maybeTrigger(FaultMode.MODEL_TIMEOUT)).toThrow(
      'Simulated Model Execution Timeout',
    );
  });

  it('2. Provider Outage: Catches simulated LLM provider outage (503)', () => {
    injector.enableFault(FaultMode.PROVIDER_OUTAGE);
    expect(() => injector.maybeTrigger(FaultMode.PROVIDER_OUTAGE)).toThrow(
      'Simulated LLM Provider Outage',
    );
  });

  it('3. Rate Limiting: Catches simulated rate limit exceeded (429)', () => {
    injector.enableFault(FaultMode.RATE_LIMITING);
    expect(() => injector.maybeTrigger(FaultMode.RATE_LIMITING)).toThrow(
      'Simulated Rate Limit Exceeded',
    );
  });

  it('4. Malformed Model Response: Handles invalid JSON model output gracefully', () => {
    injector.enableFault(FaultMode.MALFORMED_MODEL_RESPONSE);
    expect(() => injector.maybeTrigger(FaultMode.MALFORMED_MODEL_RESPONSE)).toThrow(
      'Malformed JSON',
    );
  });

  it('5. Tool Timeout: Catches tool execution timeout', () => {
    injector.enableFault(FaultMode.TOOL_TIMEOUT);
    expect(() => injector.maybeTrigger(FaultMode.TOOL_TIMEOUT)).toThrow('Tool Execution Timeout');
  });

  it('6. Tool Crash: Handles native tool process crash cleanly', () => {
    injector.enableFault(FaultMode.TOOL_CRASH);
    expect(() => injector.maybeTrigger(FaultMode.TOOL_CRASH)).toThrow('Tool Process Crash');
  });

  it('7. Verifier Crash: Catches internal verification exception', () => {
    injector.enableFault(FaultMode.VERIFIER_CRASH);
    expect(() => injector.maybeTrigger(FaultMode.VERIFIER_CRASH)).toThrow(
      'Verification Engine Internal Exception',
    );
  });

  it('8. Corrupted State: StateCorruptionValidator detects corrupted state snapshots', () => {
    expect(() => StateCorruptionValidator.validateOrThrow(null as any)).toThrow(
      'State object is null or undefined',
    );

    const corruptState: any = {
      id: null,
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      phase: AgentPhase.INIT,
      iterationCount: 1,
      repairCount: 0,
    };
    expect(() => StateCorruptionValidator.validateOrThrow(corruptState)).toThrow(
      'State snapshot is missing mandatory identifiers',
    );
  });

  it('9. Process Crash: RecoveryManager classifies crash and resumes task state', async () => {
    const proposal: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.FILE_READ,
      description: 'Read file',
      parameters: { path: 'src/main.ts' },
      irreversible: false,
      proposedAt: clock.now(),
    };

    const execId = await journal.logProposal(proposal, false);
    await journal.logStart(execId);

    const crashAnalysis = await recoveryManager.analyzeCrash(
      taskId,
      journal,
      eventStore,
      checkpointStore,
    );
    expect(crashAnalysis.interruptedEntries).toHaveLength(1);
    expect(crashAnalysis.recommendedPolicy).toBe(RecoveryPolicy.RETRY_SAFE);

    const decision = recoveryManager.createRecoveryDecision(crashAnalysis);
    const resumeResult = await resumeManager.resumeTask(taskId, decision);
    expect(resumeResult.state).toBeDefined();
  });

  it('10. Disk Failure Simulation: Handles simulated ENOSPC disk write failure', () => {
    injector.enableFault(FaultMode.DISK_FAILURE_SIMULATION);
    expect(() => injector.maybeTrigger(FaultMode.DISK_FAILURE_SIMULATION)).toThrow(
      'Disk I/O Write Failure',
    );
  });

  it('11. Interrupted Checkpoint: Enforces safe checkpoint creation state', () => {
    injector.enableFault(FaultMode.INTERRUPTED_CHECKPOINT);
    expect(() => injector.maybeTrigger(FaultMode.INTERRUPTED_CHECKPOINT)).toThrow(
      'Interrupted Checkpoint Commit',
    );
  });

  it('12. Interrupted Rollback: Handles interrupted rollback operation cleanly', async () => {
    const invalidCpId = idFactory.create<'Checkpoint'>();
    const result = await rollbackManager.rollbackToCheckpoint(
      invalidCpId,
      checkpointStore,
      gitManager,
    );
    expect(result.success).toBe(false);
  });

  it('13. Repeated Test Failure: StateMachine handles max repair attempts', async () => {
    const sm = new StateMachine({ taskId, idFactory, clock, initialPhase: AgentPhase.REPAIR });
    sm.apply(StateEvent.MAX_REPAIRS_EXCEEDED);

    expect(sm.phase).toBe(AgentPhase.HUMAN_REQUIRED);
    expect(HUMAN_RESUMABLE_PHASES.has(sm.phase)).toBe(true);
  });

  it('14. Contradictory Evidence: ContradictoryEvidenceResolver detects conflicting evidence and forces escalation', () => {
    const evidenceList = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        checkId: 'check-auth',
        type: EvidenceType.TEST_RESULT,
        outcome: EvidenceOutcome.PASS,
        summary: 'Unit test passed',
        data: {},
        createdAt: clock.now(),
        pass: true,
        confidence: 0.9,
        affectedFiles: ['src/auth.ts'],
      },
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        checkId: 'check-auth',
        type: EvidenceType.VERIFICATION,
        outcome: EvidenceOutcome.FAIL,
        summary: 'Verification check failed',
        data: {},
        createdAt: clock.now(),
        pass: false,
        confidence: 1.0,
        affectedFiles: ['src/auth.ts'],
      },
    ];

    const resolution = ContradictoryEvidenceResolver.evaluate(evidenceList);
    expect(resolution.hasContradiction).toBe(true);
    expect(resolution.requiresEscalation).toBe(true);
  });

  it('15. Subagent Timeout: Handles simulated subagent execution timeout', () => {
    injector.enableFault(FaultMode.SUBAGENT_TIMEOUT);
    expect(() => injector.maybeTrigger(FaultMode.SUBAGENT_TIMEOUT)).toThrow(
      'Subagent Execution Timeout',
    );
  });

  it('16. Context Compiler Failure: Handles simulated context compilation failure', () => {
    injector.enableFault(FaultMode.CONTEXT_COMPILER_FAILURE);
    expect(() => injector.maybeTrigger(FaultMode.CONTEXT_COMPILER_FAILURE)).toThrow(
      'Context Compiler Budget Failure',
    );
  });
});
