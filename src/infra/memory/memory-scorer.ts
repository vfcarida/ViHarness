/**
 * Memory Scorer.
 *
 * Computes composite relevance score for selective retrieval:
 * Relevance = w_sim * textSimilarity + w_imp * importance + w_conf * confidence + w_rec * recency + w_succ * successRate - stalePenalty
 */
import type {
  MemoryRecord,
  ScoredMemoryRecord,
  MemoryQuery,
} from '../../core/model/memory-types.js';
import { MemoryStatus } from '../../core/model/memory-types.js';

export interface ScorerWeights {
  readonly textSimilarityWeight: number;
  readonly importanceWeight: number;
  readonly confidenceWeight: number;
  readonly recencyWeight: number;
  readonly successRateWeight: number;
}

export const DEFAULT_MEMORY_SCORER_WEIGHTS: Readonly<ScorerWeights> = {
  textSimilarityWeight: 0.35,
  importanceWeight: 0.25,
  confidenceWeight: 0.15,
  recencyWeight: 0.15,
  successRateWeight: 0.1,
};

export class MemoryScorer {
  /**
   * Score a MemoryRecord against a MemoryQuery at a given point in time.
   */
  static score(
    record: MemoryRecord,
    query: MemoryQuery,
    nowMs: number,
    weights: ScorerWeights = DEFAULT_MEMORY_SCORER_WEIGHTS,
  ): ScoredMemoryRecord {
    // 1. Text Similarity (keyword / token overlap)
    let textSimilarity = 0.5; // Neutral if no text query provided
    if (query.queryText && query.queryText.trim().length > 0) {
      textSimilarity = this.calculateKeywordSimilarity(record.content, query.queryText);
    }

    // 2. Recency Score (half-life decay over 48h)
    const ageHours = Math.max(0, (nowMs - record.lastUsed.getTime()) / (1000 * 60 * 60));
    const recencyScore = 1 / (1 + ageHours / 48);

    // 3. Success Rate Score
    const successRate = record.accessCount > 0 ? record.successCount / record.accessCount : 0.5;

    // 4. Staleness / Invalidation Penalty
    let stalePenalty = 0.0;
    if (record.status === MemoryStatus.STALE) {
      stalePenalty = 0.5;
    } else if (
      record.status === MemoryStatus.INVALIDATED ||
      record.status === MemoryStatus.EXPIRED
    ) {
      stalePenalty = 1.0;
    }

    // Composite Relevance Formula
    const relevanceScore = Math.max(
      0.0,
      weights.textSimilarityWeight * textSimilarity +
        weights.importanceWeight * record.importance +
        weights.confidenceWeight * record.confidence +
        weights.recencyWeight * recencyScore +
        weights.successRateWeight * successRate -
        stalePenalty,
    );

    return {
      record,
      relevanceScore,
      scoreBreakdown: {
        textSimilarity,
        importance: record.importance,
        confidence: record.confidence,
        recencyScore,
        successRate,
        stalePenalty,
      },
    };
  }

  private static calculateKeywordSimilarity(content: string, query: string): number {
    const contentTokens = new Set(
      content
        .toLowerCase()
        .split(/[\W_]+/)
        .filter((t) => t.length > 2),
    );
    const queryTokens = query
      .toLowerCase()
      .split(/[\W_]+/)
      .filter((t) => t.length > 2);

    if (queryTokens.length === 0) return 0.5;

    let matches = 0;
    for (const qToken of queryTokens) {
      if (contentTokens.has(qToken)) {
        matches++;
      }
    }

    return matches / queryTokens.length;
  }
}
