/**
 * SQLite Experience Store for Meta-Harness Execution Traces.
 *
 * Implements execution trace storage, similarity retrieval, access tracking,
 * and TTL/retention pruning (Meta-Harness reference).
 */
import * as crypto from 'node:crypto';
import type { SqliteStore } from './sqlite-store.js';

export interface ExperienceRecord {
  readonly id: string;
  readonly taskDescription: string;
  readonly taskHash?: string;
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly trace: Record<string, unknown> | Array<unknown> | string;
  readonly score?: number;
  readonly createdAt?: number;
  readonly accessedAt?: number;
  readonly accessCount?: number;
}

export interface SqliteExperienceStoreOptions {
  readonly store: SqliteStore;
}

export function computeTaskHash(taskDescription: string): string {
  const normalized = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class SqliteExperienceStore {
  private readonly store: SqliteStore;

  constructor(options: SqliteExperienceStoreOptions) {
    this.store = options.store;
  }

  /**
   * Save a completed execution trace into the experience store.
   */
  async saveExperience(record: ExperienceRecord): Promise<void> {
    const db = this.store.db;
    const taskHash = record.taskHash ?? computeTaskHash(record.taskDescription);
    const now = Date.now();
    const createdAt = record.createdAt ?? now;
    const accessedAt = record.accessedAt ?? now;
    const accessCount = record.accessCount ?? 0;
    const score =
      record.score ??
      (record.outcome === 'success' ? 1.0 : record.outcome === 'partial' ? 0.5 : 0.0);
    const serializedTrace =
      typeof record.trace === 'string' ? record.trace : JSON.stringify(record.trace);

    db.prepare(
      `INSERT INTO experiences (id, task_hash, outcome, trace, score, created_at, accessed_at, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         task_hash = excluded.task_hash,
         outcome = excluded.outcome,
         trace = excluded.trace,
         score = excluded.score,
         accessed_at = excluded.accessed_at,
         access_count = excluded.access_count`,
    ).run(
      record.id,
      taskHash,
      record.outcome,
      serializedTrace,
      score,
      createdAt,
      accessedAt,
      accessCount,
    );
  }

  /**
   * Retrieve experience by ID, incrementing its access count.
   */
  async getExperience(id: string): Promise<ExperienceRecord | null> {
    const db = this.store.db;
    const now = Date.now();

    const row = db
      .prepare(
        'SELECT id, task_hash, outcome, trace, score, created_at, accessed_at, access_count FROM experiences WHERE id = ?',
      )
      .get(id) as any;

    if (!row) return null;

    db.prepare(
      'UPDATE experiences SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
    ).run(now, id);

    let parsedTrace: any = row.trace;
    try {
      parsedTrace = JSON.parse(row.trace);
    } catch {
      // Keep as string
    }

    return {
      id: row.id,
      taskDescription: '',
      taskHash: row.task_hash,
      outcome: row.outcome,
      trace: parsedTrace,
      score: row.score,
      createdAt: row.created_at,
      accessedAt: now,
      accessCount: row.access_count + 1,
    };
  }

  /**
   * Find similar historical execution traces by task hash or description.
   */
  async findSimilar(
    taskDescription: string,
    minScore = 0.0,
    limit = 10,
  ): Promise<ExperienceRecord[]> {
    const db = this.store.db;
    const taskHash = computeTaskHash(taskDescription);
    const now = Date.now();

    // Query matching exact task_hash or high scoring experiences
    const rows = db
      .prepare(
        `SELECT id, task_hash, outcome, trace, score, created_at, accessed_at, access_count
         FROM experiences
         WHERE (task_hash = ? OR score >= ?)
         ORDER BY (task_hash = ?) DESC, score DESC, access_count DESC
         LIMIT ?`,
      )
      .all(taskHash, minScore, taskHash, limit) as any[];

    if (rows.length === 0) return [];

    const updateAccess = db.prepare(
      'UPDATE experiences SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
    );
    const updateTx = db.transaction(() => {
      for (const r of rows) {
        updateAccess.run(now, r.id);
      }
    });
    updateTx();

    return rows.map((r) => {
      let parsedTrace: any = r.trace;
      try {
        parsedTrace = JSON.parse(r.trace);
      } catch {
        // Keep string
      }
      return {
        id: r.id,
        taskDescription,
        taskHash: r.task_hash,
        outcome: r.outcome,
        trace: parsedTrace,
        score: r.score,
        createdAt: r.created_at,
        accessedAt: now,
        accessCount: r.access_count + 1,
      };
    });
  }

  /**
   * List recent experiences.
   */
  async listRecent(limit = 50): Promise<ExperienceRecord[]> {
    const db = this.store.db;
    const rows = db
      .prepare(
        `SELECT id, task_hash, outcome, trace, score, created_at, accessed_at, access_count
         FROM experiences
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as any[];

    return rows.map((r) => {
      let parsedTrace: any = r.trace;
      try {
        parsedTrace = JSON.parse(r.trace);
      } catch {
        // Keep string
      }
      return {
        id: r.id,
        taskDescription: '',
        taskHash: r.task_hash,
        outcome: r.outcome,
        trace: parsedTrace,
        score: r.score,
        createdAt: r.created_at,
        accessedAt: r.accessed_at,
        accessCount: r.access_count,
      };
    });
  }

  /**
   * Prune low-utility or expired experiences.
   */
  async prune(maxAgeDays = 90, maxEntries = 5000): Promise<{ prunedCount: number }> {
    const db = this.store.db;
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    let prunedCount = 0;

    const pruneTx = db.transaction(() => {
      // 1. Delete expired / untouched entries older than maxAgeDays
      const res1 = db.prepare('DELETE FROM experiences WHERE accessed_at < ?').run(cutoff);
      prunedCount += res1.changes;

      // 2. Trim excess entries beyond maxEntries keeping top scores
      const countRow = db.prepare('SELECT COUNT(*) as count FROM experiences').get() as {
        count: number;
      };
      if (countRow.count > maxEntries) {
        const excess = countRow.count - maxEntries;
        const res2 = db
          .prepare(
            `DELETE FROM experiences WHERE id IN (
               SELECT id FROM experiences ORDER BY score ASC, access_count ASC, created_at ASC LIMIT ?
             )`,
          )
          .run(excess);
        prunedCount += res2.changes;
      }
    });

    pruneTx();
    return { prunedCount };
  }
}
