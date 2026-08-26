/**
 * MCP & ACP Transports End-to-End Integration Suite (P012).
 *
 * Validates:
 * 1. Full MCP Server execution over Stdio transport (tools/list, tools/call).
 * 2. Full MCP Server execution over HTTP/SSE transport (POST /rpc, GET /sse push notifications).
 * 3. Full ACP Automation Server driving agent session over HTTP transport.
 */
import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PassThrough } from 'node:stream';
import {
  McpServer,
  AcpServer,
  StdioTransport,
  HttpTransport,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultContextCompiler,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
  type Tool,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/index.js';
import {
  ToolCategory,
  ToolRiskLevel,
  FinishReason,
  ProviderHealthStatus,
  type ModelRouter,
} from '../../src/core/index.js';

describe('MCP & ACP Transports End-to-End Integration — P012', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  it('1. should execute tools/list and tools/call over StdioTransport', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-stdio-e2e-'));
    const targetFile = path.join(tempDir, 'output.txt');

    const customTool: Tool = {
      definition: {
        name: 'write_custom',
        version: '1.0.0',
        description: 'Write text to file',
        category: ToolCategory.FILESYSTEM,
        riskLevel: ToolRiskLevel.LOW,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      },
      execute: async (input) => {
        fs.writeFileSync(String(input['path']), String(input['content']), 'utf-8');
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_custom',
          output: 'File written successfully',
          success: true,
          durationMs: 5,
        };
      },
    };

    const toolRegistry = new DefaultToolRegistry();
    toolRegistry.register(customTool);

    const mcpServer = new McpServer({
      serverName: 'test-mcp-stdio',
      toolRegistry,
    });

    const clientIn = new PassThrough(); // Server inStream
    const clientOut = new PassThrough(); // Server outStream

    const stdioTransport = new StdioTransport({ inStream: clientIn, outStream: clientOut });
    await mcpServer.listen(stdioTransport);

    const serverResponses: string[] = [];
    clientOut.on('data', (c) => serverResponses.push(c.toString()));

    // 1. Send tools/list
    clientIn.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    await new Promise((r) => setTimeout(r, 20));

    const listRes = JSON.parse(serverResponses[0]!);
    expect(listRes.result.tools).toHaveLength(1);
    expect(listRes.result.tools[0].name).toBe('write_custom');

    // 2. Send tools/call
    clientIn.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'write_custom',
          arguments: { path: targetFile, content: 'E2E_STDIO_TEST' },
        },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 20));

    const callRes = JSON.parse(serverResponses[1]!);
    expect(callRes.result.isError).toBe(false);
    expect(callRes.result.content[0].text).toContain('File written successfully');

    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('E2E_STDIO_TEST');

    await mcpServer.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. should execute tools/call over HTTP /rpc and stream notifications via /sse', async () => {
    const toolRegistry = new DefaultToolRegistry();
    const echoTool: Tool = {
      definition: {
        name: 'echo_service',
        version: '1.0.0',
        description: 'Echo message',
        category: ToolCategory.GENERAL,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      },
      execute: async (input) => ({
        toolCallId: idFactory.create<'ToolCall'>(),
        name: 'echo_service',
        output: `ECHO: ${input['msg']}`,
        success: true,
        durationMs: 2,
      }),
    };
    toolRegistry.register(echoTool);

    const mcpServer = new McpServer({ serverName: 'test-mcp-http', toolRegistry });
    const httpTransport = new HttpTransport({ port: 0 });
    await mcpServer.listen(httpTransport);
    const port = httpTransport.boundPort!;

    // 1. Connect SSE client
    const sseMessages: string[] = [];
    const sseReq = http.request(
      { hostname: '127.0.0.1', port, path: '/sse', method: 'GET' },
      (res) => {
        res.on('data', (c) => sseMessages.push(c.toString()));
      },
    );
    sseReq.end();
    await new Promise((r) => setTimeout(r, 50));

    // 2. Call tool via POST /rpc
    const rpcRes = await new Promise<{ statusCode: number; body: string }>((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/rpc',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ statusCode: res.statusCode!, body: b }));
        },
      );
      req.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name: 'echo_service', arguments: { msg: 'Hello MCP HTTP' } },
        }),
      );
      req.end();
    });

    expect(rpcRes.statusCode).toBe(200);
    const parsed = JSON.parse(rpcRes.body);
    expect(parsed.result.content[0].text).toBe('ECHO: Hello MCP HTTP');

    // 3. Broadcast notification
    await mcpServer.broadcastNotification('custom/event', { data: 'notified' });

    const startNotif = Date.now();
    while (!sseMessages.join('').includes('custom/event') && Date.now() - startNotif < 1000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(sseMessages.join('')).toContain('custom/event');
    expect(sseMessages.join('')).toContain('notified');

    sseReq.destroy();
    await mcpServer.close();
  });

  it('3. should run full ACP automation session over HTTP transport', async () => {
    const provider = new ScriptedModelProvider({
      providerId: 'acp-e2e-provider',
      steps: [
        {
          content: 'I have finished the automated workflow.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'gpt-4o',
        scores: [],
        rationale: 'ACP E2E Route',
        decidedAt: clock.now(),
        deterministic: true,
      }),
      listAvailableModels: () => [],
      getProviderHealth: () => ProviderHealthStatus.HEALTHY,
      updateMetrics: () => {},
      hasCapability: () => true,
    };

    const toolRegistry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const acpServer = new AcpServer({ runtime, idFactory, clock });
    const httpTransport = new HttpTransport({ port: 0 });
    await acpServer.listen(httpTransport);
    const port = httpTransport.boundPort!;

    const postAcp = async (
      method: string,
      params?: Record<string, unknown>,
      id = 1,
    ): Promise<any> => {
      return new Promise((resolve) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/rpc',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => resolve(JSON.parse(b)));
          },
        );
        req.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        req.end();
      });
    };

    // 1. session/new
    const newSession = await postAcp('session/new', { goalDescription: 'ACP CI Job' }, 1);
    const sessionId = newSession.result.sessionId;
    expect(sessionId).toBeDefined();

    // 2. session/send
    const sendResult = await postAcp(
      'session/send',
      { sessionId, message: 'Run regression tests' },
      2,
    );
    expect(sendResult.result.success).toBe(true);

    // 3. session/status
    const statusResult = await postAcp('session/status', { sessionId }, 3);
    expect(statusResult.result.status).toBe('COMPLETED');
    expect(statusResult.result.iterationCount).toBe(1);

    // 4. session/history
    const historyResult = await postAcp('session/history', { sessionId }, 4);
    expect(historyResult.result.events.length).toBeGreaterThanOrEqual(2);

    await acpServer.close();
  });
});
