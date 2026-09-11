/**
 * Native Anthropic Model Provider.
 *
 * Implements ModelProvider interface for Anthropic Messages API:
 * - Native Prompt Caching (`cache_control: { type: 'ephemeral' }`)
 * - Structured Tool Calls (`tool_use` / `tool_result`)
 * - Streaming SSE response parser with token metrics & tool call deltas
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
  CacheMetrics,
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
  readonly costPer1kCacheWriteTokensDollars?: number;
  readonly promptCaching?: boolean;
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
    input: z.union([z.record(z.unknown()), z.string()]),
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
  public readonly promptCaching: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModelId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly costPer1kCacheReadTokensDollars: number;
  private readonly costPer1kCacheWriteTokensDollars: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.providerId = options.providerId ?? 'anthropic-primary';
    this.baseUrl = (
      options.baseUrl ??
      process.env['ANTHROPIC_BASE_URL'] ??
      'https://api.anthropic.com/v1'
    ).replace(/\/+$/, '');
    this.apiKey =
      options.apiKey ??
      process.env['ANTHROPIC_API_KEY'] ??
      process.env['ANTHROPIC_AUTH_TOKEN'] ??
      '';
    this.defaultModelId = options.defaultModelId ?? 'claude-3-7-sonnet-20250219';
    this.fetchImpl = options.customFetch ?? globalThis.fetch;
    this.promptCaching = options.promptCaching ?? true;

    const costInput = options.costPer1kInputTokensDollars ?? 0.003;
    const costOutput = options.costPer1kOutputTokensDollars ?? 0.015;
    this.costPer1kCacheReadTokensDollars = options.costPer1kCacheReadTokensDollars ?? costInput * 0.1;
    this.costPer1kCacheWriteTokensDollars = options.costPer1kCacheWriteTokensDollars ?? costInput * 1.25;

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
      costPer1kInputTokensDollars: costInput,
      costPer1kOutputTokensDollars: costOutput,
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
        let inputObj: Record<string, unknown> = {};
        if (typeof block.input === 'string') {
          try {
            inputObj = JSON.parse(block.input);
          } catch {
            inputObj = { raw: block.input };
          }
        } else if (block.input && typeof block.input === 'object') {
          inputObj = block.input as Record<string, unknown>;
        }

        toolCalls.push({
          id: block.id,
          name: block.name,
          input: inputObj,
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
      cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
      cacheWriteTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
    };

    const cacheMetrics: CacheMetrics | undefined =
      cacheReadTokens > 0 || cacheCreationTokens > 0
        ? {
            cacheReadInputTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
            cacheCreationInputTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
          }
        : undefined;

    // Cost calculation accounting for caching discounts and creation overhead
    const uncachedInputTokens = Math.max(0, inputTokens - cacheReadTokens);
    const costDollars =
      (uncachedInputTokens / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (cacheReadTokens / 1000) * this.costPer1kCacheReadTokensDollars +
      (cacheCreationTokens / 1000) * this.costPer1kCacheWriteTokensDollars +
      (outputTokens / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    return {
      requestId: data.id ?? `req-${Date.now()}`,
      content: textContent,
      toolCalls,
      finishReason: this.mapStopReason(data.stop_reason),
      usage,
      latencyMs,
      estimatedCostDollars: costDollars,
      cacheMetrics,
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

    let activeToolCall: Partial<ToolCall> | undefined;
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let stopReason: FinishReason | undefined;

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

            if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens ?? 0;
              cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
              cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
            } else if (event.type === 'content_block_start') {
              if (event.content_block?.type === 'tool_use') {
                activeToolCall = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  input: {},
                };
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield {
                  deltaText: event.delta.text,
                };
              } else if (event.delta?.type === 'input_json_delta' && activeToolCall) {
                yield {
                  deltaToolCall: {
                    id: activeToolCall.id,
                    name: activeToolCall.name,
                  },
                };
              }
            } else if (event.type === 'content_block_stop') {
              activeToolCall = undefined;
            } else if (event.type === 'message_delta') {
              const outputTokens = event.usage?.output_tokens ?? 0;
              stopReason = this.mapStopReason(event.delta?.stop_reason);

              yield {
                finishReason: stopReason,
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                  cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
                  cacheWriteTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
                },
              };
            } else if (event.type === 'message_stop') {
              if (!stopReason) {
                yield {
                  finishReason: FinishReason.STOP,
                };
              }
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

    // 1. Collect system prompt and system messages
    if (request.systemPrompt) {
      systemBlocks.push({
        type: 'text',
        text: request.systemPrompt,
        ...(this.promptCaching ? { cache_control: { type: 'ephemeral' } } : {}),
      });
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];

    for (const msg of request.messages) {
      if (msg.role === MessageRole.SYSTEM) {
        const shouldCache =
          this.promptCaching &&
          (msg.metadata?.['segmentType'] === 'STATIC' ||
            msg.metadata?.['cacheControl'] !== undefined);

        systemBlocks.push({
          type: 'text',
          text: msg.content,
          ...(shouldCache ? { cache_control: { type: 'ephemeral' } } : {}),
        });
      } else if (msg.role === MessageRole.USER) {
        const shouldCache =
          this.promptCaching &&
          (msg.metadata?.['segmentType'] === 'STATIC' ||
            msg.metadata?.['cacheControl'] !== undefined);

        if (shouldCache) {
          messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: msg.content,
                cache_control: { type: 'ephemeral' },
              },
            ],
          });
        } else {
          messages.push({
            role: 'user',
            content: msg.content,
          });
        }
      } else if (msg.role === MessageRole.ASSISTANT) {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input ?? {},
            });
          }
          messages.push({ role: 'assistant', content: blocks });
        } else {
          messages.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      } else if (msg.role === MessageRole.TOOL_CALL) {
        const blocks: Array<Record<string, unknown>> = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        const calls =
          msg.toolCalls ??
          (msg.name ? [{ id: msg.toolCallId ?? 'call_1', name: msg.name, input: {} }] : []);
        for (const tc of calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input ?? {},
          });
        }
        messages.push({ role: 'assistant', content: blocks });
      } else if (msg.role === MessageRole.TOOL || msg.role === MessageRole.TOOL_RESULT) {
        const toolCallId =
          msg.toolResult?.toolCallId ??
          msg.toolCallId ??
          (msg.metadata?.['toolCallId'] as string) ??
          'call_unknown';
        const content = msg.toolResult?.output ?? msg.content ?? '';
        const isError = msg.toolResult?.isError ?? false;

        const toolResultBlock: Record<string, unknown> = {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content,
          is_error: isError,
        };

        // Coalesce consecutive tool results into a single user message block array
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Array<Record<string, unknown>>).push(toolResultBlock);
        } else {
          messages.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
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
      payload['tools'] = request.tools.map((t, index) => {
        const toolDef: Record<string, unknown> = {
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema ?? t.parameters ?? { type: 'object', properties: {} },
        };
        // Cache tool definitions at the last tool breakpoint when prompt caching is enabled
        if (this.promptCaching && index === request.tools!.length - 1) {
          toolDef['cache_control'] = { type: 'ephemeral' };
        }
        return toolDef;
      });
    }

    if (request.temperature !== undefined) {
      payload['temperature'] = request.temperature;
    }
    if (request.topP !== undefined) {
      payload['top_p'] = request.topP;
    }
    if (request.stopSequences && request.stopSequences.length > 0) {
      payload['stop_sequences'] = request.stopSequences;
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

    if (this.promptCaching) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }

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
      const errorText = await response.text().catch(() => '');
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          detail = parsed.error.message;
        }
      } catch {
        // use raw error text
      }
      this.handleHttpError(response.status, detail);
    }

    return response;
  }

  private handleHttpError(status: number, detail: string): never {
    const suffix = detail ? `: ${detail}` : '';
    if (status === 401 || status === 403) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `Anthropic authentication failed (HTTP ${status})${suffix}`,
      });
    }
    if (status === 429) {
      throw new HarnessError({
        code: ErrorCode.MODEL_RATE_LIMITED,
        category: ErrorCategory.MODEL,
        message: `Anthropic rate limit exceeded (HTTP 429)${suffix}`,
      });
    }
    if (status === 400) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: `Anthropic bad request (HTTP 400)${suffix}`,
      });
    }
    throw new HarnessError({
      code: ErrorCode.MODEL_UNAVAILABLE,
      category: ErrorCategory.MODEL,
      message: `Anthropic API error (HTTP ${status})${suffix}`,
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
