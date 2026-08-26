import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../../src/infra/model/openai-compatible-provider.js';
import { MessageRole } from '../../src/core/model/model-io.js';

describe('Live Model Provider Integration Suite', () => {
  const isLiveEnabled =
    process.env.LIVE_PROVIDER_TESTS === 'true' && Boolean(process.env.OPENAI_API_KEY);

  it('verifies provider configuration contract in non-live mode', () => {
    const provider = new OpenAICompatibleProvider({
      providerId: 'openai-live',
      apiKey: process.env.OPENAI_API_KEY || 'sk-dummy-key-for-contract-check',
      defaultModelId: 'gpt-4o-mini',
    });

    expect(provider.providerId).toBe('openai-live');
    expect(provider.descriptor.id).toBe('gpt-4o-mini');
  });

  (isLiveEnabled ? it : it.skip)('executes real live generation with OpenAI API', async () => {
    const provider = new OpenAICompatibleProvider({
      providerId: 'openai-live',
      apiKey: process.env.OPENAI_API_KEY!,
      defaultModelId: process.env.TEST_MODEL_ID || 'gpt-4o-mini',
    });

    const response = await provider.complete({
      modelId: process.env.TEST_MODEL_ID || 'gpt-4o-mini',
      systemPrompt: 'You are a test assistant. Respond in 5 words or less.',
      messages: [{ role: MessageRole.USER, content: 'Ping' }],
      temperature: 0,
      maxTokens: 20,
    });

    expect(response).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });
});
