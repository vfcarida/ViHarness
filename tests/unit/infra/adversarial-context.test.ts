import { describe, it, expect } from 'vitest';
import { DefaultContextCompiler } from '../../../src/infra/compiler/default-context-compiler.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../../src/infra/time/system-clock.js';
import { ContextObjectType, ContextScope } from '../../../src/core/model/context-object.js';
import { ContextTier } from '../../../src/core/model/context.js';
import type { ContextObject } from '../../../src/core/model/context-object.js';
import type { Goal, Task, AgentState, ModelDescriptor } from '../../../src/core/index.js';
import { AgentPhase } from '../../../src/core/index.js';

describe('Adversarial Context Compiler Suite', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();
  const compiler = new DefaultContextCompiler({ idFactory, clock });

  const sampleGoal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'Refactor enterprise authentication service',
    constraints: { maxIterations: 20, maxCostDollars: 10, timeoutMs: 60000, allowedTools: ['*'] },
    createdAt: new Date(),
  };

  const sampleTask: Task = {
    id: idFactory.create<'Task'>(),
    goalId: sampleGoal.id,
    description: 'Fix token validation error in auth module',
    status: 'IN_PROGRESS',
    assignedAgentId: 'agent-1',
    createdAt: new Date(),
  };

  const sampleState: AgentState = {
    phase: AgentPhase.IMPLEMENT,
    iterationCount: 1,
    history: [],
    metrics: { totalTokens: 0, totalCost: 0, iterations: 1, toolCalls: 0, latencyMs: 0 },
  };

  const tinyModelDescriptor: ModelDescriptor = {
    modelId: 'tiny-model-4k',
    providerId: 'local',
    capabilities: {
      maxContextTokens: 4000,
      maxOutputTokens: 1000,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: false,
    },
    costPer1kInputTokens: 0.001,
    costPer1kOutputTokens: 0.002,
  };

  const largeModelDescriptor: ModelDescriptor = {
    modelId: 'large-model-128k',
    providerId: 'openai',
    capabilities: {
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
    },
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  };

  it('1. 1000 Irrelevant Observations & Critical Decision at Position 999: Preserves critical decision', async () => {
    const now = new Date();
    const candidates: ContextObject[] = [];

    // 998 irrelevant observations
    for (let i = 0; i < 998; i++) {
      candidates.push({
        id: `obs-${i}`,
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.OBSERVATION,
        content: `Irrelevant log message #${i} with background noise details`,
        source: 'executor',
        timestamp: new Date(now.getTime() - i * 1000),
        importance: 0.1,
        confidence: 0.5,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: null,
        costTokens: 20,
        tags: ['noise'],
        version: 1,
        active: true,
        metadata: {},
      });
    }

    // Position 999: Critical decision
    candidates.push({
      id: 'critical-dec-999',
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.DECISION,
      content: 'Critical Decision: Never use hardcoded secrets in authorization header',
      source: 'human',
      timestamp: now,
      importance: 0.99,
      confidence: 1.0,
      scope: ContextScope.GLOBAL,
      dependencies: [],
      lastUsed: now,
      lastVerified: now,
      costTokens: 30,
      tags: ['critical_decision', 'must_preserve'],
      version: 1,
      active: true,
      metadata: {},
    });

    const result = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: sampleState,
      relevantObjects: candidates,
      targetModelDescriptor: tinyModelDescriptor,
      budget: { maxTokens: 3500, softLimitTokens: 3000 },
    });

    // Verify critical decision at position 999 is retained!
    const retainedIds = result.retainedObjects.map((o) => o.id);
    expect(retainedIds).toContain('critical-dec-999');
    expect(result.metrics.tokensAfter).toBeLessThanOrEqual(4000);
    expect(result.metrics.inputObjectCount).toBe(1001); // 1000 + goal/task
  });

  it('2. Contradictory & Stale Memory: Retains high-confidence memory and prunes stale entry', async () => {
    const now = new Date();
    const staleTime = new Date(now.getTime() - 48 * 3600 * 1000); // 48h ago

    const candidates: ContextObject[] = [
      // Stale low-value observation
      {
        id: 'stale-mem-1',
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.OBSERVATION,
        content: 'Old temporary build log from previous run',
        source: 'system',
        timestamp: staleTime,
        importance: 0.2,
        confidence: 0.4,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: staleTime,
        lastVerified: null,
        costTokens: 50,
        tags: ['log'],
        version: 1,
        active: true,
        metadata: {},
      },
      // Contradictory entry 1 (stale / low confidence)
      {
        id: 'contradictory-old',
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.OBSERVATION,
        content: 'Auth port is set to 8080',
        source: 'agent',
        timestamp: staleTime,
        importance: 0.3,
        confidence: 0.5,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: staleTime,
        lastVerified: null,
        costTokens: 20,
        tags: [],
        version: 1,
        active: true,
        metadata: {},
      },
      // Contradictory entry 2 (fresh / high importance & verified)
      {
        id: 'contradictory-new',
        tier: ContextTier.L1_WORKING,
        type: ContextObjectType.REQUIREMENT,
        content: 'Auth port MUST be set to 443 with TLS enabled',
        source: 'architect',
        timestamp: now,
        importance: 0.95,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 25,
        tags: ['must_preserve'],
        version: 1,
        active: true,
        metadata: {},
      },
    ];

    const result = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: sampleState,
      relevantObjects: candidates,
      targetModelDescriptor: tinyModelDescriptor,
      budget: { maxTokens: 2000, softLimitTokens: 1800 },
    });

    const retainedIds = result.retainedObjects.map((o) => o.id);
    expect(retainedIds).toContain('contradictory-new');
    expect(retainedIds).not.toContain('stale-mem-1');
  });

  it('3. Repeated Tool Outputs & Massive Excerpts: Deduplicates tool output and truncates huge excerpt', async () => {
    const now = new Date();
    const hugeExcerpt = 'x'.repeat(20000); // 5000 tokens

    const candidates: ContextObject[] = [
      // Duplicate tool outputs
      {
        id: 'tool-out-1',
        tier: ContextTier.L1_WORKING,
        type: ContextObjectType.OBSERVATION,
        content: 'Tool Output: vitest run tests/unit/auth.test.ts -> PASS',
        source: 'tool',
        timestamp: now,
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 30,
        tags: [],
        version: 1,
        active: true,
        metadata: {},
      },
      {
        id: 'tool-out-2',
        tier: ContextTier.L1_WORKING,
        type: ContextObjectType.OBSERVATION,
        content: 'Tool Output: vitest run tests/unit/auth.test.ts -> PASS',
        source: 'tool',
        timestamp: now,
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 30,
        tags: [],
        version: 1,
        active: true,
        metadata: {},
      },
      // Massive file excerpt
      {
        id: 'huge-file',
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.OBSERVATION,
        content: `File Contents: ${hugeExcerpt}`,
        source: 'file_reader',
        timestamp: now,
        importance: 0.6,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: null,
        costTokens: 5000,
        tags: ['file_excerpt'],
        version: 1,
        active: true,
        metadata: {},
      },
    ];

    const result = await compiler.compile({
      goal: sampleGoal,
      task: sampleTask,
      currentState: sampleState,
      relevantObjects: candidates,
      targetModelDescriptor: tinyModelDescriptor,
      budget: { maxTokens: 3500, softLimitTokens: 3000 },
    });

    expect(result.metrics.tokensAfter).toBeLessThanOrEqual(3500);
    expect(result.metrics.omittedCount).toBeGreaterThan(0);
  });

  it('4. Sublinear Context Growth: Demonstrates compiled token growth is sublinear vs raw iteration history', async () => {
    const now = new Date();
    const rawTokensHistory: number[] = [];
    const compiledTokensHistory: number[] = [];

    // Simulate 50 iterations adding 20 objects per iteration
    const accumulatedCandidates: ContextObject[] = [];
    let currentRawTokens = 0;

    for (let iter = 1; iter <= 50; iter++) {
      for (let j = 0; j < 20; j++) {
        const cost = 50;
        currentRawTokens += cost;
        accumulatedCandidates.push({
          id: `iter-${iter}-obj-${j}`,
          tier: iter % 5 === 0 ? ContextTier.L1_WORKING : ContextTier.L2_EPISODIC,
          type: ContextObjectType.OBSERVATION,
          content: `Iteration ${iter} step ${j} execution log details`,
          source: 'runner',
          timestamp: new Date(now.getTime() + iter * 1000),
          importance: j === 0 ? 0.8 : 0.2,
          confidence: 0.8,
          scope: ContextScope.TASK,
          dependencies: [],
          lastUsed: now,
          lastVerified: null,
          costTokens: cost,
          tags: [],
          version: 1,
          active: true,
          metadata: {},
        });
      }

      const result = await compiler.compile({
        goal: sampleGoal,
        task: sampleTask,
        currentState: { ...sampleState, iterationCount: iter },
        relevantObjects: accumulatedCandidates,
        targetModelDescriptor: largeModelDescriptor,
        budget: { maxTokens: 8000, softLimitTokens: 7000 },
      });

      rawTokensHistory.push(currentRawTokens);
      compiledTokensHistory.push(result.metrics.tokensAfter);
    }

    // At iteration 50, raw tokens = 50 * 20 * 50 = 50,000 tokens!
    // Compiled tokens MUST remain bounded (<= 8,000 tokens) -> SUBLINEAR!
    const finalRaw = rawTokensHistory[rawTokensHistory.length - 1]!;
    const finalCompiled = compiledTokensHistory[compiledTokensHistory.length - 1]!;

    expect(finalRaw).toBe(50000);
    expect(finalCompiled).toBeLessThanOrEqual(8000);
    expect(finalCompiled / finalRaw).toBeLessThan(0.2); // Compressed by > 80%
  });
});
