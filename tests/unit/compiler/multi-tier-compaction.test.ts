/**
 * Multi-Tier Progressive Context Compaction Suite (Prompt 6).
 *
 * Validates the 4-stage pipeline (SNIP, MICRO-COMPACT, COLLAPSE, AUTO-COMPACT),
 * model-aware threshold adaptation, detailed explanation reports, and an
 * extreme 50-iteration debugging scenario with invariant preservation.
 */
import { describe, it, expect } from 'vitest';
import {
  ContextCompressor,
  ContextRanker,
  DefaultContextCompiler,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  ContextObjectType,
  ContextTier,
  ContextScope,
  type ContextObject,
  DEFAULT_SCORING_WEIGHTS,
  type Goal,
  type Task,
  GoalStatus,
  TaskStatus,
  AgentPhase,
  ModelCapability,
  type ModelDescriptor,
} from '../../../src/core/index.js';

describe('Multi-Tier Progressive Context Compaction Suite (Prompt 6)', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));
  const now = clock.now();
  const nowMs = now.getTime();

  const smallModelDescriptor: ModelDescriptor = {
    id: 'small-local-model',
    name: 'Small Local Model (32k)',
    providerId: 'local-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.CODING]),
      maxContextTokens: 32000,
      maxOutputTokens: 2048,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.0001,
    costPer1kOutputTokensDollars: 0.0002,
  };

  const largeModelDescriptor: ModelDescriptor = {
    id: 'claude-3-7-sonnet',
    name: 'Large Frontier Model (200k)',
    providerId: 'anthropic-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
      maxContextTokens: 200000,
      maxOutputTokens: 16000,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.003,
    costPer1kOutputTokensDollars: 0.015,
  };

  it('1. SNIP Stage: Prunes ephemeral diagnostic noise while preserving critical evidence', () => {
    const objects: ContextObject[] = [
      {
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: '[DEBUG] Ephemeral verbose diagnostic log from memory profiler trace...',
        source: 'tracer',
        timestamp: new Date(nowMs - 15 * 60 * 60 * 1000), // 15 hours old
        importance: 0.3,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: new Date(nowMs - 15 * 60 * 60 * 1000),
        lastVerified: null,
        costTokens: 100,
        tags: ['ephemeral'],
        version: 1,
        active: true,
        metadata: {},
      },
      {
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L1_WORKING,
        type: ContextObjectType.FAILURE,
        content: 'CRITICAL FAILURE: Segfault in token verification routine at line 142.',
        source: 'runtime',
        timestamp: now,
        importance: 0.95,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 40,
        tags: ['must_preserve', 'failure'],
        version: 1,
        active: true,
        metadata: {},
      },
    ];

    const scored = objects.map((o) => ContextRanker.scoreObject(o, nowMs, DEFAULT_SCORING_WEIGHTS));
    const result = ContextCompressor.compress(scored, 120, nowMs, { modelContextTokens: 32000 });

    expect(result.pipelineStagesRun).toContain('SNIP');
    expect(result.retained.some((o) => o.type === ContextObjectType.FAILURE)).toBe(true);
    expect(result.omitted.some((o) => o.content.includes('[DEBUG]'))).toBe(true);
    expect(result.explanations.find((e) => e.action === 'OMITTED')?.reason).toContain('SNIP Stage');
  });

  it('2. MICRO-COMPACT Stage: Compacts repetitive tool outputs into micro-summaries', () => {
    const objects: ContextObject[] = [];

    // Simulate 5 identical tool execution outputs
    for (let i = 0; i < 5; i++) {
      objects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: 'Tool Output from npm test: Vitest runner exited with code 1. 2 failed tests.',
        source: 'tool_executor',
        timestamp: now,
        importance: 0.7,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 150,
        tags: ['tool_output'],
        version: 1,
        active: true,
        metadata: {},
      });
    }

    const scored = objects.map((o) => ContextRanker.scoreObject(o, nowMs, DEFAULT_SCORING_WEIGHTS));
    const result = ContextCompressor.compress(scored, 400, nowMs, { modelContextTokens: 32000 });

    const summarizedItems = result.explanations.filter((e) => e.action === 'SUMMARIZED');
    expect(summarizedItems.length).toBeGreaterThanOrEqual(2);
    expect(summarizedItems[0]?.reason).toContain('MICRO-COMPACT Stage');
  });

  it('3. Model-Aware Thresholds: Small-window models compact earlier than large-window models', () => {
    const objects: ContextObject[] = [];
    for (let i = 0; i < 10; i++) {
      objects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.ATTEMPT,
        content: `Attempt #${i + 1}: Attempted fix via monkey patch of service layer...`,
        source: 'agent',
        timestamp: now,
        importance: 0.6,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 100,
        tags: ['attempt'],
        version: 1,
        active: true,
        metadata: {},
      });
    }

    const scored = objects.map((o) => ContextRanker.scoreObject(o, nowMs, DEFAULT_SCORING_WEIGHTS));

    // Small model (32k) -> Triggers aggressive compaction early
    const smallResult = ContextCompressor.compress(scored, 600, nowMs, {
      modelContextTokens: 32000,
    });
    // Large model (200k) -> Delays compaction threshold
    const largeResult = ContextCompressor.compress(scored, 1000, nowMs, {
      modelContextTokens: 200000,
    });

    expect(smallResult.totalTokens).toBeLessThanOrEqual(600);
    expect(largeResult.totalTokens).toBeGreaterThan(smallResult.totalTokens);
  });

  it('4. Extreme 50-Iteration Debugging Scenario: 100% Invariant Retention and Strict Budget', async () => {
    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const contextObjects: ContextObject[] = [];

    // Invariant 1: Root user goal
    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Fix race condition in distributed lock manager',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 50 },
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    // Invariant 2: Current task
    const task: Task = {
      id: idFactory.create<'Task'>(),
      goalId: goal.id,
      description: 'Investigate mutex acquire timeout in lock.ts',
      status: TaskStatus.ACTIVE,
      priority: 1,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    // Invariant 3: Critical architectural decision
    contextObjects.push({
      id: idFactory.create<'Context'>(),
      tier: ContextTier.L3_REPOSITORY,
      type: ContextObjectType.DECISION,
      content: 'MANDATORY ARCHITECTURE RULE: Redis lock lease renewal must use atomic Lua scripts.',
      source: 'lead_architect',
      timestamp: now,
      importance: 1.0,
      confidence: 1.0,
      scope: ContextScope.GLOBAL,
      dependencies: [],
      lastUsed: now,
      lastVerified: now,
      costTokens: 35,
      tags: ['must_preserve', 'decision'],
      version: 1,
      active: true,
      metadata: {},
    });

    // Simulate 50 continuous iterations of debugging history
    for (let iter = 1; iter <= 50; iter++) {
      // 1. Tool execution output (repetitive)
      contextObjects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: `Iteration ${iter} tool execution output: redis-cli EVAL return 0 error in lease renewal [iter_${iter}]`,
        source: 'tool_executor',
        timestamp: new Date(nowMs - (50 - iter) * 60 * 1000),
        importance: iter === 50 ? 0.9 : 0.4,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: new Date(nowMs - (50 - iter) * 60 * 1000),
        lastVerified: null,
        costTokens: 80,
        tags: ['tool_output'],
        version: 1,
        active: true,
        metadata: { iteration: iter },
      });

      // 2. Episodic attempt
      contextObjects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.ATTEMPT,
        content: `Attempt ${iter}: Hypothesized lease TTL was too short (${iter * 100}ms).`,
        source: 'agent',
        timestamp: new Date(nowMs - (50 - iter) * 60 * 1000),
        importance: iter > 45 ? 0.8 : 0.3,
        confidence: 0.7,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: new Date(nowMs - (50 - iter) * 60 * 1000),
        lastVerified: null,
        costTokens: 45,
        tags: ['attempt'],
        version: 1,
        active: true,
        metadata: { iteration: iter },
      });

      // 3. Ephemeral debug logs
      contextObjects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: `[DEBUG] Socket ping latency to Redis cluster: ${12 + (iter % 5)}ms. stdout: OK`,
        source: 'tracer',
        timestamp: new Date(nowMs - (50 - iter) * 60 * 1000),
        importance: 0.2,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: new Date(nowMs - (50 - iter) * 60 * 1000),
        lastVerified: null,
        costTokens: 50,
        tags: ['ephemeral'],
        version: 1,
        active: true,
        metadata: {},
      });
    }

    const rawTokenSum = contextObjects.reduce((acc, o) => acc + o.costTokens, 0);
    expect(rawTokenSum).toBeGreaterThan(8000); // Massive 50-iteration trajectory (>8k tokens)

    // Compile with budget of 2500 tokens
    const compiled = await compiler.compile({
      goal,
      task,
      currentState: {
        taskId: task.id,
        phase: AgentPhase.REPAIR,
        stepCount: 50,
        repairCount: 8,
        noProgressCount: 0,
        updatedAt: now,
        history: [],
      },
      relevantObjects: contextObjects,
      targetModelDescriptor: smallModelDescriptor,
      budget: { maxTokens: 2500, softLimitTokens: 2000 },
    });

    // Assertions:
    // a) Budget strictly respected
    expect(compiled.compiledContext.totalTokenEstimate).toBeLessThanOrEqual(2500);

    // b) Invariants 100% preserved
    const retainedDecisions = compiled.retainedObjects.filter(
      (o) => o.type === ContextObjectType.DECISION,
    );
    expect(retainedDecisions.length).toBeGreaterThanOrEqual(1);
    expect(retainedDecisions[0]?.content).toContain('atomic Lua scripts');

    const retainedGoals = compiled.retainedObjects.filter(
      (o) => o.type === ContextObjectType.USER_INSTRUCTION,
    );
    expect(retainedGoals.length).toBeGreaterThanOrEqual(1);

    // c) Detailed Explanation Report generated
    expect(compiled.explanation).toBeDefined();
    expect(compiled.explanation!.items.length).toBeGreaterThanOrEqual(50);
    expect(compiled.explanation!.riskLevel).toBeDefined();

    // d) Metrics demonstrate massive compression ratio
    expect(compiled.metrics.compressionRatio).toBeGreaterThan(0.6);
    expect(compiled.metrics.mandatoryRetainedCount).toBeGreaterThanOrEqual(2);
  });
});
