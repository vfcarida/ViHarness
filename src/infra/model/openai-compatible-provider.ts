/**
 * OpenAI-Compatible Provider Adapter.
 *
 * Generic HTTP provider adapter compatible with:
 * - OpenAI
 * - vLLM
 * - Ollama (via openai endpoint)
 * - DeepSeek
 * - Groq
 * - Anyscale / Together
 * - LocalAI / LM Studio
 *
 * Uses standard Node `fetch` with NO vendor SDK dependencies.
 * Translates between vendor-neutral types and the OpenAI chat/completions HTTP schema.
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
import { FinishReason, ModelCapability, ProviderHealthStatus } from '../../core/model/model-io.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import { ProviderMessageAdapter } from './provider-message-adapter.js';

export interface OpenAICompatibleProviderOptions {
  readonly providerId?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly defaultModelId?: string;
  readonly customFetch?: typeof fetch;
  readonly costPer1kInputTokensDollars?: number;
  readonly costPer1kOutputTokensDollars?: number;
}

// Zod Schemas for Response Validation
const OpenAIToolCallFunctionSchema = z.object({
  name: z.string({ required_error: 'Tool call missing function name' }),
  arguments: z.union([z.string(), z.record(z.unknown())]).optional(),
});

const OpenAIToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  function: OpenAIToolCallFunctionSchema,
});

const OpenAIChoiceSchema = z.object({
  index: z.number().optional(),
  message: z.object({
    role: z.string().optional(),
    content: z.string().nullable().optional(),
    tool_calls: z.array(OpenAIToolCallSchema).optional(),
  }),
  finish_reason: z.string().nullable().optional(),
});

const OpenAIResponseSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(OpenAIChoiceSchema).min(1, 'Response contained no choices'),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().optional(),
          cache_read_tokens: z.number().optional(),
        })
        .passthrough()
        .optional(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number().optional(),
        })
        .passthrough()
        .optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_deleted_input_tokens: z.number().optional(),
      prompt_cache_hit_tokens: z.number().optional(),
      prompt_cache_miss_tokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.providerId = options.providerId ?? 'openai-compatible';
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    this.apiKey = options.apiKey ?? 'dummy-key';
    this.defaultModelId = options.defaultModelId ?? 'gpt-4o';
    this.fetchImpl = options.customFetch ?? globalThis.fetch;

    this.descriptor = {
      id: this.defaultModelId,
      name: `OpenAI-Compatible (${this.defaultModelId})`,
      providerId: this.providerId,
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
          ModelCapability.VISION,
          ModelCapability.LONG_CONTEXT,
          ModelCapability.STREAMING,
          ModelCapability.PARALLEL_TOOL_CALLS,
        ]),
        maxContextTokens: 128000,
        maxOutputTokens: 16384,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: options.costPer1kInputTokensDollars ?? 0.0025,
      costPer1kOutputTokensDollars: options.costPer1kOutputTokensDollars ?? 0.01,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const startTime = Date.now();
    const payload = this.buildPayload(request, false);

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (err) {
      throw mapFetchError(err, this.providerId);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw mapHttpStatusToError(response.status, errorText, this.providerId);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    return this.parseResponse(data, request, latencyMs);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const payload = this.buildPayload(request, true);

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch (err) {
      throw mapFetchError(err, this.providerId);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw mapHttpStatusToError(response.status, errorText, this.providerId);
    }

    if (!response.body) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: `[${this.providerId}] Response body is null during stream`,
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
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') return;

          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const chunkData = JSON.parse(jsonStr);
              const chunk = parseStreamChunk(chunkData);
              if (chunk) yield chunk;
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getHealth(): Promise<ModelHealth> {
    const start = Date.now();
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });
      const latencyMs = Date.now() - start;

      return {
        providerId: this.providerId,
        status: res.ok ? ProviderHealthStatus.HEALTHY : ProviderHealthStatus.DEGRADED,
        latencyMs,
        lastChecked: new Date(),
        errorMessage: !res.ok ? `HTTP ${res.status}` : undefined,
      };
    } catch (err) {
      return {
        providerId: this.providerId,
        status: ProviderHealthStatus.UNHEALTHY,
        lastChecked: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private buildPayload(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const messages = ProviderMessageAdapter.toOpenAIMessages(request);

    const payload: Record<string, unknown> = {
      model: request.modelId ?? this.defaultModelId,
      messages,
      stream,
    };

    if (request.temperature !== undefined) payload['temperature'] = request.temperature;
    if (request.topP !== undefined) payload['top_p'] = request.topP;
    if (request.maxTokens !== undefined) payload['max_tokens'] = request.maxTokens;
    if (request.stopSequences && request.stopSequences.length > 0) {
      payload['stop'] = request.stopSequences;
    }

    if (request.tools && request.tools.length > 0) {
      payload['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    if (request.structuredOutputSchema) {
      payload['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: request.structuredOutputSchema.name,
          schema: request.structuredOutputSchema.schema,
          strict: request.structuredOutputSchema.strict ?? true,
        },
      };
    }

    return payload;
  }

  private parseResponse(data: unknown, request: ModelRequest, latencyMs: number): ModelResponse {
    const validation = OpenAIResponseSchema.safeParse(data);
    if (!validation.success) {
      throw new HarnessError({
        code: ErrorCode.MODEL_MALFORMED_OUTPUT,
        category: ErrorCategory.MODEL,
        message: `[${this.providerId}] Malformed model response structure: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        context: { errors: validation.error.issues },
      });
    }

    const responseData = validation.data;
    const choice = responseData.choices[0]!;
    const message = choice.message;
    const content = message.content ?? '';

    // Tool calls validation
    const toolCalls: ToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown> = {};
        if (typeof tc.function.arguments === 'string') {
          try {
            args = JSON.parse(tc.function.arguments);
          } catch (err) {
            throw new HarnessError({
              code: ErrorCode.MODEL_MALFORMED_OUTPUT,
              category: ErrorCategory.MODEL,
              message: `[${this.providerId}] Malformed tool call arguments JSON for tool [${tc.function.name}]: ${err instanceof Error ? err.message : String(err)}`,
              context: { rawArguments: tc.function.arguments },
            });
          }
        } else if (typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
          args = tc.function.arguments as Record<string, unknown>;
        }

        toolCalls.push({
          id: tc.id ?? `call_${Math.random().toString(36).substring(2, 7)}`,
          name: tc.function.name,
          input: args,
        });
      }
    }

    // Structured Output
    let structuredOutput: Record<string, unknown> | undefined;
    if (request.structuredOutputSchema && content) {
      try {
        structuredOutput = JSON.parse(content);
      } catch {
        // Leave undefined if parse fails
      }
    }

    // Usage & Cache Metrics
    const usageObj = (responseData.usage ?? {}) as Record<string, any>;
    const promptDetails = usageObj['prompt_tokens_details'] ?? {};
    const cacheReadInputTokens =
      promptDetails.cached_tokens ??
      promptDetails.cache_read_tokens ??
      usageObj['cache_read_input_tokens'] ??
      usageObj['prompt_cache_hit_tokens'];

    const cacheCreationInputTokens =
      usageObj['cache_creation_input_tokens'] ?? usageObj['prompt_cache_miss_tokens'];

    const cacheDeletedInputTokens = usageObj['cache_deleted_input_tokens'];

    const hasCacheData =
      cacheReadInputTokens !== undefined ||
      cacheCreationInputTokens !== undefined ||
      cacheDeletedInputTokens !== undefined;

    const cacheMetrics: import('../../core/model/model-io.js').CacheMetrics | undefined =
      hasCacheData
        ? {
            cacheReadInputTokens:
              typeof cacheReadInputTokens === 'number' ? cacheReadInputTokens : undefined,
            cacheCreationInputTokens:
              typeof cacheCreationInputTokens === 'number' ? cacheCreationInputTokens : undefined,
            cacheDeletedInputTokens:
              typeof cacheDeletedInputTokens === 'number' ? cacheDeletedInputTokens : undefined,
          }
        : undefined;

    const usage: TokenUsage = {
      inputTokens: usageObj.prompt_tokens ?? 0,
      outputTokens: usageObj.completion_tokens ?? 0,
      totalTokens:
        usageObj.total_tokens ?? (usageObj.prompt_tokens ?? 0) + (usageObj.completion_tokens ?? 0),
      reasoningTokens: usageObj.completion_tokens_details?.reasoning_tokens,
      cacheReadTokens: typeof cacheReadInputTokens === 'number' ? cacheReadInputTokens : undefined,
      cacheWriteTokens:
        typeof cacheCreationInputTokens === 'number' ? cacheCreationInputTokens : undefined,
    };

    const cost =
      (usage.inputTokens / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (usage.outputTokens / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    const finishReason = mapFinishReason(choice.finish_reason ?? undefined);

    return {
      requestId: responseData.id ?? `req_${Date.now()}`,
      modelId: responseData.model ?? request.modelId ?? this.defaultModelId,
      providerId: this.providerId,
      content,
      structuredOutput,
      toolCalls,
      usage,
      finishReason,
      latencyMs,
      estimatedCostDollars: cost,
      cacheMetrics,
    };
  }
}

function parseStreamChunk(data: any): ModelStreamChunk | null {
  const choice = data.choices?.[0];
  if (!choice) return null;

  const delta = choice.delta ?? {};
  const finishReason = choice.finish_reason ? mapFinishReason(choice.finish_reason) : undefined;

  let deltaToolCall: Partial<ToolCall> | undefined;
  if (delta.tool_calls?.[0]) {
    const tc = delta.tool_calls[0];
    let args: any = {};
    if (tc.function?.arguments) {
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = { deltaArguments: tc.function.arguments };
      }
    }
    deltaToolCall = {
      id: tc.id,
      name: tc.function?.name,
      input: args,
    };
  }

  return {
    deltaText: delta.content ?? undefined,
    deltaToolCall,
    finishReason,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

function mapFinishReason(rawReason?: string): FinishReason {
  switch (rawReason) {
    case 'stop':
      return FinishReason.STOP;
    case 'tool_calls':
    case 'function_call':
      return FinishReason.TOOL_CALL;
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'content_filter':
      return FinishReason.CONTENT_FILTER;
    default:
      return FinishReason.STOP;
  }
}

function mapHttpStatusToError(status: number, bodyText: string, providerId: string): HarnessError {
  if (status === 429) {
    return new HarnessError({
      code: ErrorCode.MODEL_RATE_LIMITED,
      category: ErrorCategory.MODEL,
      message: `[${providerId}] Rate limit exceeded (HTTP 429): ${bodyText}`,
      context: { status, bodyText },
    });
  }
  if (status === 504 || status === 408) {
    return new HarnessError({
      code: ErrorCode.MODEL_TIMEOUT,
      category: ErrorCategory.MODEL,
      message: `[${providerId}] Gateway timeout (HTTP ${status}): ${bodyText}`,
      context: { status, bodyText },
    });
  }
  if (status >= 500) {
    return new HarnessError({
      code: ErrorCode.MODEL_UNAVAILABLE,
      category: ErrorCategory.MODEL,
      message: `[${providerId}] Provider server error (HTTP ${status}): ${bodyText}`,
      context: { status, bodyText },
    });
  }
  return new HarnessError({
    code: ErrorCode.MODEL_INVALID_RESPONSE,
    category: ErrorCategory.MODEL,
    message: `[${providerId}] HTTP ${status}: ${bodyText}`,
    context: { status, bodyText },
  });
}

function mapFetchError(err: unknown, providerId: string): HarnessError {
  if (err instanceof Error && err.name === 'AbortError') {
    return new HarnessError({
      code: ErrorCode.MODEL_TIMEOUT,
      category: ErrorCategory.MODEL,
      message: `[${providerId}] Execution aborted or timed out`,
      context: { error: err.message },
    });
  }
  return new HarnessError({
    code: ErrorCode.MODEL_UNAVAILABLE,
    category: ErrorCategory.MODEL,
    message: `[${providerId}] Network fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    context: { error: err },
  });
}
