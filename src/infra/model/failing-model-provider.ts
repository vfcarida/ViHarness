/**
 * Failing Model Provider.
 *
 * Test provider specifically designed to simulate transient errors
 * (e.g. rate limit 429, timeout, network error) that succeed after N attempts,
 * or fail permanently to test retries and fallback chains.
 */
import type { ModelProvider } from '../../core/interfaces/model-provider.js';
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ModelDescriptor,
  ModelHealth,
} from '../../core/model/model-io.js';
import { FinishReason, ModelCapability, ProviderHealthStatus } from '../../core/model/model-io.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export interface FailingModelProviderOptions {
  readonly providerId?: string;
  readonly failAttemptsCount?: number;
  readonly failureErrorCode?: ErrorCode;
  readonly failureErrorMessage?: string;
  readonly successResponseText?: string;
}

export class FailingModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly failAttemptsCount: number;
  private readonly failureErrorCode: ErrorCode;
  private readonly failureErrorMessage: string;
  private readonly successResponseText: string;

  public currentAttemptCount = 0;

  constructor(options: FailingModelProviderOptions = {}) {
    this.providerId = options.providerId ?? 'failing-provider';
    this.failAttemptsCount = options.failAttemptsCount ?? 2; // Fails twice, succeeds on 3rd attempt
    this.failureErrorCode = options.failureErrorCode ?? ErrorCode.MODEL_RATE_LIMITED;
    this.failureErrorMessage = options.failureErrorMessage ?? 'HTTP 429: Rate limit exceeded';
    this.successResponseText = options.successResponseText ?? 'Success after retry';

    this.descriptor = {
      id: 'failing-model-v1',
      name: 'Failing Test Model',
      providerId: this.providerId,
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
        maxContextTokens: 64000,
        maxOutputTokens: 2048,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: 0.001,
      costPer1kOutputTokensDollars: 0.002,
    };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.currentAttemptCount++;

    if (this.currentAttemptCount <= this.failAttemptsCount) {
      throw new HarnessError({
        code: this.failureErrorCode,
        category: ErrorCategory.MODEL,
        message: `${this.failureErrorMessage} (Attempt ${this.currentAttemptCount})`,
        context: { attempt: this.currentAttemptCount },
      });
    }

    return {
      requestId: `fail-req-${Date.now()}`,
      modelId: request.modelId ?? this.descriptor.id,
      providerId: this.providerId,
      content: this.successResponseText,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      finishReason: FinishReason.STOP,
      latencyMs: 10,
      estimatedCostDollars: 0.00003,
    };
  }

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.currentAttemptCount++;

    if (this.currentAttemptCount <= this.failAttemptsCount) {
      throw new HarnessError({
        code: this.failureErrorCode,
        category: ErrorCategory.MODEL,
        message: `${this.failureErrorMessage} (Attempt ${this.currentAttemptCount})`,
        context: { attempt: this.currentAttemptCount },
      });
    }

    yield { deltaText: this.successResponseText };
    yield { finishReason: FinishReason.STOP };
  }

  async getHealth(): Promise<ModelHealth> {
    return {
      providerId: this.providerId,
      status:
        this.currentAttemptCount <= this.failAttemptsCount
          ? ProviderHealthStatus.DEGRADED
          : ProviderHealthStatus.HEALTHY,
      lastChecked: new Date(),
    };
  }
}
