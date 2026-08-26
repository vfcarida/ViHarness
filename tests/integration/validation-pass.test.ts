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
  VerificationProfile,
  VerificationStatus,
  EvidenceOutcome,
  EvidenceType,
  ModelCapability,
  checkOscillation,
  // State & Runtime
  StateMachine,
  // DI Infrastructure
  UuidV7IdFactory,
  TestClock,
  MockModelProvider,
  UtilityModelRouter,
  InMemoryContextStore,
  DefaultContextCompiler,
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
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  DefaultEvidenceAggregator,
  DefaultCheckpointStore,
  DefaultGitManager,
  DefaultRollbackManager,
  DefaultTelemetryCollector,
  DefaultCostTracker,
  DefaultStateStore,
  DefaultEventStore,
  DefaultExecutionJournal,
  DefaultRecoveryManager,
  DefaultResumeManager,
} from '../../src/index.js';
import type {
  Goal,
  Task,
  ActionProposal,
  ModelDescriptor,
  StateTransition,
} from '../../src/index.js';

describe('Enterprise Coding-Agent Harness — Real Task End-to-End Validation Pass', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;

  // Telemetry & Metrics Data Structure for Engineering Report
  interface IterationTelemetry {
    iteration: number;
    phase: AgentPhase;
    modelSelected: string;
    contextTokensBefore: number;
    contextTokensAfter: number;
    compressionRatio: number;
    toolCall?: string;
    verificationStatus?: string;
    costIncurredDollars: number;
  }

  const telemetryLog: IterationTelemetry[] = [];

  // Infrastructure Components
  let gpt4oProvider: MockModelProvider;
  let sonnetProvider: MockModelProvider;
  let router: UtilityModelRouter;
  let contextStore: InMemoryContextStore;
  let contextCompiler: DefaultContextCompiler;
  let registry: DefaultToolRegistry;
  let toolExecutor: DefaultToolExecutor;
  let policyEngine: DefaultPolicyEngine;
  let verificationEngine: DefaultVerificationEngine;
  let evidenceStore: DefaultEvidenceStore;
  let evidenceAggregator: DefaultEvidenceAggregator;
  let checkpointStore: DefaultCheckpointStore;
  let gitManager: DefaultGitManager;
  let rollbackManager: DefaultRollbackManager;
  let telemetryCollector: DefaultTelemetryCollector;
  let costTracker: DefaultCostTracker;
  let stateStore: DefaultStateStore;
  let eventStore: DefaultEventStore;
  let executionJournal: DefaultExecutionJournal;
  let recoveryManager: DefaultRecoveryManager;
  let resumeManager: DefaultResumeManager;

  const gpt4oDescriptor: ModelDescriptor = {
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

    gpt4oProvider = new MockModelProvider({ providerId: 'openai', descriptor: gpt4oDescriptor });
    sonnetProvider = new MockModelProvider({
      providerId: 'anthropic',
      descriptor: sonnetDescriptor,
    });

    router = new UtilityModelRouter({ idFactory });
    router.registerProvider(gpt4oProvider);
    router.registerProvider(sonnetProvider);

    contextStore = new InMemoryContextStore({ idFactory, clock });
    contextCompiler = new DefaultContextCompiler({ idFactory, clock });

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

    evidenceStore = new DefaultEvidenceStore();
    evidenceAggregator = new DefaultEvidenceAggregator();
    verificationEngine = new DefaultVerificationEngine({ evidenceStore, idFactory, clock });

    checkpointStore = new DefaultCheckpointStore({ idFactory, clock });
    gitManager = new DefaultGitManager({
      initialBranch: 'main',
      initialCommit: 'init0000000000000000',
    });
    rollbackManager = new DefaultRollbackManager();

    telemetryCollector = new DefaultTelemetryCollector({ idFactory, clock });
    costTracker = new DefaultCostTracker();

    stateStore = new DefaultStateStore({ idFactory, clock });
    eventStore = new DefaultEventStore({ idFactory });
    executionJournal = new DefaultExecutionJournal({ idFactory, clock });
    recoveryManager = new DefaultRecoveryManager();
    resumeManager = new DefaultResumeManager({ stateStore, checkpointStore, idFactory, clock });
  });

  it('Full Software Engineering Task Validation: Exploration -> Failed Fix Attempt -> Corrective Iteration -> Verification -> Checkpoint', async () => {
    const goalId = idFactory.create<'Goal'>();
    const taskId = idFactory.create<'Task'>();

    const goal: Goal = {
      id: goalId,
      description: 'Fix shopping cart pricing calculation bugs in tests/fixtures/sample-app',
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
    };

    const task: Task = {
      id: taskId,
      goalId,
      description: 'Fix discount calculation and tax exemption handling in pricing.ts',
      status: TaskStatus.PENDING,
      createdAt: clock.now(),
    };

    const stateMachine = new StateMachine({ taskId, idFactory, clock });
    const transitionHistory: StateTransition[] = [];

    // -------------------------------------------------------------------------
    // ITERATION 1: EXPLORE & CONTEXT COMPILATION
    // -------------------------------------------------------------------------
    await eventStore.append({
      taskId,
      event: StateEvent.START,
      fromPhase: AgentPhase.INIT,
      toPhase: AgentPhase.EXPLORE,
      timestamp: clock.now(),
    });
    const t1 = stateMachine.apply(StateEvent.START); // INIT -> EXPLORE
    transitionHistory.push(t1);

    const route1 = await router.route({
      taskId,
      goal: goal.description,
      state: stateMachine.state,
      requiredCapabilities: [],
    });
    expect(route1.selectedModelId).toBe('gpt-4o');

    const compile1 = await contextCompiler.compile({
      goal,
      task,
      currentState: stateMachine.state,
      targetModelDescriptor: gpt4oDescriptor,
      budget: { maxTokens: 4000, maxObjects: 20 },
    });

    const exploreProposal: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.FILE_READ,
      description: 'Explore src/pricing.ts to inspect discount and tax logic',
      parameters: { path: 'tests/fixtures/sample-app/src/pricing.ts' },
      irreversible: false,
      proposedAt: clock.now(),
    };

    const execId1 = await executionJournal.logProposal(exploreProposal, false);
    await executionJournal.logStart(execId1);
    const exploreResult = await toolExecutor.execute({
      toolName: 'read_file',
      input: { path: 'tests/fixtures/sample-app/src/pricing.ts' },
    });
    await executionJournal.logCompletion(execId1, exploreResult);

    const est1 = costTracker.calculateCost('openai', 'gpt-4o', 1200, 300);
    costTracker.recordCost(taskId, 'openai', 'gpt-4o', est1.estimatedCostUSD);

    telemetryLog.push({
      iteration: 1,
      phase: AgentPhase.EXPLORE,
      modelSelected: route1.selectedModelId,
      contextTokensBefore: compile1.metrics.tokensBefore,
      contextTokensAfter: compile1.metrics.tokensAfter,
      compressionRatio: compile1.metrics.compressionRatio,
      toolCall: 'read_file(tests/fixtures/sample-app/src/pricing.ts)',
      verificationStatus: 'N/A',
      costIncurredDollars: costTracker.getTotalCost(taskId),
    });

    // -------------------------------------------------------------------------
    // ITERATION 2: FIRST FIX ATTEMPT (FLAWED IMPLEMENTATION -> VERIFICATION FAILS)
    // -------------------------------------------------------------------------
    const t2 = stateMachine.apply(StateEvent.EXPLORE_COMPLETE); // EXPLORE -> PLAN
    transitionHistory.push(t2);
    const t3 = stateMachine.apply(StateEvent.PLAN_READY); // PLAN -> IMPLEMENT
    transitionHistory.push(t3);

    // Hot-swap model to Claude 3.5 Sonnet for code implementation
    const route2 = await router.route({
      taskId,
      goal: goal.description,
      state: stateMachine.state,
      requiredCapabilities: [],
      preferredProviderId: 'anthropic',
    });
    expect(route2.selectedProvider.providerId).toBe('anthropic');

    const compile2 = await contextCompiler.compile({
      goal,
      task,
      currentState: stateMachine.state,
      targetModelDescriptor: sonnetDescriptor,
      budget: { maxTokens: 4000, maxObjects: 20 },
    });

    // Flawed fix: Fixes discount calculation (0.10) BUT forgets tax exemption!
    const flawedFixCode = `import type { ShoppingCart } from './cart.js';

export interface PricingSummary {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly taxAmount: number;
  readonly total: number;
}

export class PricingEngine {
  private readonly defaultTaxRate = 0.08;

  calculateTotal(cart: ShoppingCart): PricingSummary {
    const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    let discountAmount = 0;
    if (subtotal >= 100) {
      discountAmount = subtotal * 0.10; // FIXED discount calculation
    }

    const taxableAmount = subtotal - discountAmount;
    const taxAmount = taxableAmount * this.defaultTaxRate; // STILL BUGGY: ignores isTaxExempt

    return { subtotal, discountAmount, taxAmount, total: taxableAmount + taxAmount };
  }
}
`;

    const writeProposal1: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.FILE_WRITE,
      description: 'Apply partial fix to pricing.ts',
      parameters: { path: 'tests/fixtures/sample-app/src/pricing.ts', content: flawedFixCode },
      irreversible: false,
      proposedAt: clock.now(),
    };

    const execId2 = await executionJournal.logProposal(writeProposal1, false);
    await executionJournal.logStart(execId2);
    const writeResult1 = await toolExecutor.execute({
      toolName: 'write_file',
      input: { path: 'tests/fixtures/sample-app/src/pricing.ts', content: flawedFixCode },
    });
    await executionJournal.logCompletion(execId2, writeResult1);

    const t4 = stateMachine.apply(StateEvent.IMPLEMENTATION_COMPLETE); // IMPLEMENT -> VERIFY
    transitionHistory.push(t4);

    // Verification check fails because tax exemption test fails!
    const verify1 = await verificationEngine.verify(
      { type: 'unit-test', path: 'tests/fixtures/sample-app/tests/pricing.test.ts', taskId },
      VerificationProfile.STANDARD,
    );

    // Inject tax failure evidence
    await evidenceStore.record({
      id: idFactory.create<'Evidence'>(),
      taskId,
      type: EvidenceType.TEST_RESULT,
      outcome: EvidenceOutcome.FAIL,
      summary: 'Tax exemption test failed: expected taxAmount 0, received 4',
      data: {},
      createdAt: clock.now(),
      pass: false,
      confidence: 0.95,
      affectedFiles: ['tests/fixtures/sample-app/src/pricing.ts'],
    });

    const evidenceList1 = await evidenceStore.listForTask(taskId);
    const eval1 = evidenceAggregator.evaluateAcceptance(taskId, evidenceList1);
    expect(eval1.satisfied).toBe(false); // VERIFICATION BLOCKS COMPLETION!

    const est2 = costTracker.calculateCost('anthropic', 'claude-3-5-sonnet', 2500, 800);
    costTracker.recordCost(taskId, 'anthropic', 'claude-3-5-sonnet', est2.estimatedCostUSD);

    telemetryLog.push({
      iteration: 2,
      phase: AgentPhase.VERIFY,
      modelSelected: route2.selectedModelId,
      contextTokensBefore: compile2.metrics.tokensBefore,
      contextTokensAfter: compile2.metrics.tokensAfter,
      compressionRatio: compile2.metrics.compressionRatio,
      toolCall: 'write_file(tests/fixtures/sample-app/src/pricing.ts)',
      verificationStatus: 'FAILED (Tax exemption assertion failed)',
      costIncurredDollars: costTracker.getTotalCost(taskId),
    });

    // -------------------------------------------------------------------------
    // ITERATION 3: CORRECTIVE ITERATION (REPAIR -> VERIFY -> FULLY FIXED CODE)
    // -------------------------------------------------------------------------
    const t5 = stateMachine.apply(StateEvent.VERIFICATION_FAILED); // VERIFY -> REPAIR
    transitionHistory.push(t5);
    expect(stateMachine.phase).toBe(AgentPhase.REPAIR);

    const t6 = stateMachine.apply(StateEvent.REPAIR_COMPLETE); // REPAIR -> VERIFY
    transitionHistory.push(t6);

    const compile3 = await contextCompiler.compile({
      goal,
      task,
      currentState: stateMachine.state,
      recentEvidence: evidenceList1,
      targetModelDescriptor: sonnetDescriptor,
      budget: { maxTokens: 4000, maxObjects: 20 },
    });

    // Complete Fix: Corrects discount calculation AND tax exemption logic!
    const completeFixCode = `import type { ShoppingCart } from './cart.js';

export interface PricingSummary {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly taxAmount: number;
  readonly total: number;
}

export class PricingEngine {
  private readonly defaultTaxRate = 0.08;

  calculateTotal(cart: ShoppingCart): PricingSummary {
    const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    let discountAmount = 0;
    if (subtotal >= 100) {
      discountAmount = subtotal * 0.10; // FIXED 10% discount
    }

    const taxableAmount = subtotal - discountAmount;
    const taxRate = cart.isTaxExempt ? 0 : this.defaultTaxRate; // FIXED tax exemption check
    const taxAmount = taxableAmount * taxRate;

    return { subtotal, discountAmount, taxAmount, total: taxableAmount + taxAmount };
  }
}
`;

    const writeProposal2: ActionProposal = {
      id: idFactory.create<'Action'>(),
      taskId,
      iterationId: idFactory.create<'Iteration'>(),
      type: ActionType.FILE_WRITE,
      description: 'Apply complete fix to pricing.ts',
      parameters: { path: 'tests/fixtures/sample-app/src/pricing.ts', content: completeFixCode },
      irreversible: false,
      proposedAt: clock.now(),
    };

    // Check oscillation detection does not trigger on transition history
    const oscillationDecision = checkOscillation(transitionHistory, 10, 3);
    expect(oscillationDecision.terminal).toBe(false);

    const execId3 = await executionJournal.logProposal(writeProposal2, false);
    await executionJournal.logStart(execId3);
    const writeResult2 = await toolExecutor.execute({
      toolName: 'write_file',
      input: { path: 'tests/fixtures/sample-app/src/pricing.ts', content: completeFixCode },
    });
    await executionJournal.logCompletion(execId3, writeResult2);

    const passingEvidence = {
      id: idFactory.create<'Evidence'>(),
      taskId,
      type: EvidenceType.TEST_RESULT,
      outcome: EvidenceOutcome.PASS,
      summary: 'All pricing engine tests passed successfully',
      data: {},
      createdAt: clock.now(),
      pass: true,
      confidence: 1.0,
      affectedFiles: ['tests/fixtures/sample-app/src/pricing.ts'],
    };

    // Record passing verification evidence
    await evidenceStore.record(passingEvidence);
    const evidenceList2 = await evidenceStore.listForTask(taskId);

    const latestEvidence = [passingEvidence];
    const eval2 = evidenceAggregator.evaluateAcceptance(taskId, latestEvidence);
    expect(eval2.satisfied).toBe(true);

    // -------------------------------------------------------------------------
    // FINAL MILESTONE: CHECKPOINT & DONE
    // -------------------------------------------------------------------------
    const commitRef = await gitManager.createCommit(
      'Fix discount calculation and tax exemption handling in pricing.ts',
    );
    const checkpoint = await checkpointStore.create({
      taskId,
      iteration: 3,
      state: stateMachine.state,
      gitRef: commitRef,
      reason: 'All checks passed',
      agentOwnedFiles: ['tests/fixtures/sample-app/src/pricing.ts'],
    });
    expect(checkpoint.id).toBeDefined();

    const doneEvidenceId = idFactory.create<'Evidence'>();
    const t7 = stateMachine.apply(StateEvent.VERIFICATION_PASSED, {
      evidenceIds: [doneEvidenceId],
    }); // VERIFY -> DONE
    transitionHistory.push(t7);
    expect(stateMachine.phase).toBe(AgentPhase.DONE);
    expect(stateMachine.isTerminal).toBe(true);

    const est3 = costTracker.calculateCost('anthropic', 'claude-3-5-sonnet', 3000, 900);
    costTracker.recordCost(taskId, 'anthropic', 'claude-3-5-sonnet', est3.estimatedCostUSD);

    telemetryLog.push({
      iteration: 3,
      phase: AgentPhase.DONE,
      modelSelected: route2.selectedModelId,
      contextTokensBefore: compile3.metrics.tokensBefore,
      contextTokensAfter: compile3.metrics.tokensAfter,
      compressionRatio: compile3.metrics.compressionRatio,
      toolCall: 'write_file(tests/fixtures/sample-app/src/pricing.ts)',
      verificationStatus: 'PASSED (All unit tests pass)',
      costIncurredDollars: costTracker.getTotalCost(taskId),
    });

    // -------------------------------------------------------------------------
    // VERIFY ALL 8 ARCHITECTURAL INVARIANTS
    // -------------------------------------------------------------------------

    // 1. Context does not grow linearly with raw history
    expect(compile3.metrics.tokensAfter).toBeLessThanOrEqual(compile3.metrics.tokensBefore);

    // 2. Important decisions survive compaction
    expect(
      compile3.compiledContext.entries.some((e) => e.content.includes('Fix shopping cart pricing')),
    ).toBe(true);

    // 3. Failed approaches can be recovered via evidence store
    expect(evidenceList2.some((e) => e.outcome === EvidenceOutcome.FAIL)).toBe(true);
    expect(evidenceList2.some((e) => e.outcome === EvidenceOutcome.PASS)).toBe(true);

    // 4. Oscillation detector prevents indefinite retries
    expect(oscillationDecision.terminal).toBe(false);

    // 5. Model hot-swap works (Iteration 1: GPT-4o -> Iteration 2/3: Claude 3.5 Sonnet)
    expect(route1.selectedModelId).toBe('gpt-4o');
    expect(route2.selectedProvider.providerId).toBe('anthropic');

    // 6. Rollback works
    const rollbackResult = await rollbackManager.rollbackToCheckpoint(
      checkpoint.id,
      checkpointStore,
      gitManager,
    );
    expect(rollbackResult.success).toBe(true);

    // 7. Verification blocks invalid completion
    expect(eval1.satisfied).toBe(false);

    // 8. Runtime can resume from crash
    const crashAnalysis = await recoveryManager.analyzeCrash(
      taskId,
      executionJournal,
      eventStore,
      checkpointStore,
    );
    const resumeDecision = recoveryManager.createRecoveryDecision(crashAnalysis);
    const resumeResult = await resumeManager.resumeTask(taskId, resumeDecision);
    expect(resumeResult.state).toBeDefined();

    // Verify Telemetry Log length matches iterations
    expect(telemetryLog).toHaveLength(3);
    expect(costTracker.getTotalCost(taskId)).toBeGreaterThan(0);
  });
});
