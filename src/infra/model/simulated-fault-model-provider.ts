/**
 * Simulated Fault Model Provider.
 *
 * Emulates real-world LLM API fault behaviors:
 * - Rate limits (HTTP 429 with retry-after)
 * - Service unavailability (HTTP 503 / 504)
 * - Timeouts (hanging or aborted network calls)
 * - Authentication failures (HTTP 401)
 * - Malformed responses (corrupted/truncated JSON)
 * - Transient faults that recover after N attempts (to test retries and jitter)
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
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';

export type SimulatedFaultType =
  | 'NONE'
  | 'RATE_LIMIT'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'AUTH_ERROR'
  | 'MALFORMED_JSON'
  | 'TRANSIENT_RETRYABLE';

export interface SimulatedStep {
  readonly content?: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly finishReason?: FinishReason;
  readonly usage?: Partial<TokenUsage>;
}

export interface SimulatedFaultProviderOptions {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly faultType?: SimulatedFaultType;
  readonly failCount?: number; // Number of initial calls that fail before succeeding
  readonly retryAfterSeconds?: number;
  readonly simulatedLatencyMs?: number;
  readonly steps?: ReadonlyArray<SimulatedStep>;
  readonly costPer1kInputTokensDollars?: number;
  readonly costPer1kOutputTokensDollars?: number;
}

export class SimulatedFaultModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;

  private faultType: SimulatedFaultType;
  private readonly failCount: number;
  private readonly retryAfterSeconds: number;
  private readonly simulatedLatencyMs: number;
  private readonly steps: ReadonlyArray<SimulatedStep>;
  private attempts = 0;
  private currentStepIndex = 0;

  constructor(options: SimulatedFaultProviderOptions = {}) {
    this.providerId = options.providerId ?? 'simulated-fault-provider';
    const modelId = options.modelId ?? 'simulated-gpt-4o';
    this.faultType = options.faultType ?? 'NONE';
    this.failCount = options.failCount ?? 1;
    this.retryAfterSeconds = options.retryAfterSeconds ?? 1;
    this.simulatedLatencyMs = options.simulatedLatencyMs ?? 5;
    this.steps = options.steps ?? [];

    this.descriptor = {
      id: modelId,
      name: `Simulated Fault Provider (${modelId})`,
      providerId: this.providerId,
      version: '1.0.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
          ModelCapability.STRUCTURED_OUTPUT,
          ModelCapability.STREAMING,
          ModelCapability.PARALLEL_TOOL_CALLS,
        ]),
        maxContextTokens: 128000,
        maxOutputTokens: 16384,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: options.costPer1kInputTokensDollars ?? 0.002,
      costPer1kOutputTokensDollars: options.costPer1kOutputTokensDollars ?? 0.006,
    };
  }

  setFaultType(fault: SimulatedFaultType): void {
    this.faultType = fault;
  }

  getAttemptCount(): number {
    return this.attempts;
  }

  resetAttempts(): void {
    this.attempts = 0;
    this.currentStepIndex = 0;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.attempts++;

    // Check if we should inject a fault for this attempt
    if (this.faultType !== 'NONE' && this.attempts <= this.failCount) {
      this.triggerFault(this.faultType);
    }

    const step = this.steps[this.currentStepIndex];
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
    }

    const content = step?.content ?? 'Simulated completion response';
    const toolCalls = step?.toolCalls ?? [];
    const finishReason =
      step?.finishReason ?? (toolCalls.length > 0 ? FinishReason.TOOL_CALL : FinishReason.STOP);

    const inputTokens = step?.usage?.inputTokens ?? 150;
    const outputTokens = step?.usage?.outputTokens ?? 50;
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    const cost =
      (usage.inputTokens / 1000) * this.descriptor.costPer1kInputTokensDollars +
      (usage.outputTokens / 1000) * this.descriptor.costPer1kOutputTokensDollars;

    return {
      requestId: `sim_${this.attempts}_${Date.now()}`,
      modelId: request.modelId ?? this.descriptor.id,
      providerId: this.providerId,
      content,
      toolCalls,
      usage,
      finishReason,
      latencyMs: this.simulatedLatencyMs,
      estimatedCostDollars: cost,
    };
  }

  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.attempts++;

    if (this.faultType !== 'NONE' && this.attempts <= this.failCount) {
      this.triggerFault(this.faultType);
    }

    const step = this.steps[this.currentStepIndex];
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
    }

    const content = step?.content ?? 'Simulated streaming chunk';
    const toolCalls = step?.toolCalls ?? [];

    // 1. Yield text chunks
    if (content) {
      const parts = content.split(' ');
      for (const part of parts) {
        yield { deltaText: `${part} ` };
      }
    }

    // 2. Yield tool calls if any
    for (const tc of toolCalls) {
      yield {
        deltaToolCall: {
          id: tc.id,
          name: tc.name,
          input: tc.input,
        },
      };
    }

    // 3. Yield final finish chunk with usage
    const inputTokens = step?.usage?.inputTokens ?? 120;
    const outputTokens = step?.usage?.outputTokens ?? 40;
    yield {
      finishReason:
        step?.finishReason ?? (toolCalls.length > 0 ? FinishReason.TOOL_CALL : FinishReason.STOP),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }

  async getHealth(): Promise<ModelHealth> {
    if (this.faultType === 'SERVICE_UNAVAILABLE' || this.faultType === 'AUTH_ERROR') {
      return {
        providerId: this.providerId,
        status: ProviderHealthStatus.UNHEALTHY,
        lastChecked: new Date(),
        errorMessage: `Simulated ${this.faultType}`,
      };
    }
    if (this.faultType === 'RATE_LIMIT' || this.faultType === 'TIMEOUT') {
      return {
        providerId: this.providerId,
        status: ProviderHealthStatus.DEGRADED,
        lastChecked: new Date(),
        errorMessage: `Simulated ${this.faultType}`,
      };
    }
    return {
      providerId: this.providerId,
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: this.simulatedLatencyMs,
      lastChecked: new Date(),
    };
  }

  private triggerFault(fault: SimulatedFaultType): never {
    switch (fault) {
      case 'RATE_LIMIT':
        throw new HarnessError({
          code: ErrorCode.MODEL_RATE_LIMITED,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Rate limit exceeded (HTTP 429). Retry after ${this.retryAfterSeconds}s`,
          context: { retryAfterSeconds: this.retryAfterSeconds, attempt: this.attempts },
        });

      case 'SERVICE_UNAVAILABLE':
      case 'TRANSIENT_RETRYABLE':
        throw new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Service Unavailable (HTTP 503): Model backend is overloaded`,
          context: { status: 503, attempt: this.attempts },
        });

      case 'TIMEOUT':
        throw new HarnessError({
          code: ErrorCode.MODEL_TIMEOUT,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Gateway Timeout (HTTP 504): Upstream request timed out`,
          context: { status: 504, attempt: this.attempts },
        });

      case 'AUTH_ERROR':
        throw new HarnessError({
          code: ErrorCode.MODEL_INVALID_RESPONSE,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Authentication Failed (HTTP 401): Invalid API Key`,
          context: { status: 401, attempt: this.attempts },
        });

      case 'MALFORMED_JSON':
        throw new HarnessError({
          code: ErrorCode.MODEL_MALFORMED_OUTPUT,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Malformed JSON response body: unexpected token < in JSON at position 0`,
          context: { attempt: this.attempts },
        });

      default:
        throw new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: `[${this.providerId}] Generic simulated fault`,
        });
    }
  }
}
