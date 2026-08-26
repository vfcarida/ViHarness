import { describe, it, expect } from 'vitest';
import { MemoryLifecycle } from '../../../src/infra/memory/memory-lifecycle.js';
import { MemoryRetriever } from '../../../src/infra/memory/memory-retriever.js';
import { MemoryScorer } from '../../../src/infra/memory/memory-scorer.js';
import {
  MemoryStatus,
  MemoryTier,
  MemoryType,
  MemoryScope,
} from '../../../src/core/model/memory-types.js';
import type { MemoryRecord, MemoryQuery } from '../../../src/core/model/memory-types.js';
import type { MemoryId, TaskId } from '../../../src/core/types/identifiers.js';

describe('MemoryRetriever & MemoryLifecycle Unit Suite', () => {
  const now = new Date('2024-01-01T12:00:00Z');

  function createRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
    return {
      id: 'mem-1' as MemoryId,
      taskId: 'task-1' as TaskId,
      tier: MemoryTier.SHORT_TERM,
      type: MemoryType.OBSERVATION,
      scope: MemoryScope.TASK,
      status: MemoryStatus.ACTIVE,
      summary: 'Test memory summary',
      content: 'Detailed memory content regarding database migration',
      importance: 0.5,
      confidence: 0.8,
      tags: ['db', 'migration'],
      source: 'agent',
      accessCount: 0,
      successCount: 0,
      failureCount: 0,
      recurrenceCount: 1,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:00:00Z'),
      lastUsed: new Date('2024-01-01T10:00:00Z'),
      lastVerified: null,
      expiresAt: null,
      metadata: {},
      ...overrides,
    };
  }

  describe('MemoryLifecycle', () => {
    it('1. shouldPromote returns true for explicit human/user decisions', () => {
      expect(MemoryLifecycle.shouldPromote(createRecord({ source: 'user' }))).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ source: 'human' }))).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ tags: ['user_decision'] }))).toBe(true);
    });

    it('2. shouldPromote returns true for architecture significance and failure prevention', () => {
      expect(MemoryLifecycle.shouldPromote(createRecord({ type: MemoryType.DECISION }))).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ type: MemoryType.PATTERN }))).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ tags: ['architecture'] }))).toBe(true);
      expect(
        MemoryLifecycle.shouldPromote(createRecord({ type: MemoryType.FAILURE_AVOIDANCE })),
      ).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ tags: ['failure_prevention'] }))).toBe(
        true,
      );
    });

    it('3. shouldPromote evaluates high importance + recurrence & reuse history', () => {
      expect(
        MemoryLifecycle.shouldPromote(createRecord({ importance: 0.8, recurrenceCount: 2 })),
      ).toBe(true);
      expect(
        MemoryLifecycle.shouldPromote(createRecord({ importance: 0.5, recurrenceCount: 2 })),
      ).toBe(false);
      expect(MemoryLifecycle.shouldPromote(createRecord({ successCount: 1 }))).toBe(true);
      expect(MemoryLifecycle.shouldPromote(createRecord({ accessCount: 2 }))).toBe(true);
    });

    it('4. shouldPromote returns false for STALE, INVALIDATED or ARCHIVED records', () => {
      expect(
        MemoryLifecycle.shouldPromote(createRecord({ status: MemoryStatus.STALE, source: 'user' })),
      ).toBe(false);
      expect(
        MemoryLifecycle.shouldPromote(
          createRecord({ status: MemoryStatus.INVALIDATED, source: 'user' }),
        ),
      ).toBe(false);
      expect(
        MemoryLifecycle.shouldPromote(
          createRecord({ status: MemoryStatus.ARCHIVED, source: 'user' }),
        ),
      ).toBe(false);
    });

    it('5. determinePromotedTier selects PROCEDURAL for workflows/patterns and SEMANTIC otherwise', () => {
      expect(MemoryLifecycle.determinePromotedTier(createRecord({ tags: ['workflow'] }))).toBe(
        MemoryTier.PROCEDURAL,
      );
      expect(MemoryLifecycle.determinePromotedTier(createRecord({ tags: ['skill'] }))).toBe(
        MemoryTier.PROCEDURAL,
      );
      expect(MemoryLifecycle.determinePromotedTier(createRecord({ tags: ['general'] }))).toBe(
        MemoryTier.SEMANTIC,
      );
    });

    it('6. isExpired checks TTL timestamp accurately', () => {
      const pastExpire = new Date('2024-01-01T11:00:00Z');
      const futureExpire = new Date('2024-01-01T13:00:00Z');

      expect(MemoryLifecycle.isExpired(createRecord({ expiresAt: pastExpire }), now)).toBe(true);
      expect(MemoryLifecycle.isExpired(createRecord({ expiresAt: futureExpire }), now)).toBe(false);
      expect(MemoryLifecycle.isExpired(createRecord({ expiresAt: undefined }), now)).toBe(false);
    });
  });

  describe('MemoryRetriever & MemoryScorer', () => {
    it('7. Retrieves and filters candidates by status, tags, and minimum thresholds', () => {
      const activeMatch = createRecord({
        id: 'mem-1' as MemoryId,
        tags: ['security'],
        importance: 0.9,
        confidence: 0.9,
      });
      const inactiveRecord = createRecord({ id: 'mem-2' as MemoryId, status: MemoryStatus.STALE });
      const lowImportance = createRecord({ id: 'mem-3' as MemoryId, importance: 0.2 });
      const expiredRecord = createRecord({
        id: 'mem-4' as MemoryId,
        expiresAt: new Date('2024-01-01T08:00:00Z'),
      });

      const query: MemoryQuery = {
        activeOnly: true,
        tags: ['security'],
        minImportance: 0.5,
        minConfidence: 0.5,
      };

      const results = MemoryRetriever.retrieve(
        [activeMatch, inactiveRecord, lowImportance, expiredRecord],
        query,
        now,
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.record.id).toBe('mem-1');
      expect(results[0]?.relevanceScore).toBeGreaterThan(0);
    });

    it('8. Ranks results by composite relevance score and respects query limit', () => {
      const highRelevance = createRecord({
        id: 'mem-high' as MemoryId,
        summary: 'Authentication jwt token validation',
        content: 'JWT token signing algorithm check',
        importance: 0.95,
        accessCount: 5,
        updatedAt: now,
      });

      const lowRelevance = createRecord({
        id: 'mem-low' as MemoryId,
        summary: 'CSS stylesheet colors',
        content: 'Button background color blue',
        importance: 0.3,
        accessCount: 0,
        updatedAt: new Date('2023-01-01T00:00:00Z'),
      });

      const query: MemoryQuery = {
        queryText: 'jwt authentication token',
        limit: 1,
      };

      const results = MemoryRetriever.retrieve([lowRelevance, highRelevance], query, now);
      expect(results).toHaveLength(1);
      expect(results[0]?.record.id).toBe('mem-high');
    });

    it('9. MemoryScorer calculates composite score combining semantic match, recency and importance', () => {
      const rec = createRecord({
        summary: 'Fast API endpoint routing',
        content: 'Routes definition in api router',
        importance: 0.8,
        accessCount: 3,
        updatedAt: now,
      });

      const query: MemoryQuery = { queryText: 'API routing' };
      const scored = MemoryScorer.score(rec, query, now.getTime());

      expect(scored.relevanceScore).toBeGreaterThan(0);
      expect(scored.scoreBreakdown.recencyScore).toBeCloseTo(1.0, 1);
      expect(scored.scoreBreakdown.importance).toBe(0.8);
    });
  });
});
