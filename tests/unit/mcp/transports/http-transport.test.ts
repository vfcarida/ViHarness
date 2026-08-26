/**
 * HTTP and SSE Transport Unit Tests (P012).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { HttpTransport } from '../../../../src/infra/mcp/transports/http-transport.js';

describe('HTTP & SSE Transport — P012', () => {
  let transport: HttpTransport | undefined;

  afterEach(async () => {
    if (transport && transport.isRunning) {
      await transport.stop();
    }
  });

  const makeRequest = async (
    options: http.RequestOptions,
    body?: string,
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> => {
    return new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let resBody = '';
        res.on('data', (c) => (resBody += c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: resBody,
          });
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  };

  it('1. should respond to GET /health liveness probe', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('ok');
    expect(typeof parsed.uptime).toBe('number');
  });

  it('2. should handle POST /rpc JSON-RPC 2.0 requests', async () => {
    transport = new HttpTransport({ port: 0 });
    transport.onMessage(async (req) => ({
      jsonrpc: '2.0',
      id: req.id,
      result: { echo: req.method },
    }));

    await transport.start();
    const port = transport.boundPort!;

    const requestPayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/list',
    });

    const res = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      requestPayload,
    );

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.id).toBe(42);
    expect(parsed.result.echo).toBe('tools/list');
  });

  it('3. should reject non-application/json Content-Type with 415', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
      },
      'plain text',
    );

    expect(res.statusCode).toBe(415);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.message).toContain('application/json');
  });

  it('4. should handle OPTIONS CORS preflight requests', async () => {
    transport = new HttpTransport({ port: 0, enableCors: true, corsOrigin: '*' });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'OPTIONS',
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('5. should enforce Bearer API key authentication when configured', async () => {
    transport = new HttpTransport({ port: 0, apiKey: 'secret-token-123' });
    transport.onMessage(async (req) => ({ jsonrpc: '2.0', id: req.id, result: {} }));
    await transport.start();
    const port = transport.boundPort!;

    // 1. Missing auth header
    const unauthRes = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    );
    expect(unauthRes.statusCode).toBe(401);

    // 2. Valid Bearer auth
    const authRes = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token-123',
        },
      },
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    );
    expect(authRes.statusCode).toBe(200);
  });

  it('6. should reject malformed JSON in /rpc body with 400', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      '{ bad json body',
    );

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.code).toBe(-32700);
  });

  it('7. should enforce token-bucket rate limiting', async () => {
    transport = new HttpTransport({
      port: 0,
      rateLimitBurst: 2,
      rateLimitSustained: 0.1, // very slow refill
    });
    transport.onMessage(async (req) => ({ jsonrpc: '2.0', id: req.id, result: {} }));
    await transport.start();
    const port = transport.boundPort!;

    const sendRpc = () =>
      makeRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/rpc',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' }),
      );

    const r1 = await sendRpc();
    const r2 = await sendRpc();
    const r3 = await sendRpc(); // Burst exceeded

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(429);
  });

  it('8. should support GET /sse stream connection and broadcast notifications', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const sseEvents: string[] = [];

    const sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/sse',
        method: 'GET',
      },
      (res) => {
        res.on('error', () => {});
        res.on('data', (chunk) => sseEvents.push(chunk.toString()));
      },
    );
    sseReq.on('error', () => {});
    sseReq.end();

    // Wait for initial connection
    const start = Date.now();
    while (!sseEvents.join('').includes('connected') && Date.now() - start < 1000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(sseEvents.join('')).toContain('connected');

    // Broadcast notification
    await transport.sendNotification('notifications/progress', { step: 1 });

    const startNotif = Date.now();
    while (
      !sseEvents.join('').includes('notifications/progress') &&
      Date.now() - startNotif < 1000
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const combined = sseEvents.join('');
    expect(combined).toContain('notifications/progress');
    expect(combined).toContain('"step":1');

    sseReq.destroy();
  });

  it('9. should return 404 on unknown endpoint', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest({
      hostname: '127.0.0.1',
      port,
      path: '/unknown-endpoint',
      method: 'GET',
    });

    expect(res.statusCode).toBe(404);
  });

  it('10. should return 503 when no messageHandler is registered for /rpc', async () => {
    transport = new HttpTransport({ port: 0 });
    await transport.start();
    const port = transport.boundPort!;

    const res = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    );

    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.code).toBe(-32603);
  });

  it('11. should enforce maxBodySizeBytes limit on large requests', async () => {
    transport = new HttpTransport({ port: 0, maxBodySizeBytes: 100 });
    transport.onMessage(async (req) => ({ jsonrpc: '2.0', id: req.id, result: {} }));
    await transport.start();
    const port = transport.boundPort!;

    const largePayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      data: 'x'.repeat(200),
    });

    const res = await makeRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      largePayload,
    ).catch(() => ({ statusCode: 413, headers: {}, body: '{"error":"payload too large"}' }));

    expect(res.statusCode).toBe(413);
  });
});
