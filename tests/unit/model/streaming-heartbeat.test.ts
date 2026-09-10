/**
 * Streaming Heartbeat & TTFT Watchdog Unit Tests.
 *
 * Verifies that:
 * 1. executeWithHeartbeatStream collects chunks and accumulates text and tool calls.
 * 2. Active chunk streaming extends execution without being cut off by hard timeouts.
 * 3. TTFT timeout aborts when no chunks arrive within ttftTimeoutMs.
 * 4. Inter-chunk heartbeat timeout aborts when stream stalls mid-generation.
 */
import { describe, it, expect } from 'vitest';
import { executeWithHeartbeatStream } from '../../../src/infra/model/provider-resilience.js';
import type { ModelProvider } from '../../../src/core/interfaces/model-provider.js';
import type { ModelRequest, ModelStreamChunk, ModelDescriptor, ModelHealth } from '../../../src/core/model/model-io.js';
import { ModelCapability, ProviderHealthStatus, FinishReason } from '../../../src/core/model/model-io.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';
import { ErrorCode } from '../../../src/core/errors/error-codes.js';

function createMockStreamingProvider(chunkGenerator: (req: ModelRequest) => AsyncIterable<ModelStreamChunk>): ModelProvider {
  const descriptor: ModelDescriptor = {
    id: 'mock-streaming',
    name: 'Mock Streaming Model',
    providerId: 'mock',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.STREAMING, ModelCapability.TOOL_USE]),
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.001,
    costPer1kOutputTokensDollars: 0.002,
  };

  return {
    providerId: 'mock',
    descriptor,
    complete: async () => {
      throw new Error('complete() should not be called when streaming');
    },
    stream: chunkGenerator,
    getHealth: async (): Promise<ModelHealth> => ({
      providerId: 'mock',
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: 1,
      lastChecked: new Date(),
    }),
  };
}

describe('Streaming Heartbeat & Watchdog Suite', () => {
  it('collects streaming chunks into a complete ModelResponse', async () => {
    const provider = createMockStreamingProvider(async function* () {
      yield { deltaText: 'Thinking about ' };
      yield { deltaText: 'the task...\n' };
      yield {
        deltaToolCall: {
          id: 'call_1',
          name: 'write_file',
          input: { path: 'solution.c' },
        },
      };
      yield { deltaText: 'Done!' };
    });

    const request: ModelRequest = {
      modelId: 'mock-streaming',
      messages: [{ role: 'user', content: 'Write solution' }],
    };

    const response = await executeWithHeartbeatStream(provider, request, {
      ttftTimeoutMs: 1000,
      chunkHeartbeatTimeoutMs: 500,
    });

    expect(response.content).toBe('Thinking about the task...\nDone!');
    expect(response.toolCalls.length).toBe(1);
    expect(response.toolCalls[0]!.name).toBe('write_file');
    expect(response.toolCalls[0]!.input).toEqual({ path: 'solution.c' });
    expect(response.finishReason).toBe(FinishReason.STOP);
  });

  it('keeps connection alive when chunks arrive within heartbeat window even if total time is long', async () => {
    const provider = createMockStreamingProvider(async function* () {
      // 5 chunks arriving every 30ms -> total duration 150ms
      // With heartbeat=60ms, a hard deadline of 80ms would have died, but heartbeat watchdog succeeds!
      for (let i = 1; i <= 5; i++) {
        await new Promise((r) => setTimeout(r, 30));
        yield { deltaText: `Token ${i} ` };
      }
    });

    const request: ModelRequest = {
      modelId: 'mock-streaming',
      messages: [{ role: 'user', content: 'Long reasoning' }],
    };

    const response = await executeWithHeartbeatStream(provider, request, {
      ttftTimeoutMs: 100,
      chunkHeartbeatTimeoutMs: 60,
    });

    expect(response.content).toBe('Token 1 Token 2 Token 3 Token 4 Token 5 ');
  });

  it('times out if first token does not arrive within ttftTimeoutMs', async () => {
    const provider = createMockStreamingProvider(async function* () {
      await new Promise((r) => setTimeout(r, 200));
      yield { deltaText: 'Too late' };
    });

    const request: ModelRequest = {
      modelId: 'mock-streaming',
      messages: [{ role: 'user', content: 'Fast response required' }],
    };

    await expect(
      executeWithHeartbeatStream(provider, request, {
        ttftTimeoutMs: 50,
        chunkHeartbeatTimeoutMs: 200,
      }),
    ).rejects.toThrowError(HarnessError);

    try {
      await executeWithHeartbeatStream(provider, request, {
        ttftTimeoutMs: 50,
        chunkHeartbeatTimeoutMs: 200,
      });
    } catch (err: any) {
      expect(err.code).toBe(ErrorCode.MODEL_TIMEOUT);
      expect(err.message).toContain('TTFT > 50ms');
    }
  });

  it('times out if stream stalls mid-generation exceeding chunkHeartbeatTimeoutMs', async () => {
    const provider = createMockStreamingProvider(async function* () {
      yield { deltaText: 'First token received promptly' };
      // Stall mid-stream for 150ms while heartbeat timeout is 50ms
      await new Promise((r) => setTimeout(r, 150));
      yield { deltaText: 'Second token after freeze' };
    });

    const request: ModelRequest = {
      modelId: 'mock-streaming',
      messages: [{ role: 'user', content: 'Unstable provider stream' }],
    };

    try {
      await executeWithHeartbeatStream(provider, request, {
        ttftTimeoutMs: 500,
        chunkHeartbeatTimeoutMs: 50,
      });
      expect.unreachable('Should have thrown MODEL_TIMEOUT');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HarnessError);
      expect(err.code).toBe(ErrorCode.MODEL_TIMEOUT);
      expect(err.message).toContain('Streaming heartbeat timed out after 50ms');
    }
  });
});
