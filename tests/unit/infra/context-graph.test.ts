import { describe, it, expect, beforeEach } from 'vitest';
import { ContextGraph } from '../../../src/infra/context/context-graph.js';
import { ContextObjectType, ContextRelationType } from '../../../src/core/model/context-object.js';
import { ContextTier } from '../../../src/core/model/context.js';
import type { ContextObject, ContextRelation } from '../../../src/core/model/context-object.js';
import type { ContextId, TaskId } from '../../../src/core/types/identifiers.js';

describe('ContextGraph Unit Suite', () => {
  let graph: ContextGraph;
  const taskId = 'task-100' as TaskId;

  function createNode(
    id: string,
    type = ContextObjectType.OBSERVATION,
    content = 'content',
  ): ContextObject {
    return {
      id: id as ContextId,
      taskId,
      tier: ContextTier.L1_WORKING,
      type,
      content,
      tokenEstimate: 50,
      importance: 0.8,
      createdAt: new Date(),
      updatedAt: new Date(),
      sourceIteration: 1,
      tags: [],
      metadata: {},
      isMustPreserve: false,
    };
  }

  beforeEach(() => {
    graph = new ContextGraph();
  });

  it('1. Node lifecycle: addNode, getNode, hasNode, clear', () => {
    const nodeA = createNode('node-A', ContextObjectType.FILE_CONTENT, 'file A');
    const nodeB = createNode('node-B', ContextObjectType.HYPOTHESIS, 'hypothesis B');

    expect(graph.hasNode('node-A' as ContextId)).toBe(false);
    graph.addNode(nodeA);
    graph.addNode(nodeB);

    expect(graph.hasNode('node-A' as ContextId)).toBe(true);
    expect(graph.getNode('node-A' as ContextId)?.content).toBe('file A');
    expect(graph.getNode('node-B' as ContextId)?.type).toBe(ContextObjectType.HYPOTHESIS);

    graph.clear();
    expect(graph.hasNode('node-A' as ContextId)).toBe(false);
    expect(graph.getNode('node-A' as ContextId)).toBeUndefined();
  });

  it('2. Relation lifecycle: addRelation, removeRelation, getRelationsFrom, getRelationsTo', () => {
    const nodeA = createNode('node-A');
    const nodeB = createNode('node-B');
    const nodeC = createNode('node-C');

    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addNode(nodeC);

    const rel1: ContextRelation = {
      id: 'rel-1',
      sourceId: nodeA.id,
      targetId: nodeB.id,
      relation: ContextRelationType.DEPENDS_ON,
      createdAt: new Date(),
    };

    const rel2: ContextRelation = {
      id: 'rel-2',
      sourceId: nodeA.id,
      targetId: nodeC.id,
      relation: ContextRelationType.REFERENCES,
      createdAt: new Date(),
    };

    graph.addRelation(rel1);
    graph.addRelation(rel2);

    const fromA = graph.getRelationsFrom(nodeA.id);
    expect(fromA).toHaveLength(2);

    const fromADepends = graph.getRelationsFrom(nodeA.id, ContextRelationType.DEPENDS_ON);
    expect(fromADepends).toHaveLength(1);
    expect(fromADepends[0]?.targetId).toBe(nodeB.id);

    const toB = graph.getRelationsTo(nodeB.id);
    expect(toB).toHaveLength(1);
    expect(toB[0]?.sourceId).toBe(nodeA.id);

    // Remove relation
    const removed = graph.removeRelation('rel-1');
    expect(removed).toBe(true);
    expect(graph.getRelationsFrom(nodeA.id, ContextRelationType.DEPENDS_ON)).toHaveLength(0);
    expect(graph.removeRelation('non-existent')).toBe(false);
  });

  it('3. Graph Traversal: getAncestors and getDescendants with multi-hop paths and cycle avoidance', () => {
    // Chain: A -> B -> C -> D -> A (with cycle)
    const nodeA = createNode('node-A');
    const nodeB = createNode('node-B');
    const nodeC = createNode('node-C');
    const nodeD = createNode('node-D');

    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addNode(nodeC);
    graph.addNode(nodeD);

    graph.addRelation({
      id: 'r1',
      sourceId: nodeA.id,
      targetId: nodeB.id,
      relation: ContextRelationType.DEPENDS_ON,
      createdAt: new Date(),
    });
    graph.addRelation({
      id: 'r2',
      sourceId: nodeB.id,
      targetId: nodeC.id,
      relation: ContextRelationType.DEPENDS_ON,
      createdAt: new Date(),
    });
    graph.addRelation({
      id: 'r3',
      sourceId: nodeC.id,
      targetId: nodeD.id,
      relation: ContextRelationType.DEPENDS_ON,
      createdAt: new Date(),
    });
    graph.addRelation({
      id: 'r4',
      sourceId: nodeD.id,
      targetId: nodeA.id,
      relation: ContextRelationType.DEPENDS_ON,
      createdAt: new Date(),
    }); // cycle!

    // Ancestors of A (nodes A points to via DEPENDS_ON)
    const ancestorsOfA = graph.getAncestors(nodeA.id, ContextRelationType.DEPENDS_ON);
    expect(ancestorsOfA.has(nodeB.id)).toBe(true);
    expect(ancestorsOfA.has(nodeC.id)).toBe(true);
    expect(ancestorsOfA.has(nodeD.id)).toBe(true);
    // Should terminate gracefully despite cycle
    expect(ancestorsOfA.size).toBe(3);

    // Descendants of D (nodes pointing to D)
    const descendantsOfD = graph.getDescendants(nodeD.id, ContextRelationType.DEPENDS_ON);
    expect(descendantsOfD.has(nodeC.id)).toBe(true);
    expect(descendantsOfD.has(nodeB.id)).toBe(true);
    expect(descendantsOfD.has(nodeA.id)).toBe(true);
    expect(descendantsOfD.size).toBe(3);
  });

  it('4. Contradiction Detection: detectContradictions finds bidirectional CONTRADICTS and INVALIDATES', () => {
    const hypothesis1 = createNode('hyp-1', ContextObjectType.HYPOTHESIS, 'Bug is in Auth');
    const hypothesis2 = createNode('hyp-2', ContextObjectType.HYPOTHESIS, 'Bug is in Billing');
    const staleResult = createNode('obs-stale', ContextObjectType.OBSERVATION, 'Stale test result');

    graph.addNode(hypothesis1);
    graph.addNode(hypothesis2);
    graph.addNode(staleResult);

    graph.addRelation({
      id: 'rel-contra',
      sourceId: hypothesis1.id,
      targetId: hypothesis2.id,
      relation: ContextRelationType.CONTRADICTS,
      createdAt: new Date(),
    });

    graph.addRelation({
      id: 'rel-inval',
      sourceId: hypothesis1.id,
      targetId: staleResult.id,
      relation: ContextRelationType.INVALIDATES,
      createdAt: new Date(),
    });

    // Checking from hypothesis1 (outbound contradictions/invalidations)
    const conflictsForHyp1 = graph.detectContradictions(hypothesis1.id);
    expect(conflictsForHyp1).toHaveLength(2);
    const ids = conflictsForHyp1.map((n) => n.id);
    expect(ids).toContain(hypothesis2.id);
    expect(ids).toContain(staleResult.id);

    // Checking from hypothesis2 (inbound contradiction)
    const conflictsForHyp2 = graph.detectContradictions(hypothesis2.id);
    expect(conflictsForHyp2).toHaveLength(1);
    expect(conflictsForHyp2[0]?.id).toBe(hypothesis1.id);
  });
});
