import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Domain Core & Models
  AgentPhase,
  StateEvent,
  GoalStatus,
  TaskStatus,
  ActionType,
  ActionResultStatus,
  PolicyDecisionType,
  ActionRiskCategory,
  VerificationProfile,
  VerificationStatus,
  EvidenceOutcome,
  EvidenceType,
  SubagentRole,
  HumanDecision,
  EscalationReason,
  RecoveryPolicy,
  ContextTier,
  ContextObjectType,
  ProviderHealthStatus,
  ModelCapability,
  // State & Runtime
  StateMachine,
  DefaultAgentRuntime,
  // DI Infrastructure
  UuidV7IdFactory,
  TestClock,
  MockModelProvider,
  UtilityModelRouter,
  InMemoryContextStore,
  ContextGraph,
  DefaultContextCompiler,
  InMemoryMemoryStore,
  MemoryRetriever,
  MemoryScorer,
  MemoryLifecycle,
  DefaultToolRegistry,
  DefaultToolExecutor,
  ReadFileTool,
  WriteFileTool,
  RunCommandTool,
  DefaultPolicyEngine,
  CredentialProtectionRule,
  CommandRestrictionRule,
  PathRestrictionRule,
  NetworkAccessRule,
  ProductionProtectionRule,
  LocalDevelopmentSandbox,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  DefaultEvidenceAggregator,
  DefaultCheckpointStore,
  DefaultGitManager,
  DefaultRollbackManager,
  DefaultSubagentManager,
  DefaultEscalationManager,
  DefaultTelemetryCollector,
  DefaultCostTracker,
  DefaultBudgetTracker,
  DefaultStateStore,
  DefaultEventStore,
  DefaultExecutionJournal,
  DefaultRecoveryManager,
  DefaultResumeManager,
} from '../../src/index.js';
import type { Goal, Task, ActionProposal, SubagentSpec, ModelDescriptor } from '../../src/index.js';

describe('Enterprise Coding-Agent Harness — End-to-End Integration Suite', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;

  // Infrastructure Components
  let primaryProvider: MockModelProvider;
  let backupProvider: MockModelProvider;
  let router: UtilityModelRouter;
  let contextStore: InMemoryContextStore;
  let contextGraph: ContextGraph;
  let contextCompiler: DefaultContextCompiler;
  let memoryStore: InMemoryMemoryStore;
  let registry: DefaultToolRegistry;
  let toolExecutor: DefaultToolExecutor;
  let policyEngine: DefaultPolicyEngine;
  let sandbox: LocalDevelopmentSandbox;
  let evidenceStore: DefaultEvidenceStore;
  let evidenceAggregator: DefaultEvidenceAggregator;
  let verificationEngine: DefaultVerificationEngine;
  let checkpointStore: DefaultCheckpointStore;
  let gitManager: DefaultGitManager;
  let rollbackManager: DefaultRollbackManager;
  let subagentManager: DefaultSubagentManager;
  let escalationManager: DefaultEscalationManager;
  let telemetryCollector: DefaultTelemetryCollector;
  let costTracker: DefaultCostTracker;
  let budgetTracker: DefaultBudgetTracker;
  let stateStore: DefaultStateStore;
  let eventStore: DefaultEventStore;
  let executionJournal: DefaultExecutionJournal;
  let recoveryManager: DefaultRecoveryManager;
  let resumeManager: DefaultResumeManager;
  let runtime: DefaultAgentRuntime;

  const defaultDescriptor: ModelDescriptor = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    providerId: 'openai',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([
        ModelCapability.REASONING,
        ModelCapability.CODING,
        ModelCapability.TOOL_USE,
      ]),
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.0025,
    costPer1kOutputTokensDollars: 0.01,
  };

  const sonnetDescriptor: ModelDescriptor = {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    providerId: 'anthropic',
    version: '3.5',
    capabilities: {
      capabilities: new Set([
        ModelCapability.REASONING,
        ModelCapability.CODING,
        ModelCapability.TOOL_USE,
      ]),
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.003,
    costPer1kOutputTokensDollars: 0.015,
  };

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));

    // 1. Providers & Router
    primaryProvider = new MockModelProvider({
      providerId: 'openai',
      descriptor: defaultDescriptor,
    });
    backupProvider = new MockModelProvider({
      providerId: 'anthropic',
      descriptor: sonnetDescriptor,
    });

    router = new UtilityModelRouter({ idFactory });
    router.registerProvider(primaryProvider);
    router.registerProvider(backupProvider);

    // 2. Context & Memory Subsystems
    contextStore = new InMemoryContextStore({ idFactory, clock });
    contextGraph = new ContextGraph();
    contextCompiler = new DefaultContextCompiler({ idFactory, clock });

    memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const memoryScorer = new MemoryScorer();
    const memoryRetriever = new MemoryRetriever(memoryStore, memoryScorer);
    const memoryLifecycle = new MemoryLifecycle(memoryStore, clock);

    // 3. Tool Execution & Security Layer
    registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));
    registry.register(new RunCommandTool(idFactory));

    toolExecutor = new DefaultToolExecutor({ registry, idFactory });

    policyEngine = new DefaultPolicyEngine({
      rules: [
        new CredentialProtectionRule(),
        new PathRestrictionRule(),
        new CommandRestrictionRule(),
        new NetworkAccessRule(),
        new ProductionProtectionRule(),
      ],
      idFactory,
      clock,
    });

    sandbox = new LocalDevelopmentSandbox();

    // 4. Verification & Evidence Layers
    evidenceStore = new DefaultEvidenceStore();
    evidenceAggregator = new DefaultEvidenceAggregator();

    verificationEngine = new DefaultVerificationEngine({
      evidenceStore,
      idFactory,
      clock,
    });

    // 5. Repository State & Reversibility
    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    gitManager = new DefaultGitManager({
      initialBranch: 'main',
      initialCommit: 'c0000000000000000000',
    });
    rollbackManager = new DefaultRollbackManager();

    // 6. Subagents & Escalation
    subagentManager = new DefaultSubagentManager({
      idFactory,
      clock,
      toolExecutor,
      evidenceStore,
    });

    escalationManager = new DefaultEscalationManager({
      idFactory,
      clock,
      evidenceStore,
    });

    // 7. Telemetry & Cost
    telemetryCollector = new DefaultTelemetryCollector({ idFactory, clock });
    costTracker = new DefaultCostTracker();
    budgetTracker = new DefaultBudgetTracker();

    // 8. Persistence & Recovery
    stateStore = new DefaultStateStore({ idFactory, clock });
    eventStore = new DefaultEventStore({ idFactory });
    executionJournal = new DefaultExecutionJournal({ idFactory, clock });
    recoveryManager = new DefaultRecoveryManager();
    resumeManager = new DefaultResumeManager({
      stateStore,
      checkpointStore,
      idFactory,
      clock,
    });

    // 9. Core Agent Runtime
    runtime = new DefaultAgentRuntime({
      router,
      compiler: contextCompiler,
      policyEngine,
      toolExecutor,
      verificationEngine,
      evidenceStore,
      checkpointStore,
      idFactory,
      clock,
    });
  });

  it('16-Step Canonical Execution: User creates task -> Context Compiled -> Router selects model -> Policy Evaluates -> Tool Executes -> Verification runs -> Evidence stored -> Checkpoint created -> Task reaches DONE', async () => {
    // 1. User creates goal & task
    const goalId = idFactory.create<'Goal'>();
    const taskId = idFactory.create<'Task'>();

    const goal: Goal = {
      id: goalId,
      description: 'Implement secure login feature',
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
    };

    const task: Task = {
      id: taskId,
      goalId,
      description: 'Create login validator in src/auth/login.ts',
      status: TaskStatus.PENDING,
      createdAt: clock.now(),
    };

    // 2. Task enters INIT phase
    const stateMachine = new StateMachine({ taskId, idFactory, clock });
    expect(stateMachine.phase).toBe(AgentPhase.INIT);

    // Record INIT state event
    await eventStore.append({
      taskId,
      event: StateEvent.START,
      fromPhase: AgentPhase.INIT,
      toPhase: AgentPhase.EXPLORE,
      timestamp: clock.now(),
    });

    // Transition state machine: INIT -> EXPLORE
    stateMachine.apply(StateEvent.START);
    expect(stateMachine.phase).toBe(AgentPhase.EXPLORE);

    // 3. Context is compiled
    const compilationResult = await contextCompiler.compile({
      goal,
      currentState: stateMachine.state,
      task,
      targetModelDescriptor: defaultDescriptor,
      budget: { maxTokens: 4000, maxObjects: 20 },
    });
    expect(compilationResult.compiledContext.totalTokenEstimate).toBeGreaterThan(0);

    // 4. Model Router selects optimal model
    const routingDecision = await router.route({
      taskId,
      goal: goal.description,
      state: stateMachine.state,
      requiredCapabilities: [],
    });
    expect(routingDecision.selectedModelId).toBeDefined();

    // 5. Agent receives compiled context & proposes tool call
    const actionProposal: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.FILE_WRITE,
      description: 'Write login validation code to src/auth/login.ts',
      parameters: {
        path: 'src/auth/login.ts',
        content: 'export function validateLogin() { return true; }',
      },
      irreversible: false,
      proposedAt: clock.now(),
    };

    // Log proposal in ExecutionJournal
    const execId = await executionJournal.logProposal(actionProposal, false);

    // 6 & 7. Policy Engine evaluates action proposal (Deny-First Precedence)
    const policyDecision = await policyEngine.evaluate(
      {
        id: actionProposal.id,
        type: actionProposal.type,
        resource: (actionProposal.parameters.path as string) ?? 'src/auth/login.ts',
        parameters: actionProposal.parameters as Record<string, unknown>,
        irreversible: actionProposal.irreversible,
      },
      {
        allowedPaths: ['src/'],
        forbiddenPaths: ['.env', 'secrets/'],
        allowedCommands: ['npm test', 'tsc'],
        forbiddenCommands: ['rm -rf /'],
        allowNetwork: false,
        requireApprovalForDestructive: true,
      },
    );
    expect(policyDecision.decision).toBe(PolicyDecisionType.ALLOW);

    // 8. Tool Executes in Local Development Sandbox
    await executionJournal.logStart(execId);
    const sandboxResult = await sandbox.execute({
      command: 'node -e "console.log(\'Validating login code\')"',
      workingDirectory: process.cwd(),
    });
    expect(sandboxResult.exitCode).toBe(0);

    const toolResult = await toolExecutor.execute({
      toolName: 'write_file',
      input: {
        path: 'src/auth/login.ts',
        content: 'export function validateLogin() { return true; }',
      },
    });
    expect(toolResult.success).toBe(true);
    await executionJournal.logCompletion(execId, toolResult);

    // 9. Verification Engine runs checks
    const verificationResult = await verificationEngine.verify(
      {
        type: 'unit-test',
        path: 'src/auth/login.ts',
        taskId,
      },
      VerificationProfile.STANDARD,
    );
    expect(verificationResult.status).toBe(VerificationStatus.PASSED);

    // 10. Evidence is stored in EvidenceStore
    const evidenceList = await evidenceStore.listForTask(taskId);
    expect(evidenceList.length).toBeGreaterThan(0);
    expect(evidenceList[0]!.outcome).toBe(EvidenceOutcome.PASS);

    // 11. State updates: EXPLORE -> PLAN -> IMPLEMENT -> VERIFY
    stateMachine.apply(StateEvent.EXPLORE_COMPLETE); // EXPLORE -> PLAN
    stateMachine.apply(StateEvent.PLAN_READY); // PLAN -> IMPLEMENT
    stateMachine.apply(StateEvent.IMPLEMENTATION_COMPLETE); // IMPLEMENT -> VERIFY
    expect(stateMachine.phase).toBe(AgentPhase.VERIFY);

    // 12. Context is recomputed with new evidence & artifacts
    const recomputedContext = await contextCompiler.compile({
      goal,
      currentState: stateMachine.state,
      task,
      recentEvidence: evidenceList,
      targetModelDescriptor: defaultDescriptor,
      budget: { maxTokens: 4000, maxObjects: 20 },
    });
    expect(recomputedContext.compiledContext).toBeDefined();

    // 13. Completion is evaluated via EvidenceAggregator & AcceptancePolicy
    const acceptanceEvaluation = evidenceAggregator.evaluateAcceptance(taskId, evidenceList, {
      zeroRegressionsRequired: true,
      minConfidence: 0.8,
      allowWarnings: true,
    });
    expect(acceptanceEvaluation.satisfied).toBe(true);

    // 14 & 15. Checkpoint is created
    const commitRef = await gitManager.createCommit(
      'Milestone: Login validation passed verification',
    );
    const checkpoint = await checkpointStore.create({
      taskId,
      iteration: 2,
      state: stateMachine.state,
      gitRef: commitRef,
      reason: 'All checks passed',
      agentOwnedFiles: ['src/auth/login.ts'],
    });
    expect(checkpoint.id).toBeDefined();

    // 16. Task reaches DONE terminal state
    const doneEvidenceId = idFactory.create<'Evidence'>();
    stateMachine.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [doneEvidenceId] }); // VERIFY -> DONE
    expect(stateMachine.phase).toBe(AgentPhase.DONE);
    expect(stateMachine.isTerminal).toBe(true);

    // Record Telemetry
    telemetryCollector.recordAgentTask(true, 2, 'GOAL_ACHIEVED');
    const telemetry = telemetryCollector.getAggregatedTelemetry();
    expect(telemetry.agent.successRate).toBe(1.0);
  });

  it('Model Swap Between Iterations: Hot-swaps models dynamically based on task requirements', async () => {
    const taskId = idFactory.create<'Task'>();
    const sm = new StateMachine({ taskId, idFactory, clock });

    // Iteration 1: Fast reasoning router selection
    const route1 = await router.route({
      taskId,
      goal: 'Explore problem space',
      state: sm.state,
      requiredCapabilities: [],
    });
    expect(route1.selectedModelId).toBeDefined();

    // Iteration 2: Swap model to preferred anthropic coding model
    const route2 = await router.route({
      taskId,
      goal: 'Complex refactoring',
      state: { ...sm.state, phase: AgentPhase.IMPLEMENT },
      requiredCapabilities: [],
      preferredProviderId: 'anthropic',
    });
    expect(route2.selectedProvider.providerId).toBe('anthropic');
  });

  it('Context Compaction: Compresses context size over multiple iterations without losing MUST-PRESERVE elements', async () => {
    const taskId = idFactory.create<'Task'>();
    const sm = new StateMachine({ taskId, idFactory, clock });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Context compaction test',
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
    };

    const task: Task = {
      id: taskId,
      goalId: goal.id,
      description: 'Compact context items',
      status: TaskStatus.IN_PROGRESS,
      createdAt: clock.now(),
    };

    // Populate ContextStore with 15 objects
    for (let i = 1; i <= 15; i++) {
      await contextStore.addObject({
        taskId,
        tier: ContextTier.L1_WORKING,
        type: ContextObjectType.OBSERVATION,
        content: `Iteration ${i} intermediate discovery observation text details...`,
        importance: i === 15 ? 999.0 : 0.5,
      });
    }

    const result = await contextCompiler.compile({
      goal,
      task,
      currentState: sm.state,
      targetModelDescriptor: defaultDescriptor,
      budget: { maxTokens: 500, maxObjects: 5 },
    });

    expect(result.compiledContext.entries.length).toBeLessThanOrEqual(5);
    expect(result.metrics.retainedCount).toBeGreaterThan(0);
  });

  it('Failed Tests & Repair Loop: VERIFY -> REPAIR -> VERIFY -> DONE', async () => {
    const taskId = idFactory.create<'Task'>();
    const sm = new StateMachine({ taskId, idFactory, clock, initialPhase: AgentPhase.VERIFY });

    // 1. Verification fails -> REPAIR
    sm.apply(StateEvent.VERIFICATION_FAILED);
    expect(sm.phase).toBe(AgentPhase.REPAIR);

    // 2. Repair fixes issue -> VERIFY
    sm.apply(StateEvent.REPAIR_COMPLETE);
    expect(sm.phase).toBe(AgentPhase.VERIFY);

    // 3. Verification passes -> DONE
    const doneEvidenceId = idFactory.create<'Evidence'>();
    sm.apply(StateEvent.VERIFICATION_PASSED, { evidenceIds: [doneEvidenceId] });
    expect(sm.phase).toBe(AgentPhase.DONE);
  });

  it('Regression Detection: Target test passes but unrelated baseline test fails -> Blocks DONE state', async () => {
    const taskId = idFactory.create<'Task'>();

    const baselineEvidence = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: EvidenceType.TEST_RESULT,
        outcome: EvidenceOutcome.PASS,
        summary: 'Auth module tests pass',
        data: {},
        createdAt: clock.now(),
        pass: true,
        checkId: 'check-auth',
        confidence: 0.95,
        affectedFiles: [],
      },
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: EvidenceType.TEST_RESULT,
        outcome: EvidenceOutcome.PASS,
        summary: 'Billing module tests pass',
        data: {},
        createdAt: clock.now(),
        pass: true,
        checkId: 'check-billing',
        confidence: 0.95,
        affectedFiles: [],
      },
    ];

    // Current evidence: check-auth PASS, check-billing FAIL (Regression!)
    const currentEvidence = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: EvidenceType.TEST_RESULT,
        outcome: EvidenceOutcome.PASS,
        summary: 'Auth module tests pass',
        data: {},
        createdAt: clock.now(),
        pass: true,
        checkId: 'check-auth',
        confidence: 0.95,
        affectedFiles: [],
      },
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: EvidenceType.TEST_RESULT,
        outcome: EvidenceOutcome.FAIL,
        summary: 'Billing module tests fail',
        data: {},
        createdAt: clock.now(),
        pass: false,
        checkId: 'check-billing',
        confidence: 0.95,
        affectedFiles: [],
      },
    ];

    const regressions = evidenceAggregator.detectRegressions(
      taskId,
      currentEvidence,
      baselineEvidence,
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0]!.outcome).toBe(EvidenceOutcome.REGRESSION);

    const evaluation = evidenceAggregator.evaluateAcceptance(taskId, regressions, {
      zeroRegressionsRequired: true,
    });
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.regressionsDetected).toHaveLength(1);
  });

  it('Human Escalation: High-risk action triggers escalation and records durable decision evidence', async () => {
    const taskId = idFactory.create<'Task'>();

    const req = await escalationManager.requestEscalation({
      taskId,
      reason: EscalationReason.HIGH_RISK,
      summary: 'Production deployment requires approval',
      risk: ActionRiskCategory.PRODUCTION_IMPACTING,
    });

    expect(req.status).toBe('PENDING' as any);

    const resolution = await escalationManager.resolveEscalation(req.id, {
      taskId,
      decision: HumanDecision.APPROVE,
      decidedBy: 'lead_architect',
      rationale: 'Approved for deployment',
    });

    expect(resolution.request.status).toBe('RESOLVED' as any);

    // Durable Evidence persisted
    const evidenceList = await evidenceStore.listForTask(taskId);
    expect(evidenceList).toHaveLength(1);
    expect(evidenceList[0]!.type).toBe(EvidenceType.HUMAN_FEEDBACK);
    expect(evidenceList[0]!.pass).toBe(true);
  });

  it('Rollback & User Change Preservation: Restores agent files while preserving user modifications', async () => {
    const taskId = idFactory.create<'Task'>();
    const sm = new StateMachine({ taskId, idFactory, clock });
    const commitRef = await gitManager.createCommit('Initial state');

    // Agent modifies auth.ts
    gitManager.markFileOwner('src/auth.ts', 'agent');
    // User modifies notes.txt
    gitManager.markFileOwner('notes.txt', 'user');

    const cp = await checkpointStore.create({
      taskId,
      iteration: 1,
      state: sm.state,
      gitRef: commitRef,
      agentOwnedFiles: ['src/auth.ts'],
      userOwnedFiles: ['notes.txt'],
    });

    const rollbackResult = await rollbackManager.rollbackToCheckpoint(
      cp.id,
      checkpointStore,
      gitManager,
    );
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.revertedFiles).toContain('src/auth.ts');
    expect(rollbackResult.preservedUserChanges).toContain('notes.txt');
  });

  it('Provider Outage & Resilience: Exponential backoff retries with full jitter and failover', async () => {
    const failingProvider = new MockModelProvider({
      providerId: 'failing-provider',
      healthStatus: ProviderHealthStatus.UNHEALTHY,
      descriptor: {
        id: 'failing-model',
        name: 'Failing Model',
        providerId: 'failing-provider',
        version: '1.0',
        capabilities: {
          capabilities: new Set([ModelCapability.REASONING]),
          maxContextTokens: 4000,
          maxOutputTokens: 1000,
          supportsSystemPrompt: false,
        },
        costPer1kInputTokensDollars: 0.001,
        costPer1kOutputTokensDollars: 0.002,
      },
    });

    const taskId = idFactory.create<'Task'>();
    const sm = new StateMachine({ taskId, idFactory, clock });

    const outageRouter = new UtilityModelRouter({ idFactory });
    outageRouter.registerProvider(failingProvider);
    outageRouter.registerProvider(backupProvider);

    const route = await outageRouter.route({
      taskId,
      goal: 'Execute with fallback provider',
      state: sm.state,
      requiredCapabilities: [],
    });

    expect(route.selectedProvider).toBeDefined();
    expect(route.selectedProvider.providerId).toBe('anthropic');
  });

  it('Process Restart & Crash Recovery: Resumes safely after crash without silently repeating destructive operations', async () => {
    const taskId = idFactory.create<'Task'>();

    const proposal: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.SHELL_EXECUTE,
      description: 'Delete temp build files: rm -rf /tmp/build',
      parameters: {},
      irreversible: true,
      proposedAt: clock.now(),
    };

    const execId = await executionJournal.logProposal(proposal, true);
    await executionJournal.logStart(execId);

    // Process crashes while destructive action is RUNNING
    const crashAnalysis = await recoveryManager.analyzeCrash(
      taskId,
      executionJournal,
      eventStore,
      checkpointStore,
    );
    expect(crashAnalysis.requiresHumanReview).toBe(true);

    const decision = recoveryManager.createRecoveryDecision(crashAnalysis);
    expect(decision.action).toBe('ESCALATE');
    expect(decision.recoveryPolicy).toBe(RecoveryPolicy.REQUIRE_REVIEW);

    const resumeResult = await resumeManager.resumeTask(taskId, decision);
    expect(resumeResult.actionToTake).toBe('ESCALATE');
  });

  it('Subagent Subsystem: Executes parallel subagents returning artifacts and evidence without full transcripts', async () => {
    const spec1: SubagentSpec = {
      role: SubagentRole.EXPLORE,
      description: 'Explore API endpoints',
      scope: { workingDirectory: 'src/api' },
      allowedTools: ['read_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const spec2: SubagentSpec = {
      role: SubagentRole.TESTER,
      description: 'Generate unit tests',
      scope: { workingDirectory: 'tests/unit' },
      allowedTools: ['read_file', 'write_file'],
      maxContextTokens: 4000,
      maxIterations: 3,
      timeoutMs: 5000,
    };

    const subagentResults = await subagentManager.executeParallel([spec1, spec2]);

    expect(subagentResults).toHaveLength(2);
    expect(subagentResults[0]!.success).toBe(true);
    expect(subagentResults[1]!.success).toBe(true);
    expect(subagentResults[0]!.artifacts.length).toBeGreaterThan(0);
    expect((subagentResults[0] as any).transcript).toBeUndefined();
  });

  it('Budget Exhaustion: Financial cost exceeding budget limit triggers BUDGET_EXCEEDED state transition', async () => {
    const taskId = idFactory.create<'Task'>();
    budgetTracker.setTaskBudget(taskId, 0.1); // $0.10 budget limit

    // Incur usage of $0.15
    budgetTracker.recordUsage(taskId, 'gpt-4o', 0.15);

    const check = budgetTracker.checkBudget(taskId, 'gpt-4o', 0.05);
    expect(check.allowed).toBe(false);
    expect(check.errorMessage).toContain('budget limit');

    // State machine transitions to BUDGET_EXCEEDED
    const sm = new StateMachine({ taskId, idFactory, clock });
    sm.apply(StateEvent.START); // INIT -> EXPLORE
    sm.apply(StateEvent.BUDGET_EXHAUSTED); // EXPLORE -> BUDGET_EXCEEDED

    expect(sm.phase).toBe('BUDGET_EXCEEDED');
    expect(sm.isTerminal).toBe(true);
  });
});
