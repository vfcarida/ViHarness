/**
 * SQLite Memory Curator with Hermes-inspired Lifecycle.
 *
 * Manages scoped memory (global, project, session) with automatic lifecycle transitions:
 * active -> stale (30 days without access) -> archived (90 days).
 * Includes memory consolidation and sweep capabilities.
 */
import * as crypto from 'node:crypto';
import type { SqliteStore } from './sqlite-store.js';

export type MemoryScope = 'global' | 'project' | 'session';
export type MemoryStatus = 'active' | 'stale' | 'archived';

export interface MemoryEntry {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly key: string;
  readonly value: string;
  readonly status: MemoryStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly accessedAt: number;
}

export interface SqliteMemoryCuratorOptions {
  readonly store: SqliteStore;
}

export class SqliteMemoryCurator {
  private readonly store: SqliteStore;

  constructor(options: SqliteMemoryCuratorOptions) {
    this.store = options.store;
  }

  /**
   * Retrieve a memory value by scope and key.
   * Accessing a stale memory reactivates it to 'active'.
   */
  async get(scope: MemoryScope, key: string): Promise<string | null> {
    const db = this.store.db;
    const now = Date.now();

    const row = db
      .prepare('SELECT id, value, status FROM memory WHERE scope = ? AND key = ?')
      .get(scope, key) as { id: string; value: string; status: MemoryStatus } | undefined;

    if (!row) return null;

    // If stale, reactivate back to active upon access
    const newStatus = row.status === 'stale' ? 'active' : row.status;
    db.prepare('UPDATE memory SET accessed_at = ?, status = ? WHERE id = ?').run(
      now,
      newStatus,
      row.id,
    );

    return row.value;
  }

  /**
   * Store or update a memory entry in the given scope.
   */
  async set(scope: MemoryScope, key: string, value: string): Promise<void> {
    const db = this.store.db;
    const now = Date.now();
    const id = crypto.createHash('sha256').update(`${scope}:${key}`).digest('hex').slice(0, 16);

    db.prepare(
      `INSERT INTO memory (id, scope, key, value, status, created_at, updated_at, accessed_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET
         value = excluded.value,
         status = 'active',
         updated_at = excluded.updated_at,
         accessed_at = excluded.accessed_at`,
    ).run(id, scope, key, value, now, now, now);
  }

  /**
   * Delete a memory entry.
   */
  async delete(scope: MemoryScope, key: string): Promise<void> {
    const db = this.store.db;
    db.prepare('DELETE FROM memory WHERE scope = ? AND key = ?').run(scope, key);
  }

  /**
   * List memory entries by scope and optional status filter.
   */
  async list(scope?: MemoryScope, status?: MemoryStatus): Promise<MemoryEntry[]> {
    const db = this.store.db;
    let query =
      'SELECT id, scope, key, value, status, created_at, updated_at, accessed_at FROM memory WHERE 1=1';
    const params: any[] = [];

    if (scope) {
      query += ' AND scope = ?';
      params.push(scope);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY accessed_at DESC';
    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as MemoryScope,
      key: r.key,
      value: r.value,
      status: r.status as MemoryStatus,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      accessedAt: r.accessed_at,
    }));
  }

  /**
   * Run Hermes curator lifecycle sweep:
   * active -> stale (no access for staleDays, default 30)
   * stale -> archived (no access for archiveDays, default 90)
   */
  async sweep(
    staleDays = 30,
    archiveDays = 90,
    customNow?: number,
  ): Promise<{ transitionedToStale: number; transitionedToArchived: number }> {
    const db = this.store.db;
    const now = customNow ?? Date.now();
    const staleCutoff = now - staleDays * 24 * 60 * 60 * 1000;
    const archiveCutoff = now - archiveDays * 24 * 60 * 60 * 1000;

    let transitionedToStale = 0;
    let transitionedToArchived = 0;

    const sweepTx = db.transaction(() => {
      // 1. Move stale -> archived if accessed_at < archiveCutoff
      const archiveRes = db
        .prepare("UPDATE memory SET status = 'archived' WHERE status = 'stale' AND accessed_at < ?")
        .run(archiveCutoff);
      transitionedToArchived = archiveRes.changes;

      // 2. Move active -> stale if accessed_at < staleCutoff
      const staleRes = db
        .prepare("UPDATE memory SET status = 'stale' WHERE status = 'active' AND accessed_at < ?")
        .run(staleCutoff);
      transitionedToStale = staleRes.changes;
    });

    sweepTx();
    return { transitionedToStale, transitionedToArchived };
  }

  /**
   * Consolidate memory entries within a scope when count exceeds threshold.
   */
  async consolidate(scope: MemoryScope, threshold = 10): Promise<{ consolidatedCount: number }> {
    const entries = await this.list(scope, 'active');
    if (entries.length <= threshold) {
      return { consolidatedCount: 0 };
    }

    const db = this.store.db;
    const consolidatedKey = `consolidated_${Date.now()}`;
    const consolidatedValue = entries.map((e) => `[${e.key}]: ${e.value}`).join('\n');

    const consolidateTx = db.transaction(() => {
      // Delete old entries and write consolidated entry
      db.prepare("DELETE FROM memory WHERE scope = ? AND status = 'active'").run(scope);
      this.set(scope, consolidatedKey, consolidatedValue);
    });

    consolidateTx();
    return { consolidatedCount: entries.length };
  }
}
