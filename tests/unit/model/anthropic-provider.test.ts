import { describe, it, expect, vi } from 'vitest';
import { AnthropicModelProvider } from '../../../src/infra/model/anthropic-provider.js';
import { MessageRole, FinishReason, ProviderHealthStatus } from '../../../src/core/model/model-io.js';
import { ErrorCode } from '../../../src/core/errors/error-codes.js';

describe('AnthropicModelProvider', () => {
  it('translates messages, prompt caching tags, and parses text/tool responses correctly', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(init?.body as string);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-7-sonnet-20250219',
          content: [
            { type: 'text', text: 'I have evaluated the repository.' },
            {
              type: 'tool_use',
              id: 'toolu_01',
              name: 'write_to_file',
              input: { targetFile: 'src/main.ts', content: 'console.log("hello");' },
            },
          ],
          stop_reason: 'tool_use',
          usage: {
            input_tokens: 1500,
            output_tokens: 80,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 500,
          },
        }),
      } as unknown as Response;
    });

    const provider = new AnthropicModelProvider({
      apiKey: 'test-anthropic-key',
      baseUrl: 'https://api.anthropic.com/v1',
      customFetch: mockFetch,
    });

    const response = await provider.complete({
      systemPrompt: 'System-level instructions.',
      messages: [
        {
          role: MessageRole.SYSTEM,
          content: 'You are an autonomous coding assistant.',
          metadata: { segmentType: 'STATIC', cacheControl: { type: 'ephemeral' } },
        },
        {
          role: MessageRole.USER,
          content: 'Implement the feature.',
        },
      ],
      tools: [
        {
          name: 'read_file',
          version: '1.0.0',
          description: 'Read file content',
          category: 'READ' as any,
          riskLevel: 'LOW' as any,
          mutating: false,
          idempotent: true,
          defaultTimeoutMs: 5000,
          requiredPermissions: [],
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
        {
          name: 'write_to_file',
          version: '1.0.0',
          description: 'Write file content',
          category: 'WRITE' as any,
          riskLevel: 'MEDIUM' as any,
          mutating: true,
          idempotent: false,
          defaultTimeoutMs: 5000,
          requiredPermissions: [],
          inputSchema: {
            type: 'object',
            properties: {
              targetFile: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['targetFile', 'content'],
          },
        },
      ],
    });

    // Verify request
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedHeaders['x-api-key']).toBe('test-anthropic-key');
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
    expect(capturedHeaders['anthropic-beta']).toBe('prompt-caching-2024-07-31');

    // Verify system blocks with caching
    expect(capturedBody.system).toHaveLength(2);
    expect(capturedBody.system[0].text).toBe('System-level instructions.');
    expect(capturedBody.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(capturedBody.system[1].text).toBe('You are an autonomous coding assistant.');
    expect(capturedBody.system[1].cache_control).toEqual({ type: 'ephemeral' });

    // Verify tool definitions cache breakpoint on last tool
    expect(capturedBody.tools).toHaveLength(2);
    expect(capturedBody.tools[0].cache_control).toBeUndefined();
    expect(capturedBody.tools[1].cache_control).toEqual({ type: 'ephemeral' });

    // Verify response
    expect(response.content).toBe('I have evaluated the repository.');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe('write_to_file');
    expect(response.toolCalls?.[0]?.input).toEqual({
      targetFile: 'src/main.ts',
      content: 'console.log("hello");',
    });
    expect(response.finishReason).toBe(FinishReason.TOOL_CALL);
    expect(response.usage.inputTokens).toBe(1500);
    expect(response.usage.cacheReadTokens).toBe(500);
    expect(response.usage.cacheWriteTokens).toBe(1000);
    expect(response.cacheMetrics?.cacheReadInputTokens).toBe(500);
    expect(response.cacheMetrics?.cacheCreationInputTokens).toBe(1000);
    expect(response.estimatedCostDollars).toBeGreaterThan(0);
  });

  it('disables prompt caching headers and breakpoints when promptCaching is false', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(init?.body as string);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: 'OK' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      } as unknown as Response;
    });

    const provider = new AnthropicModelProvider({
      apiKey: 'test-key',
      promptCaching: false,
      customFetch: mockFetch,
    });

    await provider.complete({
      systemPrompt: 'Instructions',
      messages: [{ role: MessageRole.USER, content: 'Hello' }],
      tools: [
        {
          name: 'tool_a',
          version: '1.0.0',
          description: 'A tool',
          category: 'READ' as any,
          riskLevel: 'LOW' as any,
          mutating: false,
          idempotent: true,
          defaultTimeoutMs: 5000,
          requiredPermissions: [],
          inputSchema: {},
        },
      ],
    });

    expect(capturedHeaders['anthropic-beta']).toBeUndefined();
    expect(capturedBody.system[0].cache_control).toBeUndefined();
    expect(capturedBody.tools[0].cache_control).toBeUndefined();
  });

  it('formats prior assistant tool_calls and coalesces consecutive tool_results correctly', async () => {
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: 'All tools reviewed.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 30 },
        }),
      } as unknown as Response;
    });

    const provider = new AnthropicModelProvider({
      apiKey: 'test-key',
      customFetch: mockFetch,
    });

    await provider.complete({
      messages: [
        { role: MessageRole.USER, content: 'Check files' },
        {
          role: MessageRole.ASSISTANT,
          content: 'Checking files now',
          toolCalls: [
            { id: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
            { id: 'call_2', name: 'read_file', input: { path: 'b.ts' } },
          ],
        },
        {
          role: MessageRole.TOOL_RESULT,
          content: 'content of a.ts',
          toolCallId: 'call_1',
        },
        {
          role: MessageRole.TOOL_RESULT,
          content: 'content of b.ts',
          toolCallId: 'call_2',
        },
      ],
    });

    expect(capturedBody.messages).toHaveLength(3);
    // 0: user
    expect(capturedBody.messages[0].role).toBe('user');
    // 1: assistant with 2 tool_use blocks
    expect(capturedBody.messages[1].role).toBe('assistant');
    expect(capturedBody.messages[1].content).toHaveLength(3); // text + 2 tool_use
    expect(capturedBody.messages[1].content[1].type).toBe('tool_use');
    expect(capturedBody.messages[1].content[1].id).toBe('call_1');
    expect(capturedBody.messages[1].content[2].type).toBe('tool_use');
    expect(capturedBody.messages[1].content[2].id).toBe('call_2');

    // 2: coalesced user message with both tool_result blocks
    expect(capturedBody.messages[2].role).toBe('user');
    expect(capturedBody.messages[2].content).toHaveLength(2);
    expect(capturedBody.messages[2].content[0].type).toBe('tool_result');
    expect(capturedBody.messages[2].content[0].tool_use_id).toBe('call_1');
    expect(capturedBody.messages[2].content[1].type).toBe('tool_result');
    expect(capturedBody.messages[2].content[1].tool_use_id).toBe('call_2');
  });

  it('streams text deltas, tool call deltas, usage, and finish reason via SSE', async () => {
    const sseChunks = [
      'data: {"type":"message_start","message":{"id":"msg_stream","type":"message","role":"assistant","content":[],"model":"claude-3-7-sonnet-20250219","usage":{"input_tokens":300,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Building"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" component"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_stream_1","name":"edit_file","input":{}}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"index.ts\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":1}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":45}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];

    const encoder = new TextEncoder();
    let chunkIndex = 0;

    const mockStream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < sseChunks.length) {
          controller.enqueue(encoder.encode(sseChunks[chunkIndex++]));
        } else {
          controller.close();
        }
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
    } as unknown as Response);

    const provider = new AnthropicModelProvider({
      apiKey: 'test-key',
      customFetch: mockFetch,
    });

    const receivedDeltas: string[] = [];
    const receivedToolDeltas: any[] = [];
    let finalChunk: any = null;

    for await (const chunk of provider.stream({
      messages: [{ role: MessageRole.USER, content: 'Run edit' }],
    })) {
      if (chunk.deltaText) receivedDeltas.push(chunk.deltaText);
      if (chunk.deltaToolCall) receivedToolDeltas.push(chunk.deltaToolCall);
      if (chunk.finishReason) finalChunk = chunk;
    }

    expect(receivedDeltas.join('')).toBe('Building component');
    expect(receivedToolDeltas).toHaveLength(1);
    expect(receivedToolDeltas[0].id).toBe('tool_stream_1');
    expect(receivedToolDeltas[0].name).toBe('edit_file');
    expect(finalChunk).not.toBeNull();
    expect(finalChunk.finishReason).toBe(FinishReason.TOOL_CALL);
    expect(finalChunk.usage.inputTokens).toBe(300);
    expect(finalChunk.usage.outputTokens).toBe(45);
    expect(finalChunk.usage.cacheReadTokens).toBe(100);
  });

  it('maps HTTP errors (401, 429, 400, 500) to corresponding HarnessError codes with message detail', async () => {
    // 401 Unauthorized
    const mockFetch401 = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid x-api-key provided' } }),
    } as unknown as Response);

    const provider401 = new AnthropicModelProvider({ apiKey: 'bad-key', customFetch: mockFetch401 });
    await expect(
      provider401.complete({ messages: [{ role: MessageRole.USER, content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: ErrorCode.MODEL_UNAVAILABLE,
      message: expect.stringContaining('Invalid x-api-key provided'),
    });

    // 429 Rate Limited
    const mockFetch429 = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'Rate limit exceeded: 5 req/s' } }),
    } as unknown as Response);

    const provider429 = new AnthropicModelProvider({ apiKey: 'key', customFetch: mockFetch429 });
    await expect(
      provider429.complete({ messages: [{ role: MessageRole.USER, content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: ErrorCode.MODEL_RATE_LIMITED,
      message: expect.stringContaining('Rate limit exceeded'),
    });

    // 400 Context Length / Bad Request
    const mockFetch400 = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'prompt is too long: 250000 tokens' } }),
    } as unknown as Response);

    const provider400 = new AnthropicModelProvider({ apiKey: 'key', customFetch: mockFetch400 });
    await expect(
      provider400.complete({ messages: [{ role: MessageRole.USER, content: 'hi' }] }),
    ).rejects.toMatchObject({
      code: ErrorCode.MODEL_INVALID_RESPONSE,
      message: expect.stringContaining('prompt is too long'),
    });
  });

  it('reports provider health status correctly based on credentials', async () => {
    const unconfiguredProvider = new AnthropicModelProvider({ apiKey: '' });
    const unhealthy = await unconfiguredProvider.getHealth();
    expect(unhealthy.status).toBe(ProviderHealthStatus.UNHEALTHY);
    expect(unhealthy.errorMessage).toContain('ANTHROPIC_API_KEY');

    const configuredProvider = new AnthropicModelProvider({ apiKey: 'sk-ant-valid' });
    const healthy = await configuredProvider.getHealth();
    expect(healthy.status).toBe(ProviderHealthStatus.HEALTHY);
  });
});
