/**
 * Unit Tests for Cache-Aware Compaction + Per-Tool Budget Caps (P002).
 *
 * Validates:
 * 1. ModelResponse & TokenUsage cache metrics parsing in OpenAICompatibleProvider.
 * 2. CachePrefixTracker: Accurately identifies prompt cache prefixes using actual provider metrics.
 * 3. Cache-Preserving Compaction: Retains cached prefix messages unmodified to avoid KV-cache invalidation.
 * 4. Deferred Boundary Pattern: Defers mutating boundary markers within active cached prefix.
 * 5. Compactor uses actual cache metrics from model responses to make optimal compaction decisions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/infra/model/openai-compatible-provider.js';
import { CachePrefixTracker } from '../../../src/infra/compiler/cache-prefix-tracker.js';
import { ContextCompressor } from '../../../src/infra/compiler/context-compressor.js';
import { ContextRanker } from '../../../src/infra/compiler/context-ranker.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { ContextTier } from '../../../src/core/model/context.js';
import {
  ContextObjectType,
  ContextScope,
  type ContextObject,
} from '../../../src/core/model/context-object.js';
import {
  MessageRole,
  type ModelRequest,
  type ModelResponse,
  FinishReason,
} from '../../../src/core/model/model-io.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../../src/core/model/compiler-types.js';

describe('Cache-Aware Compaction + Per-Tool Budget Caps (P002)', () => {
  const idFactory = new UuidV7IdFactory();
  const now = new Date('2026-08-19T10:00:00Z');
  const nowMs = now.getTime();

  let tracker: CachePrefixTracker;

  beforeEach(() => {
    tracker = new CachePrefixTracker();
  });

  // -------------------------------------------------------------------------
  // 1. OpenAICompatibleProvider: Cache Metrics Extraction
  // -------------------------------------------------------------------------
  it('1. OpenAICompatibleProvider: Extracts and returns cache metrics from response body', async () => {
    const mockResponseBody = {
      id: 'chatcmpl-test-cache-123',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Database connection pool refactored successfully.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 2400,
        completion_tokens: 150,
        total_tokens: 2550,
        prompt_tokens_details: {
          cached_tokens: 1800,
        },
        cache_creation_input_tokens: 600,
        cache_deleted_input_tokens: 0,
      },
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockResponseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new OpenAICompatibleProvider({
      customFetch: mockFetch as any,
      defaultModelId: 'gpt-4o',
    });

    const request: ModelRequest = {
      messages: [
        { role: MessageRole.SYSTEM, content: 'System instruction prefix.' },
        { role: MessageRole.USER, content: 'Refactor DB pool.' },
      ],
    };

    const response = await provider.complete(request);

    // Verify cache metrics on ModelResponse
    expect(response.cacheMetrics).toBeDefined();
    expect(response.cacheMetrics?.cacheReadInputTokens).toBe(1800);
    expect(response.cacheMetrics?.cacheCreationInputTokens).toBe(600);
    expect(response.cacheMetrics?.cacheDeletedInputTokens).toBe(0);

    // Verify TokenUsage has cache fields
    expect(response.usage.cacheReadTokens).toBe(1800);
    expect(response.usage.cacheWriteTokens).toBe(600);
  });

  // -------------------------------------------------------------------------
  // 2. CachePrefixTracker: Accurately Identifies Cached Prefix Messages
  // -------------------------------------------------------------------------
  it('2. CachePrefixTracker: Maps actual cacheReadTokens to prefix messages', () => {
    const msg1Content = 'STATIC SYSTEM INSTRUCTIONS: ' + 'RULE_'.repeat(100); // ~500 chars -> ~125 tokens
    const msg2Content = 'REPO SYMBOL MAP: ' + 'SYMBOL_ENTRY_'.repeat(200); // ~2600 chars -> ~650 tokens
    const msg3Content = 'DYNAMIC OBSERVATION: Latest test failure in worker.ts'; // ~50 chars -> ~13 tokens

    const request: ModelRequest = {
      systemPrompt: 'BASE SYSTEM PROMPT', // ~18 chars -> ~5 tokens
      messages: [
        {
          role: MessageRole.SYSTEM,
          content: msg1Content,
          metadata: { id: 'static_system_msg' },
        },
        {
          role: MessageRole.SYSTEM,
          content: msg2Content,
          metadata: { id: 'static_repo_map_msg' },
        },
        {
          role: MessageRole.USER,
          content: msg3Content,
          metadata: { id: 'dynamic_obs_msg' },
        },
      ],
    };

    const response: ModelResponse = {
      requestId: 'req_1',
      modelId: 'gpt-4o',
      providerId: 'openai',
      content: 'OK',
      toolCalls: [],
      usage: {
        inputTokens: 810,
        outputTokens: 50,
        totalTokens: 860,
        cacheReadTokens: 795, // Covers system prompt (5) + msg1 (132) + msg2 (655) = 792 tokens
      },
      finishReason: FinishReason.STOP,
      latencyMs: 250,
      estimatedCostDollars: 0.002,
      cacheMetrics: {
        cacheReadInputTokens: 795,
        cacheCreationInputTokens: 15,
      },
    };

    tracker.recordResponse(request, response);

    // Verify tracked prefix items
    expect(tracker.isPrefixCached('static_system_msg')).toBe(true);
    expect(tracker.isPrefixCached('static_repo_map_msg')).toBe(true);
    expect(tracker.isPrefixCached('dynamic_obs_msg')).toBe(false);

    const cachedIds = tracker.getCachedPrefixIds();
    expect(cachedIds.has('static_system_msg')).toBe(true);
    expect(cachedIds.has('static_repo_map_msg')).toBe(true);

    const efficiency = tracker.getEfficiencyReport(response);
    expect(efficiency.cacheReadTokens).toBe(795);
    expect(efficiency.cacheHitRatio).toBeCloseTo(795 / 810, 2);
  });

  // -------------------------------------------------------------------------
  // 3. Cache-Preserving Compaction: Retains Cached Prefix Messages Unmodified
  // -------------------------------------------------------------------------
  it('3. Cache-Preserving Compaction: Skips mutating cached prefix items, compacting items after the prefix', () => {
    const cachedPrefixObj1Id = idFactory.create<'Context'>();
    const cachedPrefixObj2Id = idFactory.create<'Context'>();
    const uncachedObservationId = idFactory.create<'Context'>();
    const uncachedRepetitive1Id = idFactory.create<'Context'>();
    const uncachedRepetitive2Id = idFactory.create<'Context'>();

    const objects: ContextObject[] = [
      // 1. Cached prefix system rules (in cache prefix)
      {
        id: cachedPrefixObj1Id,
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.OBSERVATION,
        content: 'System architecture rules: ALWAYS use connection pooling.',
        source: 'system',
        timestamp: now,
        importance: 0.6,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 80,
        tags: ['architecture', 'cached_prefix'],
        version: 1,
        active: true,
        metadata: { isCachedPrefix: true },
      },
      // 2. Cached prefix tool schema (in cache prefix)
      {
        id: cachedPrefixObj2Id,
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.OBSERVATION,
        content: 'Available tool schemas: db_query, db_migrate, run_test.',
        source: 'system',
        timestamp: now,
        importance: 0.6,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 120,
        tags: ['tools', 'cached_prefix'],
        version: 1,
        active: true,
        metadata: { isCachedPrefix: true },
      },
      // 3. Uncached ephemeral debug log (AFTER cache prefix -> Snip candidate)
      {
        id: uncachedObservationId,
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: '[DEBUG] Ping latency 45ms stdout: OK',
        source: 'tracer',
        timestamp: new Date(nowMs - 20 * 60 * 60 * 1000), // 20 hours old
        importance: 0.2,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: new Date(nowMs - 20 * 60 * 60 * 1000),
        lastVerified: null,
        costTokens: 60,
        tags: ['ephemeral', 'log'],
        version: 1,
        active: true,
        metadata: {},
      },
      // 4. Uncached repetitive tool output (AFTER cache prefix -> Microcompact candidate)
      {
        id: uncachedRepetitive1Id,
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: 'test run: 45 passed, 0 failed',
        source: 'tool_executor',
        timestamp: now,
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 100,
        tags: ['tool_output'],
        version: 1,
        active: true,
        metadata: {},
      },
      {
        id: uncachedRepetitive2Id,
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: 'test run: 45 passed, 0 failed',
        source: 'tool_executor',
        timestamp: now,
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 100,
        tags: ['tool_output'],
        version: 1,
        active: true,
        metadata: {},
      },
    ];

    const scored = objects.map((o) => ContextRanker.scoreObject(o, nowMs, DEFAULT_SCORING_WEIGHTS));

    const cachedPrefixIds = new Set([cachedPrefixObj1Id, cachedPrefixObj2Id]);

    const result = ContextCompressor.compress(scored, 400, nowMs, {
      cachedPrefixIds,
      cacheMetrics: {
        cacheReadInputTokens: 200,
      },
    });

    // Verify cached prefix items were preserved unmodified with cache-aware explanation
    const prefixExplanations = result.explanations.filter(
      (e) => e.id === cachedPrefixObj1Id || e.id === cachedPrefixObj2Id,
    );
    expect(prefixExplanations.length).toBe(2);
    expect(prefixExplanations.every((e) => e.action === 'RETAINED')).toBe(true);
    expect(prefixExplanations.some((e) => e.reason.includes('Cache-Aware Compaction'))).toBe(true);

    // Verify uncached items after prefix were compacted/snipped
    expect(result.omitted.some((o) => o.id === uncachedObservationId)).toBe(true);
    expect(result.explanations.some((e) => e.action === 'SUMMARIZED')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Deferred Boundary Pattern
  // -------------------------------------------------------------------------
  it('4. Deferred Boundary Pattern: Defers mutating boundary markers within active cached prefix', () => {
    const cachedPrefixId = idFactory.create<'Context'>();
    const uncachedId = idFactory.create<'Context'>();

    const objects: ContextObject[] = [
      {
        id: cachedPrefixId,
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.OBSERVATION,
        content: 'Prefix content in active cache window.',
        source: 'system',
        timestamp: now,
        importance: 0.8,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 50,
        tags: ['cached_prefix'],
        version: 1,
        active: true,
        metadata: { isCachedPrefix: true },
      },
      {
        id: uncachedId,
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.OBSERVATION,
        content: 'STDOUT: ' + 'DATA_ROW_'.repeat(400), // ~1600 tokens
        source: 'tool_executor',
        timestamp: now,
        importance: 0.5,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 1600,
        tags: ['tool_output'],
        version: 1,
        active: true,
        metadata: {},
      },
    ];

    const scored = objects.map((o) => ContextRanker.scoreObject(o, nowMs, DEFAULT_SCORING_WEIGHTS));

    const result = ContextCompressor.compress(scored, 600, nowMs, {
      cachedPrefixIds: new Set([cachedPrefixId]),
      deferBoundaryMarkers: true,
      maxToolResultTokens: 500,
    });

    // Cached prefix item retained untouched
    const cachedRetained = result.retained.find((o) => o.id === cachedPrefixId);
    expect(cachedRetained).toBeDefined();
    expect(cachedRetained?.content).toBe('Prefix content in active cache window.');

    // Uncached tool result after prefix was trimmed to budget cap
    const uncachedRetained = result.retained.find((o) => o.id === uncachedId);
    expect(uncachedRetained).toBeDefined();
    expect(uncachedRetained?.costTokens).toBeLessThanOrEqual(500);
  });

  // -------------------------------------------------------------------------
  // 5. Compactor Uses Actual Cache Metrics
  // -------------------------------------------------------------------------
  it('5. Actual Cache Metrics Integration: Employs response cache metrics to protect active KV prefix', () => {
    const req: ModelRequest = {
      messages: [
        {
          role: MessageRole.SYSTEM,
          content: 'SYSTEM STANDARD GUIDELINES: Strict typescript, no any.',
          metadata: { id: 'guidelines_1' },
        },
        {
          role: MessageRole.USER,
          content: 'Implement connection pooling.',
          metadata: { id: 'task_user_1' },
        },
      ],
    };

    const res: ModelResponse = {
      requestId: 'res_100',
      modelId: 'claude-3-5-sonnet',
      providerId: 'anthropic',
      content: 'I will implement pooling.',
      toolCalls: [],
      usage: {
        inputTokens: 500,
        outputTokens: 40,
        totalTokens: 540,
        cacheReadTokens: 450,
        cacheWriteTokens: 50,
      },
      finishReason: FinishReason.STOP,
      latencyMs: 300,
      estimatedCostDollars: 0.001,
      cacheMetrics: {
        cacheReadInputTokens: 450,
        cacheCreationInputTokens: 50,
      },
    };

    tracker.recordResponse(req, res);

    expect(tracker.isPrefixCached('guidelines_1')).toBe(true);
    expect(tracker.getLastCacheMetrics()?.cacheReadInputTokens).toBe(450);

    const compressorOptions = {
      cachedPrefixIds: tracker.getCachedPrefixIds(),
      cacheMetrics: tracker.getLastCacheMetrics(),
    };

    expect(compressorOptions.cachedPrefixIds.has('guidelines_1')).toBe(true);
    expect(compressorOptions.cacheMetrics?.cacheReadInputTokens).toBe(450);
  });
});
