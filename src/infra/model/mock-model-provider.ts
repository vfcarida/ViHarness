/**
 * Mock Model Provider.
 *
 * Deterministic test implementation of ModelProvider.
 * Supports text generation, tool calls, structured JSON outputs,
 * streaming, simulated latency, error injection, and health checks.
 */
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

export interface MockModelProviderOptions {
  readonly providerId?: string;
  readonly descriptor?: Partial<ModelDescriptor>;
  readonly defaultResponseText?: string;
  readonly defaultToolCalls?: ReadonlyArray<ToolCall>;
  readonly defaultStructuredOutput?: Readonly<Record<string, unknown>>;
  readonly defaultFinishReason?: FinishReason;
  readonly simulatedLatencyMs?: number;
  readonly errorToThrow?: Error;
  readonly healthStatus?: ProviderHealthStatus;
}

export class MockModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly responseText: string;
  private readonly toolCalls: ReadonlyArray<ToolCall>;
  private readonly structuredOutput?: Readonly<Record<string, unknown>>;
  private readonly finishReason: FinishReason;
  private readonly latencyMs: number;
  private readonly errorToThrow?: Error;
  private readonly healthStatus: ProviderHealthStatus;

  public requestHistory: ModelRequest[] = [];

  constructor(options: MockModelProviderOptions = {}) {
    this.providerId = options.providerId ?? 'mock-provider-primary';
    this.responseText = options.defaultResponseText ?? 'Mock response content';
    this.toolCalls = options.defaultToolCalls ?? [];
    this.structuredOutput = options.defaultStructuredOutput;
    this.finishReason =
      options.defaultFinishReason ??
      (this.toolCalls.length > 0 ? FinishReason.TOOL_CALL : FinishReason.STOP);
    this.latencyMs = options.simulatedLatencyMs ?? 5;
    this.errorToThrow = options.errorToThrow;
    this.healthStatus = options.healthStatus ?? ProviderHealthStatus.HEALTHY;

    this.descriptor = {
      id: options.descriptor?.id ?? 'mock-model-v1',
      name: options.descriptor?.name ?? 'Mock Model V1',
      providerId: this.providerId,
      version: options.descriptor?.version ?? '1.0.0',
      capabilities: options.descriptor?.capabilities ?? {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
          ModelCapability.STREAMING,
          ModelCapability.PARALLEL_TOOL_CALLS,
        ]),
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: options.descriptor?.costPer1kInputTokensDollars ?? 0.001,
      costPer1kOutputTokensDollars: options.descriptor?.costPer1kOutputTokensDollars ?? 0.002,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requestHistory.push(request);

    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const inputTokenEst = request.messages.reduce(
      (acc, m) => acc + Math.ceil(m.content.length / 4),
      0,
    );
    const outputTokenEst = Math.ceil(this.responseText.length / 4) + 10;

    const usage: TokenUsage = {
      inputTokens: inputTokenEst,
      outputTokens: outputTokenEst,
      totalTokens: inputTokenEst + outputTokenEst,
    };

    const cost =
      (inputTokenEst / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (outputTokenEst / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    return {
      requestId: `mock-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      modelId: request.modelId ?? this.descriptor.id,
      providerId: this.providerId,
      content: this.responseText,
      structuredOutput: this.structuredOutput,
      toolCalls: this.toolCalls,
      usage,
      finishReason: this.finishReason,
      latencyMs: this.latencyMs,
      estimatedCostDollars: cost,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requestHistory.push(request);

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const words = this.responseText.split(' ');
    for (const word of words) {
      if (this.latencyMs > 0) {
        await new Promise((r) =>
          setTimeout(r, Math.max(1, Math.floor(this.latencyMs / words.length))),
        );
      }
      yield { deltaText: word + ' ' };
    }

    if (this.toolCalls.length > 0) {
      for (const tc of this.toolCalls) {
        yield { deltaToolCall: tc };
      }
    }

    yield {
      finishReason: this.finishReason,
      usage: {
        inputTokens: 20,
        outputTokens: words.length + 5,
        totalTokens: 25 + words.length,
      },
    };
  }

  async getHealth(): Promise<ModelHealth> {
    return {
      providerId: this.providerId,
      status: this.healthStatus,
      latencyMs: this.latencyMs,
      lastChecked: new Date(),
      errorMessage:
        this.healthStatus === ProviderHealthStatus.UNHEALTHY
          ? 'Mock provider forced unhealthy'
          : undefined,
    };
  }
}
