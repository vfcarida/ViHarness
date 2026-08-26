// Pattern: Cache-aware compaction & prefix tracking (ref: Claude Code)
/**
 * Cache Prefix Tracker (Claude Code & Anthropic/OpenAI prompt cache integration).
 *
 * Tracks actual provider cache metrics (`cache_read_input_tokens`, `cache_creation_input_tokens`)
 * across model calls to accurately identify which prompt prefix messages are cached.
 *
 * Provides cache prefix awareness to the compiler and compressor to prevent
 * accidental prompt cache invalidation (which would trigger expensive re-creation).
 */
import type { ModelRequest, ModelResponse, CacheMetrics } from '../../core/model/model-io.js';

export interface CacheEfficiencyReport {
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheDeletedTokens: number;
  readonly totalPromptTokens: number;
  readonly cacheHitRatio: number;
}

export class CachePrefixTracker {
  private readonly cachedPrefixIds = new Set<string>();
  private lastCacheMetrics?: CacheMetrics;
  private lastCachedTokenCount: number = 0;

  /**
   * Record a model request-response pair to determine which prefix messages were cached.
   */
  recordResponse(request: ModelRequest, response: ModelResponse): void {
    const metrics = response.cacheMetrics;
    this.lastCacheMetrics = metrics;

    const cacheReadTokens = metrics?.cacheReadInputTokens ?? response.usage.cacheReadTokens ?? 0;

    this.lastCachedTokenCount = cacheReadTokens;
    this.cachedPrefixIds.clear();

    if (cacheReadTokens <= 0) {
      return;
    }

    // Iterate through request messages in prefix order to find which items fall within the cached token budget
    let cumulativeTokens = 0;
    if (request.systemPrompt) {
      cumulativeTokens += Math.ceil(request.systemPrompt.length / 4);
    }

    for (let i = 0; i < request.messages.length; i++) {
      const msg = request.messages[i]!;
      const msgId = (msg.metadata?.['originalId'] ?? msg.metadata?.['id'] ?? `msg_${i}`) as string;
      const msgTokens = Math.ceil(msg.content.length / 4);

      if (cumulativeTokens + msgTokens <= cacheReadTokens) {
        // Within the cache window
        this.cachedPrefixIds.add(msgId);
        cumulativeTokens += msgTokens;
      } else {
        // Reached end of cached prefix
        break;
      }
    }
  }

  /**
   * Directly register verified cached prefix IDs (e.g. from static segments).
   */
  registerCachedPrefixIds(ids: ReadonlyArray<string> | ReadonlySet<string>): void {
    for (const id of ids) {
      this.cachedPrefixIds.add(id);
    }
  }

  /**
   * Check if a context object / message is in the confirmed cached prefix.
   */
  isPrefixCached(id: string): boolean {
    return this.cachedPrefixIds.has(id);
  }

  /**
   * Get all confirmed cached prefix IDs.
   */
  getCachedPrefixIds(): ReadonlySet<string> {
    return this.cachedPrefixIds;
  }

  /**
   * Get the last confirmed cache metrics from the provider.
   */
  getLastCacheMetrics(): CacheMetrics | undefined {
    return this.lastCacheMetrics;
  }

  /**
   * Get the last recorded cached token count.
   */
  getLastCachedTokenCount(): number {
    return this.lastCachedTokenCount;
  }

  /**
   * Calculate cache efficiency telemetry.
   */
  getEfficiencyReport(response: ModelResponse): CacheEfficiencyReport {
    const readTokens =
      response.cacheMetrics?.cacheReadInputTokens ?? response.usage.cacheReadTokens ?? 0;
    const createTokens =
      response.cacheMetrics?.cacheCreationInputTokens ?? response.usage.cacheWriteTokens ?? 0;
    const deleteTokens = response.cacheMetrics?.cacheDeletedInputTokens ?? 0;
    const inputTokens = response.usage.inputTokens || readTokens + createTokens;

    const hitRatio = inputTokens > 0 ? readTokens / inputTokens : 0;

    return {
      cacheReadTokens: readTokens,
      cacheCreationTokens: createTokens,
      cacheDeletedTokens: deleteTokens,
      totalPromptTokens: inputTokens,
      cacheHitRatio: hitRatio,
    };
  }

  /**
   * Clear tracked cache state.
   */
  clear(): void {
    this.cachedPrefixIds.clear();
    this.lastCacheMetrics = undefined;
    this.lastCachedTokenCount = 0;
  }
}
