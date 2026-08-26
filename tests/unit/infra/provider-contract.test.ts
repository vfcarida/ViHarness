import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/infra/model/openai-compatible-provider.js';
import { executeResiliently } from '../../../src/infra/model/provider-resilience.js';
import { MessageRole, FinishReason, ErrorCode } from '../../../src/core/index.js';
import type { ModelRequest } from '../../../src/core/index.js';

describe('Model Provider Contract & Resilience Suite', () => {
  const sampleRequest: ModelRequest = {
    modelId: 'gpt-4o',
    systemPrompt: 'You are an autonomous enterprise coding assistant.',
    messages: [{ role: MessageRole.USER, content: 'Read package.json file.' }],
    tools: [
      {
        name: 'read_file',
        description: 'Read file content',
        category: 'READ' as any,
        riskLevel: 'LOW' as any,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ],
  };

  it('1. Valid Tool Call: Parses structured tool call response correctly', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-valid-123',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'package.json' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });
    const response = await provider.complete(sampleRequest);

    expect(response.requestId).toBe('chatcmpl-valid-123');
    expect(response.finishReason).toBe(FinishReason.TOOL_CALL);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]?.id).toBe('call_abc123');
    expect(response.toolCalls[0]?.name).toBe('read_file');
    expect(response.toolCalls[0]?.input).toEqual({ path: 'package.json' });
  });

  it('2. Malformed Tool Call: Throws MODEL_MALFORMED_OUTPUT on invalid arguments JSON', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-malformed-123',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{ invalid_json_syntax: ',
                  },
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });

    await expect(provider.complete(sampleRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_MALFORMED_OUTPUT,
    });
  });

  it('3. Text Response: Handles plain reasoning response without tool calls', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-text-123',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'I will analyze the repository structure.',
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }),
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });
    const response = await provider.complete(sampleRequest);

    expect(response.finishReason).toBe(FinishReason.STOP);
    expect(response.content).toBe('I will analyze the repository structure.');
    expect(response.toolCalls).toHaveLength(0);
  });

  it('4. Multiple Tool Calls: Parses batch parallel tool calls', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-multi-123',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_1',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'src/index.ts' }),
                  },
                },
                {
                  id: 'call_2',
                  function: { name: 'list_directory', arguments: JSON.stringify({ path: 'src' }) },
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });
    const response = await provider.complete(sampleRequest);

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls[0]?.name).toBe('read_file');
    expect(response.toolCalls[1]?.name).toBe('list_directory');
  });

  it('5. Provider Timeout: Returns MODEL_TIMEOUT error on gateway 504 / timeout', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      text: async () => 'Gateway Timeout',
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });

    await expect(provider.complete(sampleRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_TIMEOUT,
    });
  });

  it('6. Rate Limit Handling: Throws MODEL_RATE_LIMITED on HTTP 429', async () => {
    const customFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    } as Response);

    const provider = new OpenAICompatibleProvider({ customFetch });

    await expect(provider.complete(sampleRequest)).rejects.toMatchObject({
      code: ErrorCode.MODEL_RATE_LIMITED,
    });
  });

  it('7. Provider Failure & Fallback: Retries or fails over cleanly', async () => {
    const primaryFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as Response);

    const fallbackFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-fallback-ok',
        choices: [
          { finish_reason: 'stop', message: { role: 'assistant', content: 'Fallback Success' } },
        ],
      }),
    } as Response);

    const primaryProvider = new OpenAICompatibleProvider({
      providerId: 'primary',
      customFetch: primaryFetch,
    });
    const fallbackProvider = new OpenAICompatibleProvider({
      providerId: 'fallback',
      customFetch: fallbackFetch,
    });

    const response = await executeResiliently(primaryProvider, sampleRequest, {
      maxRetries: 1,
      initialBackoffMs: 1,
      fallbacks: [fallbackProvider],
    });

    expect(response.providerId).toBe('fallback');
    expect(response.content).toBe('Fallback Success');
  });
});
