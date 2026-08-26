import { describe, it, expect } from 'vitest';
import { DefaultToolRunContext } from '../../../src/core/tools/deferred-context.js';

describe('Deferred Context & Turn Control — P018', () => {
  it('1. Collects deferred context messages in execution order', () => {
    const ctx = new DefaultToolRunContext({
      sessionId: 's1',
      callId: 'c1',
      toolName: 'write_file',
    });

    expect(ctx.getDeferredContext()).toEqual([]);
    expect(ctx.isTurnConcluded()).toBe(false);

    ctx.deferContext('Note: file was modified');
    ctx.deferContext({ type: 'user', content: 'Run test suite to verify changes' });

    const messages = ctx.getDeferredContext();
    expect(messages.length).toBe(2);
    expect(messages[0]).toBe('Note: file was modified');
    expect(messages[1]).toEqual({ type: 'user', content: 'Run test suite to verify changes' });
  });

  it('2. concludeTurn() signals termination of the active turn', () => {
    const ctx = new DefaultToolRunContext();
    expect(ctx.isTurnConcluded()).toBe(false);

    ctx.concludeTurn();
    expect(ctx.isTurnConcluded()).toBe(true);
  });

  it('3. Ignores empty or null deferred context messages', () => {
    const ctx = new DefaultToolRunContext();
    ctx.deferContext(null as any);
    ctx.deferContext(undefined as any);
    ctx.deferContext('');

    expect(ctx.getDeferredContext()).toEqual([]);
  });

  it('4. Preserves toolName, sessionId, and callId metadata', () => {
    const ctx = new DefaultToolRunContext({
      sessionId: 'session-42',
      callId: 'call-99',
      toolName: 'bash',
      metadata: { env: 'prod' },
    });

    expect(ctx.sessionId).toBe('session-42');
    expect(ctx.callId).toBe('call-99');
    expect(ctx.toolName).toBe('bash');
    expect(ctx.metadata).toEqual({ env: 'prod' });
  });

  it('5. Handles multiple deferred messages from composite tool operations', () => {
    const ctx = new DefaultToolRunContext();
    for (let i = 1; i <= 5; i++) {
      ctx.deferContext(`Step ${i} complete`);
    }

    const messages = ctx.getDeferredContext();
    expect(messages.length).toBe(5);
    expect(messages[0]).toBe('Step 1 complete');
    expect(messages[4]).toBe('Step 5 complete');
  });

  it('6. Returned deferred context array is a shallow copy preventing external mutation', () => {
    const ctx = new DefaultToolRunContext();
    ctx.deferContext('Original');

    const copy = ctx.getDeferredContext();
    copy.push('Tampered');

    expect(ctx.getDeferredContext()).toEqual(['Original']);
  });
});
