/**
 * Model Context Protocol (MCP) Server & Client Adapter Unit Tests.
 *
 * Verifies JSON-RPC 2.0 initialization, tool discovery, tool invocation,
 * resource reading, and proxy execution through Vi-Harness ToolRegistry.
 */
import { describe, it, expect } from 'vitest';
import {
  McpServer,
  McpClientAdapter,
  DefaultToolRegistry,
  ReadFileTool,
  WriteFileTool,
  UuidV7IdFactory,
} from '../../../src/infra/index.js';
import type {
  McpTransport,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
} from '../../../src/infra/index.js';

describe('Model Context Protocol (MCP) Server & Client', () => {
  const idFactory = new UuidV7IdFactory();

  it('McpServer exposes registered tools, initializes protocol, and executes tool calls', async () => {
    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    const server = new McpServer({
      serverName: 'test-mcp-server',
      serverVersion: '1.0.0',
      toolRegistry: registry,
    });

    // 1. Initialize
    const initRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(initRes.result).toBeDefined();
    expect((initRes.result as any).serverInfo.name).toBe('test-mcp-server');

    // 2. Tools List
    const listRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect(listRes.result).toBeDefined();
    const tools = (listRes.result as any).tools;
    expect(tools).toHaveLength(2);
    expect(tools.map((t: any) => t.name)).toContain('read_file');
    expect(tools.map((t: any) => t.name)).toContain('write_file');

    // 3. Resources List & Read
    const resList = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    });
    expect((resList.result as any).resources).toHaveLength(1);

    const resRead = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'vi-harness://context/active' },
    });
    expect((resRead.result as any).contents[0].text).toContain('READY');
  });

  it('McpClientAdapter connects to an external MCP server, proxies tools, and executes them seamlessly', async () => {
    // Simulated remote server
    const remoteRegistry = new DefaultToolRegistry();
    remoteRegistry.register({
      definition: {
        name: 'query_db',
        version: '1.0.0',
        description: 'Query database',
        category: 'READ' as any,
        riskLevel: 'LOW' as any,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 10000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
      },
      async execute(input: any, context: any) {
        return {
          toolCallId: context.correlationId,
          name: 'query_db',
          output: `Result for SQL: ${input['sql']}`,
          success: true,
          durationMs: 10,
        };
      },
    });

    const remoteServer = new McpServer({
      serverName: 'remote-postgres',
      toolRegistry: remoteRegistry,
    });

    // In-memory loopback transport
    const transport: McpTransport = {
      async send(req: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
        return serverHandleRequest(req);
      },
    };

    function serverHandleRequest(req: McpJsonRpcRequest) {
      return remoteServer.handleRequest(req);
    }

    const localRegistry = new DefaultToolRegistry();
    const client = new McpClientAdapter({
      serverName: 'postgres',
      transport,
      toolRegistry: localRegistry,
      idFactory,
    });

    // Sync tools from remote MCP
    const syncedTools = await client.syncTools();
    expect(syncedTools).toContain('mcp_postgres_query_db');
    expect(Boolean(localRegistry.getTool('mcp_postgres_query_db'))).toBe(true);

    // Execute proxied tool
    const tool = localRegistry.getTool('mcp_postgres_query_db')!;
    const output = await tool.execute(
      { sql: 'SELECT * FROM users;' },
      { correlationId: 'test_call' },
    );
    expect(output.output).toContain('Result for SQL: SELECT * FROM users;');
    expect(output.success).toBe(true);
  });
});
