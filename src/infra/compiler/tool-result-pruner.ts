/**
 * Deterministic Tool-Result Pruner (DeepSeek Harness & Claude Code inspired).
 *
 * Implements Stage 0.5 Pre-Compaction:
 * - Measures text content strictly in Unicode code points.
 * - Prunes the "fat middle" of oversized tool results while preserving head and tail structure.
 * - Entirely deterministic: requires NO LLM calls.
 */
import type {
  ContentBlock,
  PrunedEntry,
  PruneResult,
  ToolResultPruner,
} from '../../core/model/compiler-types.js';

export interface PruneOptions {
  readonly maxCodePoints?: number;
  readonly headRatio?: number; // e.g. 0.20 (20%)
  readonly tailRatio?: number; // e.g. 0.20 (20%)
}

export class DefaultToolResultPruner implements ToolResultPruner {
  private readonly defaultMaxCodePoints: number;

  constructor(defaultMaxCodePoints: number = 4000) {
    this.defaultMaxCodePoints = defaultMaxCodePoints;
  }

  /**
   * Measure text content in Unicode code points.
   * Handles surrogate pairs, multi-byte code points, and emojis properly.
   */
  measureContent(blocks: ReadonlyArray<ContentBlock>): number {
    let totalCodePoints = 0;
    for (const block of blocks) {
      if (typeof block.text === 'string') {
        totalCodePoints += Array.from(block.text).length;
      }
    }
    return totalCodePoints;
  }

  /**
   * Measure raw string in Unicode code points.
   */
  measureString(text: string): number {
    return Array.from(text).length;
  }

  /**
   * Prune raw text deterministically keeping head and tail while trimming the middle.
   */
  pruneText(
    text: string,
    maxCodePoints?: number,
    options?: { headRatio?: number; tailRatio?: number },
  ): { text: string; pruned: boolean; charsRemoved: number } {
    const budget = maxCodePoints ?? this.defaultMaxCodePoints;
    const codePoints = Array.from(text);
    const totalCount = codePoints.length;

    if (totalCount <= budget) {
      return { text, pruned: false, charsRemoved: 0 };
    }

    const headRatio = options?.headRatio ?? 0.25;
    const tailRatio = options?.tailRatio ?? 0.25;

    const headCount = Math.max(1, Math.floor(budget * headRatio));
    const tailCount = Math.max(1, Math.floor(budget * tailRatio));

    const headSlice = codePoints.slice(0, headCount).join('');
    const tailSlice = codePoints.slice(totalCount - tailCount).join('');
    const removedCount = totalCount - (headCount + tailCount);

    const marker = `\n[... pruned ${removedCount} characters ...]\n`;
    const prunedText = `${headSlice}${marker}${tailSlice}`;

    return {
      text: prunedText,
      pruned: true,
      charsRemoved: removedCount,
    };
  }

  /**
   * Replace over-budget text middle while retaining structure.
   * Returns null if within budget, or pruned blocks if over budget.
   */
  pruneContent(blocks: ReadonlyArray<ContentBlock>, maxCodePoints?: number): ContentBlock[] | null {
    const budget = maxCodePoints ?? this.defaultMaxCodePoints;
    const totalCodePoints = this.measureContent(blocks);

    if (totalCodePoints <= budget) {
      return null;
    }

    const result: ContentBlock[] = [];
    // Budget per block proportionally or prune large text blocks
    for (const block of blocks) {
      if (typeof block.text === 'string') {
        const blockPoints = Array.from(block.text).length;
        if (blockPoints > budget / 2) {
          const { text: prunedText } = this.pruneText(block.text, Math.floor(budget * 0.8));
          result.push({
            ...block,
            text: prunedText,
          });
          continue;
        }
      }
      result.push({ ...block });
    }

    return result;
  }

  /**
   * Prune all over-budget tool results in a session / context item list in one pass.
   */
  pruneSession(items: ReadonlyArray<any>): PruneResult {
    const pruned: PrunedEntry[] = [];
    let totalCharsRemoved = 0;

    for (const item of items) {
      const id = String(item.id ?? item.toolCallId ?? 'unknown');
      let rawContent: string | undefined;

      if (typeof item.content === 'string') {
        rawContent = item.content;
      } else if (item.toolResult && typeof item.toolResult.output === 'string') {
        rawContent = item.toolResult.output;
      }

      if (rawContent) {
        const originalSize = Array.from(rawContent).length;
        if (originalSize > this.defaultMaxCodePoints) {
          const { text: prunedContent, charsRemoved } = this.pruneText(
            rawContent,
            this.defaultMaxCodePoints,
          );
          if (charsRemoved > 0) {
            const prunedSize = Array.from(prunedContent).length;
            pruned.push({
              id,
              originalSize,
              prunedSize,
              charsRemoved,
            });
            totalCharsRemoved += charsRemoved;

            if (typeof item.content === 'string') {
              item.content = prunedContent;
              if (item.costTokens) {
                item.costTokens = Math.ceil(prunedContent.length / 4);
              }
            } else if (item.toolResult) {
              item.toolResult.output = prunedContent;
            }
          }
        }
      }
    }

    return {
      pruned,
      charsRemoved: totalCharsRemoved,
    };
  }
}
