// Pattern: Context Collapse virtual projection (ref: Claude Code)
/**
 * Context Collapse — Read-Time Virtual Projection.
 *
 * Implements Claude Code & DeepSeek Harness style lazy degradation:
 * - Creates a virtual read-time projection of the context by consolidating older contiguous
 *   episodic events and tool trajectories into milestone summaries.
 * - Stored context/messages are NEVER mutated or deleted.
 * - Full original history is completely retrievable via `reconstructFullHistory`.
 * - Tracks boundary metadata: `headId`, `anchorId`, `tailId` for chain patching.
 * - Fired when context exceeds collapse threshold (default: 70% of max tokens).
 */
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType, ContextScope } from '../../core/model/context-object.js';
import { ContextTier } from '../../core/model/context.js';
import type {
  CollapseRecord,
  CollapseMetadata,
  CollapseStore,
  CompactionTrigger,
} from '../../core/model/compiler-types.js';

import type { ContextId } from '../../core/types/identifiers.js';

export interface ApplyCollapseOptions {
  readonly modelMaxTokens: number;
  readonly currentTokens: number;
  readonly collapseThreshold?: number; // e.g. 0.70
  readonly trigger?: CompactionTrigger;
  readonly now?: Date;
}

export interface CollapseApplicationResult {
  readonly projected: ContextObject[];
  readonly collapsesCreated: ReadonlyArray<CollapseRecord>;
  readonly tokensReduced: number;
}

export class InMemoryCollapseStore implements CollapseStore {
  private readonly collapses = new Map<string, CollapseRecord>();

  saveCollapse(record: CollapseRecord): void {
    this.collapses.set(record.id, record);
  }

  getCollapse(id: string): CollapseRecord | undefined {
    return this.collapses.get(id);
  }

  getAllCollapses(): ReadonlyArray<CollapseRecord> {
    return Array.from(this.collapses.values());
  }

  clear(): void {
    this.collapses.clear();
  }
}

export class ContextCollapser {
  /**
   * Synchronously apply read-time Context Collapse projection if token pressure exceeds the threshold.
   * Original context objects are never modified.
   */
  static applyCollapsesSync(
    objects: ReadonlyArray<ContextObject>,
    collapseStore: CollapseStore,
    options: ApplyCollapseOptions,
  ): CollapseApplicationResult {
    const threshold =
      options.collapseThreshold ?? (options.trigger === 'context-overflow' ? 0.4 : 0.7);
    const tokenLimit = options.modelMaxTokens * threshold;

    if (options.currentTokens <= tokenLimit) {
      return {
        projected: [...objects],
        collapsesCreated: [],
        tokensReduced: 0,
      };
    }

    const now = options.now ?? new Date();
    const collapsesCreated: CollapseRecord[] = [];
    const projected: ContextObject[] = [];
    let tokensReduced = 0;

    let currentBatch: ContextObject[] = [];

    const flushBatch = () => {
      if (currentBatch.length === 0) return;

      if (currentBatch.length === 1) {
        projected.push(currentBatch[0]!);
        currentBatch = [];
        return;
      }

      const headObj = currentBatch[0]!;
      const tailObj = currentBatch[currentBatch.length - 1]!;
      const anchorIdx = Math.floor(currentBatch.length / 2);
      const anchorObj = currentBatch[anchorIdx]!;

      const collapseId = `collapse_${headObj.id.slice(0, 8)}_${tailObj.id.slice(0, 8)}_${Date.now()}`;
      const originalTokens = currentBatch.reduce((acc, o) => acc + o.costTokens, 0);

      const itemSnippets =
        currentBatch.length <= 3
          ? currentBatch
              .map(
                (o, idx) => `[${idx + 1}] ${o.type}: ${o.content.slice(0, 30).replace(/\n/g, ' ')}`,
              )
              .join('; ')
          : `[1] ${currentBatch[0]!.content.slice(0, 30)} ... [${currentBatch.length}] ${currentBatch[currentBatch.length - 1]!.content.slice(0, 30)}`;

      const summaryText =
        `[Context Collapse Milestone: ${headObj.id.slice(0, 8)}..${tailObj.id.slice(0, 8)}] ` +
        `Collapsed ${currentBatch.length} episodic events (${originalTokens} tokens): ${itemSnippets}`;

      const collapsedTokens = Math.ceil(summaryText.length / 4);

      const metadata: CollapseMetadata = {
        headId: headObj.id,
        anchorId: anchorObj.id,
        tailId: tailObj.id,
        collapsedCount: currentBatch.length,
        originalTokens,
        collapsedTokens,
      };

      const record: CollapseRecord = {
        id: collapseId,
        metadata,
        summary: summaryText,
        originalObjects: [...currentBatch],
        createdAt: now,
      };

      collapseStore.saveCollapse(record);
      collapsesCreated.push(record);

      const collapsedObject: ContextObject = {
        id: collapseId as ContextId,
        tier: ContextTier.L2_EPISODIC,
        type: ContextObjectType.SUMMARY,
        content: summaryText,
        source: 'context_collapser',
        timestamp: now,
        importance: 0.65,
        confidence: 1.0,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: null,
        costTokens: collapsedTokens,
        tags: ['collapsed_milestone', 'virtual_projection'],
        version: 1,
        active: true,
        metadata: {
          collapseId,
          headId: metadata.headId,
          anchorId: metadata.anchorId,
          tailId: metadata.tailId,
          isVirtualProjection: true,
          originalCount: metadata.collapsedCount,
          originalTokens: metadata.originalTokens,
        },
      };

      projected.push(collapsedObject);
      tokensReduced += Math.max(0, originalTokens - collapsedTokens);
      currentBatch = [];
    };

    for (const obj of objects) {
      const isMustPreserve =
        obj.tags.includes('must_preserve') ||
        obj.type === ContextObjectType.USER_INSTRUCTION ||
        obj.type === ContextObjectType.DECISION ||
        (obj.type === ContextObjectType.FAILURE && obj.importance >= 0.9);

      const isCollapsible =
        !isMustPreserve &&
        (obj.tier === ContextTier.L2_EPISODIC ||
          obj.type === ContextObjectType.ATTEMPT ||
          obj.type === ContextObjectType.OBSERVATION ||
          obj.tags.includes('episodic') ||
          obj.tags.includes('tool_output') ||
          obj.importance < 0.75);

      if (isCollapsible) {
        currentBatch.push(obj);
      } else {
        flushBatch();
        projected.push(obj);
      }
    }

    flushBatch();

    return {
      projected,
      collapsesCreated,
      tokensReduced,
    };
  }

  /**
   * Apply read-time Context Collapse projection if token pressure exceeds the threshold.
   */
  static async applyCollapsesIfNeeded(
    objects: ReadonlyArray<ContextObject>,
    collapseStore: CollapseStore,
    options: ApplyCollapseOptions,
  ): Promise<CollapseApplicationResult> {
    return this.applyCollapsesSync(objects, collapseStore, options);
  }

  /**
   * Synchronously reconstruct the full uncompressed history from a collapsed projection.
   */
  static reconstructFullHistorySync(
    projectedObjects: ReadonlyArray<ContextObject>,
    collapseStore: CollapseStore,
  ): ContextObject[] {
    const reconstructed: ContextObject[] = [];

    for (const obj of projectedObjects) {
      const collapseId = obj.metadata?.['collapseId'] as string | undefined;
      const isVirtualProjection = obj.metadata?.['isVirtualProjection'] === true;

      if (collapseId && isVirtualProjection) {
        const record = collapseStore.getCollapse(collapseId);
        if (record && 'then' in (record as any)) {
          // If a promise, handle or skip in sync
        } else if (record && (record as CollapseRecord).originalObjects?.length > 0) {
          reconstructed.push(...(record as CollapseRecord).originalObjects);
          continue;
        }
      }

      reconstructed.push(obj);
    }

    return reconstructed;
  }

  /**
   * Reconstruct the full uncompressed history from a collapsed projection.
   * Expands every collapsed milestone back into its exact original items.
   */
  static async reconstructFullHistory(
    projectedObjects: ReadonlyArray<ContextObject>,
    collapseStore: CollapseStore,
  ): Promise<ContextObject[]> {
    const reconstructed: ContextObject[] = [];

    for (const obj of projectedObjects) {
      const collapseId = obj.metadata?.['collapseId'] as string | undefined;
      const isVirtualProjection = obj.metadata?.['isVirtualProjection'] === true;

      if (collapseId && isVirtualProjection) {
        const record = await collapseStore.getCollapse(collapseId);
        if (record && record.originalObjects && record.originalObjects.length > 0) {
          reconstructed.push(...record.originalObjects);
          continue;
        }
      }

      reconstructed.push(obj);
    }

    return reconstructed;
  }
}
