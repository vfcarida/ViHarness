// Pattern: Background self-improvement & curator lifecycle (ref: Hermes)
/**
 * Skill & Pattern Curator Lifecycle (from Hermes).
 *
 * Enforces memory decay and curation rules:
 * - Patterns unused for >= 30 iterations -> STALE
 * - Patterns unused for >= 100 iterations -> ARCHIVED (excluded from active retrieval)
 * - Frequently used patterns -> Boosts importance score
 */
import type { MemoryStore } from '../../core/interfaces/memory-store.js';
import { MemoryStatus, MemoryType, type MemoryRecord } from '../../core/model/memory-types.js';

export interface SkillCuratorOptions {
  readonly memoryStore: MemoryStore;
  readonly staleThresholdIterations?: number; // Default: 30
  readonly archiveThresholdIterations?: number; // Default: 100
}

export interface CurationReport {
  readonly patternsEvaluated: number;
  readonly markedStale: number;
  readonly markedArchived: number;
  readonly boostedImportance: number;
}

export class SkillCurator {
  private readonly memoryStore: MemoryStore;
  private readonly staleThreshold: number;
  private readonly archiveThreshold: number;

  constructor(options: SkillCuratorOptions) {
    this.memoryStore = options.memoryStore;
    this.staleThreshold = options.staleThresholdIterations ?? 30;
    this.archiveThreshold = options.archiveThresholdIterations ?? 100;
  }

  /**
   * Evaluates all pattern/skill memories and transitions their lifecycle status.
   */
  async curate(): Promise<CurationReport> {
    const records = await this.memoryStore.retrieve({
      types: [MemoryType.PATTERN, MemoryType.SKILL],
      activeOnly: false,
      statuses: [MemoryStatus.ACTIVE, MemoryStatus.STALE, MemoryStatus.PROMOTED],
      limit: 1000,
    });

    let markedStale = 0;
    let markedArchived = 0;
    let boostedImportance = 0;

    for (const scored of records) {
      const record = scored.record;
      const useCount = Number(record.metadata['useCount'] ?? record.accessCount ?? 0);
      const iterationsUnused = Number(record.metadata['iterationsSinceLastUse'] ?? 0);

      // Rule 1: Archive if unused for >= 100 iterations
      if (iterationsUnused >= this.archiveThreshold) {
        if (record.status !== MemoryStatus.ARCHIVED) {
          await this.memoryStore.updateRecord(record.id, {
            status: MemoryStatus.ARCHIVED,
          });
          markedArchived++;
        }
      }
      // Rule 2: Mark STALE if unused for >= 30 iterations
      else if (iterationsUnused >= this.staleThreshold) {
        if (record.status === MemoryStatus.ACTIVE || record.status === MemoryStatus.PROMOTED) {
          await this.memoryStore.updateRecord(record.id, {
            status: MemoryStatus.STALE,
          });
          markedStale++;
        }
      }
      // Rule 3: Boost importance if frequently used (>= 3 uses)
      else if (useCount >= 3) {
        const targetImportance = Math.min(1.0, 0.7 + useCount * 0.05);
        if (record.importance < targetImportance) {
          await this.memoryStore.updateRecord(record.id, {
            importance: targetImportance,
          });
          boostedImportance++;
        }
      }
    }

    return {
      patternsEvaluated: records.length,
      markedStale,
      markedArchived,
      boostedImportance,
    };
  }

  /**
   * Advances the unused iteration counter for all active patterns by a given number of iterations.
   */
  async advanceIterationCounter(iterationsElapsed: number): Promise<void> {
    const records = await this.memoryStore.retrieve({
      types: [MemoryType.PATTERN, MemoryType.SKILL],
      activeOnly: false,
      statuses: [MemoryStatus.ACTIVE, MemoryStatus.STALE, MemoryStatus.PROMOTED],
      limit: 1000,
    });

    for (const scored of records) {
      const record = scored.record;
      const currentUnused = Number(record.metadata['iterationsSinceLastUse'] ?? 0);
      await this.memoryStore.updateRecord(record.id, {
        metadata: {
          ...record.metadata,
          iterationsSinceLastUse: currentUnused + iterationsElapsed,
        },
      });
    }
  }

  /**
   * Reset unused iteration counter when a pattern is used.
   */
  async markPatternUsed(record: MemoryRecord): Promise<void> {
    await this.memoryStore.updateRecord(record.id, {
      status: MemoryStatus.ACTIVE,
      metadata: {
        ...record.metadata,
        iterationsSinceLastUse: 0,
        useCount: Number(record.metadata['useCount'] ?? 0) + 1,
      },
    });
  }
}
