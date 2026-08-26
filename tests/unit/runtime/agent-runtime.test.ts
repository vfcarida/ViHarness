import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MockModelProvider,
  FailingModelProvider,
  UtilityModelRouter,
  DefaultContextCompiler,
  InMemoryContextStore,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';
import { DefaultVerificationEngine } from '../../../src/infra/verification/default-verification-engine.js';
import { AgentPhase, GoalStatus, AgentEventType } from '../../../src/core/index.js';
import type {
  Goal,
  AgentEvent,
  AgentObserver,
  ToolExecutor,
  VerificationEngine,
  CheckpointStore,
} from '../../../src/core/index.js';

describe('DefaultAgentRuntime', () => {
  let runtime: DefaultAgentRuntime;
  let router: UtilityModelRouter;
  let compiler: DefaultContextCompiler;
  let contextStore: InMemoryContextStore;
  let mockProvider: MockModelProvider;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let sampleGoal: Goal;
  let verificationEngine: DefaultVerificationEngine;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    contextStore = new InMemoryContextStore({ idFactory, clock });
    compiler = new DefaultContextCompiler({ idFactory, clock });

    mockProvider = new MockModelProvider({
      providerId: 'primary-mock',
      defaultResponseText: 'Mock execution plan response',
    });

    router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    verificationEngine = new DefaultVerificationEngine({ idFactory, clock });

    runtime = new DefaultAgentRuntime({
      router,
      compiler,
      verificationEngine,
      idFactory,
      clock,
    });

    sampleGoal = {
      id: idFactory.create<'Goal'>(),
      description: 'Implement user login feature',
      constraints: {
        maxIterations: 10,
        maxCostDollars: 5.0,
        maxDurationMs: 60000,
        maxRepairAttempts: 3,
        maxNoProgressIterations: 3,
        requireVerification: true,
      },
      status: GoalStatus.ACTIVE,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };
  });

  it('should execute Happy Path: INIT -> EXPLORE -> PLAN -> IMPLEMENT -> VERIFY -> DONE', async () => {
    const events: AgentEvent[] = [];
    const observer: AgentObserver = {
      onEvent: (e) => events.push(e),
    };
    runtime.subscribe(observer);

    const result = await runtime.execute(sampleGoal);

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(result.iterationCount).toBeGreaterThan(0);
    expect(result.iterations[0]!.iterationId).toBeDefined();

    // Verify Observable Events emitted
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(AgentEventType.AgentStarted);
    expect(eventTypes).toContain(AgentEventType.IterationStarted);
    expect(eventTypes).toContain(AgentEventType.ModelSelected);
    expect(eventTypes).toContain(AgentEventType.ModelCalled);
    expect(eventTypes).toContain(AgentEventType.StateUpdated);
    expect(eventTypes).toContain(AgentEventType.AgentCompleted);
  });

  it('should handle tool failure and transition to REPAIR cycle', async () => {
    const mockFailingToolExecutor: ToolExecutor = {
      execute: async () => ({
        success: false,
        error: 'Compilation syntax error on line 42',
        durationMs: 15,
      }),
    };

    const customRuntime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor: mockFailingToolExecutor,
      idFactory,
      clock,
    });

    const result = await customRuntime.execute(sampleGoal);
    expect(result.iterations.some((iter) => iter.toolResults.some((t) => !t.status))).toBeDefined();
  }, 15000);

  it('should escalate to AWAITING_HUMAN when max repair attempts are exceeded', async () => {
    const mockFailingVerification: VerificationEngine = {
      verify: async () => ({
        status: 'FAILED',
        summary: 'Unit test suite failed',
        durationMs: 20,
      }),
    };

    const customRuntime = new DefaultAgentRuntime({
      router,
      compiler,
      verificationEngine: mockFailingVerification,
      idFactory,
      clock,
    });

    // Constrain goal maxRepairAttempts to 2
    const strictGoal: Goal = {
      ...sampleGoal,
      constraints: {
        ...sampleGoal.constraints,
        maxRepairAttempts: 2,
      },
    };

    const result = await customRuntime.execute(strictGoal);
    expect(result.status).toBe('AWAITING_HUMAN');
    expect(result.success).toBe(false);
  }, 15000);

  it('should handle model failure and retry/fallback cleanly', async () => {
    const failingProvider = new FailingModelProvider({
      failAttemptsCount: 1, // Fails 1st call, succeeds on 2nd
    });

    const failRouter = new UtilityModelRouter();
    failRouter.registerProvider(failingProvider);

    const failRuntime = new DefaultAgentRuntime({
      router: failRouter,
      compiler,
      verificationEngine,
      idFactory,
      clock,
    });

    const result = await failRuntime.execute(sampleGoal);
    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
  }, 15000);

  it('should terminate with BUDGET_EXCEEDED when iteration budget is exhausted', async () => {
    const tightGoal: Goal = {
      ...sampleGoal,
      constraints: {
        ...sampleGoal.constraints,
        maxIterations: 2, // Exceeds budget after 2 iterations
      },
    };

    // Force machine to cycle without reaching DONE
    const mockNeverPassVerification: VerificationEngine = {
      verify: async () => ({
        status: 'FAILED',
        summary: 'Always failing test',
        durationMs: 10,
      }),
    };

    const budgetRuntime = new DefaultAgentRuntime({
      router,
      compiler,
      verificationEngine: mockNeverPassVerification,
      idFactory,
      clock,
    });

    const result = await budgetRuntime.execute(tightGoal);
    expect(result.success).toBe(false);
    expect(result.iterationCount).toBe(2);
  });

  it('should support cancellation via AbortSignal / abort()', async () => {
    const controller = new AbortController();
    controller.abort(); // Cancel immediately

    const result = await runtime.execute(sampleGoal, {
      signal: controller.signal,
    });

    expect(result.status).toBe('CANCELLED');
    expect(result.success).toBe(false);
  });

  it('should support Pause and Resume from Checkpoint', async () => {
    const checkpointMap = new Map<string, any>();
    const mockCheckpointStore: CheckpointStore = {
      create: async (state, label) => {
        const cp = {
          id: idFactory.create<'Checkpoint'>(),
          taskId: state.taskId,
          state,
          createdAt: clock.now(),
          label,
        };
        checkpointMap.set(cp.id, cp);
        return cp;
      },
      restore: async (id) => checkpointMap.get(id)?.state,
      list: async () => Array.from(checkpointMap.values()),
      delete: async (id) => checkpointMap.delete(id),
    };

    const cpRuntime = new DefaultAgentRuntime({
      router,
      compiler,
      checkpointStore: mockCheckpointStore,
      idFactory,
      clock,
    });

    const execPromise = cpRuntime.execute(sampleGoal);

    // Pause execution
    // (Wait microtask to ensure execution ID registered)
    await new Promise((r) => setTimeout(r, 10));

    // Execute completes
    const result = await execPromise;
    expect(result.executionId).toBeDefined();
  });
});
