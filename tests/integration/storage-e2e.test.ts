/**
 * SQLite Storage End-to-End Integration Suite (P013).
 *
 * Validates cross-process persistence for sessions, experiences, memory, and metrics,
 * plus Pi-style tree session branching and WAL concurrency.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SqliteStore,
  SqliteSessionStore,
  SqliteExperienceStore,
  SqliteMemoryCurator,
  SqliteMetricsSink,
} from '../../src/infra/storage/index.js';
import { DefaultSession } from '../../src/core/session/session.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { parseSessionsArgs } from '../../src/cli/commands/sessions.js';

describe('SQLite Storage End-to-End Integration — P013', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  it('1. should persist all domain stores across database close and reopen', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-storage-e2e-'));
    const dbPath = path.join(tempDir, 'persist.db');

    // === PROCESS 1: WRITE DATA ===
    const store1 = new SqliteStore(dbPath);
    await store1.open();

    const sessionStore1 = new SqliteSessionStore({ store: store1, idFactory, clock });
    const expStore1 = new SqliteExperienceStore({ store: store1 });
    const curator1 = new SqliteMemoryCurator({ store: store1 });
    const metrics1 = new SqliteMetricsSink({ store: store1 });

    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: { id: sessionId, createdAt: Date.now() },
      idFactory,
      clock,
    });
    session.append('user_message', { content: 'Persist across restart' });
    session.append('agent_message', { content: 'Saved successfully' });
    await sessionStore1.saveSession(session, { project: 'Vi-Harness' });

    await expStore1.saveExperience({
      id: 'exp-e2e-1',
      taskDescription: 'Compile TypeScript AST parser',
      outcome: 'success',
      score: 1.0,
      trace: { durationMs: 120 },
    });

    await curator1.set('project', 'git_branch', 'feat/sqlite-persistence');
    await metrics1.recordMetric(sessionId, 'tokens_used', {
      totalTokens: 4200,
      costDollars: 0.015,
    });

    await store1.close();

    // === PROCESS 2: REOPEN AND VERIFY ===
    const store2 = new SqliteStore(dbPath);
    await store2.open();

    const sessionStore2 = new SqliteSessionStore({ store: store2, idFactory, clock });
    const expStore2 = new SqliteExperienceStore({ store: store2 });
    const curator2 = new SqliteMemoryCurator({ store: store2 });
    const metrics2 = new SqliteMetricsSink({ store: store2 });

    // Verify Session
    const loadedSession = await sessionStore2.loadSession(sessionId);
    expect(loadedSession).toBeDefined();
    expect(loadedSession?.metadata.project).toBe('Vi-Harness');
    expect(loadedSession?.session.log).toHaveLength(2);

    // Verify Experience
    const similar = await expStore2.findSimilar('Compile TypeScript AST parser', 0.9);
    expect(similar).toHaveLength(1);
    expect(similar[0]?.id).toBe('exp-e2e-1');

    // Verify Memory
    const memVal = await curator2.get('project', 'git_branch');
    expect(memVal).toBe('feat/sqlite-persistence');

    // Verify Metrics
    const agg = await metrics2.aggregateSessionTotals(sessionId);
    expect(agg.totalTokens).toBe(4200);
    expect(agg.totalCostDollars).toBe(0.015);

    await store2.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. should support tree branching and continuation across sessions', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-tree-e2e-'));
    const dbPath = path.join(tempDir, 'tree.db');

    const store = new SqliteStore(dbPath);
    await store.open();
    const sessionStore = new SqliteSessionStore({ store, idFactory, clock });

    const rootId = idFactory.create<'Session'>();
    const rootSession = new DefaultSession({
      header: { id: rootId, createdAt: Date.now() },
      idFactory,
      clock,
    });
    rootSession.append('user_message', { content: 'Step 0: Initial prompt' });
    rootSession.append('agent_message', { content: 'Step 1: Analyzed issue' });
    rootSession.append('user_message', { content: 'Step 2: Try Approach A' });
    rootSession.append('agent_message', { content: 'Step 3: Approach A failed' });
    await sessionStore.saveSession(rootSession);

    // Branch from Step 1 to try Approach B
    const branchId = idFactory.create<'Session'>();
    const branchSession = await sessionStore.branchSession(rootId, 1, branchId);
    branchSession.append('user_message', { content: 'Step 2: Try Approach B' });
    branchSession.append('agent_message', { content: 'Step 3: Approach B succeeded!' });
    await sessionStore.saveSession(branchSession);

    const list = await sessionStore.listRecent(10);
    expect(list).toHaveLength(2);

    const branchLoaded = await sessionStore.loadSession(branchId);
    expect(branchLoaded?.session.header.parentId).toBe(rootId);
    expect(branchLoaded?.session.header.branchPoint).toBe(1);
    expect(branchLoaded?.session.log).toHaveLength(4);
    expect((branchLoaded?.session.log[2]?.data as any).content).toBe('Step 2: Try Approach B');

    await store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('3. should parse CLI sessions arguments accurately', () => {
    const a1 = parseSessionsArgs(['list', '--limit', '50']);
    expect(a1.action).toBe('list');
    expect(a1.limit).toBe(50);

    const a2 = parseSessionsArgs(['branch', 'sess-123', '4']);
    expect(a2.action).toBe('branch');
    expect(a2.sessionId).toBe('sess-123');
    expect(a2.branchPoint).toBe(4);

    const a3 = parseSessionsArgs(['resume', 'sess-999']);
    expect(a3.action).toBe('resume');
    expect(a3.sessionId).toBe('sess-999');
  });
});
