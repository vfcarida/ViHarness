/**
 * Wave 7.6 — Real-Time Evolution Cockpit HTTP/SSE Server (`EvolutionCockpitServer`).
 *
 * Provides a zero-dependency Node `node:http` observability & operational control server
 * for the Evolution Plane:
 * - `GET /`: Interactive dark-mode glassmorphic HTML5 Evolution Cockpit UI
 * - `GET /api/evolution/status`: Consolidated JSON status (canary, ledger, leaderboard, meta-router)
 * - `GET /api/evolution/leaderboard`: Glicko-2 / Bradley-Terry rankings & active-learning matchups
 * - `GET /api/evolution/canary`: Canary rollout status & sequential CUSUM state
 * - `POST /api/evolution/canary/rollback`: Immediate emergency canary rollback to $H_{\text{stable}}$
 * - `GET /api/evolution/ledger/verify`: Cryptographic hash-chain integrity verification
 * - `GET /api/evolution/stream`: Server-Sent Events (`text/event-stream`) live telemetry stream
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CanaryDeploymentController } from './canary-deployment-controller.js';
import type { BradleyTerryHarnessRanker } from './bradley-terry-ranker.js';
import type { CryptographicEvolutionLedger } from './cryptographic-evolution-ledger.js';
import type { ContextualBanditMetaRouter } from './contextual-bandit-meta-router.js';

export interface EvolutionCockpitEvent {
  readonly eventType: string;
  readonly timestamp: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvolutionCockpitServerOptions {
  readonly canaryController: CanaryDeploymentController;
  readonly ranker: BradleyTerryHarnessRanker;
  readonly ledger: CryptographicEvolutionLedger;
  readonly metaRouter?: ContextualBanditMetaRouter;
}

export class EvolutionCockpitServer {
  private readonly canaryController: CanaryDeploymentController;
  private readonly ranker: BradleyTerryHarnessRanker;
  private readonly ledger: CryptographicEvolutionLedger;
  private readonly metaRouter?: ContextualBanditMetaRouter;

  private server?: http.Server;
  private readonly sseClients = new Set<http.ServerResponse>();
  private readonly recentEvents: EvolutionCockpitEvent[] = [];

  constructor(options: EvolutionCockpitServerOptions) {
    this.canaryController = options.canaryController;
    this.ranker = options.ranker;
    this.ledger = options.ledger;
    this.metaRouter = options.metaRouter;
  }

  /**
   * Starts the HTTP/SSE server on the specified port (`0` for ephemeral OS-assigned port).
   */
  async start(port = 0, host = '127.0.0.1'): Promise<{
    readonly port: number;
    readonly url: string;
  }> {
    if (this.server) {
      const addr = this.server.address() as AddressInfo;
      return { port: addr.port, url: `http://${host}:${addr.port}` };
    }

    const srv = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        resolve();
      });
    });

    this.server = srv;
    const addr = srv.address() as AddressInfo;
    return {
      port: addr.port,
      url: `http://${host}:${addr.port}`,
    };
  }

  /**
   * Stops the server and closes all active SSE streams cleanly.
   */
  async stop(): Promise<void> {
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // Ignore already closed socket
      }
    }
    this.sseClients.clear();

    if (!this.server) return;
    const srv = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  /**
   * Broadcasts a live `EvolutionCockpitEvent` to all connected SSE subscribers.
   */
  publishEvent(event: {
    readonly eventType: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly timestamp?: string;
  }): EvolutionCockpitEvent {
    const fullEvent: EvolutionCockpitEvent = {
      eventType: event.eventType,
      timestamp: event.timestamp ?? new Date().toISOString(),
      payload: event.payload,
    };

    this.recentEvents.push(fullEvent);
    if (this.recentEvents.length > 50) {
      this.recentEvents.shift();
    }

    const frame = `event: ${fullEvent.eventType}\ndata: ${JSON.stringify(fullEvent)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(frame);
      } catch {
        this.sseClients.delete(client);
      }
    }

    return fullEvent;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    if (method === 'GET' && pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(this.renderCockpitHtml());
      return;
    }

    if (method === 'GET' && pathname === '/api/evolution/status') {
      this.sendJson(res, 200, {
        canary: this.canaryController.getSnapshot(),
        ledgerIntegrity: this.ledger.verifyLedgerIntegrity(),
        leaderboard: this.ranker.getLeaderboard().slice(0, 10),
        metaArms: this.metaRouter?.getArmLeaderboard() ?? [],
        recentEventsCount: this.recentEvents.length,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/evolution/leaderboard') {
      this.sendJson(res, 200, {
        leaderboard: this.ranker.getLeaderboard(),
        suggestedMatchups: this.ranker.suggestNextMatchups(3),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/evolution/canary') {
      this.sendJson(res, 200, this.canaryController.getSnapshot());
      return;
    }

    if (method === 'POST' && pathname === '/api/evolution/canary/rollback') {
      const body = await this.readJsonBody(req);
      const reason =
        typeof body['reason'] === 'string' && body['reason'].trim().length > 0
          ? body['reason']
          : 'Manual operator rollback via Evolution Cockpit.';

      // Trigger immediate rollback by recording a synthetic policy violation alarm on CANARY
      const snapshot = await this.canaryController.recordOutcome({
        taskId: 'cockpit_emergency_rollback',
        servedBy: 'CANARY',
        success: false,
        costDollars: 0,
        latencyMs: 0,
        policyViolations: 1,
        safetyViolations: 1,
      });

      this.publishEvent({
        eventType: 'CANARY_EMERGENCY_ROLLBACK',
        payload: { reason, status: snapshot.status },
      });

      this.sendJson(res, 200, {
        rolledBack: snapshot.status === 'ROLLED_BACK_ALARM',
        reason,
        snapshot,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/evolution/ledger/verify') {
      this.sendJson(res, 200, {
        verification: this.ledger.verifyLedgerIntegrity(),
        entries: this.ledger.getEntries(),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/evolution/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(
        `event: CONNECTED\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`,
      );
      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    this.sendJson(res, 404, { error: `Unknown endpoint: ${method} ${pathname}` });
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    payload: unknown,
  ): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload));
  }

  private async readJsonBody(
    req: http.IncomingMessage,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(
        Buffer.concat(chunks).toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private renderCockpitHtml(): string {
    const canary = this.canaryController.getSnapshot();
    const ledger = this.ledger.verifyLedgerIntegrity();
    const leaderboard = this.ranker.getLeaderboard();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Vi-Harness Real-Time Recursive Evolution Cockpit & Canary Control Plane" />
  <title>Vi-Harness Evolution Cockpit</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: rgba(17, 24, 39, 0.85);
      --border: rgba(99, 102, 241, 0.28);
      --accent: #6366f1;
      --emerald: #10b981;
      --rose: #f43f5e;
      --text: #f3f4f6;
      --muted: #9ca3af;
    }
    body {
      margin: 0;
      padding: 2rem;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at top right, #1e1b4b, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
    }
    h1 { margin-top: 0; font-size: 1.8rem; letter-spacing: -0.02em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-top: 1.5rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.25rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.18);
      color: var(--emerald);
    }
    button#btn-emergency-rollback {
      background: linear-gradient(135deg, #e11d48, #be123c);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.55rem 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    button#btn-emergency-rollback:hover { transform: translateY(-1px); }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.88rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); }
  </style>
</head>
<body>
  <header>
    <h1>Vi-Harness Evolution Cockpit <span class="badge">${ledger.valid ? 'LEDGER VERIFIED' : 'LEDGER TAMPERED'}</span></h1>
    <p style="color: var(--muted)">Zero-Trust Recursive Evolution Plane • Live SSE Telemetry &amp; Canary CUSUM Control</p>
  </header>
  <main class="grid">
    <section class="card" id="canary-panel">
      <h2>Online Canary &amp; CUSUM</h2>
      <p>Status: <strong id="canary-status">${canary.status}</strong> (${canary.stagePercentage}% traffic)</p>
      <p>CUSUM Score: <code>${canary.cusumDegradationScore} / ${canary.cusumThresholdH}</code></p>
      <button id="btn-emergency-rollback" onclick="fetch('/api/evolution/canary/rollback', {method:'POST'}).then(()=>location.reload())">Emergency Rollback to H_stable</button>
    </section>
    <section class="card" id="ledger-panel">
      <h2>Cryptographic Provenance Ledger</h2>
      <p>Chain Integrity: <strong>${ledger.valid ? 'VALID' : 'BROKEN'}</strong></p>
      <p>Total Signed Entries: <strong>${ledger.totalEntries}</strong></p>
      <p>Head SHA-256: <code>${ledger.headHash.slice(0, 16)}...</code></p>
    </section>
    <section class="card" id="leaderboard-panel">
      <h2>Glicko-2 / Bradley-Terry Leaderboard</h2>
      <table>
        <thead><tr><th>Harness</th><th>Rating (&mu;)</th><th>LCB95</th></tr></thead>
        <tbody>
          ${leaderboard
            .slice(0, 5)
            .map(
              (r) =>
                `<tr><td><code>${r.manifestId}</code></td><td>${r.ratingMu.toFixed(1)}</td><td>${r.conservativeLowerBound.toFixed(1)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
  }
}
