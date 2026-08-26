/**
 * In-Memory Context Graph.
 *
 * Provides typed directed graph traversal, relation indexing, ancestor/descendant
 * path finding, and contradiction detection without needing an external graph DB.
 */
import type { ContextId } from '../../core/types/identifiers.js';
import type { ContextObject, ContextRelation } from '../../core/model/context-object.js';
import { ContextRelationType } from '../../core/model/context-object.js';

export class ContextGraph {
  private readonly nodes = new Map<ContextId, ContextObject>();
  private readonly relations = new Map<string, ContextRelation>();
  private readonly outbound = new Map<ContextId, Map<string, ContextRelation>>();
  private readonly inbound = new Map<ContextId, Map<string, ContextRelation>>();

  addNode(node: ContextObject): void {
    this.nodes.set(node.id, node);
    if (!this.outbound.has(node.id)) this.outbound.set(node.id, new Map());
    if (!this.inbound.has(node.id)) this.inbound.set(node.id, new Map());
  }

  getNode(id: ContextId): ContextObject | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: ContextId): boolean {
    return this.nodes.has(id);
  }

  addRelation(relation: ContextRelation): void {
    this.relations.set(relation.id, relation);

    let outMap = this.outbound.get(relation.sourceId);
    if (!outMap) {
      outMap = new Map();
      this.outbound.set(relation.sourceId, outMap);
    }
    outMap.set(relation.id, relation);

    let inMap = this.inbound.get(relation.targetId);
    if (!inMap) {
      inMap = new Map();
      this.inbound.set(relation.targetId, inMap);
    }
    inMap.set(relation.id, relation);
  }

  removeRelation(relationId: string): boolean {
    const rel = this.relations.get(relationId);
    if (!rel) return false;

    this.relations.delete(relationId);
    this.outbound.get(rel.sourceId)?.delete(relationId);
    this.inbound.get(rel.targetId)?.delete(relationId);
    return true;
  }

  getRelationsFrom(
    sourceId: ContextId,
    relationType?: ContextRelationType,
  ): ReadonlyArray<ContextRelation> {
    const outMap = this.outbound.get(sourceId);
    if (!outMap) return [];
    const list = Array.from(outMap.values());
    if (!relationType) return list;
    return list.filter((r) => r.relation === relationType);
  }

  getRelationsTo(
    targetId: ContextId,
    relationType?: ContextRelationType,
  ): ReadonlyArray<ContextRelation> {
    const inMap = this.inbound.get(targetId);
    if (!inMap) return [];
    const list = Array.from(inMap.values());
    if (!relationType) return list;
    return list.filter((r) => r.relation === relationType);
  }

  /**
   * Find ancestor nodes up the directed graph (e.g. DEPENDS_ON or DERIVED_FROM).
   */
  getAncestors(startId: ContextId, relationType?: ContextRelationType): Set<ContextId> {
    const ancestors = new Set<ContextId>();
    const queue: ContextId[] = [startId];
    const visited = new Set<ContextId>([startId]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const outboundRels = this.getRelationsFrom(curr, relationType);
      for (const rel of outboundRels) {
        if (!visited.has(rel.targetId)) {
          visited.add(rel.targetId);
          ancestors.add(rel.targetId);
          queue.push(rel.targetId);
        }
      }
    }

    return ancestors;
  }

  /**
   * Find descendant nodes down the directed graph.
   */
  getDescendants(startId: ContextId, relationType?: ContextRelationType): Set<ContextId> {
    const descendants = new Set<ContextId>();
    const queue: ContextId[] = [startId];
    const visited = new Set<ContextId>([startId]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const inboundRels = this.getRelationsTo(curr, relationType);
      for (const rel of inboundRels) {
        if (!visited.has(rel.sourceId)) {
          visited.add(rel.sourceId);
          descendants.add(rel.sourceId);
          queue.push(rel.sourceId);
        }
      }
    }

    return descendants;
  }

  /**
   * Detect conflicting or invalidating nodes linked to `id`.
   */
  detectContradictions(id: ContextId): ReadonlyArray<ContextObject> {
    const conflictingIds = new Set<ContextId>();

    const outRels = this.getRelationsFrom(id);
    for (const r of outRels) {
      if (
        r.relation === ContextRelationType.CONTRADICTS ||
        r.relation === ContextRelationType.INVALIDATES
      ) {
        conflictingIds.add(r.targetId);
      }
    }

    const inRels = this.getRelationsTo(id);
    for (const r of inRels) {
      if (
        r.relation === ContextRelationType.CONTRADICTS ||
        r.relation === ContextRelationType.INVALIDATES
      ) {
        conflictingIds.add(r.sourceId);
      }
    }

    const result: ContextObject[] = [];
    for (const cId of conflictingIds) {
      const node = this.nodes.get(cId);
      if (node) result.push(node);
    }

    return result;
  }

  /**
   * Semantically subsume a redundant secondary context object into a primary object.
   * Redirects inbound and outbound relations to the primary node and removes the redundant node.
   */
  subsume(primaryId: ContextId, secondaryId: ContextId): boolean {
    if (!this.hasNode(primaryId) || !this.hasNode(secondaryId) || primaryId === secondaryId) {
      return false;
    }

    // Re-link outbound relations
    const outRels = this.getRelationsFrom(secondaryId);
    for (const r of outRels) {
      this.removeRelation(r.id);
      this.addRelation({
        ...r,
        sourceId: primaryId,
      });
    }

    // Re-link inbound relations
    const inRels = this.getRelationsTo(secondaryId);
    for (const r of inRels) {
      this.removeRelation(r.id);
      this.addRelation({
        ...r,
        targetId: primaryId,
      });
    }

    // Remove secondary node
    this.nodes.delete(secondaryId);
    this.outbound.delete(secondaryId);
    this.inbound.delete(secondaryId);
    return true;
  }

  /**
   * Group context nodes sharing a specific tag or metadata topic.
   */
  clusterByTopic(topicTag: string): ReadonlyArray<ContextObject> {
    const cleanTag = topicTag.toLowerCase().trim();
    const cluster: ContextObject[] = [];

    for (const node of this.nodes.values()) {
      const hasTag = node.tags.some((t) => t.toLowerCase() === cleanTag);
      const metaTopic = String(node.metadata?.['topic'] ?? '').toLowerCase();
      if (hasTag || metaTopic === cleanTag) {
        cluster.push(node);
      }
    }

    return cluster;
  }

  getAllNodes(): ReadonlyArray<ContextObject> {
    return Array.from(this.nodes.values());
  }

  clear(): void {
    this.nodes.clear();
    this.relations.clear();
    this.outbound.clear();
    this.inbound.clear();
  }
}
