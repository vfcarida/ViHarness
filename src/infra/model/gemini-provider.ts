/**
 * Native Google Gemini Model Provider.
 *
 * Implements ModelProvider interface for Google Generative AI API:
 * - Direct REST API (/v1beta/models/{model}:generateContent)
 * - Function Calling / Structured Tool Calls
 * - Multi-turn conversational mapping (`user` / `model` / `functionResponse`)
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

export interface GeminiProviderOptions {
  readonly providerId?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly defaultModelId?: string;
  readonly customFetch?: typeof fetch;
  readonly costPer1kInputTokensDollars?: number;
  readonly costPer1kOutputTokensDollars?: number;
}

const GeminiPartSchema = z.object({
  text: z.string().optional(),
  thought: z.string().optional(),
  functionCall: z
    .object({
      name: z.string(),
      args: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const GeminiCandidateSchema = z.object({
  content: z
    .object({
      role: z.string().optional(),
      parts: z.array(GeminiPartSchema).optional(),
    })
    .optional(),
  finishReason: z.string().nullable().optional(),
});

const GeminiResponseSchema = z.object({
  candidates: z.array(GeminiCandidateSchema).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
      cachedContentTokenCount: z.number().optional(),
    })
    .optional(),
});

export class GeminiModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    this.providerId = options.providerId ?? 'gemini-primary';
    this.baseUrl = (
      options.baseUrl ??
      process.env['GEMINI_BASE_URL'] ??
      'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    this.defaultModelId = options.defaultModelId ?? 'gemini-2.5-pro';
    this.fetchImpl = options.customFetch ?? globalThis.fetch;

    this.descriptor = {
      id: this.defaultModelId,
      name: 'Google Gemini 2.5 Pro',
      providerId: this.providerId,
      version: '2.5-pro',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STREAMING,
          ModelCapability.LONG_CONTEXT,
        ]),
        maxContextTokens: 1000000,
        maxOutputTokens: 8192,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: options.costPer1kInputTokensDollars ?? 0.00125,
      costPer1kOutputTokensDollars: options.costPer1kOutputTokensDollars ?? 0.005,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const modelId = request.modelId ?? this.defaultModelId;
    const body = this.buildRequestBody(request);
    const startMs = Date.now();

    const response = await this.executeRequest(
      `/models/${modelId}:generateContent`,
      body,
      request.signal,
    );
    const latencyMs = Date.now() - startMs;

    let parsedJson: unknown;
    try {
      parsedJson = await response.json();
    } catch {
      throw new HarnessError({
        code: ErrorCode.MODEL_MALFORMED_OUTPUT,
        category: ErrorCategory.MODEL,
        message: 'Gemini API returned invalid JSON',
        context: { status: response.status },
      });
    }

    const parseResult = GeminiResponseSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: `Invalid Gemini response structure: ${parseResult.error.message}`,
        context: { errors: parseResult.error.errors },
      });
    }

    const data = parseResult.data;
    const candidate = data.candidates?.[0];
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          textContent += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call-${part.functionCall.name}-${Date.now()}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }
      }
    }

    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const cacheReadTokens = data.usageMetadata?.cachedContentTokenCount ?? 0;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
      cacheReadTokens,
    };

    const costDollars =
      (inputTokens / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (outputTokens / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    return {
      requestId: `gemini-${Date.now()}`,
      content: textContent,
      toolCalls,
      finishReason: this.mapFinishReason(candidate?.finishReason),
      usage,
      latencyMs,
      estimatedCostDollars: costDollars,
      modelId,
      providerId: this.providerId,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const modelId = request.modelId ?? this.defaultModelId;
    const body = this.buildRequestBody(request);

    const response = await this.executeRequest(
      `/models/${modelId}:streamGenerateContent?alt=sse`,
      body,
      request.signal,
    );

    if (!response.body) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: 'Gemini streaming response body is null',
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
            const chunk = JSON.parse(dataStr);
            const candidate = chunk.candidates?.[0];
            const textDelta = candidate?.content?.parts?.[0]?.text;
            if (textDelta) {
              yield {
                deltaText: textDelta,
              };
            }
            if (candidate?.finishReason) {
              yield {
                finishReason: this.mapFinishReason(candidate.finishReason),
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
        errorMessage: 'Missing GEMINI_API_KEY',
      };
    }

    return {
      providerId: this.providerId,
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: 12,
      lastChecked: new Date(),
    };
  }

  private buildRequestBody(request: ModelRequest): Record<string, unknown> {
    let systemInstructionText = '';
    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];

    for (const msg of request.messages) {
      if (msg.role === MessageRole.SYSTEM) {
        systemInstructionText += (systemInstructionText ? '\n\n' : '') + msg.content;
      } else if (msg.role === MessageRole.USER) {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === MessageRole.ASSISTANT) {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === MessageRole.TOOL || msg.role === MessageRole.TOOL_RESULT) {
        const toolName = msg.name ?? (msg.metadata?.['toolName'] as string) ?? 'tool';
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: toolName,
                response: { content: msg.content },
              },
            },
          ],
        });
      }
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.0,
      },
    };

    if (systemInstructionText) {
      payload['systemInstruction'] = {
        parts: [{ text: systemInstructionText }],
      };
    }

    if (request.tools && request.tools.length > 0) {
      payload['tools'] = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? { type: 'OBJECT', properties: {} },
          })),
        },
      ];
    }

    return payload;
  }

  private async executeRequest(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const delimiter = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${delimiter}key=${this.apiKey}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
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
        message: `Failed to connect to Gemini API: ${err instanceof Error ? err.message : String(err)}`,
        cause: err instanceof Error ? err : undefined,
      });
    }

    if (!response.ok) {
      this.handleHttpError(response.status);
    }

    return response;
  }

  private handleHttpError(status: number): never {
    if (status === 400 || status === 403) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `Gemini authentication or client request error (HTTP ${status})`,
      });
    }
    if (status === 429) {
      throw new HarnessError({
        code: ErrorCode.MODEL_RATE_LIMITED,
        category: ErrorCategory.MODEL,
        message: 'Gemini rate limit exceeded (HTTP 429)',
      });
    }
    throw new HarnessError({
      code: ErrorCode.MODEL_UNAVAILABLE,
      category: ErrorCategory.MODEL,
      message: `Gemini API error (HTTP ${status})`,
    });
  }

  private mapFinishReason(reason?: string | null): FinishReason {
    switch (reason) {
      case 'STOP':
        return FinishReason.STOP;
      case 'MAX_TOKENS':
        return FinishReason.MAX_TOKENS;
      case 'SAFETY':
        return FinishReason.CONTENT_FILTER;
      default:
        return FinishReason.STOP;
    }
  }
}
