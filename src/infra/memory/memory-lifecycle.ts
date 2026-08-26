/**
 * Memory Lifecycle Manager.
 *
 * Implements promotion rules and explicit status transitions:
 * CANDIDATE -> ACTIVE -> STALE / INVALIDATED -> ARCHIVED
 *
 * A memory is not active simply because a tool returned data.
 * Promotion to ACTIVE considers:
 * - importance >= 0.7
 * - recurrence count >= 2
 * - explicit user decision
 * - architecture significance
 * - successful reuse
 * - failure prevention
 */
import type { MemoryRecord } from '../../core/model/memory-types.js';
import { MemoryStatus, MemoryTier, MemoryType } from '../../core/model/memory-types.js';

export class MemoryLifecycle {
  /**
   * Evaluate whether a MemoryRecord (in CANDIDATE status or SHORT_TERM tier)
   * qualifies for promotion to ACTIVE status and/or long-term tier.
   */
  static shouldPromote(record: MemoryRecord): boolean {
    if (
      record.status === MemoryStatus.STALE ||
      record.status === MemoryStatus.INVALIDATED ||
      record.status === MemoryStatus.ARCHIVED
    ) {
      return false;
    }

    // 1. Explicit user decision
    if (
      record.source === 'user' ||
      record.source === 'human' ||
      record.tags.includes('user_decision') ||
      record.tags.includes('explicit_user')
    ) {
      return true;
    }

    // 2. Architecture significance
    if (
      record.type === MemoryType.DECISION ||
      record.type === MemoryType.PATTERN ||
      record.tags.includes('architecture') ||
      record.tags.includes('critical_decision')
    ) {
      return true;
    }

    // 3. Failure prevention
    if (
      record.type === MemoryType.FAILURE_AVOIDANCE ||
      record.tags.includes('failure_avoidance') ||
      record.tags.includes('failure_prevention')
    ) {
      return true;
    }

    // 4. High importance & recurrence
    if (record.importance >= 0.7 && record.recurrenceCount >= 2) {
      return true;
    }

    // 5. Successful reuse history
    if (record.successCount >= 1 || record.accessCount >= 2) {
      return true;
    }

    return false;
  }

  /**
   * Determine optimal target tier for a promoted memory record.
   */
  static determinePromotedTier(record: MemoryRecord): MemoryTier {
    if (
      record.tags.includes('pattern') ||
      record.tags.includes('workflow') ||
      record.tags.includes('skill')
    ) {
      return MemoryTier.PROCEDURAL;
    }
    return MemoryTier.SEMANTIC;
  }

  /**
   * Check if a record is expired based on current timestamp and expiresAt.
   */
  static isExpired(record: MemoryRecord, now: Date): boolean {
    if (!record.expiresAt) return false;
    return now.getTime() > record.expiresAt.getTime();
  }
}
