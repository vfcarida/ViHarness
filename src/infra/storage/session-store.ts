/**
 * SQLite-backed Session Store for Vi-Harness.
 *
 * Implements tree-structured session branching (Pi reference), message history persistence,
 * session resume, and metadata queries.
 */
import type { SqliteStore } from './sqlite-store.js';
import { DefaultSession } from '../../core/session/session.js';
import type { Session } from '../../core/session/session.js';
import type { SessionHeader } from '../../core/session/session-header.js';
import type { SessionEvent } from '../../core/session/session-event.js';
import type { SessionId } from '../../core/types/identifiers.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';
import { SystemClock } from '../time/system-clock.js';

export interface SessionSummary {
  readonly id: string;
  readonly parentId?: string;
  readonly branchPoint?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
  readonly metadata: Record<string, unknown>;
}

export interface SqliteSessionStoreOptions {
  readonly store: SqliteStore;
  readonly idFactory?: IdFactory;
  readonly clock?: Clock;
}

export class SqliteSessionStore {
  private readonly store: SqliteStore;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(options: SqliteSessionStoreOptions) {
    this.store = options.store;
    this.idFactory = options.idFactory ?? new UuidV7IdFactory();
    this.clock = options.clock ?? new SystemClock();
  }

  /**
   * Persist full session state, headers, metadata, and messages to SQLite.
   */
  async saveSession(session: Session, metadata: Record<string, unknown> = {}): Promise<void> {
    const db = this.store.db;
    const header = session.header;
    const now = this.clock.now().getTime();
    let effectiveMeta = metadata;
    if (Object.keys(metadata).length === 0) {
      const existing = db.prepare('SELECT metadata FROM sessions WHERE id = ?').get(header.id) as
        { metadata: string | null } | undefined;
      if (existing?.metadata) {
        try {
          effectiveMeta = JSON.parse(existing.metadata);
        } catch {
          // Ignore
        }
      }
    }
    const serializedMeta = JSON.stringify(effectiveMeta);

    const saveTx = db.transaction(() => {
      // 1. Upsert session header
      db.prepare(
        `INSERT INTO sessions (id, parent_id, branch_point, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           parent_id = excluded.parent_id,
           branch_point = excluded.branch_point,
           updated_at = excluded.updated_at,
           metadata = excluded.metadata`,
      ).run(
        header.id,
        header.parentId ?? null,
        header.branchPoint ?? null,
        header.createdAt,
        now,
        serializedMeta,
      );

      // 2. Upsert messages / events
      const insertMsg = db.prepare(
        `INSERT INTO messages (session_id, sequence, role, content, tokens_in, tokens_out, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, sequence) DO UPDATE SET
           role = excluded.role,
           content = excluded.content,
           tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out,
           model = excluded.model`,
      );

      for (let seq = 0; seq < session.log.length; seq++) {
        const ev = session.log[seq]!;
        const role =
          ev.type === 'user_message'
            ? 'user'
            : ev.type === 'agent_message'
              ? 'assistant'
              : 'system';
        const content = JSON.stringify(ev.data ?? {});
        insertMsg.run(header.id, seq, role, content, null, null, null, ev.time ?? now);
      }
    });

    saveTx();
  }

  /**
   * Load session by ID and reconstruct its event log and metadata.
   */
  async loadSession(
    sessionId: string,
  ): Promise<{ session: DefaultSession; metadata: Record<string, unknown> } | null> {
    const db = this.store.db;
    const sessionRow = db
      .prepare(
        'SELECT id, parent_id, branch_point, created_at, updated_at, metadata FROM sessions WHERE id = ?',
      )
      .get(sessionId) as
      | {
          id: string;
          parent_id: string | null;
          branch_point: number | null;
          created_at: number;
          updated_at: number;
          metadata: string | null;
        }
      | undefined;

    if (!sessionRow) return null;

    let metadata: Record<string, unknown> = {};
    try {
      if (sessionRow.metadata) metadata = JSON.parse(sessionRow.metadata);
    } catch {
      // Ignore parse error
    }

    const messageRows = db
      .prepare(
        'SELECT sequence, role, content, created_at FROM messages WHERE session_id = ? ORDER BY sequence ASC',
      )
      .all(sessionId) as Array<{
      sequence: number;
      role: string;
      content: string;
      created_at: number;
    }>;

    const initialLog: SessionEvent[] = messageRows.map((row) => {
      let data: any = {};
      try {
        data = JSON.parse(row.content);
      } catch {
        data = { content: row.content };
      }

      const type =
        row.role === 'user'
          ? 'user_message'
          : row.role === 'assistant'
            ? 'agent_message'
            : 'custom';

      return {
        type: type as any,
        data,
        seq: row.sequence,
        time: row.created_at,
      };
    });

    const header: SessionHeader = {
      id: sessionRow.id as SessionId,
      version: 1,
      parentId: (sessionRow.parent_id as SessionId) ?? undefined,
      branchPoint: sessionRow.branch_point ?? undefined,
      createdAt: sessionRow.created_at,
    };

    const session = new DefaultSession({
      header,
      initialLog,
      idFactory: this.idFactory,
      clock: this.clock,
    });

    return { session, metadata };
  }

  /**
   * Branch a parent session at a specific message index, creating a child tree branch (Pi reference).
   */
  async branchSession(
    parentSessionId: string,
    branchPoint: number,
    childSessionId?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Session> {
    const parent = await this.loadSession(parentSessionId);
    if (!parent) {
      throw new Error(`Cannot branch from non-existent parent session: ${parentSessionId}`);
    }

    const newChildId = (childSessionId ?? this.idFactory.create<'Session'>()) as SessionId;
    const childSession = parent.session.fork(branchPoint, newChildId);

    await this.saveSession(childSession, {
      ...metadata,
      branchedFrom: parentSessionId,
      branchPoint,
    });

    return childSession;
  }

  /**
   * Resume an existing session.
   */
  async resumeSession(sessionId: string): Promise<Session> {
    const record = await this.loadSession(sessionId);
    if (!record) {
      throw new Error(`Session not found for resume: ${sessionId}`);
    }
    return record.session;
  }

  /**
   * List recent sessions ordered by updated_at DESC.
   */
  async listRecent(limit = 50): Promise<SessionSummary[]> {
    const db = this.store.db;
    const rows = db
      .prepare(
        `SELECT s.id, s.parent_id, s.branch_point, s.created_at, s.updated_at, s.metadata,
                COUNT(m.id) as message_count
         FROM sessions s
         LEFT JOIN messages m ON s.id = m.session_id
         GROUP BY s.id
         ORDER BY s.updated_at DESC, s.created_at DESC, s.id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      parent_id: string | null;
      branch_point: number | null;
      created_at: number;
      updated_at: number;
      metadata: string | null;
      message_count: number;
    }>;

    return rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        if (r.metadata) meta = JSON.parse(r.metadata);
      } catch {
        // Ignore parse error
      }
      return {
        id: r.id,
        parentId: r.parent_id ?? undefined,
        branchPoint: r.branch_point ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.message_count,
        metadata: meta,
      };
    });
  }

  /**
   * Delete a session and its associated messages.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const db = this.store.db;
    const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return result.changes > 0;
  }
}
