import { describe, it, expect, vi } from 'vitest';
import { runBasicAgent } from '../../../examples/basic-agent/index.js';
import { runCustomToolExample } from '../../../examples/custom-tool/index.js';
import { runSweBenchHarnessExample } from '../../../examples/swe-bench-harness/index.js';
import { runOpenAiAgent } from '../../../examples/openai-agent/index.js';

describe('Example Suite Verification — Track 6', () => {
  it('1. basic-agent: executes end-to-end without throwing', async () => {
    await expect(runBasicAgent()).resolves.not.toThrow();
  });

  it('2. custom-tool: defines custom word_count tool and executes via scripted provider', async () => {
    await expect(runCustomToolExample()).resolves.not.toThrow();
  });

  it('3. swe-bench-harness: drives judge-in-the-loop repair loop to AC verdict', async () => {
    const outcome = await runSweBenchHarnessExample();
    expect(outcome.success).toBe(true);
    expect(outcome.finalVerdict).toBe('AC');
    expect(outcome.totalAttempts).toBe(1);
  });

  it('4. openai-agent: throws descriptive error when no API key is provided', async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(runOpenAiAgent({ apiKey: '' })).rejects.toThrow(
        /OPENAI_API_KEY environment variable is required/,
      );
    } finally {
      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      }
    }
  });

  it('5. openai-agent: completes execution with mocked fetch and simulated OpenAI responses', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'chatcmpl-mock-1',
            object: 'chat.completion',
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'I will write the sumArray function to target.ts',
                  tool_calls: [
                    {
                      id: 'call_write',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({
                          path: 'target.ts',
                          content: '/** Sums an array of numbers. */\nexport function sumArray(numbers: number[]): number {\n  return numbers.reduce((a, b) => a + b, 0);\n}\n',
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'chatcmpl-mock-2',
          object: 'chat.completion',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Task complete. sumArray function implemented with JSDoc in target.ts.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 },
        }),
      };
    });

    await expect(
      runOpenAiAgent({
        apiKey: 'test-api-key-mock',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        customFetch: mockFetch as unknown as typeof fetch,
      }),
    ).resolves.not.toThrow();
  });
});
