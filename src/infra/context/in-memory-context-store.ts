/**
 * In-Memory Context Store with Versioning & Graph Integration.
 *
 * Implements ContextStore:
 * - Immutable versioning (version 1 -> N creation with complete audit trail)
 * - Active projection vs full underlying history (non-destructive deactivation)
 * - Historical reconstruction (reconstructing active projection at past timestamp)
 * - Typed graph relation queries and path finding
 * - Multi-criteria scoring query engine
 */
import type { ContextStore } from '../../core/interfaces/context-store.js';
import type { ContextId, IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type {
  ContextObject,
  ContextRelation,
  ContextQuery,
  CreateContextObjectParams,
  CreateContextRelationParams,
} from '../../core/model/context-object.js';
import { ContextScope, ContextRelationType } from '../../core/model/context-object.js';
import { ContextGraph } from './context-graph.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export interface InMemoryContextStoreOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class InMemoryContextStore implements ContextStore {
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly versionHistory = new Map<ContextId, Map<number, ContextObject>>();
  private readonly graph = new ContextGraph();

  constructor(options: InMemoryContextStoreOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  async addObject(params: CreateContextObjectParams): Promise<ContextObject> {
    const id = params.id ?? this.idFactory.create<'Context'>();
    const now = this.clock.now();

    const object: ContextObject = {
      id,
      tier: params.tier,
      type: params.type,
      content: params.content,
      source: params.source,
      timestamp: now,
      importance: params.importance ?? 0.5,
      confidence: params.confidence ?? 1.0,
      scope: params.scope ?? ContextScope.TASK,
      scopeTarget: params.scopeTarget,
      dependencies: params.dependencies ?? [],
      lastUsed: now,
      lastVerified: params.lastVerified ?? null,
      costTokens: params.costTokens ?? Math.ceil(params.content.length / 4),
      tags: params.tags ?? [],
      version: 1,
      active: true,
      metadata: params.metadata ?? {},
    };

    let historyMap = this.versionHistory.get(id);
    if (!historyMap) {
      historyMap = new Map<number, ContextObject>();
      this.versionHistory.set(id, historyMap);
    }
    historyMap.set(1, object);

    this.graph.addNode(object);

    // Auto-create DEPENDS_ON relations if dependencies are specified
    for (const depId of object.dependencies) {
      if (this.graph.hasNode(depId)) {
        const rel: ContextRelation = {
          id: this.idFactory.create(),
          sourceId: object.id,
          targetId: depId,
          relation: ContextRelationType.DEPENDS_ON,
          weight: 1.0,
          createdAt: now,
          metadata: {},
        };
        this.graph.addRelation(rel);
      }
    }

    return object;
  }

  async updateObject(id: ContextId, updates: Partial<ContextObject>): Promise<ContextObject> {
    const historyMap = this.versionHistory.get(id);
    if (!historyMap || historyMap.size === 0) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `ContextObject not found for update: ${id}`,
      });
    }

    const currentVersion = Math.max(...historyMap.keys());
    const latest = historyMap.get(currentVersion)!;
    const now = this.clock.now();
    const newVersion = currentVersion + 1;

    const updatedObject: ContextObject = {
      ...latest,
      ...updates,
      id: latest.id,
      version: newVersion,
      timestamp: now,
      lastUsed: now,
    };

    historyMap.set(newVersion, updatedObject);
    this.graph.addNode(updatedObject);

    return updatedObject;
  }

  async getObject(id: ContextId, version?: number): Promise<ContextObject | undefined> {
    const historyMap = this.versionHistory.get(id);
    if (!historyMap || historyMap.size === 0) return undefined;

    if (version !== undefined) {
      return historyMap.get(version);
    }

    const latestVersion = Math.max(...historyMap.keys());
    return historyMap.get(latestVersion);
  }

  async getObjectHistory(id: ContextId): Promise<ReadonlyArray<ContextObject>> {
    const historyMap = this.versionHistory.get(id);
    if (!historyMap || historyMap.size === 0) return [];

    const versions = Array.from(historyMap.keys()).sort((a, b) => a - b);
    return versions.map((v) => historyMap.get(v)!);
  }

  async query(query: ContextQuery): Promise<ReadonlyArray<ContextObject>> {
    const onlyActive = query.onlyActive ?? true;
    const candidates: ContextObject[] = [];

    for (const historyMap of this.versionHistory.values()) {
      const latestVersion = Math.max(...historyMap.keys());
      const latest = historyMap.get(latestVersion)!;

      if (onlyActive && !latest.active) continue;
      if (query.tier && latest.tier !== query.tier) continue;
      if (query.types && query.types.length > 0 && !query.types.includes(latest.type)) continue;
      if (query.scopes && query.scopes.length > 0 && !query.scopes.includes(latest.scope)) continue;
      if (query.scopeTarget && latest.scopeTarget !== query.scopeTarget) continue;
      if (query.minImportance !== undefined && latest.importance < query.minImportance) continue;
      if (query.minConfidence !== undefined && latest.confidence < query.minConfidence) continue;
      if (query.verifiedOnly && latest.lastVerified === null) continue;
      if (query.since && latest.timestamp < query.since) continue;

      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some((t) => latest.tags.includes(t));
        if (!hasTag) continue;
      }

      if (query.relatedToId) {
        const rels = this.graph.getRelationsFrom(query.relatedToId, query.relationTypes?.[0]);
        const inRels = this.graph.getRelationsTo(query.relatedToId, query.relationTypes?.[0]);
        const isRelated =
          rels.some((r) => r.targetId === latest.id) ||
          inRels.some((r) => r.sourceId === latest.id);
        if (!isRelated) continue;
      }

      candidates.push(latest);
    }

    // Rank / Sort
    const now = this.clock.now().getTime();
    candidates.sort((a, b) => {
      if (query.sortBy === 'importance') {
        return b.importance - a.importance;
      }
      if (query.sortBy === 'confidence') {
        return b.confidence - a.confidence;
      }
      if (query.sortBy === 'recency') {
        return b.lastUsed.getTime() - a.lastUsed.getTime();
      }

      // Default: Composite Relevance Score
      const scoreA = this.calculateCompositeScore(a, now);
      const scoreB = this.calculateCompositeScore(b, now);
      return scoreB - scoreA;
    });

    if (query.limit && query.limit > 0) {
      return candidates.slice(0, query.limit);
    }

    return candidates;
  }

  async deactivate(id: ContextId): Promise<boolean> {
    const historyMap = this.versionHistory.get(id);
    if (!historyMap || historyMap.size === 0) return false;

    const currentVersion = Math.max(...historyMap.keys());
    const latest = historyMap.get(currentVersion)!;

    if (!latest.active) return false;

    await this.updateObject(id, { active: false });
    return true;
  }

  async reconstructHistoryAt(timestamp: Date): Promise<ReadonlyArray<ContextObject>> {
    const reconstructed: ContextObject[] = [];
    const targetMs = timestamp.getTime();

    for (const historyMap of this.versionHistory.values()) {
      // Find latest version created <= targetMs
      const validVersions = Array.from(historyMap.entries())
        .filter(([_, obj]) => obj.timestamp.getTime() <= targetMs)
        .sort(([a], [b]) => b - a); // Descending version order

      if (validVersions.length > 0) {
        const [_, objAtTime] = validVersions[0]!;
        if (objAtTime.active) {
          reconstructed.push(objAtTime);
        }
      }
    }

    return reconstructed;
  }

  async addRelation(params: CreateContextRelationParams): Promise<ContextRelation> {
    const now = this.clock.now();
    const relation: ContextRelation = {
      id: this.idFactory.create(),
      sourceId: params.sourceId,
      targetId: params.targetId,
      relation: params.relation,
      weight: params.weight ?? 1.0,
      createdAt: now,
      metadata: params.metadata ?? {},
    };

    this.graph.addRelation(relation);
    return relation;
  }

  async getRelations(
    nodeId: ContextId,
    direction: 'inbound' | 'outbound' | 'both' = 'both',
    relationType?: ContextRelationType,
  ): Promise<ReadonlyArray<ContextRelation>> {
    const results: ContextRelation[] = [];
    if (direction === 'outbound' || direction === 'both') {
      results.push(...this.graph.getRelationsFrom(nodeId, relationType));
    }
    if (direction === 'inbound' || direction === 'both') {
      results.push(...this.graph.getRelationsTo(nodeId, relationType));
    }
    return results;
  }

  async getGraph(): Promise<ContextGraph> {
    return this.graph;
  }

  async clear(): Promise<void> {
    this.versionHistory.clear();
    this.graph.clear();
  }

  private calculateCompositeScore(obj: ContextObject, nowMs: number): number {
    const ageHours = Math.max(0, (nowMs - obj.lastUsed.getTime()) / (1000 * 60 * 60));
    const recencyScore = 1 / (1 + ageHours / 24); // Half-life decay of ~24h
    const verifiedBonus = obj.lastVerified !== null ? 0.1 : 0.0;

    return obj.importance * 0.35 + obj.confidence * 0.35 + recencyScore * 0.2 + verifiedBonus;
  }
}
