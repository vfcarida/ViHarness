/**
 * Frozen Memory Snapshot Unit Tests (P007).
 *
 * Validates:
 * 1. Memory loaded ONCE at execution start into immutable L3_REPOSITORY context object.
 * 2. New memories added during execution are persisted to store but NOT visible in current session.
 * 3. Prefix stability: compiled prompt prefix remains invariant across iterations.
 * 4. Next execution start captures updated memories into a fresh frozen snapshot.
 */
import { describe, it, expect } from 'vitest';
import {
  InMemoryMemoryStore,
  FrozenMemorySnapshot,
  DefaultContextCompiler,
  PrefixCachingCompiler,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  MemoryTier,
  MemoryType,
  MemoryScope,
  MemoryStatus,
  ContextTier,
  AgentPhase,
  type Goal,
  type Task,
  type AgentState,
  type ModelDescriptor,
  ModelCapability,
  ProviderHealthStatus,
  DEFAULT_GOAL_CONSTRAINTS,
} from '../../../src/core/index.js';

describe('Frozen Memory Snapshot (Hermes Pattern) — P007', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const mockModelDescriptor: ModelDescriptor = {
    providerId: 'mock-provider',
    modelId: 'mock-model',
    contextWindowTokens: 32000,
    costPerMillionInputTokens: 3.0,
    costPerMillionOutputTokens: 15.0,
    healthStatus: ProviderHealthStatus.HEALTHY,
    supportedRoles: ['GENERALIST'],
    capabilities: {
      toolCalling: true,
      streaming: false,
      structuredOutputs: true,
      vision: false,
      reasoningModel: false,
      contextBudgetTokens: 32000,
      maxContextTokens: 32000,
      supportedCapabilities: [ModelCapability.TOOLS, ModelCapability.STRUCTURED_OUTPUTS],
    },
  };

  const sampleGoal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'Implement JWT OAuth2 authentication flow',
    constraints: { ...DEFAULT_GOAL_CONSTRAINTS },
    status: 'ACTIVE' as any,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    metadata: {},
  };

  const sampleTask: Task = {
    id: idFactory.create<'Task'>(),
    goalId: sampleGoal.id,
    description: 'Refactor token expiration handling in auth provider',
    status: 'ACTIVE' as any,
    priority: 1,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    metadata: {},
  };

  const sampleState: AgentState = {
    taskId: sampleTask.id,
    phase: AgentPhase.IMPLEMENT,
    repairCount: 0,
    iterationCount: 1,
    lastAction: null,
    lastOutcome: null,
    history: [],
    updatedAt: clock.now(),
  };

  it('1. should capture active memories at execution start marked as immutableDuringExecution', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });

    await memoryStore.createRecord({
      tier: MemoryTier.SEMANTIC,
      type: MemoryType.FACT,
      content: 'OAuth tokens must use RS256 signing algorithm.',
      source: 'security_spec',
      confidence: 0.95,
      importance: 0.9,
      scope: MemoryScope.REPOSITORY,
      status: MemoryStatus.ACTIVE,
      tags: ['auth', 'jwt', 'security'],
    });

    const snapshotManager = new FrozenMemorySnapshot({ memoryStore, idFactory, clock });
    const snapshot = await snapshotManager.capture({
      taskDescription: sampleTask.description,
      goalDescription: sampleGoal.description,
    });

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.tier).toBe(ContextTier.L3_REPOSITORY);
    expect(snapshot[0]?.immutableDuringExecution).toBe(true);
    expect(snapshot[0]?.content).toContain('RS256');
    expect(snapshot[0]?.tags).toContain('frozen_memory');
  });

  it('2. should keep execution context isolated from mid-execution memory additions', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock, memoryStore });

    // Initial memory in store
    await memoryStore.createRecord({
      type: MemoryType.FACT,
      content: 'Initial convention: Use Bearer token authorization header.',
      source: 'conventions',
      confidence: 0.9,
      importance: 0.8,
      status: MemoryStatus.ACTIVE,
      tags: ['auth'],
    });

    const snapshotManager = new FrozenMemorySnapshot({ memoryStore, idFactory, clock });
    // Capture frozen snapshot at execution start
    const frozenObjects = await snapshotManager.capture({
      taskDescription: sampleTask.description,
      goalDescription: sampleGoal.description,
    });

    expect(frozenObjects).toHaveLength(1);

    // Compile Iteration 1 with frozen snapshot
    const iter1Result = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: sampleState,
      targetModelDescriptor: mockModelDescriptor,
      budget: { maxTokens: 8000, softLimitTokens: 6000 },
      frozenMemoryObjects: frozenObjects,
    });

    expect(
      iter1Result.compiledContext.entries.some((e) => e.content.includes('Bearer token')),
    ).toBe(true);
    expect(
      iter1Result.compiledContext.entries.some((e) =>
        e.content.includes('Dynamic Runtime Addition'),
      ),
    ).toBe(false);

    // Mid-execution: Agent creates a new memory during iteration 1
    await memoryStore.createRecord({
      type: MemoryType.FACT,
      content: 'Dynamic Runtime Addition: Session timeout is 15 minutes.',
      source: 'runtime_discovery',
      confidence: 0.9,
      importance: 0.85,
      status: MemoryStatus.ACTIVE,
      tags: ['auth'],
    });

    // Compile Iteration 2 using the SAME frozen snapshot
    const iter2Result = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: { ...sampleState, iterationCount: 2 },
      targetModelDescriptor: mockModelDescriptor,
      budget: { maxTokens: 8000, softLimitTokens: 6000 },
      frozenMemoryObjects: frozenObjects,
    });

    // Iteration 2 MUST NOT contain the new memory added mid-execution
    expect(
      iter2Result.compiledContext.entries.some((e) => e.content.includes('Bearer token')),
    ).toBe(true);
    expect(
      iter2Result.compiledContext.entries.some((e) =>
        e.content.includes('Dynamic Runtime Addition'),
      ),
    ).toBe(false);

    // Next execution start: fresh capture reflects the newly created memory
    const nextExecutionSnapshot = await snapshotManager.capture({
      taskDescription: sampleTask.description,
      goalDescription: sampleGoal.description,
    });

    expect(nextExecutionSnapshot.some((e) => e.content.includes('Dynamic Runtime Addition'))).toBe(
      true,
    );
  });

  it('3. should ensure static prompt prefix is perfectly invariant across iterations for cache hit', async () => {
    const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock, memoryStore });

    await memoryStore.createRecord({
      type: MemoryType.FACT,
      content: 'Durable Standard: All repository files must pass strict linter.',
      source: 'standards',
      status: MemoryStatus.ACTIVE,
      tags: ['standards'],
    });

    const snapshotManager = new FrozenMemorySnapshot({ memoryStore, idFactory, clock });
    const frozenObjects = await snapshotManager.capture({
      taskDescription: sampleTask.description,
      goalDescription: sampleGoal.description,
    });

    // Compile Iteration 1 context
    const iter1 = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: sampleState,
      targetModelDescriptor: mockModelDescriptor,
      budget: { maxTokens: 8000, softLimitTokens: 6000 },
      frozenMemoryObjects: frozenObjects,
    });

    // Extract static system text from compiled entries
    const staticTextIter1 = iter1.compiledContext.entries
      .filter((e) => e.tier === ContextTier.L3_REPOSITORY)
      .map((e) => e.content)
      .join('\n');

    // Compile Iteration 2 context with modified dynamic state
    const iter2 = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: { ...sampleState, iterationCount: 2, repairCount: 1 },
      targetModelDescriptor: mockModelDescriptor,
      budget: { maxTokens: 8000, softLimitTokens: 6000 },
      frozenMemoryObjects: frozenObjects,
    });

    const staticTextIter2 = iter2.compiledContext.entries
      .filter((e) => e.tier === ContextTier.L3_REPOSITORY)
      .map((e) => e.content)
      .join('\n');

    // Frozen memory prefix is byte-for-byte identical
    expect(staticTextIter1).toBe(staticTextIter2);

    // PrefixCachingCompiler confirms static segment tokens are stable
    const prefixPayload1 = PrefixCachingCompiler.compile({
      systemPrompt: staticTextIter1,
      taskDescription: sampleTask.description,
      currentPhase: AgentPhase.IMPLEMENT,
      iterationNumber: 1,
    });

    const prefixPayload2 = PrefixCachingCompiler.compile({
      systemPrompt: staticTextIter2,
      taskDescription: sampleTask.description,
      currentPhase: AgentPhase.VERIFY,
      iterationNumber: 2,
    });

    expect(prefixPayload1.cacheKeyPrefix).toBe(prefixPayload2.cacheKeyPrefix);
    expect(prefixPayload1.totalStaticTokens).toBe(prefixPayload2.totalStaticTokens);
  });
});
