/**
 * Agent Client Protocol (ACP) Server Unit Tests (P012).
 */
import { describe, it, expect } from 'vitest';
import { AcpServer } from '../../../src/infra/acp/acp-server.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';
import { DefaultToolRegistry } from '../../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../../src/infra/tools/default-tool-executor.js';
import { DefaultContextCompiler } from '../../../src/infra/compiler/default-context-compiler.js';
import { ScriptedModelProvider } from '../../../src/infra/model/scripted-model-provider.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import { FinishReason, ProviderHealthStatus, type ModelRouter } from '../../../src/core/index.js';

describe('Agent Client Protocol (ACP) Server — P012', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const createTestAcpServer = () => {
    const provider = new ScriptedModelProvider({
      providerId: 'acp-test-provider',
      steps: [
        {
          content: 'I have completed the task successfully.',
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
        rationale: 'ACP Test Route',
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

    return new AcpServer({ runtime, idFactory, clock });
  };

  it('1. should respond to initialize handshake with ACP capabilities', async () => {
    const server = createTestAcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });

    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect((res.result as any)?.protocol).toBe('ACP');
    expect((res.result as any)?.capabilities?.headlessExecution).toBe(true);
  });

  it('2. should create new session with session/new', async () => {
    const server = createTestAcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { goalDescription: 'Test task' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any)?.sessionId).toBeDefined();
  });

  it('3. should execute agent turn and record message with session/send', async () => {
    const server = createTestAcpServer();

    // 1. Create session
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/new',
    });
    const sessionId = (newSessionRes.result as any).sessionId;

    // 2. Send message
    const sendRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/send',
      params: { sessionId, message: 'Perform automated check' },
    });

    expect(sendRes.error).toBeUndefined();
    expect((sendRes.result as any)?.success).toBe(true);
    expect((sendRes.result as any)?.messageId).toBeDefined();
  });

  it('4. should retrieve session status with session/status', async () => {
    const server = createTestAcpServer();
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/new',
    });
    const sessionId = (newSessionRes.result as any).sessionId;

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'session/send',
      params: { sessionId, message: 'Do work' },
    });

    const statusRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/status',
      params: { sessionId },
    });

    expect((statusRes.result as any)?.status).toBe('COMPLETED');
    expect((statusRes.result as any)?.iterationCount).toBe(1);
  });

  it('5. should cancel active session with session/cancel', async () => {
    const server = createTestAcpServer();
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'session/new',
    });
    const sessionId = (newSessionRes.result as any).sessionId;

    const cancelRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'session/cancel',
      params: { sessionId, reason: 'Abort test' },
    });

    expect((cancelRes.result as any)?.cancelled).toBe(true);

    const statusRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'session/status',
      params: { sessionId },
    });
    expect((statusRes.result as any)?.status).toBe('CANCELLED');
  });

  it('6. should retrieve event history with session/history', async () => {
    const server = createTestAcpServer();
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'session/new',
    });
    const sessionId = (newSessionRes.result as any).sessionId;

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 12,
      method: 'session/send',
      params: { sessionId, message: 'Message 1' },
    });

    const historyRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 13,
      method: 'session/history',
      params: { sessionId },
    });

    expect((historyRes.result as any)?.events.length).toBeGreaterThanOrEqual(2);
  });

  it('7. should resolve agent/idle when session is completed or idle', async () => {
    const server = createTestAcpServer();
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 14,
      method: 'session/new',
    });
    const sessionId = (newSessionRes.result as any).sessionId;

    const idleRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 15,
      method: 'agent/idle',
      params: { sessionId, timeoutMs: 1000 },
    });

    expect((idleRes.result as any)?.idle).toBe(true);
  });

  it('8. should return error on missing jsonrpc 2.0 version or id', async () => {
    const server = createTestAcpServer();
    const res = await server.handleRequest({ method: 'initialize' } as any);
    expect(res.error?.code).toBe(-32600);
  });

  it('9. should return method not found error on unknown ACP method', async () => {
    const server = createTestAcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 99,
      method: 'unknown/method',
    });
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toContain('ACP Method not found');
  });

  it('10. should return error when sending message to non-existent session', async () => {
    const server = createTestAcpServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 100,
      method: 'session/send',
      params: { sessionId: 'invalid-id-xyz', message: 'Hello' },
    });
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain('Session not found');
  });

  it('11. should support pre-configured initial goal during session/new', async () => {
    const server = createTestAcpServer();
    const newSessionRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 101,
      method: 'session/new',
      params: { goalDescription: 'Build high-performance router' },
    });

    const sessionId = (newSessionRes.result as any).sessionId;
    const sendRes = await server.handleRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'session/send',
      params: { sessionId, message: 'Proceed' },
    });

    expect((sendRes.result as any)?.success).toBe(true);
  });
});
