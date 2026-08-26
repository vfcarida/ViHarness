/**
 * Native Anthropic Model Provider.
 *
 * Implements ModelProvider interface for Anthropic Messages API:
 * - Native Prompt Caching (`cache_control: { type: 'ephemeral' }`)
 * - Structured Tool Calls (`tool_use` / `tool_result`)
 * - Streaming SSE response parser
 * - Zero vendor SDK dependencies (uses standard Node.js `fetch`)
 */
import { z } from 'zod';
import type { ModelProvider } from '../../core/interfaces/model-provider.js';
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ModelDescriptor,
  ModelHealth,
  ToolCall,
  TokenUsage,
} from '../../core/model/model-io.js';
import {
  MessageRole,
  FinishReason,
  ModelCapability,
  ProviderHealthStatus,
} from '../../core/model/model-io.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export interface AnthropicProviderOptions {
  readonly providerId?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly defaultModelId?: string;
  readonly customFetch?: typeof fetch;
  readonly costPer1kInputTokensDollars?: number;
  readonly costPer1kOutputTokensDollars?: number;
  readonly costPer1kCacheReadTokensDollars?: number;
}

const AnthropicContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
  }),
]);

const AnthropicResponseSchema = z.object({
  id: z.string().optional(),
  type: z.literal('message').optional(),
  role: z.literal('assistant').optional(),
  model: z.string().optional(),
  content: z.array(AnthropicContentBlockSchema),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .optional(),
});

export class AnthropicModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicProviderOptions = {}) {
    this.providerId = options.providerId ?? 'anthropic-primary';
    this.baseUrl = (
      options.baseUrl ??
      process.env['ANTHROPIC_BASE_URL'] ??
      'https://api.anthropic.com/v1'
    ).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.defaultModelId = options.defaultModelId ?? 'claude-3-7-sonnet-20250219';
    this.fetchImpl = options.customFetch ?? globalThis.fetch;

    this.descriptor = {
      id: this.defaultModelId,
      name: 'Claude 3.7 Sonnet',
      providerId: this.providerId,
      version: '20250219',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STREAMING,
          ModelCapability.LONG_CONTEXT,
        ]),
        maxContextTokens: 200000,
        maxOutputTokens: 8192,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: options.costPer1kInputTokensDollars ?? 0.003,
      costPer1kOutputTokensDollars: options.costPer1kOutputTokensDollars ?? 0.015,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const modelId = request.modelId ?? this.defaultModelId;
    const body = this.buildRequestBody(request, modelId, false);
    const startMs = Date.now();

    const response = await this.executeRequest('/messages', body, request.signal);
    const latencyMs = Date.now() - startMs;

    let parsedJson: unknown;
    try {
      parsedJson = await response.json();
    } catch {
      throw new HarnessError({
        code: ErrorCode.MODEL_MALFORMED_OUTPUT,
        category: ErrorCategory.MODEL,
        message: 'Anthropic API returned invalid JSON',
        context: { status: response.status },
      });
    }

    const parseResult = AnthropicResponseSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: `Invalid Anthropic response: ${parseResult.error.message}`,
        context: { errors: parseResult.error.errors },
      });
    }

    const data = parseResult.data;
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const cacheReadTokens = data.usage?.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = data.usage?.cache_creation_input_tokens ?? 0;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheReadTokens,
      cacheWriteTokens: cacheCreationTokens,
    };

    const costDollars =
      (inputTokens / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (outputTokens / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    return {
      requestId: data.id ?? `req-${Date.now()}`,
      content: textContent,
      toolCalls,
      finishReason: this.mapStopReason(data.stop_reason),
      usage,
      latencyMs,
      estimatedCostDollars: costDollars,
      modelId,
      providerId: this.providerId,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const modelId = request.modelId ?? this.defaultModelId;
    const body = this.buildRequestBody(request, modelId, true);

    const response = await this.executeRequest('/messages', body, request.signal);
    if (!response.body) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: 'Anthropic streaming response body is null',
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') return;

          try {
            const event = JSON.parse(dataStr);
            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield {
                  deltaText: event.delta.text,
                };
              }
            } else if (event.type === 'message_stop') {
              yield {
                finishReason: FinishReason.STOP,
              };
            }
          } catch {
            // Ignore partial SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getHealth(): Promise<ModelHealth> {
    if (!this.apiKey) {
      return {
        providerId: this.providerId,
        status: ProviderHealthStatus.UNHEALTHY,
        latencyMs: 0,
        lastChecked: new Date(),
        errorMessage: 'Missing ANTHROPIC_API_KEY',
      };
    }

    return {
      providerId: this.providerId,
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: 15,
      lastChecked: new Date(),
    };
  }

  private buildRequestBody(
    request: ModelRequest,
    modelId: string,
    stream: boolean,
  ): Record<string, unknown> {
    const systemBlocks: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }> = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of request.messages) {
      if (msg.role === MessageRole.SYSTEM) {
        const isStatic =
          msg.metadata?.['segmentType'] === 'STATIC' ||
          msg.metadata?.['cacheControl'] !== undefined;
        systemBlocks.push({
          type: 'text',
          text: msg.content,
          ...(isStatic ? { cache_control: { type: 'ephemeral' } } : {}),
        });
      } else if (msg.role === MessageRole.USER) {
        messages.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === MessageRole.ASSISTANT) {
        messages.push({
          role: 'assistant',
          content: msg.content,
        });
      } else if (msg.role === MessageRole.TOOL || msg.role === MessageRole.TOOL_RESULT) {
        const toolCallId =
          msg.toolCallId ?? (msg.metadata?.['toolCallId'] as string) ?? 'tool-result';
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolCallId,
              content: msg.content,
            },
          ],
        });
      }
    }

    const payload: Record<string, unknown> = {
      model: modelId,
      max_tokens: request.maxTokens ?? 4096,
      stream,
      messages,
    };

    if (systemBlocks.length > 0) {
      payload['system'] = systemBlocks;
    }

    if (request.tools && request.tools.length > 0) {
      payload['tools'] = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters ?? { type: 'object', properties: {} },
      }));
    }

    if (request.temperature !== undefined) {
      payload['temperature'] = request.temperature;
    }

    return payload;
  }

  private async executeRequest(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `Failed to connect to Anthropic API: ${err instanceof Error ? err.message : String(err)}`,
        cause: err instanceof Error ? err : undefined,
      });
    }

    if (!response.ok) {
      this.handleHttpError(response.status);
    }

    return response;
  }

  private handleHttpError(status: number): never {
    if (status === 401 || status === 403) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `Anthropic authentication failed (HTTP ${status})`,
      });
    }
    if (status === 429) {
      throw new HarnessError({
        code: ErrorCode.MODEL_RATE_LIMITED,
        category: ErrorCategory.MODEL,
        message: 'Anthropic rate limit exceeded (HTTP 429)',
      });
    }
    if (status === 400) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: 'Anthropic bad request / context length exceeded (HTTP 400)',
      });
    }
    throw new HarnessError({
      code: ErrorCode.MODEL_UNAVAILABLE,
      category: ErrorCategory.MODEL,
      message: `Anthropic API error (HTTP ${status})`,
    });
  }

  private mapStopReason(stopReason?: string | null): FinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return FinishReason.STOP;
      case 'tool_use':
        return FinishReason.TOOL_CALL;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      default:
        return FinishReason.STOP;
    }
  }
}
