import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/infra/model/openai-compatible-provider.js';
import {
  MessageRole,
  FinishReason,
  ProviderHealthStatus,
  ModelCapability,
} from '../../../src/core/model/model-io.js';
import type { ModelRequest } from '../../../src/core/model/model-io.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../../src/core/errors/error-codes.js';

describe('OpenAICompatibleProvider Unit Suite', () => {
  const baseRequest: ModelRequest = {
    modelId: 'gpt-4o',
    systemPrompt: 'You are an expert coding assistant.',
    messages: [{ role: MessageRole.USER, content: 'Refactor calculateInvoice function' }],
    temperature: 0.1,
    topP: 0.9,
    maxTokens: 1000,
    stopSequences: ['<END>'],
  };

  it('1. Complete request: builds proper headers, payload and parses valid response', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-test-123',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Refactored code result',
                tool_calls: [
                  {
                    id: 'call_abc',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments:
                        '{"path":"src/invoice.ts","content":"export function calculateInvoice() {}"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 45,
            total_tokens: 165,
            completion_tokens_details: {
              reasoning_tokens: 10,
            },
          },
        }),
      };
    });

    const provider = new OpenAICompatibleProvider({
      providerId: 'openai-custom',
      baseUrl: 'https://api.custom-ai.com/v1',
      apiKey: 'secret-token-xyz',
      costPer1kInputTokensDollars: 0.005,
      costPer1kOutputTokensDollars: 0.015,
      customFetch: mockFetch as any,
    });

    const response = await provider.complete(baseRequest);

    expect(capturedUrl).toBe('https://api.custom-ai.com/v1/chat/completions');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-token-xyz');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(capturedInit?.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'You are an expert coding assistant.',
    });
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'Refactor calculateInvoice function',
    });
    expect(body.temperature).toBe(0.1);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(1000);
    expect(body.stop).toEqual(['<END>']);

    // Assertions on ModelResponse
    expect(response.providerId).toBe('openai-custom');
    expect(response.modelId).toBe('gpt-4o');
    expect(response.content).toBe('Refactored code result');
    expect(response.finishReason).toBe(FinishReason.TOOL_CALL);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]!.name).toBe('write_file');
    expect(response.toolCalls[0]!.input).toEqual({
      path: 'src/invoice.ts',
      content: 'export function calculateInvoice() {}',
    });
    expect(response.usage.inputTokens).toBe(120);
    expect(response.usage.outputTokens).toBe(45);
    expect(response.usage.totalTokens).toBe(165);
    expect(response.usage.reasoningTokens).toBe(10);
    expect(response.estimatedCostDollars).toBeCloseTo(
      (120 / 1000) * 0.005 + (45 / 1000) * 0.015,
      6,
    );
  });

  it('2. Streaming response: parses SSE lines, deltas, multiple chunks and handles data: [DONE]', async () => {
    const sseLines = [
      ': ping keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"World!"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_s1","function":{"name":"read_file","arguments":"{\\"path\\":\\"test.txt\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    const provider = new OpenAICompatibleProvider({
      customFetch: mockFetch as any,
    });

    const chunks: any[] = [];
    for await (const chunk of provider.stream(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].deltaText).toBe('Hello ');
    expect(chunks[1].deltaText).toBe('World!');
    expect(chunks[2].deltaToolCall?.name).toBe('read_file');
    expect(chunks[2].deltaToolCall?.input).toEqual({ path: 'test.txt' });
    expect(chunks[3].finishReason).toBe(FinishReason.STOP);
    expect(chunks[3].usage?.totalTokens).toBe(15);
  });

  it('3. Error Mapping: maps HTTP 429 to MODEL_RATE_LIMITED', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded. Quota exhausted.',
    });

    const provider = new OpenAICompatibleProvider({
      providerId: 'openai-ratelimit',
      customFetch: mockFetch as any,
    });

    try {
      await provider.complete(baseRequest);
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HarnessError);
      expect(err.code).toBe(ErrorCode.MODEL_RATE_LIMITED);
      expect(err.category).toBe(ErrorCategory.MODEL);
      expect(err.message).toContain('Rate limit exceeded');
    }
  });

  it('4. Error Mapping: maps HTTP 504 and 503 to MODEL_TIMEOUT and MODEL_UNAVAILABLE', async () => {
    const mockFetch504 = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => 'Gateway Timeout from upstream',
    });

    const provider504 = new OpenAICompatibleProvider({ customFetch: mockFetch504 as any });
    await expect(provider504.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_TIMEOUT,
    });

    const mockFetch503 = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Temporarily Unavailable',
    });

    const provider503 = new OpenAICompatibleProvider({ customFetch: mockFetch503 as any });
    await expect(provider503.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_UNAVAILABLE,
    });
  });

  it('5. Error Mapping: maps AbortError to MODEL_TIMEOUT and generic fetch error to MODEL_UNAVAILABLE', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const mockFetchAbort = vi.fn().mockRejectedValue(abortErr);
    const providerAbort = new OpenAICompatibleProvider({ customFetch: mockFetchAbort as any });

    await expect(providerAbort.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_TIMEOUT,
    });

    const networkErr = new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:8000');
    const mockFetchNetwork = vi.fn().mockRejectedValue(networkErr);
    const providerNetwork = new OpenAICompatibleProvider({ customFetch: mockFetchNetwork as any });

    await expect(providerNetwork.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_UNAVAILABLE,
    });
  });

  it('6. Malformed JSON & schema error: throws MODEL_MALFORMED_OUTPUT on invalid structure or tool arguments', async () => {
    // Missing choices array
    const mockFetchInvalid = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'bad-response', choices: [] }),
    });

    const providerInvalid = new OpenAICompatibleProvider({ customFetch: mockFetchInvalid as any });
    await expect(providerInvalid.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_MALFORMED_OUTPUT,
    });

    // Invalid JSON inside tool call function arguments string
    const mockFetchBadJson = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'bad-args',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c1',
                  function: {
                    name: 'test_tool',
                    arguments: '{ broken json syntax ...',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const providerBadJson = new OpenAICompatibleProvider({ customFetch: mockFetchBadJson as any });
    await expect(providerBadJson.complete(baseRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_MALFORMED_OUTPUT,
    });
  });

  it('7. Health Checks: checks /models endpoint and reports HEALTHY, DEGRADED or UNHEALTHY', async () => {
    // Healthy
    const mockFetchOk = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const providerOk = new OpenAICompatibleProvider({ customFetch: mockFetchOk as any });
    const healthOk = await providerOk.getHealth();
    expect(healthOk.status).toBe(ProviderHealthStatus.HEALTHY);

    // Degraded (!ok)
    const mockFetchDegraded = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const providerDegraded = new OpenAICompatibleProvider({
      customFetch: mockFetchDegraded as any,
    });
    const healthDegraded = await providerDegraded.getHealth();
    expect(healthDegraded.status).toBe(ProviderHealthStatus.DEGRADED);
    expect(healthDegraded.errorMessage).toBe('HTTP 500');

    // Unhealthy (catch error)
    const mockFetchFail = vi.fn().mockRejectedValue(new Error('DNS lookup failed'));
    const providerFail = new OpenAICompatibleProvider({ customFetch: mockFetchFail as any });
    const healthFail = await providerFail.getHealth();
    expect(healthFail.status).toBe(ProviderHealthStatus.UNHEALTHY);
    expect(healthFail.errorMessage).toContain('DNS lookup failed');
  });
});
