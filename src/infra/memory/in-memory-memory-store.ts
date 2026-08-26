/**
 * In-Memory Memory Store Implementation.
 *
 * Implements MemoryStore contract:
 * - Candidate -> Active -> Stale / Invalidated -> Archived explicit lifecycle
 * - Creation of CANDIDATE memory by default unless promotion rules satisfied
 * - Conflict detection: detects contradictory memory claims without silent overwriting
 * - Source provenance tracking (toolName, filePath, commitHash, agentPhase, timestamp)
 * - Invalidation & Staleness transitions
 */
import type { MemoryStore, MemoryProvider } from '../../core/interfaces/memory-store.js';
import type { MemoryId, IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type {
  MemoryRecord,
  ScoredMemoryRecord,
  MemoryQuery,
  CreateMemoryRecordParams,
  MemoryConflict,
} from '../../core/model/memory-types.js';
import { MemoryStatus, MemoryScope, MemoryTier } from '../../core/model/memory-types.js';
import { InMemoryMemoryProvider } from './in-memory-memory-provider.js';
import { MemoryLifecycle } from './memory-lifecycle.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import { ContextSanitizer } from '../security/context-sanitizer.js';
import { SecretScrubber } from '../security/secret-scrubber.js';

export interface InMemoryMemoryStoreOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly provider?: MemoryProvider;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly provider: MemoryProvider;
  private readonly conflicts = new Map<string, MemoryConflict>();

  constructor(options: InMemoryMemoryStoreOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.provider = options.provider ?? new InMemoryMemoryProvider();
  }

  async createRecord(params: CreateMemoryRecordParams): Promise<MemoryRecord> {
    const id = params.id ?? this.idFactory.create<'Memory'>();
    const now = this.clock.now();

    // Sanitize and scrub memory content
    const sanitizedContent = SecretScrubber.scrub(ContextSanitizer.sanitize(params.content));

    // Default status: SHORT_TERM unverified tool entries are CANDIDATE; explicit/semantic/procedural default to ACTIVE
    const requestedTier = params.tier ?? MemoryTier.SHORT_TERM;
    let initialStatus =
      params.status ??
      (requestedTier === MemoryTier.SHORT_TERM &&
      (params.importance ?? 0.5) < 0.7 &&
      params.source.startsWith('tool:')
        ? MemoryStatus.CANDIDATE
        : MemoryStatus.ACTIVE);
    let initialTier = requestedTier;

    // Check initial parameters for promotion eligibility
    const tempRecord: MemoryRecord = {
      id,
      tier: initialTier,
      type: params.type,
      content: sanitizedContent,
      source: params.source,
      provenance: params.provenance ?? { source: params.source, timestamp: now },
      confidence: params.confidence ?? 1.0,
      importance: params.importance ?? 0.5,
      scope: params.scope ?? MemoryScope.REPOSITORY,
      scopeTarget: params.scopeTarget,
      topic: params.topic,
      createdAt: now,
      updatedAt: now,
      lastUsed: now,
      lastVerified: params.lastVerified ?? null,
      expiresAt: params.expiresAt ?? null,
      status: initialStatus,
      accessCount: 0,
      successCount: 0,
      recurrenceCount: 1,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    };

    if (MemoryLifecycle.shouldPromote(tempRecord)) {
      initialStatus = MemoryStatus.ACTIVE;
      initialTier = MemoryLifecycle.determinePromotedTier(tempRecord);
    }

    const record: MemoryRecord = {
      ...tempRecord,
      status: initialStatus,
      tier: initialTier,
    };

    // Conflict detection against existing active memories
    await this.detectAndRecordConflict(record);

    await this.provider.storeRecord(record);
    return record;
  }

  async retrieve(query: MemoryQuery): Promise<ReadonlyArray<ScoredMemoryRecord>> {
    return this.provider.retrieve(query);
  }

  async getRecord(id: MemoryId): Promise<MemoryRecord | undefined> {
    return this.provider.getRecord(id);
  }

  async recordUsage(id: MemoryId, success: boolean): Promise<MemoryRecord> {
    const record = await this.provider.getRecord(id);
    if (!record) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryRecord not found: ${id}`,
      });
    }

    const now = this.clock.now();
    const updatedAccess = record.accessCount + 1;
    const updatedSuccess = record.successCount + (success ? 1 : 0);
    const updatedRecurrence = record.recurrenceCount + 1;

    let updated: MemoryRecord = {
      ...record,
      accessCount: updatedAccess,
      successCount: updatedSuccess,
      recurrenceCount: updatedRecurrence,
      lastUsed: now,
      updatedAt: now,
    };

    if (MemoryLifecycle.shouldPromote(updated)) {
      const targetTier = MemoryLifecycle.determinePromotedTier(updated);
      updated = {
        ...updated,
        status: MemoryStatus.PROMOTED,
        tier: targetTier,
      };
    }

    return this.provider.updateRecord(id, updated);
  }

  async promote(id: MemoryId, targetTier?: MemoryTier): Promise<MemoryRecord> {
    const record = await this.provider.getRecord(id);
    if (!record) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryRecord not found: ${id}`,
      });
    }

    const newTier = targetTier ?? MemoryLifecycle.determinePromotedTier(record);
    const updated: MemoryRecord = {
      ...record,
      status: MemoryStatus.ACTIVE,
      tier: newTier,
      updatedAt: this.clock.now(),
    };

    return this.provider.updateRecord(id, updated);
  }

  async markStale(id: MemoryId, reason?: string): Promise<MemoryRecord> {
    const record = await this.provider.getRecord(id);
    if (!record) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryRecord not found: ${id}`,
      });
    }

    const updated: MemoryRecord = {
      ...record,
      status: MemoryStatus.STALE,
      updatedAt: this.clock.now(),
      metadata: { ...record.metadata, staleReason: reason ?? 'Architecture change' },
    };

    return this.provider.updateRecord(id, updated);
  }

  async invalidate(id: MemoryId, reason?: string): Promise<MemoryRecord> {
    const record = await this.provider.getRecord(id);
    if (!record) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryRecord not found: ${id}`,
      });
    }

    const updated: MemoryRecord = {
      ...record,
      status: MemoryStatus.INVALIDATED,
      updatedAt: this.clock.now(),
      metadata: { ...record.metadata, invalidationReason: reason ?? 'Contradictory evidence' },
    };

    return this.provider.updateRecord(id, updated);
  }

  async updateRecord(id: MemoryId, updates: Partial<MemoryRecord>): Promise<MemoryRecord> {
    const record = await this.provider.getRecord(id);
    if (!record) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryRecord not found: ${id}`,
      });
    }

    const updated: MemoryRecord = {
      ...record,
      ...updates,
      updatedAt: this.clock.now(),
    };

    return this.provider.updateRecord(id, updated);
  }

  async delete(id: MemoryId): Promise<boolean> {
    return this.provider.deleteRecord(id);
  }

  async getConflicts(): Promise<ReadonlyArray<MemoryConflict>> {
    return Array.from(this.conflicts.values());
  }

  async resolveConflict(conflictId: string, winningRecordId: MemoryId): Promise<MemoryRecord> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new HarnessError({
        code: ErrorCode.CONTEXT_COMPILATION_FAILED,
        category: ErrorCategory.CONTEXT,
        message: `MemoryConflict not found: ${conflictId}`,
      });
    }

    const winningId = winningRecordId;
    const losingId =
      conflict.existingRecord.id === winningId
        ? conflict.conflictingRecord.id
        : conflict.existingRecord.id;

    await this.invalidate(losingId, `Resolved conflict ${conflictId} in favor of ${winningId}`);
    const winner = await this.promote(winningId);

    this.conflicts.delete(conflictId);
    return winner;
  }

  async clear(): Promise<void> {
    this.conflicts.clear();
    await this.provider.clear();
  }

  private async detectAndRecordConflict(newRecord: MemoryRecord): Promise<void> {
    if (!newRecord.topic && !newRecord.scopeTarget) return;

    // Retrieve active records matching scope / topic
    const activeRecords = await this.provider.retrieve({
      activeOnly: true,
      scopes: [newRecord.scope],
      scopeTarget: newRecord.scopeTarget,
      topic: newRecord.topic,
    });

    for (const scored of activeRecords) {
      const existing = scored.record;
      if (existing.id === newRecord.id) continue;

      // Check if topics match and contents are contradictory
      const topicMatches =
        (newRecord.topic && existing.topic && newRecord.topic === existing.topic) ||
        (newRecord.scopeTarget &&
          existing.scopeTarget &&
          newRecord.scopeTarget === existing.scopeTarget);

      if (topicMatches && existing.content !== newRecord.content) {
        const isContradictory =
          (existing.content.toLowerCase().includes('port') &&
            newRecord.content.toLowerCase().includes('port')) ||
          (existing.content.toLowerCase().includes('must') &&
            newRecord.content.toLowerCase().includes('must')) ||
          existing.content !== newRecord.content;

        if (isContradictory) {
          const conflictId = `conflict-${existing.id}-${newRecord.id}`;
          const conflict: MemoryConflict = {
            conflictId,
            existingRecord: existing,
            conflictingRecord: newRecord,
            topic: newRecord.topic ?? newRecord.scopeTarget ?? 'contradictory_memory',
            reason: `Contradictory claims for topic [${newRecord.topic ?? newRecord.scopeTarget}]: "${existing.content}" vs "${newRecord.content}"`,
            detectedAt: this.clock.now(),
          };
          this.conflicts.set(conflictId, conflict);
        }
      }
    }
  }
}
