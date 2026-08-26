/**
 * Memory Retriever.
 *
 * Selectively retrieves relevant memories matching a query.
 * "Memory is retrieved, not injected wholesale."
 *
 * Ensures only high-signal records crossing the relevance threshold are retrieved.
 */
import type {
  MemoryRecord,
  ScoredMemoryRecord,
  MemoryQuery,
} from '../../core/model/memory-types.js';
import { MemoryStatus } from '../../core/model/memory-types.js';
import { MemoryScorer } from './memory-scorer.js';
import { MemoryLifecycle } from './memory-lifecycle.js';

export class MemoryRetriever {
  /**
   * Filter and score candidate memory records according to MemoryQuery.
   */
  static retrieve(
    candidates: ReadonlyArray<MemoryRecord>,
    query: MemoryQuery,
    now: Date,
  ): ReadonlyArray<ScoredMemoryRecord> {
    const activeOnly = query.activeOnly ?? true;
    const nowMs = now.getTime();
    const scoredList: ScoredMemoryRecord[] = [];

    for (const record of candidates) {
      // 1. Check TTL Expiration
      if (MemoryLifecycle.isExpired(record, now)) {
        continue;
      }

      // 2. Active status filter
      if (query.statuses && query.statuses.length > 0) {
        if (!query.statuses.includes(record.status)) continue;
      } else if (activeOnly) {
        if (record.status !== MemoryStatus.ACTIVE && record.status !== MemoryStatus.PROMOTED) {
          continue;
        }
      }

      if (query.topic && record.topic && record.topic !== query.topic) {
        continue;
      }

      // 3. Tiers filter
      if (query.tiers && query.tiers.length > 0 && !query.tiers.includes(record.tier)) {
        continue;
      }

      // 4. Types filter
      if (query.types && query.types.length > 0 && !query.types.includes(record.type)) {
        continue;
      }

      // 5. Scopes filter
      if (query.scopes && query.scopes.length > 0 && !query.scopes.includes(record.scope)) {
        continue;
      }

      if (query.scopeTarget && record.scopeTarget !== query.scopeTarget) {
        continue;
      }

      // 6. Importance & Confidence threshold
      if (query.minImportance !== undefined && record.importance < query.minImportance) {
        continue;
      }

      if (query.minConfidence !== undefined && record.confidence < query.minConfidence) {
        continue;
      }

      // 7. Tags filter
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some((t) => record.tags.includes(t));
        if (!hasTag) continue;
      }

      // 8. Calculate Composite Score
      const scored = MemoryScorer.score(record, query, nowMs);

      // If minRelevance threshold is specified, enforce it
      if (
        (query as any).minRelevance !== undefined &&
        scored.relevanceScore < (query as any).minRelevance
      ) {
        continue;
      }

      scoredList.push(scored);
    }

    // Sort by relevance score descending
    scoredList.sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (query.limit && query.limit > 0) {
      return scoredList.slice(0, query.limit);
    }

    return scoredList;
  }
}
