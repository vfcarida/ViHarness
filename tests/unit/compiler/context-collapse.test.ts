/**
 * Context Collapse Test Suite (Prompt P001).
 *
 * Validates:
 * - Read-time virtual projection does NOT mutate original stored history
 * - Collapsed projection reduces token count
 * - Full history reconstruction perfectly restores original objects
 * - Threshold evaluation (fires only when context exceeds 70% threshold)
 * - Chain patching metadata tracking (headId, anchorId, tailId, original/collapsed token costs)
 * - Invariant preservation (user instructions, security decisions never collapsed)
 */
import { describe, it, expect } from 'vitest';
import {
  ContextCollapser,
  InMemoryCollapseStore,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  ContextObjectType,
  ContextTier,
  ContextScope,
  type ContextObject,
} from '../../../src/core/index.js';

describe('Context Collapse — Virtual Projection & Reversible Reconstruction', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));
  const now = clock.now();

  function createEpisodicObjects(count: number, tokenCostEach = 100): ContextObject[] {
    const objects: ContextObject[] = [];
    for (let i = 1; i <= count; i++) {
      objects.push({
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.ATTEMPT,
        content: `Attempt #${i}: Executed fix strategy variation with params alpha=${i * 10} beta=${i * 20}`,
        source: 'agent',
        timestamp: new Date(now.getTime() - (count - i) * 60 * 1000),
        importance: 0.5,
        confidence: 0.8,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: new Date(now.getTime() - (count - i) * 60 * 1000),
        lastVerified: null,
        costTokens: tokenCostEach,
        tags: ['episodic', 'attempt'],
        version: 1,
        active: true,
        metadata: { attemptIndex: i },
      });
    }
    return objects;
  }

  it('1. Virtual Projection: Produces collapsed view without mutating original objects', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const originalObjects = createEpisodicObjects(5, 100); // 500 tokens
    const originalClone = JSON.parse(JSON.stringify(originalObjects));

    // Under model budget 500, current 500 > 500 * 0.70 = 350 -> triggers collapse
    const result = await ContextCollapser.applyCollapsesIfNeeded(originalObjects, collapseStore, {
      modelMaxTokens: 500,
      currentTokens: 500,
      collapseThreshold: 0.7,
      now,
    });

    // 1. Projected array has collapsed single milestone item
    expect(result.projected.length).toBe(1);
    expect(result.collapsesCreated.length).toBe(1);
    expect(result.tokensReduced).toBeGreaterThan(300);

    // 2. Projected item has virtual projection markers and metadata
    const collapsedItem = result.projected[0]!;
    expect(collapsedItem.metadata?.['isVirtualProjection']).toBe(true);
    expect(collapsedItem.tags).toContain('virtual_projection');

    // 3. Original objects remain 100% UNMUTATED
    expect(originalObjects.length).toBe(5);
    expect(JSON.stringify(originalObjects)).toBe(JSON.stringify(originalClone));
  });

  it('2. Token Reduction: Collapsed view has significantly fewer tokens than original', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const originalObjects = createEpisodicObjects(10, 150); // 1500 tokens
    const rawTokens = originalObjects.reduce((acc, o) => acc + o.costTokens, 0);

    const result = await ContextCollapser.applyCollapsesIfNeeded(originalObjects, collapseStore, {
      modelMaxTokens: 1000,
      currentTokens: rawTokens,
      collapseThreshold: 0.7,
      now,
    });

    const projectedTokens = result.projected.reduce((acc, o) => acc + o.costTokens, 0);
    expect(projectedTokens).toBeLessThan(rawTokens * 0.3); // >70% compression on episodic logs
    expect(result.tokensReduced).toBe(rawTokens - projectedTokens);
  });

  it('3. Full History Reconstruction: Expands collapsed projection back to exact original sequence', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const originalObjects = createEpisodicObjects(6, 120);

    const collapseResult = await ContextCollapser.applyCollapsesIfNeeded(
      originalObjects,
      collapseStore,
      {
        modelMaxTokens: 600,
        currentTokens: 720,
        collapseThreshold: 0.7,
        now,
      },
    );

    expect(collapseResult.projected.length).toBe(1);

    // Reconstruct full history
    const reconstructed = await ContextCollapser.reconstructFullHistory(
      collapseResult.projected,
      collapseStore,
    );

    expect(reconstructed.length).toBe(originalObjects.length);
    for (let i = 0; i < originalObjects.length; i++) {
      expect(reconstructed[i]!.id).toBe(originalObjects[i]!.id);
      expect(reconstructed[i]!.content).toBe(originalObjects[i]!.content);
      expect(reconstructed[i]!.costTokens).toBe(originalObjects[i]!.costTokens);
    }
  });

  it('4. Threshold Evaluation: Does NOT fire collapse when below 70% threshold', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const originalObjects = createEpisodicObjects(4, 50); // 200 tokens

    // Model max 1000, threshold 70% = 700 tokens. Current 200 <= 700 -> no collapse
    const result = await ContextCollapser.applyCollapsesIfNeeded(originalObjects, collapseStore, {
      modelMaxTokens: 1000,
      currentTokens: 200,
      collapseThreshold: 0.7,
      now,
    });

    expect(result.projected.length).toBe(4);
    expect(result.collapsesCreated.length).toBe(0);
    expect(result.tokensReduced).toBe(0);
  });

  it('5. Metadata Tracking: Correctly records headId, anchorId, and tailId for chain patching', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const originalObjects = createEpisodicObjects(7, 80);

    const headExpected = originalObjects[0]!.id;
    const tailExpected = originalObjects[6]!.id;
    const anchorExpected = originalObjects[3]!.id; // middle item

    const result = await ContextCollapser.applyCollapsesIfNeeded(originalObjects, collapseStore, {
      modelMaxTokens: 400,
      currentTokens: 560,
      collapseThreshold: 0.7,
      now,
    });

    expect(result.collapsesCreated.length).toBe(1);
    const collapseRecord = result.collapsesCreated[0]!;

    expect(collapseRecord.metadata.headId).toBe(headExpected);
    expect(collapseRecord.metadata.tailId).toBe(tailExpected);
    expect(collapseRecord.metadata.anchorId).toBe(anchorExpected);
    expect(collapseRecord.metadata.collapsedCount).toBe(7);
    expect(collapseRecord.metadata.originalTokens).toBe(560);
    expect(collapseRecord.metadata.collapsedTokens).toBeLessThan(100);

    // Stored in collapseStore
    const retrieved = await collapseStore.getCollapse(collapseRecord.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.metadata.headId).toBe(headExpected);
  });

  it('6. Invariant Preservation: Preserves user instructions and core decisions uncollapsed', async () => {
    const collapseStore = new InMemoryCollapseStore();
    const objects: ContextObject[] = [
      {
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.USER_INSTRUCTION,
        content: 'Goal: Implement non-mutating context collapse pipeline',
        source: 'user',
        timestamp: now,
        importance: 1.0,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 40,
        tags: ['must_preserve', 'goal'],
        version: 1,
        active: true,
        metadata: {},
      },
      ...createEpisodicObjects(4, 100),
      {
        id: idFactory.create<'Context'>(),
        tier: ContextTier.L3_REPOSITORY,
        type: ContextObjectType.DECISION,
        content: 'ARCHITECTURAL DECISION: Stored context is immutable and unmutated.',
        source: 'architect',
        timestamp: now,
        importance: 1.0,
        confidence: 1.0,
        scope: ContextScope.GLOBAL,
        dependencies: [],
        lastUsed: now,
        lastVerified: now,
        costTokens: 30,
        tags: ['must_preserve', 'decision'],
        version: 1,
        active: true,
        metadata: {},
      },
      ...createEpisodicObjects(4, 100),
    ];

    const result = await ContextCollapser.applyCollapsesIfNeeded(objects, collapseStore, {
      modelMaxTokens: 600,
      currentTokens: 870,
      collapseThreshold: 0.7,
      now,
    });

    // Invariants (User instruction, Decision) remain as separate distinct uncollapsed objects
    const retainedInstructions = result.projected.filter(
      (o) => o.type === ContextObjectType.USER_INSTRUCTION,
    );
    const retainedDecisions = result.projected.filter((o) => o.type === ContextObjectType.DECISION);

    expect(retainedInstructions.length).toBe(1);
    expect(retainedDecisions.length).toBe(1);
    expect(retainedInstructions[0]?.content).toContain('Implement non-mutating');
    expect(retainedDecisions[0]?.content).toContain('ARCHITECTURAL DECISION');

    // Two separate collapse milestone blocks created around the invariants
    expect(result.collapsesCreated.length).toBe(2);
  });
});
