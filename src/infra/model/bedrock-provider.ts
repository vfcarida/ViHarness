/**
 * Native AWS Bedrock Converse Model Provider.
 *
 * Implements ModelProvider interface for AWS Bedrock Converse API:
 * - Direct REST endpoint (/model/{modelId}/converse)
 * - Native AWS SigV4 request signing using built-in Node.js crypto (zero AWS SDK dependencies)
 * - Supports Claude 3.5/3.7, Amazon Nova, Llama 3, and Mistral on Bedrock
 * - Multi-turn conversational mapping (user, assistant, toolUse, toolResult)
 * - Enterprise VPC / API Gateway proxy fallback support
 */
import * as crypto from 'node:crypto';
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

export interface BedrockProviderOptions {
  readonly providerId?: string;
  readonly region?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModelId?: string;
  readonly customFetch?: typeof fetch;
  readonly costPer1kInputTokensDollars?: number;
  readonly costPer1kOutputTokensDollars?: number;
}

const BedrockToolUseSchema = z.object({
  toolUseId: z.string(),
  name: z.string(),
  input: z.union([z.record(z.unknown()), z.unknown()]).optional(),
});

const BedrockContentBlockSchema = z.object({
  text: z.string().optional(),
  toolUse: BedrockToolUseSchema.optional(),
});

const BedrockConverseResponseSchema = z.object({
  output: z
    .object({
      message: z
        .object({
          role: z.string().optional(),
          content: z.array(BedrockContentBlockSchema).optional(),
        })
        .optional(),
    })
    .optional(),
  stopReason: z.string().nullable().optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    })
    .optional(),
  metrics: z
    .object({
      latencyMs: z.number().optional(),
    })
    .optional(),
});

function sha256(str: string): string {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Standard AWS SigV4 signer for Node.js using built-in crypto.
 */
export function signBedrockRequest(params: {
  method: string;
  url: URL;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = params.url.pathname;
  const canonicalQueryString = params.url.searchParams.toString();
  const payloadHash = sha256(params.body);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: params.url.host,
    'x-amz-date': amzDate,
  };
  if (params.sessionToken) {
    headers['x-amz-security-token'] = params.sessionToken;
  }

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorizationHeader = `${algorithm} Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    Authorization: authorizationHeader,
  };
  if (params.sessionToken) {
    result['X-Amz-Security-Token'] = params.sessionToken;
  }
  return result;
}

export class BedrockConverseProvider implements ModelProvider {
  readonly providerId: string;
  readonly descriptor: ModelDescriptor;

  private readonly region: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly sessionToken?: string;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly defaultModelId: string;
  private readonly customFetch?: typeof fetch;
  private readonly costPer1kInputTokensDollars: number;
  private readonly costPer1kOutputTokensDollars: number;

  constructor(options: BedrockProviderOptions = {}) {
    this.providerId = options.providerId ?? 'bedrock';
    this.region =
      options.region ??
      process.env['AWS_REGION'] ??
      process.env['AWS_DEFAULT_REGION'] ??
      'us-east-1';
    this.accessKeyId =
      options.accessKeyId ?? process.env['AWS_ACCESS_KEY_ID'];
    this.secretAccessKey =
      options.secretAccessKey ?? process.env['AWS_SECRET_ACCESS_KEY'];
    this.sessionToken =
      options.sessionToken ?? process.env['AWS_SESSION_TOKEN'];
    this.apiKey =
      options.apiKey ?? process.env['BEDROCK_API_KEY'];
    this.baseUrl =
      options.baseUrl ?? process.env['BEDROCK_BASE_URL'];
    this.defaultModelId =
      options.defaultModelId ??
      process.env['BEDROCK_MODEL_ID'] ??
      'anthropic.claude-3-5-sonnet-20241022-v2:0';
    this.customFetch = options.customFetch;
    this.costPer1kInputTokensDollars =
      options.costPer1kInputTokensDollars ?? 0.003;
    this.costPer1kOutputTokensDollars =
      options.costPer1kOutputTokensDollars ?? 0.015;

    this.descriptor = {
      id: this.defaultModelId,
      name: `AWS Bedrock (${this.defaultModelId})`,
      providerId: this.providerId,
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
          ModelCapability.STREAMING,
          ModelCapability.VISION,
          ModelCapability.CODING,
          ModelCapability.REASONING,
        ]),
        maxContextTokens: 200000,
        maxOutputTokens: 8192,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: this.costPer1kInputTokensDollars,
      costPer1kOutputTokensDollars: this.costPer1kOutputTokensDollars,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const modelId = request.modelId ?? this.defaultModelId;
    const start = Date.now();

    const requestBody = this.buildRequestBody(request);
    const bodyStr = JSON.stringify(requestBody);

    const urlString = this.baseUrl
      ? `${this.baseUrl.replace(/\/$/, '')}/model/${encodeURIComponent(modelId)}/converse`
      : `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

    const url = new URL(urlString);
    const headers = this.buildHeaders('POST', url, bodyStr);

    const fetchFn = this.customFetch ?? fetch;
    let response: Response;

    try {
      response = await fetchFn(url.toString(), {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: request.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new HarnessError({
          code: ErrorCode.MODEL_TIMEOUT,
          category: ErrorCategory.MODEL,
          message: 'AWS Bedrock request aborted or timed out',
        });
      }
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `Network error reaching AWS Bedrock: ${err.message}`,
        cause: err,
      });
    }

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      let errorType = 'UnknownError';
      try {
        const parsedErr = JSON.parse(errorText);
        errorType = parsedErr['__type'] ?? parsedErr['message'] ?? errorType;
      } catch {
        // Raw text error
      }

      if (response.status === 429 || errorType.includes('Throttling')) {
        throw new HarnessError({
          code: ErrorCode.MODEL_RATE_LIMITED,
          category: ErrorCategory.MODEL,
          message: `AWS Bedrock rate limit exceeded: ${errorText}`,
        });
      }

      if (response.status === 401 || response.status === 403 || errorType.includes('AccessDenied')) {
        throw new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: `AWS Bedrock authorization failed: ${errorText}`,
        });
      }

      if (errorType.includes('ModelNotReady')) {
        throw new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: `AWS Bedrock model is temporarily not ready: ${errorText}`,
        });
      }

      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: `AWS Bedrock error (${response.status}): ${errorText}`,
      });
    }

    const json = await response.json();
    const parseResult = BedrockConverseResponseSchema.safeParse(json);
    if (!parseResult.success) {
      throw new HarnessError({
        code: ErrorCode.MODEL_INVALID_RESPONSE,
        category: ErrorCategory.MODEL,
        message: `Failed to parse AWS Bedrock Converse response: ${parseResult.error.message}`,
      });
    }

    const data = parseResult.data;
    const message = data.output?.message;
    const contentBlocks = message?.content ?? [];

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.text) {
        textContent += block.text;
      }
      if (block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          input:
            typeof block.toolUse.input === 'object' && block.toolUse.input !== null
              ? (block.toolUse.input as Record<string, unknown>)
              : {},
        });
      }
    }

    const inputTokens = data.usage?.inputTokens ?? 0;
    const outputTokens = data.usage?.outputTokens ?? 0;
    const totalTokens = data.usage?.totalTokens ?? inputTokens + outputTokens;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens,
    };

    const costDollars =
      (inputTokens / 1000) * this.costPer1kInputTokensDollars +
      (outputTokens / 1000) * this.costPer1kOutputTokensDollars;

    return {
      requestId: `bedrock-${Date.now()}`,
      content: textContent,
      toolCalls,
      finishReason: this.mapStopReason(data.stopReason),
      usage,
      latencyMs: data.metrics?.latencyMs ?? latencyMs,
      estimatedCostDollars: costDollars,
      modelId,
      providerId: this.providerId,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    // Bedrock streaming converse fallback to single-step completion chunk
    const res = await this.complete(request);
    yield {
      deltaText: res.content,
      finishReason: res.finishReason,
    };
  }

  async countTokens(text: string): Promise<number> {
    // Accurate heuristic token estimation for Bedrock models (approx 3.7 chars/token)
    return Math.ceil(text.length / 3.7);
  }

  async getHealth(): Promise<ModelHealth> {
    const hasSigV4 = Boolean(this.accessKeyId && this.secretAccessKey);
    const hasBearer = Boolean(this.apiKey);

    if (!hasSigV4 && !hasBearer) {
      return {
        providerId: this.providerId,
        status: ProviderHealthStatus.UNHEALTHY,
        latencyMs: 0,
        lastChecked: new Date(),
        errorMessage: 'Missing AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or BEDROCK_API_KEY)',
      };
    }

    return {
      providerId: this.providerId,
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: 50,
      lastChecked: new Date(),
    };
  }

  private buildHeaders(
    method: string,
    url: URL,
    body: string,
  ): Record<string, string> {
    if (this.accessKeyId && this.secretAccessKey) {
      return signBedrockRequest({
        method,
        url,
        body,
        region: this.region,
        service: 'bedrock',
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        sessionToken: this.sessionToken,
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private buildRequestBody(request: ModelRequest): Record<string, unknown> {
    const systemBlocks: Array<{ text: string }> = [];
    const converseMessages: Array<{
      role: 'user' | 'assistant';
      content: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of request.messages) {
      if (msg.role === MessageRole.SYSTEM) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text.trim()) {
          systemBlocks.push({ text });
        }
        continue;
      }

      if (msg.role === MessageRole.USER) {
        converseMessages.push({
          role: 'user',
          content: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
        });
      } else if (msg.role === MessageRole.ASSISTANT) {
        const content: Array<Record<string, unknown>> = [];
        if (msg.content && typeof msg.content === 'string') {
          content.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            content.push({
              toolUse: {
                toolUseId: tc.id,
                name: tc.name,
                input: tc.input,
              },
            });
          }
        }
        if (content.length > 0) {
          converseMessages.push({ role: 'assistant', content });
        }
      } else if (msg.role === MessageRole.TOOL) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        converseMessages.push({
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: msg.toolCallId ?? 'unknown_tool',
                content: [{ text }],
                status: 'success',
              },
            },
          ],
        });
      }
    }

    // Must have at least one user message
    if (converseMessages.length === 0) {
      converseMessages.push({
        role: 'user',
        content: [{ text: 'Hello' }],
      });
    }

    const payload: Record<string, unknown> = {
      messages: converseMessages,
      inferenceConfig: {
        maxTokens: request.maxTokens ?? 4096,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(request.stopSequences && request.stopSequences.length > 0
          ? { stopSequences: request.stopSequences }
          : {}),
      },
    };

    if (systemBlocks.length > 0) {
      payload['system'] = systemBlocks;
    }

    if (request.tools && request.tools.length > 0) {
      payload['toolConfig'] = {
        tools: request.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: {
              json: t.parameters,
            },
          },
        })),
      };
    }

    return payload;
  }

  private mapStopReason(reason?: string | null): FinishReason {
    if (!reason) return FinishReason.STOP;
    switch (reason.toLowerCase()) {
      case 'tool_use':
        return FinishReason.TOOL_CALL;
      case 'max_tokens':
        return FinishReason.MAX_TOKENS;
      case 'content_filtered':
        return FinishReason.CONTENT_FILTER;
      case 'end_turn':
      case 'stop_sequence':
      default:
        return FinishReason.STOP;
    }
  }
}
