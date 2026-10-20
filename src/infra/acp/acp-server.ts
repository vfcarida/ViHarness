// Pattern: Agent Client Protocol (ACP) (ref: DeepSeek Harness)
/**
 * Agent Client Protocol (ACP) Automation Server.
 *
 * Exposes Vi-Harness agent execution and session lifecycles as a dedicated JSON-RPC 2.0
 * server for CI pipelines, automation scripts, and multi-agent coordination.
 *
 * Reference: DeepSeek Harness — Agent Client Protocol (ACP)
 */
import type { McpJsonRpcRequest, McpJsonRpcResponse } from '../mcp/mcp-types.js';
import type { Transport } from '../mcp/transports/types.js';
import { AcpHandlers, type AcpHandlerOptions } from './acp-handlers.js';

export class AcpServer {
  public readonly serverName = 'vi-harness-acp-server';
  public readonly serverVersion = '1.0.0';
  private readonly handlers: AcpHandlers;
  private readonly activeTransports = new Set<Transport>();

  constructor(options: AcpHandlerOptions) {
    this.handlers = new AcpHandlers(options);
  }

  /**
   * Handle an incoming ACP JSON-RPC 2.0 request.
   */
  async handleRequest(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
    if (!request || request.jsonrpc !== '2.0' || request.id === undefined) {
      return {
        jsonrpc: '2.0',
        id: request?.id ?? 0,
        error: { code: -32600, message: 'Invalid Request: Missing jsonrpc 2.0 or id' },
      };
    }

    try {
      switch (request.method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocol: 'ACP',
              version: this.serverVersion,
              serverInfo: { name: this.serverName, version: this.serverVersion },
              capabilities: {
                sessionManagement: true,
                headlessExecution: true,
                eventHistory: true,
                idleSynchronization: true,
                evolutionPlane: true,
              },
            },
          };
        }

        case 'session/new': {
          const result = await this.handlers.handleNewSession(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        case 'session/send': {
          const result = await this.handlers.handleSendMessage(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        case 'session/status': {
          const result = await this.handlers.handleSessionStatus(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        case 'session/cancel': {
          const result = await this.handlers.handleCancelSession(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        case 'session/history': {
          const result = await this.handlers.handleSessionHistory(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        case 'agent/idle': {
          const result = await this.handlers.handleAgentIdle(request.params as any);
          return { jsonrpc: '2.0', id: request.id, result };
        }

        default: {
          if (this.handlers.evolutionDispatcher.canHandle(request.method)) {
            const result = await this.handlers.evolutionDispatcher.dispatch(
              request.method,
              request.params,
            );
            return { jsonrpc: '2.0', id: request.id, result };
          }
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: `ACP Method not found: ${request.method}` },
          };
        }
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: `ACP Internal Error: ${err?.message ?? String(err)}` },
      };
    }
  }

  /**
   * Bind the ACP server to a transport (stdio or HTTP).
   */
  async listen(transport: Transport, config?: Record<string, unknown>): Promise<void> {
    transport.onMessage(async (req) => {
      return this.handleRequest(req);
    });

    if (!transport.isRunning) {
      await transport.start(config);
    }
    this.activeTransports.add(transport);
  }

  /**
   * Stop all active transports.
   */
  async close(): Promise<void> {
    for (const transport of this.activeTransports) {
      try {
        await transport.stop();
      } catch {
        // Ignore stop error
      }
    }
    this.activeTransports.clear();
  }
}
