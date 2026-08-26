/**
 * SQLite Storage Engine for Vi-Harness.
 *
 * Implements persistent key-value storage with namespaces, TTL expiration, batch transactions,
 * WAL mode, and automated schema migrations using better-sqlite3.
 */
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface BatchOp {
  readonly type: 'set' | 'delete';
  readonly namespace: string;
  readonly key: string;
  readonly value?: unknown;
  readonly ttlMs?: number;
}

export interface StorageEngine {
  open(dbPath?: string): Promise<void>;
  close(): Promise<void>;
  get<T>(namespace: string, key: string): Promise<T | null>;
  set<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string, prefix?: string): Promise<string[]>;
  batch(ops: ReadonlyArray<BatchOp>): Promise<void>;
  readonly isOpened: boolean;
  readonly db: Database.Database;
}

export const MIGRATION_001_SQL = `
CREATE TABLE IF NOT EXISTS kv_store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  branch_point INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence);

CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  task_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  trace TEXT NOT NULL,
  score REAL,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_experiences_task ON experiences(task_hash);
CREATE INDEX IF NOT EXISTS idx_experiences_outcome ON experiences(outcome, score);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_session ON metrics(session_id, created_at);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,
  UNIQUE(scope, key)
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope, status);
`;

export class SqliteStore implements StorageEngine {
  private _db?: Database.Database;
  private _dbPath?: string;

  constructor(dbPath?: string) {
    this._dbPath = dbPath;
  }

  get isOpened(): boolean {
    return this._db !== undefined && this._db.open;
  }

  get db(): Database.Database {
    if (!this._db || !this._db.open) {
      throw new Error('SqliteStore is not open. Call open() first.');
    }
    return this._db;
  }

  get resolvedDbPath(): string {
    if (this._dbPath) return this._dbPath;
    if (process.env['VI_HARNESS_DB']) return process.env['VI_HARNESS_DB'];
    return path.join(os.homedir(), '.vi-harness', 'store.db');
  }

  async open(customPath?: string): Promise<void> {
    if (this.isOpened) return;

    const targetPath = customPath ?? this.resolvedDbPath;
    this._dbPath = targetPath;

    if (targetPath !== ':memory:') {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    try {
      this._db = new Database(targetPath);
      this._db.pragma('quick_check');
    } catch (err: any) {
      // If corruption detected on existing file, attempt recovery by archiving corrupted db
      if (this._db && this._db.open) {
        try {
          this._db.close();
        } catch {
          /* ignore close error on corrupted db */
        }
      }
      if (targetPath !== ':memory:' && fs.existsSync(targetPath)) {
        const backupPath = `${targetPath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(targetPath, backupPath);
          this._db = new Database(targetPath);
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // Configure PRAGMAs for performance and reliability
    if (targetPath !== ':memory:') {
      this._db.pragma('journal_mode = WAL');
    }
    this._db.pragma('synchronous = NORMAL');

    // Run Schema Migrations
    this.runMigrations();
  }

  private runMigrations(): void {
    const db = this.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const row = db.prepare('SELECT MAX(version) as max_version FROM schema_migrations').get() as
      { max_version: number | null } | undefined;
    const currentVersion = row?.max_version ?? 0;

    if (currentVersion < 1) {
      const apply001 = db.transaction(() => {
        db.exec(MIGRATION_001_SQL);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(1, '001-core-tables', Date.now());
      });
      apply001();
    }
  }

  async get<T>(namespace: string, key: string): Promise<T | null> {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT value, expires_at FROM kv_store WHERE namespace = ? AND key = ?')
      .get(namespace, key) as { value: string; expires_at: number | null } | undefined;

    if (!row) return null;

    if (row.expires_at !== null && row.expires_at <= now) {
      this.db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?').run(namespace, key);
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async set<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void> {
    const now = Date.now();
    const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    this.db
      .prepare(
        `INSERT INTO kv_store (namespace, key, value, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(namespace, key, serialized, expiresAt, now);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?').run(namespace, key);
  }

  async list(namespace: string, prefix?: string): Promise<string[]> {
    const now = Date.now();
    let query =
      'SELECT key FROM kv_store WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)';
    const params: any[] = [namespace, now];

    if (prefix) {
      query += ' AND key LIKE ?';
      params.push(`${prefix}%`);
    }

    query += ' ORDER BY key ASC';
    const rows = this.db.prepare(query).all(...params) as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  async batch(ops: ReadonlyArray<BatchOp>): Promise<void> {
    if (ops.length === 0) return;

    const setStmt = this.db.prepare(
      `INSERT INTO kv_store (namespace, key, value, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET
         value = excluded.value,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    );
    const deleteStmt = this.db.prepare('DELETE FROM kv_store WHERE namespace = ? AND key = ?');

    const tx = this.db.transaction(() => {
      const now = Date.now();
      for (const op of ops) {
        if (op.type === 'set') {
          const expiresAt = op.ttlMs !== undefined ? now + op.ttlMs : null;
          const serialized = typeof op.value === 'string' ? op.value : JSON.stringify(op.value);
          setStmt.run(op.namespace, op.key, serialized, expiresAt, now);
        } else if (op.type === 'delete') {
          deleteStmt.run(op.namespace, op.key);
        }
      }
    });

    tx();
  }

  async close(): Promise<void> {
    if (this._db && this._db.open) {
      this._db.close();
    }
  }
}
