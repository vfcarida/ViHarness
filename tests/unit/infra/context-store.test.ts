import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryContextStore, UuidV7IdFactory, TestClock } from '../../../src/infra/index.js';
import {
  ContextTier,
  ContextObjectType,
  ContextScope,
  ContextRelationType,
} from '../../../src/core/index.js';

describe('ContextStore & ContextGraph', () => {
  let store: InMemoryContextStore;
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2024-01-01T00:00:00Z'));
    store = new InMemoryContextStore({ idFactory, clock });
  });

  it('should create ContextObjects with version 1 and metadata defaults', async () => {
    const obj = await store.addObject({
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.REQUIREMENT,
      content: 'System must support model hot-swapping',
      source: 'user_instruction',
      importance: 0.9,
      confidence: 1.0,
      scope: ContextScope.GLOBAL,
      tags: ['architecture', 'core'],
    });

    expect(obj.id).toBeDefined();
    expect(obj.version).toBe(1);
    expect(obj.active).toBe(true);
    expect(obj.tier).toBe(ContextTier.L0_HOT);
    expect(obj.type).toBe(ContextObjectType.REQUIREMENT);
    expect(obj.importance).toBe(0.9);
    expect(obj.tags).toContain('architecture');

    const fetched = await store.getObject(obj.id);
    expect(fetched).toEqual(obj);
  });

  it('should support immutable versioning — updates create version N+1 preserving history', async () => {
    const v1 = await store.addObject({
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.HYPOTHESIS,
      content: 'Hypothesis v1: Bug caused by race condition in DB',
      source: 'agent',
      importance: 0.7,
      confidence: 0.6,
    });

    clock.advance(5000); // 5 seconds later

    const v2 = await store.updateObject(v1.id, {
      content: 'Hypothesis v2: Bug caused by missing lock in memory queue',
      confidence: 0.85,
    });

    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(v2.content).toContain('Hypothesis v2');
    expect(v2.confidence).toBe(0.85);

    // Latest getObject returns v2
    const latest = await store.getObject(v1.id);
    expect(latest?.version).toBe(2);

    // Explicit getObject for version 1 returns v1 snapshot
    const fetchedV1 = await store.getObject(v1.id, 1);
    expect(fetchedV1?.version).toBe(1);
    expect(fetchedV1?.content).toContain('Hypothesis v1');

    // Get history returns [v1, v2]
    const history = await store.getObjectHistory(v1.id);
    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe(1);
    expect(history[1]!.version).toBe(2);
  });

  it('should manage typed graph relations and perform contradiction / ancestor traversal', async () => {
    const parentReq = await store.addObject({
      tier: ContextTier.L3_REPOSITORY,
      type: ContextObjectType.REQUIREMENT,
      content: 'All state transitions must be explicit and durable',
      source: 'architecture_doc',
    });

    const hypA = await store.addObject({
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.HYPOTHESIS,
      content: 'State transitions stored in volatile memory',
      source: 'agent',
    });

    const hypB = await store.addObject({
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.HYPOTHESIS,
      content: 'State transitions stored in persistent SQLite table',
      source: 'agent',
    });

    // Add DEPENDS_ON relation (hypB depends on parentReq)
    await store.addRelation({
      sourceId: hypB.id,
      targetId: parentReq.id,
      relation: ContextRelationType.DEPENDS_ON,
    });

    // Add CONTRADICTS relation (hypA contradicts parentReq)
    await store.addRelation({
      sourceId: hypA.id,
      targetId: parentReq.id,
      relation: ContextRelationType.CONTRADICTS,
    });

    // Query graph directly
    const graph = await store.getGraph();

    // Traversal: hypB ancestor is parentReq
    const ancestors = graph.getAncestors(hypB.id, ContextRelationType.DEPENDS_ON);
    expect(ancestors.has(parentReq.id)).toBe(true);

    // Contradiction detection: parentReq has conflicting node hypA
    const conflicts = graph.detectContradictions(parentReq.id);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.id).toBe(hypA.id);
  });

  it('should filter objects by scope, tier, type, minImportance, and tags', async () => {
    await store.addObject({
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.FILE,
      content: 'src/main.ts',
      source: 'tool:read',
      scope: ContextScope.FILE,
      scopeTarget: 'src/main.ts',
      importance: 0.8,
      tags: ['src'],
    });

    await store.addObject({
      tier: ContextTier.L3_REPOSITORY,
      type: ContextObjectType.SECURITY_RULE,
      content: 'Do not log authorization tokens',
      source: 'policy',
      scope: ContextScope.GLOBAL,
      importance: 1.0,
      tags: ['security'],
    });

    // Query L0 FILE objects
    const l0Files = await store.query({
      tier: ContextTier.L0_HOT,
      types: [ContextObjectType.FILE],
    });
    expect(l0Files).toHaveLength(1);
    expect(l0Files[0]!.scopeTarget).toBe('src/main.ts');

    // Query security tags
    const securityObjs = await store.query({
      tags: ['security'],
    });
    expect(securityObjs).toHaveLength(1);
    expect(securityObjs[0]!.type).toBe(ContextObjectType.SECURITY_RULE);
  });

  it('should rank query results by composite relevance score', async () => {
    const objLow = await store.addObject({
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.OBSERVATION,
      content: 'Observation low importance',
      source: 'tool',
      importance: 0.2,
      confidence: 0.5,
    });

    const objHigh = await store.addObject({
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.DECISION,
      content: 'Decision high importance',
      source: 'agent',
      importance: 0.95,
      confidence: 0.95,
      lastVerified: new Date(),
    });

    const results = await store.query({
      tier: ContextTier.L1_WORKING,
      sortBy: 'relevance',
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe(objHigh.id); // Higher relevance ranked first
    expect(results[1]!.id).toBe(objLow.id);
  });

  it('should support non-destructive deactivation (preserves history, omitted from active projection)', async () => {
    const obj = await store.addObject({
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.HYPOTHESIS,
      content: 'Old hypothesis to deactivate',
      source: 'agent',
    });

    const deactivated = await store.deactivate(obj.id);
    expect(deactivated).toBe(true);

    // Active projection query omits deactivated object by default
    const activeQuery = await store.query({ onlyActive: true });
    expect(activeQuery.find((o) => o.id === obj.id)).toBeUndefined();

    // Query with onlyActive = false reveals object in history
    const allQuery = await store.query({ onlyActive: false });
    const foundInHistory = allQuery.find((o) => o.id === obj.id);
    expect(foundInHistory).toBeDefined();
    expect(foundInHistory?.active).toBe(false);
  });

  it('should reconstruct active context history as it existed at a past timestamp', async () => {
    // T = 0: Add Object 1
    const obj1 = await store.addObject({
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.REQUIREMENT,
      content: 'Requirement created at T=0',
      source: 'user',
    });

    clock.advance(10000); // T = +10s
    const timeT10 = clock.now();

    // T = +20s: Add Object 2 and update Object 1
    clock.advance(10000); // T = +20s
    await store.addObject({
      tier: ContextTier.L1_WORKING,
      type: ContextObjectType.DECISION,
      content: 'Decision created at T=20s',
      source: 'agent',
    });

    await store.updateObject(obj1.id, {
      content: 'Requirement updated at T=20s',
    });

    // Reconstruct history at T=10s
    const historyAtT10 = await store.reconstructHistoryAt(timeT10);

    expect(historyAtT10).toHaveLength(1);
    expect(historyAtT10[0]!.id).toBe(obj1.id);
    expect(historyAtT10[0]!.version).toBe(1); // Version 1 at T=10s
    expect(historyAtT10[0]!.content).toBe('Requirement created at T=0');
  });
});
