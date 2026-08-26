/**
 * HTTP and Server-Sent Events (SSE) Transport for MCP.
 *
 * Implements standard HTTP JSON-RPC 2.0 endpoints (/rpc), Server-Sent Events (/sse) for
 * push notifications, health probes (/health), rate limiting, and Bearer authentication.
 *
 * Built entirely with Node.js built-in 'http' module (zero external runtime dependencies).
 */
import * as http from 'node:http';
import type { Transport, HttpTransportOptions, JsonRpcHandler } from './types.js';
import type { McpJsonRpcRequest } from '../mcp-types.js';

interface RateLimitBucket {
  tokens: number;
  lastRefillMs: number;
}

export class HttpTransport implements Transport {
  public readonly name = 'http';
  private running = false;
  private messageHandler?: JsonRpcHandler;
  private server?: http.Server;
  private readonly port: number;
  private readonly host: string;
  private readonly apiKey?: string;
  private readonly enableCors: boolean;
  private readonly corsOrigin: string;
  private readonly maxBodySizeBytes: number;
  private readonly rateLimitBurst: number;
  private readonly rateLimitSustained: number;
  private readonly idleTimeoutMs: number;

  private readonly sseClients = new Set<http.ServerResponse>();
  private readonly rateLimiters = new Map<string, RateLimitBucket>();
  private pingInterval?: NodeJS.Timeout;
  private startTime = Date.now();
  private activeConnectionCount = 0;

  constructor(options?: HttpTransportOptions) {
    this.port = options?.port ?? 3100;
    this.host = options?.host ?? '127.0.0.1';
    this.apiKey = options?.apiKey;
    this.enableCors = options?.enableCors ?? true;
    this.corsOrigin = options?.corsOrigin ?? '*';
    this.maxBodySizeBytes = options?.maxBodySizeBytes ?? 10 * 1024 * 1024; // 10MB
    this.rateLimitBurst = options?.rateLimitBurst ?? 100;
    this.rateLimitSustained = options?.rateLimitSustained ?? 20; // 20 tokens/sec
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 30000;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get boundPort(): number | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') {
      return addr.port;
    }
    return this.port;
  }

  onMessage(handler: JsonRpcHandler): void {
    this.messageHandler = handler;
  }

  async start(overrideConfig?: { port?: number; host?: string }): Promise<void> {
    if (this.running) return;

    const targetPort = overrideConfig?.port ?? this.port;
    const targetHost = overrideConfig?.host ?? this.host;

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.server.timeout = this.idleTimeoutMs;

    this.server.on('connection', () => {
      this.activeConnectionCount++;
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(targetPort, targetHost, () => {
        this.running = true;
        this.startTime = Date.now();

        // Start SSE ping timer (15s interval)
        this.pingInterval = setInterval(() => {
          this.broadcastSseComment('ping');
        }, 15000);

        resolve();
      });

      this.server!.on('error', (err) => {
        reject(err);
      });
    });
  }

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    req.socket.on('error', () => {});
    res.on('error', () => {});

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const clientIp =
      (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

    // 1. CORS Headers
    if (this.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', this.corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With',
      );
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 2. Rate Limiting Check
    if (!this.checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests: Rate limit exceeded' }));
      return;
    }

    // 3. Health Probe (/health)
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: (Date.now() - this.startTime) / 1000,
          connections: this.sseClients.size + this.activeConnectionCount,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // 4. Authentication Check (for /rpc and /sse)
    if (this.apiKey) {
      const authHeader = req.headers['authorization'];
      const expectedBearer = `Bearer ${this.apiKey}`;
      if (authHeader !== expectedBearer) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32001, message: 'Unauthorized: Invalid or missing API key' },
          }),
        );
        return;
      }
    }

    // 5. Server-Sent Events (/sse)
    if (pathname === '/sse' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      res.write(`data: ${JSON.stringify({ type: 'connected', server: 'vi-harness-mcp' })}\n\n`);
      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 6. JSON-RPC Endpoint (/rpc)
    if (pathname === '/rpc' && req.method === 'POST') {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32600,
              message: 'Unsupported Media Type: Content-Type must be application/json',
            },
          }),
        );
        return;
      }

      let body = '';
      let bodyLength = 0;

      req.on('data', (chunk: Buffer) => {
        bodyLength += chunk.length;
        if (bodyLength > this.maxBodySizeBytes) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32600, message: 'Payload Too Large (max 10MB)' },
            }),
          );
          req.destroy();
          return;
        }
        body += chunk.toString('utf-8');
      });

      req.on('end', async () => {
        let parsed: any;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error: Invalid JSON' },
            }),
          );
          return;
        }

        if (!this.messageHandler) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed?.id ?? null,
              error: { code: -32603, message: 'Server Not Ready: No message handler registered' },
            }),
          );
          return;
        }

        try {
          const response = await this.messageHandler(parsed as McpJsonRpcRequest);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed?.id ?? null,
              error: {
                code: -32603,
                message: `Internal server error: ${err?.message ?? String(err)}`,
              },
            }),
          );
        }
      });
      return;
    }

    // 7. Unknown Route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not Found: ${pathname}` }));
  }

  private checkRateLimit(clientIp: string): boolean {
    const now = Date.now();
    let bucket = this.rateLimiters.get(clientIp);

    if (!bucket) {
      bucket = { tokens: this.rateLimitBurst, lastRefillMs: now };
      this.rateLimiters.set(clientIp, bucket);
    } else {
      // Refill tokens
      const elapsedSeconds = (now - bucket.lastRefillMs) / 1000;
      const refilled = elapsedSeconds * this.rateLimitSustained;
      bucket.tokens = Math.min(this.rateLimitBurst, bucket.tokens + refilled);
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  private broadcastSseComment(comment: string): void {
    for (const client of this.sseClients) {
      try {
        client.write(`: ${comment}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  async sendNotification(method: string, params?: unknown): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const client of this.sseClients) {
      try {
        client.write(`data: ${payload}\n\n`);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Close all SSE connections
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // Ignore end errors
      }
    }
    this.sseClients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }
}
