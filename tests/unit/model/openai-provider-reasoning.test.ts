import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../../../src/infra/model/openai-compatible-provider.js';
import type { ModelRequest } from '../../../src/core/model/model-io.js';
import { MessageRole } from '../../../src/core/model/model-io.js';

describe('OpenAI-Compatible Provider Routing & Reasoning Effort Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. Environment Routing: Picks up OPENROUTER_BASE_URL and OPENROUTER_API_KEY by default', () => {
    process.env['OPENROUTER_BASE_URL'] = 'https://openrouter.ai/api/v1';
    process.env['OPENROUTER_API_KEY'] = 'sk-or-v1-mock-key';
    process.env['OPENAI_MODEL'] = 'openrouter/tencent/hy3';

    const provider = new OpenAICompatibleProvider();
    expect((provider as any).baseUrl).toBe('https://openrouter.ai/api/v1');
    expect((provider as any).apiKey).toBe('sk-or-v1-mock-key');
    expect(provider.descriptor.id).toBe('openrouter/tencent/hy3');
  });

  it('2. Fallback Routing: Falls back to OPENAI_BASE_URL and OPENAI_API_KEY when OpenRouter is unset', () => {
    delete process.env['OPENROUTER_BASE_URL'];
    delete process.env['OPENROUTER_API_KEY'];
    process.env['OPENAI_BASE_URL'] = 'http://localhost:8000/v1';
    process.env['OPENAI_API_KEY'] = 'sk-openai-mock-key';

    const provider = new OpenAICompatibleProvider();
    expect((provider as any).baseUrl).toBe('http://localhost:8000/v1');
    expect((provider as any).apiKey).toBe('sk-openai-mock-key');
  });

  it('3. Reasoning Effort: Serializes reasoning_effort and reasoning: { effort } into request payload', async () => {
    let capturedPayload: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'openrouter/tencent/hy3',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Result with reasoning' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      };
    });

    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-mock',
      customFetch: mockFetch as any,
    });

    const request: ModelRequest = {
      modelId: 'openrouter/tencent/hy3',
      messages: [{ role: MessageRole.USER, content: 'Solve problem 001' }],
      reasoningEffort: 'high',
    };

    const response = await provider.complete(request);

    expect(response.content).toBe('Result with reasoning');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.reasoning_effort).toBe('high');
    expect(capturedPayload.reasoning).toEqual({ effort: 'high' });
  });

  it('4. Reasoning Effort Unset: Does not inject reasoning fields when reasoningEffort is undefined', async () => {
    let capturedPayload: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-test2',
          choices: [{ message: { role: 'assistant', content: 'Plain response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      };
    });

    const provider = new OpenAICompatibleProvider({ customFetch: mockFetch as any });
    const request: ModelRequest = {
      modelId: 'gpt-4o',
      messages: [{ role: MessageRole.USER, content: 'Hello' }],
    };

    await provider.complete(request);

    expect(capturedPayload.reasoning_effort).toBeUndefined();
    expect(capturedPayload.reasoning).toBeUndefined();
  });
});
