/**
 * API Fault Simulation Suite
 *
 * Simulates real-world API behaviors using SimulatedFaultModelProvider:
 * 1. Rate Limit (HTTP 429) & Exponential Retry.
 * 2. Service Unavailable (HTTP 503) & Server Error Recovery.
 * 3. Network Timeouts & Abort handling.
 * 4. ModelRouter Automatic Fallback from Unhealthy Primary to Healthy Secondary.
 * 5. Streaming token & tool call delta delivery.
 */
import { describe, it, expect } from 'vitest';
import {
  SimulatedFaultModelProvider,
  UtilityModelRouter,
  executeResiliently,
  UuidV7IdFactory,
  TestClock,
  DefaultContextCompiler,
  DefaultEvidenceStore,
  DefaultToolRegistry,
  DefaultToolExecutor,
} from '../../../src/infra/index.js';
import {
  ErrorCode,
  HarnessError,
  MessageRole,
  FinishReason,
  ProviderHealthStatus,
  type ModelRequest,
  type Goal,
  GoalStatus,
} from '../../../src/core/index.js';
import { DefaultAgentRuntime } from '../../../src/runtime/default-agent-runtime.js';

describe('API Fault Simulation Suite', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  describe('1. Rate Limit (HTTP 429) Simulation & Retry', () => {
    it('should retry on transient HTTP 429 RateLimit and succeed on next attempt', async () => {
      const provider = new SimulatedFaultModelProvider({
        providerId: 'rate-limited-api',
        faultType: 'RATE_LIMIT',
        failCount: 1, // fails 1st attempt with 429, then recovers
        steps: [{ content: 'Recovered response after 429 retry', finishReason: FinishReason.STOP }],
      });

      const request: ModelRequest = {
        messages: [{ role: MessageRole.USER, content: 'Hello model' }],
      };

      const response = await executeResiliently(provider, request, {
        maxRetries: 2,
        initialBackoffMs: 10,
        maxBackoffMs: 50,
      });

      expect(response.content).toBe('Recovered response after 429 retry');
      expect(provider.getAttemptCount()).toBe(2);
      expect(response.retryMetadata?.attemptCount).toBe(2);
    });

    it('should throw MODEL_RATE_LIMITED when retries are exhausted', async () => {
      const provider = new SimulatedFaultModelProvider({
        providerId: 'permanent-rate-limited-api',
        faultType: 'RATE_LIMIT',
        failCount: 5,
      });

      const request: ModelRequest = {
        messages: [{ role: MessageRole.USER, content: 'Hello model' }],
      };

      await expect(
        executeResiliently(provider, request, {
          maxRetries: 2,
          initialBackoffMs: 5,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.MODEL_RATE_LIMITED,
      });
    });
  });

  describe('2. Service Unavailable (HTTP 503) & Timeout (504) Simulation', () => {
    it('should recover from transient HTTP 503 Service Unavailable via retry', async () => {
      const provider = new SimulatedFaultModelProvider({
        providerId: 'overloaded-api',
        faultType: 'SERVICE_UNAVAILABLE',
        failCount: 1,
        steps: [{ content: 'Server recovered after load spike', finishReason: FinishReason.STOP }],
      });

      const request: ModelRequest = {
        messages: [{ role: MessageRole.USER, content: 'Task query' }],
      };

      const response = await executeResiliently(provider, request, {
        maxRetries: 2,
        initialBackoffMs: 5,
      });

      expect(response.content).toBe('Server recovered after load spike');
      expect(provider.getAttemptCount()).toBe(2);
    });

    it('should report DEGRADED health status when encountering rate limits or timeouts', async () => {
      const provider = new SimulatedFaultModelProvider({
        faultType: 'TIMEOUT',
      });

      const health = await provider.getHealth();
      expect(health.status).toBe(ProviderHealthStatus.DEGRADED);
    });
  });

  describe('3. ModelRouter Failover to Secondary Provider', () => {
    it('should route to healthy secondary provider when primary provider is unhealthy', async () => {
      const primaryUnhealthy = new SimulatedFaultModelProvider({
        providerId: 'primary-down',
        modelId: 'primary-model',
        faultType: 'SERVICE_UNAVAILABLE',
        failCount: 10,
      });

      const secondaryHealthy = new SimulatedFaultModelProvider({
        providerId: 'secondary-backup',
        modelId: 'secondary-model',
        faultType: 'NONE',
        steps: [
          { content: 'Fallback secondary provider response', finishReason: FinishReason.STOP },
        ],
      });

      const router = new UtilityModelRouter();
      router.registerProvider(primaryUnhealthy);
      router.registerProvider(secondaryHealthy);

      // Mark primary as unhealthy in health registry
      router.healthRegistry.recordHealth({
        providerId: 'primary-down',
        status: ProviderHealthStatus.UNHEALTHY,
        lastChecked: new Date(),
        errorMessage: '503 Service Unavailable',
      });

      // Route task
      const decision = await router.route({
        id: idFactory.create<'Task'>(),
        goalId: idFactory.create<'Goal'>(),
        description: 'Critical code refactor task',
        type: 'coding' as any,
        category: 'CODING' as any,
        dependencies: [],
        requiredCapabilities: [],
        status: 'PENDING' as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Verify routing selected a valid provider and executes
      const response = await decision.selectedProvider.complete({
        messages: [{ role: MessageRole.USER, content: 'Code refactor' }],
      });

      expect(response).toBeDefined();
    });
  });

  describe('4. Streaming Token & Tool Call Chunks', () => {
    it('should stream text chunks and tool call deltas correctly', async () => {
      const provider = new SimulatedFaultModelProvider({
        providerId: 'stream-provider',
        faultType: 'NONE',
        steps: [
          {
            content: 'Generating code solution step by step',
            toolCalls: [{ id: 'call_stream_1', name: 'read_file', input: { path: 'index.ts' } }],
            finishReason: FinishReason.TOOL_CALL,
          },
        ],
      });

      const request: ModelRequest = {
        messages: [{ role: MessageRole.USER, content: 'Stream code' }],
      };

      const chunks: string[] = [];
      let toolCallEmitted = false;

      for await (const chunk of provider.stream(request)) {
        if (chunk.deltaText) {
          chunks.push(chunk.deltaText);
        }
        if (chunk.deltaToolCall) {
          toolCallEmitted = true;
          expect(chunk.deltaToolCall.name).toBe('read_file');
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(toolCallEmitted).toBe(true);
    });
  });
});
