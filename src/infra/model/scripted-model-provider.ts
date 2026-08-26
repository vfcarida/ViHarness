/**
 * Scripted Model Provider.
 *
 * Deterministic implementation of ModelProvider for testing real multi-step coding-agent trajectories.
 * Returns pre-scripted responses/tool calls based on step index or request content matching.
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

export interface ScriptedStep {
  readonly content?: string;
  readonly toolCalls?: ReadonlyArray<{ name: string; input: Record<string, unknown>; id?: string }>;
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
}

export type ScriptStepHandler =
  ScriptedStep | ((request: ModelRequest, index: number) => ScriptedStep);

export interface ScriptedModelProviderOptions {
  readonly providerId?: string;
  readonly descriptor?: Partial<ModelDescriptor>;
  readonly steps: ReadonlyArray<ScriptStepHandler>;
}

export class ScriptedModelProvider implements ModelProvider {
  public readonly providerId: string;
  public readonly descriptor: ModelDescriptor;
  private readonly steps: ReadonlyArray<ScriptStepHandler>;
  public requestHistory: ModelRequest[] = [];

  constructor(options: ScriptedModelProviderOptions = { steps: [] }) {
    this.providerId = options.providerId ?? 'scripted-model-provider';
    this.steps = options.steps ?? [];

    this.descriptor = {
      id: options.descriptor?.id ?? 'scripted-model-v1',
      name: options.descriptor?.name ?? 'Scripted Test Model',
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
    const stepIndex = this.requestHistory.length;
    this.requestHistory.push(request);

    const stepHandler = this.steps[Math.min(stepIndex, this.steps.length - 1)];
    const step =
      typeof stepHandler === 'function' ? stepHandler(request, stepIndex) : (stepHandler ?? {});

    const toolCalls: ToolCall[] = [];
    if (step.toolCalls && step.toolCalls.length > 0) {
      for (let i = 0; i < step.toolCalls.length; i++) {
        const tc = step.toolCalls[i]!;
        toolCalls.push({
          id: tc.id ?? `call_${stepIndex + 1}_${i + 1}`,
          name: tc.name,
          input: tc.input,
        });
      }
    }

    const content =
      step.content ?? (toolCalls.length > 0 ? '' : 'Scripted trajectory completed successfully.');
    const finishReason =
      step.finishReason ?? (toolCalls.length > 0 ? FinishReason.TOOL_CALL : FinishReason.STOP);

    const inputTokens =
      step.usage?.inputTokens ??
      request.messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
    const outputTokens = step.usage?.outputTokens ?? Math.ceil(content.length / 4) + 10;
    const usage: TokenUsage = step.usage ?? {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    const costPer1kInput = this.descriptor.costPer1kInputTokensDollars ?? 0.001;
    const costPer1kOutput = this.descriptor.costPer1kOutputTokensDollars ?? 0.002;
    const estimatedCostDollars =
      (inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput;

    return {
      requestId: `scripted-req-${stepIndex + 1}`,
      modelId: request.modelId ?? this.descriptor.id,
      providerId: this.providerId,
      content,
      toolCalls,
      usage,
      finishReason,
      latencyMs: 5,
      estimatedCostDollars,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const response = await this.complete(request);
    if (response.content) {
      yield { deltaText: response.content };
    }
    if (response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        yield { deltaToolCall: tc };
      }
    }
    yield { finishReason: response.finishReason, usage: response.usage };
  }

  async getHealth(): Promise<ModelHealth> {
    return {
      providerId: this.providerId,
      status: ProviderHealthStatus.HEALTHY,
      latencyMs: 5,
      lastChecked: new Date(),
    };
  }
}
