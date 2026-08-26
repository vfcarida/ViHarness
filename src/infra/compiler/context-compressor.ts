// Pattern: 5-stage compaction pipeline (ref: Claude Code)
/**
 * Multi-Tier Progressive Context Compressor (Claude Code & DeepSeek Harness inspired).
 *
 * Implements the 5-Stage Progressive Compaction Pipeline (Lazy Degradation):
 *
 * 0. BUDGET REDUCTION: Capping per-tool-result token counts with boundary truncation markers.
 * 0.5 TOOL-RESULT PRUNING: Deterministic head/middle/tail pruning without LLM calls.
 * 1. SNIP: Pruning ephemeral noise, low-value diagnostic logs, and trivial chatter.
 * 2. MICRO-COMPACT: Compacting repetitive tool execution outputs and command stdout.
 * 3. CONTEXT COLLAPSE: Read-time virtual projection preserving stored history (tracks headId, anchorId, tailId).
 * 4. AUTO-COMPACT: Final model-aware adaptive compaction against strict token limits.
 *
 * INVARIANT RULE: Critical user requirements, architectural decisions, approved constraints,
 * and empirical failure/verification evidence are NEVER trimmed or degraded.
 */
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType } from '../../core/model/context-object.js';
import { ContextTier } from '../../core/model/context.js';
import type { ScoredContextObject } from './context-ranker.js';
import type {
  CompilationItemExplanation,
  MultiTierCompressorOptions,
  CollapseRecord,
} from '../../core/model/compiler-types.js';
import { InMemoryCollapseStore } from './context-collapse.js';
import { DefaultToolResultPruner } from './tool-result-pruner.js';

export type { MultiTierCompressorOptions };

export interface CompressionResult {
  readonly retained: ReadonlyArray<ContextObject>;
  readonly omitted: ReadonlyArray<ContextObject>;
  readonly explanations: ReadonlyArray<CompilationItemExplanation>;
  readonly totalTokens: number;
  readonly pipelineStagesRun: ReadonlyArray<string>;
  readonly collapsesCreated?: ReadonlyArray<CollapseRecord>;
}

export class ContextCompressor {
  /**
   * Execute 5-Stage Progressive Multi-Tier Compaction Pipeline.
   */
  static compress(
    scoredObjects: ReadonlyArray<ScoredContextObject>,
    maxTokens: number,
    nowMs: number,
    options?: MultiTierCompressorOptions,
  ): CompressionResult {
    const sessionId = options?.sessionId;
    const lock = options?.lock;

    // Lock Acquisition & Crash Recovery (DeepSeek Harness)
    let lockAcquired = false;
    if (lock && sessionId) {
      if (lock.isOrphaned(sessionId)) {
        lock.recover(sessionId);
      }
      lockAcquired = lock.acquire(sessionId);
      if (!lockAcquired) {
        throw new Error(
          `Compaction lock could not be acquired for session ${sessionId}: concurrent compaction in progress`,
        );
      }
    }

    try {
      return this.executePipeline(scoredObjects, maxTokens, nowMs, options);
    } catch (err) {
      if (lock && sessionId && lockAcquired) {
        lock.release(sessionId, err instanceof Error ? err : new Error(String(err)));
      }
      throw err;
    } finally {
      if (lock && sessionId && lockAcquired) {
        lock.release(sessionId);
      }
    }
  }

  private static executePipeline(
    scoredObjects: ReadonlyArray<ScoredContextObject>,
    maxTokens: number,
    nowMs: number,
    options?: MultiTierCompressorOptions,
  ): CompressionResult {
    const retained: ContextObject[] = [];
    const omitted: ContextObject[] = [];
    const explanations: CompilationItemExplanation[] = [];
    const pipelineStagesRun: string[] = [
      'BUDGET_REDUCTION',
      'TOOL_PRUNE',
      'SNIP',
      'MICRO_COMPACT',
      'COLLAPSE',
      'AUTO_COMPACT',
    ];

    const modelMax = options?.modelContextTokens ?? 128000;
    const trigger = options?.trigger ?? 'pressure';
    const isOverflow = trigger === 'context-overflow';
    const isSmallWindow = modelMax <= 32000;

    // Compaction Thresholds (Pressure vs Overflow)
    const snipThreshold = isOverflow
      ? (options?.aggressiveThreshold ?? 0.2)
      : isSmallWindow
        ? 0.4
        : 0.75;
    const microCompactThreshold = isOverflow
      ? options?.aggressiveThreshold
        ? options.aggressiveThreshold + 0.1
        : 0.3
      : isSmallWindow
        ? 0.5
        : 0.8;
    const collapseThreshold = isOverflow
      ? (options?.collapseThreshold ?? 0.4)
      : isSmallWindow
        ? 0.6
        : (options?.collapseThreshold ?? 0.85);

    // Tool Result Cap
    const maxToolResultTokens = options?.maxToolResultTokens ?? (isOverflow ? 4000 : 8000);
    const pruner = options?.pruner ?? new DefaultToolResultPruner(maxToolResultTokens * 4);
    const collapseStore = options?.collapseStore ?? new InMemoryCollapseStore();

    // Step 0: Initial Sorting — Invariant MUST-PRESERVE items first, then score descending
    const sorted = [...scoredObjects].sort((a, b) => {
      if (a.mustPreserve !== b.mustPreserve) {
        return a.mustPreserve ? -1 : 1;
      }
      return b.score - a.score;
    });

    let currentTokens = 0;
    const seenToolSignatures = new Map<string, number>();
    const collapsesCreated: CollapseRecord[] = [];

    for (const scored of sorted) {
      let obj = scored.object;

      // ---------------------------------------------------------------------
      // INVARIANT ENFORCEMENT: MUST-PRESERVE items are ALWAYS retained
      // ---------------------------------------------------------------------
      if (scored.mustPreserve) {
        retained.push(obj);
        currentTokens += obj.costTokens;
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'RETAINED',
          score: scored.score,
          tokenCost: obj.costTokens,
          reason: 'Invariant preservation: User instruction, security rule, or core decision',
          mustPreserve: true,
        });
        continue;
      }

      // ---------------------------------------------------------------------
      // CACHE-PRESERVING COMPACTION RULE (Claude Code Prompt Cache Preservation)
      // If an item is known to be in the provider's active cache prefix, prefer NOT
      // to modify or prune it (since modification invalidates the entire KV cache).
      // Instead, compact items that appear AFTER the cached prefix.
      // ---------------------------------------------------------------------
      const isCachedPrefix =
        (options?.cachedPrefixIds
          ? options.cachedPrefixIds instanceof Set
            ? options.cachedPrefixIds.has(obj.id)
            : (options.cachedPrefixIds as ReadonlyArray<string>).includes(obj.id)
          : false) ||
        obj.tags.includes('cached_prefix') ||
        obj.metadata?.['isCachedPrefix'] === true;

      if (isCachedPrefix && !isOverflow && currentTokens + obj.costTokens <= maxTokens) {
        retained.push(obj);
        currentTokens += obj.costTokens;
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'RETAINED',
          score: scored.score,
          tokenCost: obj.costTokens,
          reason:
            'Cache-Aware Compaction: Preserved unmodified in provider prompt cache prefix to avoid KV cache invalidation',
          mustPreserve: false,
        });
        continue;
      }

      // ---------------------------------------------------------------------
      // STAGE 0: BUDGET REDUCTION (Cap per-tool-result token counts)
      // ---------------------------------------------------------------------
      const isToolOutput =
        obj.type === ContextObjectType.OBSERVATION ||
        obj.tags.includes('tool_output') ||
        obj.tags.includes('stdout');

      if (isToolOutput && obj.costTokens > maxToolResultTokens) {
        const originalTokens = obj.costTokens;
        const maxChars = maxToolResultTokens * 4;
        const truncatedContent =
          obj.content.slice(0, maxChars) +
          `\n[... truncated from ${originalTokens} to ${maxToolResultTokens} tokens ...]`;
        obj = {
          ...obj,
          content: truncatedContent,
          costTokens: maxToolResultTokens,
        };
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'TRIMMED',
          score: scored.score,
          tokenCost: maxToolResultTokens,
          reason: `Stage 0 (Budget Reduction): Tool result capped to ${maxToolResultTokens} tokens`,
          mustPreserve: false,
        });
      }

      // ---------------------------------------------------------------------
      // STAGE 0.5: TOOL-RESULT PRUNING (Deterministic head/middle/tail pruning)
      // ---------------------------------------------------------------------
      if (
        isToolOutput &&
        pruner.measureContent([{ type: 'text', text: obj.content }]) > maxToolResultTokens * 2
      ) {
        const {
          text: prunedText,
          pruned,
          charsRemoved,
        } = (pruner as DefaultToolResultPruner).pruneText(obj.content, maxToolResultTokens * 2);
        if (pruned) {
          const newTokens = Math.ceil(prunedText.length / 4);
          obj = {
            ...obj,
            content: prunedText,
            costTokens: newTokens,
          };
          explanations.push({
            id: obj.id,
            type: obj.type,
            action: 'TRIMMED',
            score: scored.score,
            tokenCost: newTokens,
            reason: `Stage 0.5 (Tool-Result Pruning): Deterministic head/middle/tail pruning removed ${charsRemoved} characters`,
            mustPreserve: false,
          });
        }
      }

      // ---------------------------------------------------------------------
      // STAGE 1: SNIP (Prune ephemeral low-value diagnostic noise)
      // ---------------------------------------------------------------------
      const ageHours = (nowMs - obj.lastUsed.getTime()) / (1000 * 60 * 60);
      const isEphemeralNoise =
        obj.type === ContextObjectType.OBSERVATION &&
        obj.importance < 0.45 &&
        (obj.content.includes('[DEBUG]') ||
          obj.content.includes('stdout:') ||
          obj.tags.includes('ephemeral') ||
          ageHours > 12);

      if (
        isEphemeralNoise &&
        (currentTokens + obj.costTokens > maxTokens * snipThreshold ||
          ageHours > 24 ||
          obj.tags.includes('log'))
      ) {
        omitted.push(obj);
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'OMITTED',
          score: scored.score,
          tokenCost: obj.costTokens,
          reason: 'SNIP Stage: Ephemeral diagnostic log pruned to conserve token budget',
          mustPreserve: false,
        });
        continue;
      }

      // ---------------------------------------------------------------------
      // STAGE 2: MICRO-COMPACT (Repeated tool outputs and redundant executions)
      // ---------------------------------------------------------------------
      if (isToolOutput) {
        const signature = this.computeToolOutputSignature(obj.content);
        const occurrences = seenToolSignatures.get(signature) ?? 0;
        seenToolSignatures.set(signature, occurrences + 1);

        if (occurrences > 0 || currentTokens > maxTokens * microCompactThreshold) {
          const summaryText = `[Micro-Compacted Tool Output (${occurrences + 1}x)]: ${obj.content.slice(0, 120)}...`;
          const newTokens = Math.ceil(summaryText.length / 4);
          obj = {
            ...obj,
            content: summaryText,
            costTokens: newTokens,
          };
          explanations.push({
            id: obj.id,
            type: obj.type,
            action: 'SUMMARIZED',
            score: scored.score,
            tokenCost: newTokens,
            reason: `MICRO-COMPACT Stage: Repetitive tool output compressed (occurrence #${occurrences + 1})`,
            mustPreserve: false,
          });
        }
      }

      // ---------------------------------------------------------------------
      // STAGE 3: CONTEXT COLLAPSE (Read-time virtual projection)
      // ---------------------------------------------------------------------
      const isEpisodic =
        obj.tier === ContextTier.L2_EPISODIC ||
        obj.type === ContextObjectType.ATTEMPT ||
        obj.tags.includes('attempt') ||
        obj.tags.includes('episodic');

      const shouldCollapse =
        isEpisodic &&
        obj.importance < 0.75 &&
        (currentTokens > maxTokens * collapseThreshold ||
          (isOverflow && options?.aggressiveOnOverflow));

      if (shouldCollapse) {
        const collapseId = `collapse_${obj.id.slice(0, 8)}_${nowMs}`;
        const collapsedSummary = `[Collapsed Trajectory Milestone: ${obj.id}]: ${obj.type} - ${obj.content.slice(0, 100)}...`;
        const newTokens = Math.ceil(collapsedSummary.length / 4);

        const record: CollapseRecord = {
          id: collapseId,
          metadata: {
            headId: obj.id,
            anchorId: obj.id,
            tailId: obj.id,
            collapsedCount: 1,
            originalTokens: obj.costTokens,
            collapsedTokens: newTokens,
          },
          summary: collapsedSummary,
          originalObjects: [obj],
          createdAt: new Date(nowMs),
        };
        collapseStore.saveCollapse(record);
        collapsesCreated.push(record);

        obj = {
          ...obj,
          content: collapsedSummary,
          costTokens: newTokens,
          metadata: {
            ...obj.metadata,
            collapseId,
            headId: obj.id,
            anchorId: obj.id,
            tailId: obj.id,
            isVirtualProjection: true,
          },
        };
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'COLLAPSED',
          score: scored.score,
          tokenCost: newTokens,
          reason: 'COLLAPSE Stage: Older episodic trajectory merged into condensed milestone',
          mustPreserve: false,
        });
      }

      // ---------------------------------------------------------------------
      // STAGE 4: AUTO-COMPACT (Budget boundary check & final assembly)
      // ---------------------------------------------------------------------
      if (currentTokens + obj.costTokens <= maxTokens) {
        retained.push(obj);
        currentTokens += obj.costTokens;
        if (!explanations.some((e) => e.id === obj.id)) {
          explanations.push({
            id: obj.id,
            type: obj.type,
            action: 'RETAINED',
            score: scored.score,
            tokenCost: obj.costTokens,
            reason: `AUTO-COMPACT: Retained with retention score ${scored.score.toFixed(3)} within budget`,
            mustPreserve: false,
          });
        }
      } else {
        // Exceeds budget -> safely omit
        omitted.push(obj);
        explanations.push({
          id: obj.id,
          type: obj.type,
          action: 'OMITTED',
          score: scored.score,
          tokenCost: obj.costTokens,
          reason: `AUTO-COMPACT: Omitted to respect token budget (${currentTokens + obj.costTokens} > ${maxTokens})`,
          mustPreserve: false,
        });
      }
    }

    return {
      retained,
      omitted,
      explanations,
      totalTokens: currentTokens,
      pipelineStagesRun,
      collapsesCreated,
    };
  }

  private static computeToolOutputSignature(content: string): string {
    // Generate normalized signature ignoring timestamps and variable IDs
    const normalized = content
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.slice(0, 80);
  }
}
