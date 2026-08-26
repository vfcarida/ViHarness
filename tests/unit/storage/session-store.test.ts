/**
 * SQLite Session Store Unit Tests (P013).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../../src/infra/storage/sqlite-store.js';
import { SqliteSessionStore } from '../../../src/infra/storage/session-store.js';
import { DefaultSession } from '../../../src/core/session/session.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import type { SessionId } from '../../../src/core/types/identifiers.js';

describe('SQLite Session Store & Tree Branching — P013', () => {
  let store: SqliteStore;
  let sessionStore: SqliteSessionStore;
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T12:00:00Z'));

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await store.open();
    sessionStore = new SqliteSessionStore({ store, idFactory, clock });
  });

  afterEach(async () => {
    await store.close();
  });

  it('1. should save and load full session with events and metadata', async () => {
    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: { id: sessionId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });

    session.append('user_message', { content: 'Please inspect codebase' });
    session.append('agent_message', { content: 'Found 3 issues in auth module' });

    await sessionStore.saveSession(session, { taskName: 'Security Audit', priority: 'high' });

    const loaded = await sessionStore.loadSession(sessionId);
    expect(loaded).toBeDefined();
    expect(loaded?.session.id).toBe(sessionId);
    expect(loaded?.metadata).toEqual({ taskName: 'Security Audit', priority: 'high' });
    expect(loaded?.session.log).toHaveLength(2);
    expect((loaded?.session.log[0]?.data as any).content).toBe('Please inspect codebase');
    expect((loaded?.session.log[1]?.data as any).content).toBe('Found 3 issues in auth module');
  });

  it('2. should branch a session at an intermediate message index (Pi reference)', async () => {
    const parentId = idFactory.create<'Session'>();
    const parent = new DefaultSession({
      header: { id: parentId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });

    parent.append('user_message', { content: 'Msg 0' });
    parent.append('agent_message', { content: 'Msg 1' });
    parent.append('user_message', { content: 'Msg 2' });
    parent.append('agent_message', { content: 'Msg 3' });

    await sessionStore.saveSession(parent);

    // Branch from message index 1 (inherits Msg 0 and Msg 1)
    const childId = idFactory.create<'Session'>();
    const child = await sessionStore.branchSession(parentId, 1, childId, {
      branchReason: 'Alternative approach',
    });

    expect(child.id).toBe(childId);
    expect(child.header.parentId).toBe(parentId);
    expect(child.header.branchPoint).toBe(1);
    expect(child.log).toHaveLength(2);
    expect((child.log[0]?.data as any).content).toBe('Msg 0');
    expect((child.log[1]?.data as any).content).toBe('Msg 1');

    // Child appends independent event
    child.append('user_message', { content: 'Child divergent message' });
    await sessionStore.saveSession(child);

    // Verify parent is unaffected
    const reloadedParent = await sessionStore.loadSession(parentId);
    expect(reloadedParent?.session.log).toHaveLength(4);

    const reloadedChild = await sessionStore.loadSession(childId);
    expect(reloadedChild?.session.log).toHaveLength(3);
    expect(reloadedChild?.metadata.branchReason).toBe('Alternative approach');
  });

  it('3. should resume an existing session by ID', async () => {
    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: { id: sessionId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });
    session.append('user_message', { content: 'Resume test' });
    await sessionStore.saveSession(session);

    const resumed = await sessionStore.resumeSession(sessionId);
    expect(resumed.id).toBe(sessionId);
    expect(resumed.log).toHaveLength(1);
  });

  it('4. should list recent sessions with summary metadata and message count', async () => {
    for (let i = 1; i <= 3; i++) {
      const sId = `session-00${i}` as SessionId;
      const s = new DefaultSession({
        header: { id: sId, createdAt: 1000 * i },
        idFactory,
        clock,
      });
      for (let j = 0; j < i; j++) {
        s.append('user_message', { content: `Msg ${j}` });
      }
      await sessionStore.saveSession(s, { index: i });
    }

    const list = await sessionStore.listRecent(10);
    expect(list).toHaveLength(3);
    expect(list[0]?.id).toBe('session-003');
    expect(list[0]?.messageCount).toBe(3);
    expect(list[2]?.id).toBe('session-001');
    expect(list[2]?.messageCount).toBe(1);
  });

  it('5. should delete session and cascade delete its messages', async () => {
    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: { id: sessionId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });
    session.append('user_message', { content: 'Cascade test' });
    await sessionStore.saveSession(session);

    const deleted = await sessionStore.deleteSession(sessionId);
    expect(deleted).toBe(true);

    const loaded = await sessionStore.loadSession(sessionId);
    expect(loaded).toBeNull();
  });

  it('6. should throw error when branching non-existent parent session', async () => {
    await expect(sessionStore.branchSession('non-existent-id', 0)).rejects.toThrow(
      /non-existent parent/i,
    );
  });

  it('7. should throw error when resuming non-existent session', async () => {
    await expect(sessionStore.resumeSession('non-existent-id')).rejects.toThrow(/not found/i);
  });

  it('8. should return null when loading non-existent session', async () => {
    const res = await sessionStore.loadSession('ghost-session');
    expect(res).toBeNull();
  });

  it('9. should support branching at boundary index 0 (initial message only)', async () => {
    const parentId = idFactory.create<'Session'>();
    const parent = new DefaultSession({
      header: { id: parentId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });
    parent.append('user_message', { content: 'Initial message' });
    parent.append('agent_message', { content: 'Second message' });
    await sessionStore.saveSession(parent);

    const child = await sessionStore.branchSession(parentId, 0);
    expect(child.log).toHaveLength(1);
    expect((child.log[0]?.data as any).content).toBe('Initial message');
  });

  it('10. should support updating session metadata without modifying message count', async () => {
    const sessionId = idFactory.create<'Session'>();
    const session = new DefaultSession({
      header: { id: sessionId, createdAt: clock.now().getTime() },
      idFactory,
      clock,
    });
    session.append('user_message', { content: 'Test' });
    await sessionStore.saveSession(session, { status: 'IN_PROGRESS' });

    await sessionStore.saveSession(session, { status: 'RESOLVED', confidence: 0.99 });
    const loaded = await sessionStore.loadSession(sessionId);

    expect(loaded?.metadata.status).toBe('RESOLVED');
    expect(loaded?.metadata.confidence).toBe(0.99);
    expect(loaded?.session.log).toHaveLength(1);
  });

  it('11. should return false when deleting non-existent session', async () => {
    const deleted = await sessionStore.deleteSession('non-existent-session-xyz');
    expect(deleted).toBe(false);
  });
});
