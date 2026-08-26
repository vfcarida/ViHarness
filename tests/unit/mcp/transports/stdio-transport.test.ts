/**
 * Stdio Transport Unit Tests (P012).
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdioTransport } from '../../../../src/infra/mcp/transports/stdio-transport.js';
import type { McpJsonRpcRequest, McpJsonRpcResponse } from '../../../../src/infra/mcp/mcp-types.js';

describe('Stdio Transport — P012', () => {
  it('1. should start, stop, and report running status', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    expect(transport.isRunning).toBe(false);
    await transport.start();
    expect(transport.isRunning).toBe(true);

    await transport.stop();
    expect(transport.isRunning).toBe(false);
  });

  it('2. should read line-delimited JSON and dispatch to message handler', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    let receivedReq: McpJsonRpcRequest | undefined;
    transport.onMessage(async (req) => {
      receivedReq = req;
      return { jsonrpc: '2.0', id: req.id, result: { status: 'ok' } };
    });

    await transport.start();

    const outputChunks: string[] = [];
    outStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

    inStream.write(JSON.stringify({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list' }) + '\n');

    // Wait for event loop tick
    await new Promise((r) => setTimeout(r, 20));

    expect(receivedReq).toBeDefined();
    expect(receivedReq?.id).toBe('req-1');
    expect(receivedReq?.method).toBe('tools/list');

    const outputJson = JSON.parse(outputChunks.join(''));
    expect(outputJson.id).toBe('req-1');
    expect(outputJson.result.status).toBe('ok');

    await transport.stop();
  });

  it('3. should buffer fragmented chunks across line boundaries', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    let receivedReq: McpJsonRpcRequest | undefined;
    transport.onMessage(async (req) => {
      receivedReq = req;
      return { jsonrpc: '2.0', id: req.id, result: { success: true } };
    });

    await transport.start();

    const fullMessage = JSON.stringify({ jsonrpc: '2.0', id: 'chunked-1', method: 'ping' });
    const part1 = fullMessage.slice(0, 15);
    const part2 = fullMessage.slice(15) + '\n';

    inStream.write(part1);
    await new Promise((r) => setTimeout(r, 10));
    expect(receivedReq).toBeUndefined();

    inStream.write(part2);
    await new Promise((r) => setTimeout(r, 20));
    expect(receivedReq?.id).toBe('chunked-1');

    await transport.stop();
  });

  it('4. should process multiple newline-delimited messages in a single chunk', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    const receivedIds: (string | number)[] = [];
    transport.onMessage(async (req) => {
      receivedIds.push(req.id);
      return { jsonrpc: '2.0', id: req.id, result: {} };
    });

    await transport.start();

    const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 'm1', method: 'test' });
    const msg2 = JSON.stringify({ jsonrpc: '2.0', id: 'm2', method: 'test' });
    inStream.write(`${msg1}\n${msg2}\n`);

    await new Promise((r) => setTimeout(r, 20));
    expect(receivedIds).toEqual(['m1', 'm2']);

    await transport.stop();
  });

  it('5. should return parse error on malformed JSON lines', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    await transport.start();

    const outputChunks: string[] = [];
    outStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

    inStream.write('{ invalid json line }\n');
    await new Promise((r) => setTimeout(r, 20));

    const response = JSON.parse(outputChunks.join(''));
    expect(response.error.code).toBe(-32700);
    expect(response.error.message).toContain('Parse error');

    await transport.stop();
  });

  it('6. should reject lines exceeding maximum line length', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream, maxLineLength: 50 });

    await transport.start();

    const outputChunks: string[] = [];
    outStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

    const giantLine = 'a'.repeat(60) + '\n';
    inStream.write(giantLine);
    await new Promise((r) => setTimeout(r, 20));

    const response = JSON.parse(outputChunks.join(''));
    expect(response.error.code).toBe(-32600);
    expect(response.error.message).toContain('Line length limit exceeded');

    await transport.stop();
  });

  it('7. should send notification messages formatted as JSON-RPC with newline', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    await transport.start();

    const outputChunks: string[] = [];
    outStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

    await transport.sendNotification('notifications/progress', { percent: 50 });

    const notification = JSON.parse(outputChunks.join(''));
    expect(notification.method).toBe('notifications/progress');
    expect(notification.params.percent).toBe(50);

    await transport.stop();
  });

  it('8. should handle Windows-style CRLF line endings (\\r\\n)', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    let receivedMethod = '';
    transport.onMessage(async (req) => {
      receivedMethod = req.method;
      return { jsonrpc: '2.0', id: req.id, result: { ok: true } };
    });

    await transport.start();
    inStream.write(JSON.stringify({ jsonrpc: '2.0', id: 'crlf-1', method: 'test/crlf' }) + '\r\n');
    await new Promise((r) => setTimeout(r, 20));

    expect(receivedMethod).toBe('test/crlf');
    await transport.stop();
  });

  it('9. should handle empty lines and whitespace without throwing errors', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    let callCount = 0;
    transport.onMessage(async (req) => {
      callCount++;
      return { jsonrpc: '2.0', id: req.id, result: {} };
    });

    await transport.start();
    inStream.write(
      '\n   \n\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'valid' }) + '\n\n',
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(callCount).toBe(1);
    await transport.stop();
  });

  it('10. should catch internal exceptions thrown in message handler and return JSON-RPC error', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const transport = new StdioTransport({ inStream, outStream });

    transport.onMessage(async () => {
      throw new Error('Database connection failed');
    });

    await transport.start();

    const outputChunks: string[] = [];
    outStream.on('data', (chunk) => outputChunks.push(chunk.toString()));

    inStream.write(JSON.stringify({ jsonrpc: '2.0', id: 'throw-1', method: 'bad' }) + '\n');
    await new Promise((r) => setTimeout(r, 20));

    const res = JSON.parse(outputChunks.join(''));
    expect(res.id).toBe('throw-1');
    expect(res.error.code).toBe(-32603);
    expect(res.error.message).toContain('Database connection failed');

    await transport.stop();
  });
});
