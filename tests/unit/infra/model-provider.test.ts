import { describe, it, expect, vi } from 'vitest';
import { MockModelProvider, OpenAICompatibleProvider } from '../../../src/infra/index.js';
import type { ModelProvider } from '../../../src/core/interfaces/model-provider.js';
import {
  MessageRole,
  FinishReason,
  ProviderHealthStatus,
} from '../../../src/core/model/model-io.js';
import type { ModelRequest } from '../../../src/core/model/model-io.js';

describe('ModelProvider Abstraction & Substitution', () => {
  const sampleRequest: ModelRequest = {
    modelId: 'test-model',
    systemPrompt: 'You are a helpful coding assistant.',
    messages: [{ role: MessageRole.USER, content: 'Write a hello world function' }],
    temperature: 0.2,
    maxTokens: 500,
  };

  it('should support provider substitution — running same request against Provider A and Provider B', async () => {
    const providerA: ModelProvider = new MockModelProvider({
      providerId: 'provider-frontier-a',
      defaultResponseText: 'function helloWorld() { return "hello"; }',
    });

    const providerB: ModelProvider = new MockModelProvider({
      providerId: 'provider-local-b',
      defaultResponseText: 'function helloWorld() { return "hello from local"; }',
    });

    // Execute against Provider A
    const responseA = await providerA.complete(sampleRequest);
    expect(responseA.providerId).toBe('provider-frontier-a');
    expect(responseA.content).toContain('hello');
    expect(responseA.finishReason).toBe(FinishReason.STOP);
    expect(responseA.usage.inputTokens).toBeGreaterThan(0);

    // Execute same request against Provider B
    const responseB = await providerB.complete(sampleRequest);
    expect(responseB.providerId).toBe('provider-local-b');
    expect(responseB.content).toContain('hello from local');
    expect(responseB.finishReason).toBe(FinishReason.STOP);
    expect(responseB.usage.inputTokens).toBeGreaterThan(0);
  });

  it('should support streaming via AsyncIterable across providers', async () => {
    const provider: ModelProvider = new MockModelProvider({
      defaultResponseText: 'stream chunk test',
    });

    const chunks: string[] = [];
    for await (const chunk of provider.stream(sampleRequest)) {
      if (chunk.deltaText) {
        chunks.push(chunk.deltaText);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('stream chunk test');
  });

  it('should return vendor-neutral tool calls and structured outputs', async () => {
    const provider: ModelProvider = new MockModelProvider({
      defaultToolCalls: [
        {
          id: 'call_123',
          name: 'read_file',
          input: { path: 'src/main.ts' },
        },
      ],
      defaultStructuredOutput: { status: 'OK', count: 1 },
    });

    const response = await provider.complete(sampleRequest);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]!.name).toBe('read_file');
    expect(response.toolCalls[0]!.input).toEqual({ path: 'src/main.ts' });
    expect(response.structuredOutput).toEqual({ status: 'OK', count: 1 });
  });

  it('OpenAICompatibleProvider should parse HTTP response into vendor-neutral ModelResponse', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-999',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"result": "success"}',
              tool_calls: [
                {
                  id: 'call_xyz',
                  function: {
                    name: 'execute_command',
                    arguments: '{"cmd": "npm test"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
      }),
    });

    const openAiProvider: ModelProvider = new OpenAICompatibleProvider({
      providerId: 'openai-adapter',
      apiKey: 'test-sk',
      customFetch: mockFetch as any,
    });

    const req: ModelRequest = {
      messages: [{ role: MessageRole.USER, content: 'Run test' }],
      structuredOutputSchema: {
        name: 'test_result',
        schema: { type: 'object' },
      },
    };

    const response = await openAiProvider.complete(req);

    expect(response.providerId).toBe('openai-adapter');
    expect(response.modelId).toBe('gpt-4o');
    expect(response.finishReason).toBe(FinishReason.TOOL_CALL);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]!.name).toBe('execute_command');
    expect(response.toolCalls[0]!.input).toEqual({ cmd: 'npm test' });
    expect(response.structuredOutput).toEqual({ result: 'success' });
    expect(response.usage.totalTokens).toBe(40);

    // Verify raw vendor fetch arguments
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-sk');
  });

  it('should support health checks', async () => {
    const provider: ModelProvider = new MockModelProvider({
      healthStatus: ProviderHealthStatus.HEALTHY,
    });

    const health = await provider.getHealth();
    expect(health.status).toBe(ProviderHealthStatus.HEALTHY);
    expect(health.providerId).toBe(provider.providerId);
  });
});
