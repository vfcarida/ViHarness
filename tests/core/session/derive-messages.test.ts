/**
 * Derived History & Reconstructability Invariant Tests (P008).
 *
 * Validates:
 * 1. deriveMessages projection from append-only events.
 * 2. Compaction summary shadow replacement of historical events.
 * 3. assertModelHistoryReconstructable invariant enforcement.
 */
import { describe, it, expect } from 'vitest';
import {
  DefaultSession,
  deriveMessages,
  assertModelHistoryReconstructable,
} from '../../../src/core/session/index.js';
import { MessageRole, type ModelMessage } from '../../../src/core/model/model-io.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';

describe('Derived History & Reconstructability Invariant (DSH) — P008', () => {
  const idFactory = new UuidV7IdFactory();

  it('1. should derive USER and ASSISTANT messages from user/message and assistant/message events', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('turn/start', { turn: 1 });
    session.append('user/message', { content: 'Please fix the failing tests.' });
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: 'I will inspect the test runner output.' },
    });
    session.append('turn/end', { turn: 1, reason: { kind: 'complete' } });

    const messages = session.deriveMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe(MessageRole.USER);
    expect(messages[0]?.content).toBe('Please fix the failing tests.');
    expect(messages[1]?.role).toBe(MessageRole.ASSISTANT);
    expect(messages[1]?.content).toBe('I will inspect the test runner output.');
  });

  it('2. should project tool/call and tool/result into structured assistant and tool messages', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('turn/start', { turn: 1 });
    session.append('user/message', { content: 'Read package.json' });
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call_read_1',
      name: 'read_file',
      arguments: JSON.stringify({ path: 'package.json' }),
    });
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        toolCallId: 'call_read_1',
        name: 'read_file',
        output: '{"name": "vi-harness"}',
      },
    });
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: { content: 'The package name is vi-harness.' },
    });
    session.append('turn/end', { turn: 1, reason: { kind: 'complete' } });

    const messages = session.deriveMessages();
    expect(messages).toHaveLength(4);

    expect(messages[0]?.role).toBe(MessageRole.USER);
    expect(messages[1]?.role).toBe(MessageRole.ASSISTANT);
    expect(messages[1]?.toolCalls?.[0]?.name).toBe('read_file');
    expect(messages[1]?.toolCalls?.[0]?.input).toEqual({ path: 'package.json' });

    expect(messages[2]?.role).toBe(MessageRole.TOOL);
    expect(messages[2]?.toolCallId).toBe('call_read_1');
    expect(messages[2]?.content).toBe('{"name": "vi-harness"}');

    expect(messages[3]?.role).toBe(MessageRole.ASSISTANT);
    expect(messages[3]?.content).toBe('The package name is vi-harness.');
  });

  it('3. should exclude operational and lifecycle events from model messages', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('request/header', {
      header: { epoch: 1, model: 'claude-3-7' },
      reason: 'initial',
    });
    session.append('turn/start', { turn: 1 });
    session.append('step/start', { turn: 1, step: 1 });
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { text: 'chunk 1' } });
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { text: 'chunk 2' } });
    session.append('step/end', { turn: 1, step: 1 });
    session.append('goal/change', { goalId: 'g1', revision: 1, phase: 'active' });
    session.append('user/message', { content: 'Only user message is model visible' });
    session.append('turn/end', { turn: 1, reason: { kind: 'complete' } });

    const messages = session.deriveMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe(MessageRole.USER);
    expect(messages[0]?.content).toBe('Only user message is model visible');
  });

  it('4. should shadow compacted sequence ranges and replace them with compaction summary', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    // Old turn (seq 0 .. 4)
    session.append('turn/start', { turn: 1 }); // seq 0
    session.append('user/message', { content: 'Initial setup question' }); // seq 1
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: 'Detailed long explanation that will be compacted' },
    }); // seq 2
    session.append('turn/end', { turn: 1, reason: { kind: 'complete' } }); // seq 3

    // Compaction event replacing seq 0..3
    session.append('compaction/summary', {
      fromSeq: 0,
      toSeq: 3,
      summary: 'User asked about setup and assistant provided configuration overview.',
      tokensSaved: 1200,
    }); // seq 4

    // Subsequent turn
    session.append('turn/start', { turn: 2 }); // seq 5
    session.append('user/message', { content: 'Now implement step 2.' }); // seq 6
    session.append('assistant/message', {
      turn: 2,
      step: 1,
      message: { content: 'Implementing step 2 now.' },
    }); // seq 7
    session.append('turn/end', { turn: 2, reason: { kind: 'complete' } }); // seq 8

    const messages = session.deriveMessages();
    expect(messages).toHaveLength(3);

    // Message 0 is the compaction summary
    expect(messages[0]?.role).toBe(MessageRole.SYSTEM);
    expect(messages[0]?.content).toContain('User asked about setup');

    // Messages 1 & 2 are from Turn 2
    expect(messages[1]?.role).toBe(MessageRole.USER);
    expect(messages[1]?.content).toBe('Now implement step 2.');
    expect(messages[2]?.role).toBe(MessageRole.ASSISTANT);
    expect(messages[2]?.content).toBe('Implementing step 2 now.');

    // When includeCompacted: true is passed, all raw messages are visible
    const unmasked = session.deriveMessages({ includeCompacted: true });
    expect(unmasked).toHaveLength(5);
    expect(unmasked[0]?.content).toBe('Initial setup question');
  });

  it('5. should pass assertModelHistoryReconstructable when derived messages match actual messages', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('user/message', { content: 'Run linter' });
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: { content: 'Running linter now.' },
    });

    const actualMessages: ModelMessage[] = [
      { role: MessageRole.USER, content: 'Run linter' },
      { role: MessageRole.ASSISTANT, content: 'Running linter now.' },
    ];

    expect(() => assertModelHistoryReconstructable(session.log, actualMessages)).not.toThrow();
  });

  it('6. should throw STATE_CORRUPTED on reconstructability message count mismatch', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('user/message', { content: 'Hello' });

    const actualMessages: ModelMessage[] = [
      { role: MessageRole.USER, content: 'Hello' },
      { role: MessageRole.ASSISTANT, content: 'Unlogged phantom response' },
    ];

    expect(() => assertModelHistoryReconstructable(session.log, actualMessages)).toThrow(
      HarnessError,
    );
  });

  it('7. should throw STATE_CORRUPTED on reconstructability role mismatch', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('user/message', { content: 'Hello' });

    const actualMessages: ModelMessage[] = [
      { role: MessageRole.SYSTEM, content: 'Hello' }, // role mismatch
    ];

    expect(() => assertModelHistoryReconstructable(session.log, actualMessages)).toThrow(
      HarnessError,
    );
  });

  it('8. should throw STATE_CORRUPTED on reconstructability content mismatch', () => {
    const session = new DefaultSession({
      header: { version: 1, id: idFactory.create<'Session'>(), createdAt: Date.now() },
    });

    session.append('user/message', { content: 'Original prompt' });

    const actualMessages: ModelMessage[] = [
      { role: MessageRole.USER, content: 'Modified prompt that was never logged' },
    ];

    expect(() => assertModelHistoryReconstructable(session.log, actualMessages)).toThrow(
      HarnessError,
    );
  });
});
