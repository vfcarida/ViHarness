/**
 * ContextStore interface.
 *
 * "The active context is a projection. The underlying state remains available."
 *
 * Stores and manages structured ContextObjects, version history, typed relations,
 * and graph queries across the four context tiers.
 */
import type { ContextId } from '../types/identifiers.js';
import type {
  ContextObject,
  ContextRelation,
  ContextQuery,
  CreateContextObjectParams,
  CreateContextRelationParams,
} from '../model/context-object.js';
import type { ContextRelationType } from '../model/context-object.js';

export interface ContextGraphPort {
  addNode(node: ContextObject): void;
  getNode(id: ContextId): ContextObject | undefined;
  hasNode(id: ContextId): boolean;
  addRelation(relation: ContextRelation): void;
  removeRelation(relationId: string): boolean;
  getRelationsFrom(
    sourceId: ContextId,
    relationType?: ContextRelationType,
  ): ReadonlyArray<ContextRelation>;
  getRelationsTo(
    targetId: ContextId,
    relationType?: ContextRelationType,
  ): ReadonlyArray<ContextRelation>;
  getAncestors(startId: ContextId, relationType?: ContextRelationType): Set<ContextId>;
  getDescendants(startId: ContextId, relationType?: ContextRelationType): Set<ContextId>;
  detectContradictions(id: ContextId): ReadonlyArray<ContextObject>;
  subsume(primaryId: ContextId, secondaryId: ContextId): boolean;
  clusterByTopic(topicTag: string): ReadonlyArray<ContextObject>;
  getAllNodes(): ReadonlyArray<ContextObject>;
  clear(): void;
}

export interface ContextStore {
  /** Create a new ContextObject (starts at version 1). */
  addObject(params: CreateContextObjectParams): Promise<ContextObject>;

  /** Update an existing ContextObject (creates version N+1, preserving history). */
  updateObject(id: ContextId, updates: Partial<ContextObject>): Promise<ContextObject>;

  /** Get the current active version (or a specific version) of an object. */
  getObject(id: ContextId, version?: number): Promise<ContextObject | undefined>;

  /** Get all version snapshots of an object ordered by version ascending. */
  getObjectHistory(id: ContextId): Promise<ReadonlyArray<ContextObject>>;

  /** Query ContextObjects matching criteria with ranking metadata. */
  query(query: ContextQuery): Promise<ReadonlyArray<ContextObject>>;

  /** Deactivate an object (marks active = false, preserves in underlying state). */
  deactivate(id: ContextId): Promise<boolean>;

  /** Reconstruct all active context objects as they existed at a past timestamp. */
  reconstructHistoryAt(timestamp: Date): Promise<ReadonlyArray<ContextObject>>;

  /** Add a directed typed relation between two ContextObjects. */
  addRelation(params: CreateContextRelationParams): Promise<ContextRelation>;

  /** Get relations connected to a ContextObject. */
  getRelations(
    nodeId: ContextId,
    direction?: 'inbound' | 'outbound' | 'both',
    relationType?: ContextRelationType,
  ): Promise<ReadonlyArray<ContextRelation>>;

  /** Get the underlying ContextGraph. */
  getGraph(): Promise<ContextGraphPort>;

  /** Clear all stored objects and graph state. */
  clear(): Promise<void>;
}

