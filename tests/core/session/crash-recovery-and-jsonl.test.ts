/**
 * Crash Recovery & JSONL Persistence Unit Tests (P008).
 *
 * Validates:
 * 1. Crash recovery synthetic turn/end with { kind: 'interrupted' } (DSH pattern).
 * 2. Intermediate events preserved without truncation.
 * 3. JSONL serialization, atomic appending, and deserialization.
 * 4. Disk-backed JsonlSessionStore persistence and resume recovery.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DefaultSession,
  recoverInterruptedSession,
  SessionJsonlPersistence,
  JsonlSessionStore,
  type SessionEvent,
} from '../../../src/core/session/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import { MessageRole } from '../../../src/core/model/model-io.js';

describe('Crash Recovery & JSONL Persistence (DSH & Pi) — P008', () => {
  const clock = new TestClock(new Date('2026-01-01T00:00:00.000Z'));
  const idFactory = new UuidV7IdFactory();

  it('1. should detect open turn and synthesize turn/end with kind interrupted without truncating events', () => {
    const rawEvents: SessionEvent[] = [
      { type: 'turn/start', data: { turn: 1 }, seq: 0, time: 1000 },
      { type: 'user/message', data: { content: 'Please refactor db client' }, seq: 1, time: 1010 },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { content: 'Refactoring database client now.' },
        },
        seq: 2,
        time: 1020,
      },
      // Turn 1 crashed here before turn/end was written
    ];

    const result = recoverInterruptedSession(rawEvents, 2000);

    expect(result.wasInterrupted).toBe(true);
    expect(result.unclosedTurnNumber).toBe(1);
    expect(result.recoveredLog).toHaveLength(4);

    const synthetic = result.recoveredLog[3]!;
    expect(synthetic.type).toBe('turn/end');
    expect(synthetic.seq).toBe(3);
    expect((synthetic.data as any).reason.kind).toBe('interrupted');
    expect((synthetic.data as any).turn).toBe(1);

    // Verify intermediate events are preserved
    expect((result.recoveredLog[1]?.data as any).content).toBe('Please refactor db client');
    expect((result.recoveredLog[2]?.data as any).message.content).toBe(
      'Refactoring database client now.',
    );
  });

  it('2. should close unclosed step and unclosed turn in proper sequence', () => {
    const rawEvents: SessionEvent[] = [
      { type: 'turn/start', data: { turn: 2 }, seq: 0, time: 1000 },
      { type: 'step/start', data: { turn: 2, step: 3 }, seq: 1, time: 1010 },
      {
        type: 'tool/call',
        data: { turn: 2, step: 3, callId: 'c1', name: 'read_file', arguments: '{}' },
        seq: 2,
        time: 1020,
      },
    ];

    const result = recoverInterruptedSession(rawEvents, 3000);

    expect(result.wasInterrupted).toBe(true);
    expect(result.recoveredLog).toHaveLength(5);

    // seq 3: synthetic step/end
    expect(result.recoveredLog[3]?.type).toBe('step/end');
    expect((result.recoveredLog[3]?.data as any).step).toBe(3);

    // seq 4: synthetic turn/end
    expect(result.recoveredLog[4]?.type).toBe('turn/end');
    expect((result.recoveredLog[4]?.data as any).reason.kind).toBe('interrupted');
  });

  it('3. should return unchanged log when session is cleanly closed', () => {
    const cleanEvents: SessionEvent[] = [
      { type: 'turn/start', data: { turn: 1 }, seq: 0, time: 1000 },
      { type: 'user/message', data: { content: 'Clean run' }, seq: 1, time: 1010 },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'complete' } }, seq: 2, time: 1020 },
    ];

    const result = recoverInterruptedSession(cleanEvents, 2000);
    expect(result.wasInterrupted).toBe(false);
    expect(result.recoveredLog).toHaveLength(3);
  });

  it('4. should serialize session to valid JSONL and deserialize back with byte-for-byte fidelity', () => {
    const session = new DefaultSession({
      header: {
        version: 1,
        id: idFactory.create<'Session'>(),
        createdAt: 1700000000000,
        cwd: '/app',
      },
      idFactory,
      clock,
    });

    session.append('turn/start', { turn: 1 });
    session.append('user/message', { content: 'Test JSONL roundtrip' });
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: 'Roundtrip verified.' },
    });
    session.append('turn/end', { turn: 1, reason: { kind: 'complete' } });

    const serialized = SessionJsonlPersistence.serializeSession(session);
    const lines = serialized.trim().split('\n');

    expect(lines).toHaveLength(5); // 1 header line + 4 event lines
    const parsedHeader = JSON.parse(lines[0]!);
    expect(parsedHeader.type).toBe('header');
    expect(parsedHeader.data.id).toBe(session.id);

    const restored = SessionJsonlPersistence.deserializeSession(serialized, {
      idFactory,
      clock,
    });

    expect(restored.id).toBe(session.id);
    expect(restored.log).toHaveLength(4);
    expect(restored.deriveMessages()).toHaveLength(2);
    expect(restored.deriveMessages()[0]?.content).toBe('Test JSONL roundtrip');
    expect(restored.deriveMessages()[1]?.content).toBe('Roundtrip verified.');
  });

  it('5. should write session to file, append events, and reload from disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-session-jsonl-'));
    const filePath = path.join(tempDir, 'test_session.jsonl');

    const session = new DefaultSession({
      header: {
        version: 1,
        id: idFactory.create<'Session'>(),
        createdAt: clock.now().getTime(),
      },
      idFactory,
      clock,
    });

    session.append('user/message', { content: 'File persistence test' });
    await SessionJsonlPersistence.writeSessionToFile(session, filePath);

    // Append single event
    const appendEv: SessionEvent = {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { content: 'Appended file event' },
      },
      seq: 1,
      time: clock.now().getTime(),
    };
    await SessionJsonlPersistence.appendEventToFile(filePath, appendEv);

    // Read back
    const loaded = await SessionJsonlPersistence.readSessionFromFile(filePath);
    expect(loaded.log).toHaveLength(2);
    expect(loaded.deriveMessages()[0]?.content).toBe('File persistence test');
    expect(loaded.deriveMessages()[1]?.content).toBe('Appended file event');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('6. should automatically recover crashed session when loaded via JsonlSessionStore', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-jsonl-store-'));
    const store = new JsonlSessionStore({ storageDir: tempDir, idFactory, clock });

    const session = store.create();
    session.append('turn/start', { turn: 1 });
    session.append('user/message', { content: 'Session that crashes mid-turn' });

    // Manually write file with unclosed turn to simulate hard kill/crash
    const unclosedFilePath = path.join(tempDir, `${session.id}.jsonl`);
    SessionJsonlPersistence.writeSessionToFile(session, unclosedFilePath);

    // Resume from disk
    const resumed = store.resume(session.id);
    expect(resumed.log).toHaveLength(3);

    const lastEvent = resumed.log[2]!;
    expect(lastEvent.type).toBe('turn/end');
    expect((lastEvent.data as any).reason.kind).toBe('interrupted');

    // Messages can still be derived safely
    const messages = resumed.deriveMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(MessageRole.USER);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('7. should list sessions and branch on disk with JsonlSessionStore', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-jsonl-store-tree-'));
    const store = new JsonlSessionStore({ storageDir: tempDir, idFactory, clock });

    const root = store.create();
    root.append('user/message', { content: 'Root session' });

    const child = store.fork(root.id);
    child.append('user/message', { content: 'Child branch' });

    const list = store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const ancestors = store.findAncestors(child.id);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]?.id).toBe(root.id);
    expect(ancestors[1]?.id).toBe(child.id);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
