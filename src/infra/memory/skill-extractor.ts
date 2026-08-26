// Pattern: Background self-improvement & skill extraction (ref: Hermes)
/**
 * Background Skill Extractor (from Hermes Self-Improvement).
 *
 * Reviews successful execution trajectories (phase -> DONE) and extracts
 * reusable procedural and semantic problem-solving patterns as learned skills.
 */
import type { MemoryStore } from '../../core/interfaces/memory-store.js';
import type { IdFactory, MemoryId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { ExecutionResult } from '../../core/model/runtime-types.js';
import {
  MemoryTier,
  MemoryType,
  MemoryScope,
  MemoryStatus,
  type MemoryRecord,
} from '../../core/model/memory-types.js';

export interface SkillExtractorOptions {
  readonly memoryStore: MemoryStore;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class SkillExtractor {
  private readonly memoryStore: MemoryStore;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(options: SkillExtractorOptions) {
    this.memoryStore = options.memoryStore;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  /**
   * Analyzes a completed execution trajectory and extracts a reusable pattern skill.
   */
  async extractFromExecution(
    execution: ExecutionResult,
    taskDescription: string,
    goalDescription: string,
  ): Promise<MemoryRecord | null> {
    if (!execution.success || execution.status !== 'COMPLETED') {
      return null;
    }

    // Infer problem type from description and iterations
    const problemType = this.inferProblemType(taskDescription, goalDescription);

    // Collect tools used across iterations
    const toolNames = new Set<string>();
    for (const it of execution.iterations) {
      if (it.toolResults) {
        for (const res of it.toolResults) {
          const name = String(
            res.metadata?.['toolName'] ?? (res as any).name ?? (res as any).action?.toolName ?? '',
          );
          if (name) toolNames.add(name);
        }
      }
      if (it.actionProposals) {
        for (const prop of it.actionProposals) {
          const name = String(prop.parameters?.['toolName'] ?? prop.description ?? '');
          if (name && !name.includes(' ')) toolNames.add(name);
        }
      }
    }
    const toolsUsedList = Array.from(toolNames).sort();

    // Summarize successful approach
    const approachSummary =
      execution.summary || `Executed in ${execution.iterationCount} iterations`;
    const patternContent = `When facing problem type '${problemType}': Approach '${approachSummary}' succeeded in ${execution.iterationCount} iteration(s) utilizing tools: [${toolsUsedList.join(', ')}].`;

    // Persist as a high-confidence learned pattern memory
    const record = await this.memoryStore.createRecord({
      id: this.idFactory.create<'Memory'>(),
      tier: MemoryTier.PROCEDURAL,
      type: MemoryType.PATTERN,
      content: patternContent,
      source: `self_improvement:execution_${execution.executionId}`,
      confidence: 0.9,
      importance: 0.85,
      scope: MemoryScope.REPOSITORY,
      topic: `learned_pattern_${problemType.toLowerCase()}`,
      status: MemoryStatus.ACTIVE,
      tags: ['skill', 'learned_pattern', 'self_improvement', problemType.toLowerCase()],
      metadata: {
        useCount: 0,
        problemType,
        iterationCount: execution.iterationCount,
        toolsUsed: toolsUsedList,
        totalCostDollars: execution.totalCostDollars,
        executionId: execution.executionId,
        extractedAt: this.clock.now().toISOString(),
      },
    });

    return record;
  }

  /**
   * Record that a learned pattern skill was used, incrementing its useCount and access count.
   */
  async recordUsage(memoryId: MemoryId): Promise<MemoryRecord | null> {
    const existing = await this.memoryStore.getRecord(memoryId);
    if (!existing) return null;

    const currentUseCount = Number(existing.metadata['useCount'] ?? existing.accessCount ?? 0);
    const updated = await this.memoryStore.updateRecord(memoryId, {
      importance: Math.min(1.0, existing.importance + 0.02),
      metadata: {
        ...existing.metadata,
        useCount: currentUseCount + 1,
        lastUsedAt: this.clock.now().toISOString(),
      },
    });

    return updated;
  }

  private inferProblemType(taskDesc: string, goalDesc: string): string {
    const combined = `${taskDesc} ${goalDesc}`.toLowerCase();
    if (combined.includes('auth') || combined.includes('token') || combined.includes('login'))
      return 'AUTHENTICATION';
    if (
      combined.includes('refactor') ||
      combined.includes('clean') ||
      combined.includes('structure')
    )
      return 'REFACTORING';
    if (
      combined.includes('bug') ||
      combined.includes('fix') ||
      combined.includes('error') ||
      combined.includes('repair')
    )
      return 'BUG_FIX';
    if (combined.includes('test') || combined.includes('coverage') || combined.includes('spec'))
      return 'TESTING';
    if (
      combined.includes('database') ||
      combined.includes('sql') ||
      combined.includes('migration') ||
      combined.includes('schema')
    )
      return 'DATABASE';
    if (combined.includes('api') || combined.includes('endpoint') || combined.includes('route'))
      return 'API_INTEGRATION';
    if (
      combined.includes('cache') ||
      combined.includes('performance') ||
      combined.includes('optimize')
    )
      return 'PERFORMANCE_OPTIMIZATION';
    return 'GENERAL_CODING';
  }
}
