import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryMemoryStore,
  InMemoryMemoryProvider,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { MemoryTier, MemoryType, MemoryScope, MemoryStatus } from '../../../src/core/index.js';

describe('Memory Subsystem & Provider Abstraction', () => {
  let store: InMemoryMemoryStore;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    store = new InMemoryMemoryStore({ idFactory, clock });
  });

  it('should create memory records with default ACTIVE status and metadata', async () => {
    const record = await store.createRecord({
      tier: MemoryTier.SHORT_TERM,
      type: MemoryType.FACT,
      content: 'Repository uses ESM NodeNext resolution',
      source: 'codebase_inspection',
      importance: 0.7,
      confidence: 1.0,
      scope: MemoryScope.REPOSITORY,
      tags: ['esm', 'typescript'],
    });

    expect(record.id).toBeDefined();
    expect(record.status).toBe(MemoryStatus.ACTIVE);
    expect(record.tier).toBe(MemoryTier.SHORT_TERM);
    expect(record.type).toBe(MemoryType.FACT);
    expect(record.scope).toBe(MemoryScope.REPOSITORY);
    expect(record.accessCount).toBe(0);
  });

  it('should perform selective retrieval with keyword matching and relevance ranking', async () => {
    const rec1 = await store.createRecord({
      tier: MemoryTier.SEMANTIC,
      type: MemoryType.FACT,
      content: 'Database connection uses connection pooling with max 20 connections',
      source: 'config_file',
      importance: 0.9,
      confidence: 1.0,
    });

    const rec2 = await store.createRecord({
      tier: MemoryTier.SEMANTIC,
      type: MemoryType.PATTERN,
      content: 'Frontend component uses React query for caching',
      source: 'code_review',
      importance: 0.5,
      confidence: 0.8,
    });

    // Query specifically for database pool
    const results = await store.retrieve({
      queryText: 'database connections pool',
      limit: 5,
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.record.id).toBe(rec1.id); // Higher keyword & importance relevance
    expect(results[0]!.relevanceScore).toBeGreaterThan(results[1]!.relevanceScore);
  });

  it('should support Memory Invalidation and Staleness marking', async () => {
    const rec = await store.createRecord({
      tier: MemoryTier.SEMANTIC,
      type: MemoryType.FACT,
      content: 'Legacy API endpoint is /v1/old-endpoint',
      source: 'legacy_doc',
      importance: 0.6,
    });

    // Architecture change -> Mark stale
    const staleRecord = await store.markStale(rec.id, 'API upgraded to /v2');
    expect(staleRecord.status).toBe(MemoryStatus.STALE);
    expect(staleRecord.metadata['staleReason']).toBe('API upgraded to /v2');

    // Default active retrieve query omits stale memory
    const activeQuery = await store.retrieve({ activeOnly: true });
    expect(activeQuery.find((s) => s.record.id === rec.id)).toBeUndefined();

    // ActiveOnly: false query returns record with staleness penalty applied
    const allQuery = await store.retrieve({ activeOnly: false });
    const foundStale = allQuery.find((s) => s.record.id === rec.id);
    expect(foundStale).toBeDefined();
    expect(foundStale?.scoreBreakdown['stalePenalty']).toBeGreaterThan(0);
  });

  it('should automatically promote recurring high-importance memories to long-term tier', async () => {
    const rec = await store.createRecord({
      tier: MemoryTier.EPISODIC,
      type: MemoryType.FAILURE_AVOIDANCE,
      content: 'Running db migrate without lock causes deadlock',
      source: 'failed_trial',
      importance: 0.9, // High importance
      tags: ['failure_avoidance'],
    });

    // Record usage twice (successful reuse)
    await store.recordUsage(rec.id, true);
    const updated = await store.recordUsage(rec.id, true);

    expect(updated.status).toBe(MemoryStatus.PROMOTED);
    expect(updated.tier).toBe(MemoryTier.SEMANTIC);
    expect(updated.accessCount).toBe(2);
    expect(updated.successCount).toBe(2);
  });

  it('should filter memory records by scope and scopeTarget', async () => {
    await store.createRecord({
      tier: MemoryTier.EPISODIC,
      type: MemoryType.EXPERIENCE,
      content: 'Modified src/auth/login.ts to fix token refresh',
      source: 'task_execution',
      scope: MemoryScope.FILE,
      scopeTarget: 'src/auth/login.ts',
    });

    await store.createRecord({
      tier: MemoryTier.EPISODIC,
      type: MemoryType.EXPERIENCE,
      content: 'Modified src/db/schema.ts to add index',
      source: 'task_execution',
      scope: MemoryScope.FILE,
      scopeTarget: 'src/db/schema.ts',
    });

    const fileResults = await store.retrieve({
      scopes: [MemoryScope.FILE],
      scopeTarget: 'src/auth/login.ts',
    });

    expect(fileResults).toHaveLength(1);
    expect(fileResults[0]!.record.scopeTarget).toBe('src/auth/login.ts');
  });

  it('should exclude expired records based on TTL (expiresAt)', async () => {
    const futureTime = new Date(clock.now().getTime() + 60000); // Expire in 60s
    const expRecord = await store.createRecord({
      tier: MemoryTier.SHORT_TERM,
      type: MemoryType.FACT,
      content: 'Transient session token xyz',
      source: 'session',
      expiresAt: futureTime,
    });

    // Advance clock past expiration
    clock.advance(120000); // Advance 120s

    const results = await store.retrieve({});
    expect(results.find((s) => s.record.id === expRecord.id)).toBeUndefined();
  });

  it('should delegate to MemoryProvider abstraction', async () => {
    const provider = new InMemoryMemoryProvider();
    const customStore = new InMemoryMemoryStore({
      idFactory,
      clock,
      provider,
    });

    const record = await customStore.createRecord({
      tier: MemoryTier.SEMANTIC,
      type: MemoryType.SKILL,
      content: 'Use git rebase for clean history',
      source: 'developer_guideline',
    });

    const fetchedFromProvider = await provider.getRecord(record.id);
    expect(fetchedFromProvider).toEqual(record);
    expect(provider.providerName).toBe('in-memory-provider');
  });
});
