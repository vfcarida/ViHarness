// Pattern: 5-stage progressive context compilation (ref: Claude Code)
/**
 * Default Model-Aware Context Compiler.
 *
 * Implements ContextCompiler interface.
 *
 * "Context is compiled, not accumulated."
 *
 * Assembles minimal high-signal context for model calls by executing the 6-stage pipeline:
 * Retrieval -> Deduplication -> Ranking -> Progressive Compression -> Validation -> Assembly
 *
 * Features:
 * - Model-Aware: Adjusts token budgets dynamically based on targetModelDescriptor.
 * - Invariant Enforcement: Never automatically discards user instructions, security rules,
 *   architecture facts, approved constraints, regressions, or human decisions.
 * - Dry-Run Mode: Generates detailed explanation report (retained, omitted, rationale, risk).
 * - Enterprise Observability: Emits CompilationMetrics (compression ratio, tokens before/after).
 * - Read-Only: Does NOT modify underlying ContextStore state.
 */
import type { ContextCompiler } from '../../core/interfaces/context-compiler.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type {
  ContextCompilationRequest,
  ContextCompilationResult,
  CompilationMetrics,
  CompilationExplanation,
} from '../../core/model/compiler-types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../core/model/compiler-types.js';
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType, ContextScope } from '../../core/model/context-object.js';
import { ContextTier } from '../../core/model/context.js';
import type { CompiledContext, ContextEntry } from '../../core/model/context.js';

import { ContextDeduplicator } from './context-deduplicator.js';
import { ContextRanker } from './context-ranker.js';
import { ContextCompressor } from './context-compressor.js';
import { ContextValidator } from './context-validator.js';
import { ContextSanitizer } from '../security/context-sanitizer.js';
import { SecretScrubber } from '../security/secret-scrubber.js';
import type { MemoryStore } from '../../core/interfaces/memory-store.js';
import { MemoryStatus } from '../../core/model/memory-types.js';
import { SourceCodeIndexer } from '../syntax/source-code-indexer.js';

export interface DefaultContextCompilerOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly memoryStore?: MemoryStore;
}

export class DefaultContextCompiler implements ContextCompiler {
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly memoryStore?: MemoryStore;

  constructor(options: DefaultContextCompilerOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.memoryStore = options.memoryStore;
  }

  async compile(request: ContextCompilationRequest): Promise<ContextCompilationResult> {
    const startTime = Date.now();
    const now = this.clock.now();

    // 1. Candidate Assembly (Read-Only with RAG Memory Retrieval)
    const candidates = await this.assembleCandidateObjects(request, now);

    // Calculate tokens before compilation
    const tokensBefore = candidates.reduce((acc, obj) => acc + obj.costTokens, 0);

    // 2. Stage 1: Deduplication
    const dedupeResult = ContextDeduplicator.deduplicate(candidates);
    const uniqueCandidates = dedupeResult.uniqueObjects;

    // 3. Stage 2: Ranking & Retention Scoring
    const scoringWeights = {
      ...DEFAULT_SCORING_WEIGHTS,
      ...request.weights,
    };
    const scoredObjects = uniqueCandidates.map((obj) =>
      ContextRanker.scoreObject(obj, now.getTime(), scoringWeights),
    );

    // 4. Stage 3: Model-Aware Budget Adjustment
    const modelMaxContext = request.targetModelDescriptor.capabilities.maxContextTokens;
    const effectiveMaxTokens = Math.min(request.budget.maxTokens, modelMaxContext);

    // 5. Stage 4: Progressive Compression (Multi-Tier Pipeline)
    const compressionResult = ContextCompressor.compress(
      scoredObjects,
      effectiveMaxTokens,
      now.getTime(),
      {
        modelContextTokens: modelMaxContext,
        collapseStore: request.collapseStore,
        cachedPrefixIds: request.cachedPrefixIds,
        cacheMetrics: request.lastCacheMetrics,
        deferBoundaryMarkers: request.deferBoundaryMarkers,
        ...request.compactionOptions,
      },
    );

    const retainedObjects = compressionResult.retained;

    // 6. Stage 5: Validation
    ContextValidator.validateOrThrow(
      retainedObjects,
      candidates,
      request.targetModelDescriptor,
      request.budget,
      compressionResult.totalTokens,
    );

    // 7. Stage 6: Context Assembly
    const compiledEntries: ContextEntry[] = retainedObjects.map((obj) => {
      const sanitizedContent = SecretScrubber.scrub(ContextSanitizer.sanitize(obj.content));
      return {
        id: this.idFactory.create<'Context'>(),
        tier: obj.tier,
        content: `[${obj.type}] ${sanitizedContent}`,
        metadata: {
          originalId: obj.id,
          source: obj.source,
          version: obj.version,
          importance: obj.importance,
          confidence: obj.confidence,
          tags: obj.tags,
        },
        createdAt: obj.timestamp,
        tokenEstimate: obj.costTokens,
      };
    });

    const compiledContext: CompiledContext = {
      entries: compiledEntries,
      totalTokenEstimate: compressionResult.totalTokens,
      compiledAt: now,
    };

    // 8. Calculate Metrics
    const durationMs = Date.now() - startTime;
    const tokensAfter = compressionResult.totalTokens;
    const compressionRatio = tokensBefore > 0 ? (tokensBefore - tokensAfter) / tokensBefore : 0;

    const mandatoryRetainedCount = retainedObjects.filter((o) =>
      ContextRanker.isMustPreserve(o),
    ).length;

    const metrics: CompilationMetrics = {
      inputObjectCount: candidates.length,
      tokensBefore,
      tokensAfter,
      compressionRatio,
      retainedCount: retainedObjects.length,
      omittedCount: compressionResult.omitted.length + dedupeResult.deduplicatedCount,
      mandatoryRetainedCount,
      durationMs,
    };

    // 9. Generate Detailed Explanation Report
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (compressionRatio > 0.7) riskLevel = 'MEDIUM';
    if (compressionRatio > 0.9) riskLevel = 'HIGH';

    const explanation: CompilationExplanation = {
      items: compressionResult.explanations,
      riskLevel,
      summary:
        `Compiled ${retainedObjects.length} objects (${tokensAfter} tokens) from ${candidates.length} candidates (${tokensBefore} tokens). ` +
        `Compression ratio: ${(compressionRatio * 100).toFixed(1)}%. Risk: ${riskLevel}.`,
    };

    return {
      compiledContext,
      retainedObjects,
      explanation,
      metrics,
    };
  }

  private async assembleCandidateObjects(
    request: ContextCompilationRequest,
    now: Date,
  ): Promise<ContextObject[]> {
    const candidates: ContextObject[] = [];

    // Frozen Memory Snapshot vs Long-Term Memory Retrieval
    if (request.frozenMemoryObjects && request.frozenMemoryObjects.length > 0) {
      // Use frozen memory snapshot (preserves prefix cache across iterations)
      candidates.push(...request.frozenMemoryObjects);
    } else if (this.memoryStore) {
      try {
        const queryText = `${request.task.description} ${request.goal.description}`;
        const scoredMemories = await this.memoryStore.retrieve({
          queryText,
          activeOnly: true,
          limit: 5,
        });

        for (const scored of scoredMemories) {
          const mem = scored.record;
          if (
            (mem.status === MemoryStatus.ACTIVE || mem.status === MemoryStatus.PROMOTED) &&
            ((scored.scoreBreakdown?.textSimilarity ?? 0) > 0 || scored.relevanceScore >= 0.5)
          ) {
            candidates.push({
              id: this.idFactory.create<'Context'>(),
              tier: ContextTier.L3_REPOSITORY,
              type: ContextObjectType.REQUIREMENT,
              content: `[Long-Term Memory: ${mem.type}] ${mem.content}`,
              source: `memory_store:${mem.source}`,
              timestamp: mem.createdAt,
              importance: Math.max(0.7, mem.importance),
              confidence: mem.confidence,
              scope: ContextScope.GLOBAL,
              dependencies: [],
              lastUsed: now,
              lastVerified: mem.lastVerified,
              costTokens: Math.ceil(mem.content.length / 4),
              tags: ['memory_rag', 'durable_fact', ...mem.tags],
              version: 1,
              active: true,
              metadata: { memoryId: mem.id, memoryType: mem.type, topic: mem.topic },
            });
          }
        }
      } catch {
        // Ignore memory retrieval error
      }
    }

    // Explicit objects passed in request
    if (request.relevantObjects) {
      for (const obj of request.relevantObjects) {
        // If Symbol Map is active and object is a large raw file that is not the primary focus file,
        // compress it to its syntactic outline to save tokens
        if (request.useSymbolMap && request.repoSymbolMap && obj.type === ContextObjectType.FILE) {
          const filePath = String(obj.metadata['filePath'] ?? obj.id);
          const fileMap = request.repoSymbolMap.files.get(filePath);
          if (fileMap && (!request.currentFiles || !request.currentFiles.includes(filePath))) {
            const outlineContent = fileMap.outline;
            candidates.push({
              ...obj,
              content: outlineContent,
              costTokens: Math.ceil(outlineContent.length / 4),
              tags: [...obj.tags, 'symbol_outline'],
            });
            continue;
          }
        }
        candidates.push(obj);
      }
    }

    // Repository Symbol Map (Aider-style AST structural map with Dynamic Token Budget)
    if (request.repoSymbolMap) {
      // Dynamic token budget allocation:
      // - 40% when no files are actively in context (broad repository discovery)
      // - 10% when active files exist in context (compact outline, space freed for file content)
      const hasActiveFiles = Boolean(request.currentFiles && request.currentFiles.length > 0);
      const budgetRatio = hasActiveFiles ? 0.1 : 0.4;
      const maxBudgetCap = hasActiveFiles ? 1000 : 4000;
      const dynamicMaxTokens = Math.min(
        maxBudgetCap,
        Math.max(100, Math.floor(request.budget.maxTokens * budgetRatio)),
      );

      const renderedMap = SourceCodeIndexer.renderRepoMap(request.repoSymbolMap, {
        maxTokens: dynamicMaxTokens,
        focusFiles: request.currentFiles,
        rankedSymbolsOnly: true,
      });

      if (renderedMap.length > 0) {
        candidates.push({
          id: this.idFactory.create<'Context'>(),
          tier: ContextTier.L3_REPOSITORY,
          type: ContextObjectType.CODE_SYMBOL,
          content: `# Repository Symbol Map (Syntactic Context):\n${renderedMap}`,
          source: 'source_code_indexer',
          timestamp: now,
          importance: 0.85,
          confidence: 1.0,
          scope: ContextScope.GLOBAL,
          dependencies: [],
          lastUsed: now,
          lastVerified: now,
          costTokens: Math.ceil(renderedMap.length / 4),
          tags: ['repo_map', 'syntactic_context'],
          version: 1,
          active: true,
          metadata: {
            totalFiles: request.repoSymbolMap.totalFiles,
            totalSymbols: request.repoSymbolMap.totalSymbols,
          },
        });
      }
    }

    // Goal & User Instructions (L3 Repository / Invariant)
    candidates.push({
      id: this.idFactory.create<'Context'>(),
      tier: ContextTier.L3_REPOSITORY,
      type: ContextObjectType.USER_INSTRUCTION,
      content: `Goal: ${request.goal.description}`,
      source: 'user',
      timestamp: now,
      importance: 1.0,
      confidence: 1.0,
      scope: ContextScope.GLOBAL,
      dependencies: [],
      lastUsed: now,
      lastVerified: now,
      costTokens: Math.ceil(request.goal.description.length / 4),
      tags: ['goal', 'must_preserve'],
      version: 1,
      active: true,
      metadata: {},
    });

    // Task (L0 Hot Context)
    candidates.push({
      id: this.idFactory.create<'Context'>(),
      tier: ContextTier.L0_HOT,
      type: ContextObjectType.REQUIREMENT,
      content: `Current Task: ${request.task.description}`,
      source: 'task_manager',
      timestamp: now,
      importance: 0.95,
      confidence: 1.0,
      scope: ContextScope.TASK,
      dependencies: [],
      lastUsed: now,
      lastVerified: now,
      costTokens: Math.ceil(request.task.description.length / 4),
      tags: ['task', 'must_preserve'],
      version: 1,
      active: true,
      metadata: {},
    });

    // Active Hypothesis (L0 Hot Context)
    if (request.activeHypothesis) {
      candidates.push({
        id: this.idFactory.create<'Context'>(),
        tier: ContextTier.L0_HOT,
        type: ContextObjectType.HYPOTHESIS,
        content: `Active Hypothesis: ${request.activeHypothesis.description}`,
        source: 'agent',
        timestamp: now,
        importance: 0.9,
        confidence: 0.8,
        scope: ContextScope.TASK,
        dependencies: [],
        lastUsed: now,
        lastVerified: null,
        costTokens: Math.ceil(request.activeHypothesis.description.length / 4),
        tags: ['hypothesis'],
        version: 1,
        active: true,
        metadata: {},
      });
    }

    // Recent Evidence & Auto-Lint/Test Feedback (L0 Hot Context for auto-feedback / failures)
    if (request.recentEvidence) {
      for (const ev of request.recentEvidence) {
        const isAutoFeedback =
          ev.summary.includes('[AUTO-LINT FAILURE]') ||
          ev.summary.includes('[AUTO-TEST FAILURE]') ||
          !ev.pass;
        const tier = isAutoFeedback ? ContextTier.L0_HOT : ContextTier.L1_WORKING;
        const importance = isAutoFeedback ? 0.95 : 0.8;

        candidates.push({
          id: this.idFactory.create<'Context'>(),
          tier,
          type: ev.pass ? ContextObjectType.EVIDENCE : ContextObjectType.FAILURE,
          content: `Evidence [${ev.type}] (${ev.pass ? 'PASS' : 'FAIL'}): ${ev.summary}`,
          source: 'verification_engine',
          timestamp: ev.createdAt,
          importance,
          confidence: 1.0,
          scope: ContextScope.TASK,
          dependencies: [],
          lastUsed: now,
          lastVerified: ev.createdAt,
          costTokens: Math.ceil(ev.summary.length / 4),
          tags: ev.pass
            ? ['evidence', 'pass']
            : ['evidence', 'fail', 'auto_feedback', 'must_preserve'],
          version: 1,
          active: true,
          metadata: { evidenceId: ev.id, outcome: ev.outcome },
        });
      }
    }

    return candidates;
  }
}
