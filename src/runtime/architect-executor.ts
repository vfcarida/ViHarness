// Pattern: Architect mode (ref: Aider + Prime Agent)
/**
 * Architect Executor (Dual-Model Plan -> Execute Split).
 *
 * Implements Architect Mode:
 * - Phase 1 (Plan): A strong reasoning model plans changes in natural language.
 *   The architect NEVER sees tool schemas (lighter prompt, maximum reasoning tokens).
 * - Phase 2 (Execute): A fast/cheap execution model receives the plan + context + tool definitions
 *   and produces concrete tool calls. The editor NEVER reasons about the problem.
 *
 * References:
 * - Aider (Architect Mode)
 * - Prime Agent (Strong/Weak model split)
 * - DeepSeek Harness (agent/pre-step waterfall interception)
 */
import type { ModelRouter } from '../core/interfaces/model-router.js';
import type { Clock } from '../core/interfaces/clock.js';
import type { ModelProvider } from '../core/interfaces/model-provider.js';
import type {
  ModelRequest,
  ModelResponse,
  ModelMessage,
  TokenUsage,
} from '../core/model/model-io.js';
import type { ToolDefinition } from '../core/model/tool-types.js';
import { MessageRole } from '../core/model/model-io.js';
import type { DualModelConfig } from '../core/model/router-types.js';
import { TaskCategory } from '../core/model/router-types.js';
import { AgentPhase } from '../core/model/state.js';
import type { Goal } from '../core/model/goal.js';
import type { Task } from '../core/model/task.js';
import type { ExecutionId } from '../core/types/identifiers.js';
import type { AgentObserverHub } from './agent-observer.js';
import { AgentEventType } from '../core/model/runtime-types.js';
import { executeResiliently } from '../infra/model/provider-resilience.js';
import type { PreStepEvent, PreStepDecision, PreStepListener } from '../core/model/pre-step.js';

export const ARCHITECT_SYSTEM_PROMPT = `You are the ARCHITECT reasoning model in a Dual-Model Plan->Execute system.
Your job is to analyze the user's goal, task, and context, and output a structured architectural plan in natural language.
You do NOT execute tool calls directly; a downstream EDITOR model will translate your plan into concrete tool calls.

Format your response strictly using the following Markdown template:

## Changes Required
1. In \`<filepath>\`: <Specific description of edits, functions, and logic to modify or add>
2. In \`<filepath>\`: <Specific description of changes or tests to create>
`;

export const EDITOR_SYSTEM_PROMPT = `You are the EDITOR execution model in a Dual-Model Plan->Execute system.
Your job is to translate the architectural plan into concrete, structured tool calls.
Do NOT question, redesign, or second-guess the architecture. Focus strictly on correct syntax, formatting, and tool execution compliance.`;

export interface ArchitectPlanParams {
  readonly goal: Goal;
  readonly task: Task;
  readonly messages: ReadonlyArray<ModelMessage>;
  readonly architectProvider: ModelProvider;
  readonly architectModelId: string;
  readonly signal?: AbortSignal;
  readonly customSystemPrompt?: string;
}

export interface ArchitectPlanResult {
  readonly plan: string;
  readonly rawResponse: ModelResponse;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly costDollars: number;
  readonly providerId: string;
  readonly modelId: string;
}

export interface ArchitectExecuteParams {
  readonly plan: string;
  readonly messages: ReadonlyArray<ModelMessage>;
  readonly editorProvider: ModelProvider;
  readonly editorModelId: string;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly signal?: AbortSignal;
  readonly customSystemPrompt?: string;
}

export interface ArchitectExecuteResult {
  readonly rawResponse: ModelResponse;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly costDollars: number;
  readonly providerId: string;
  readonly modelId: string;
}

export interface ArchitectPlanAndExecuteParams {
  readonly goal: Goal;
  readonly task: Task;
  readonly messages: ReadonlyArray<ModelMessage>;
  readonly router: ModelRouter;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly dualModelConfig?: DualModelConfig;
  readonly signal?: AbortSignal;
  readonly executionId?: ExecutionId;
  readonly observerHub?: AgentObserverHub;
  readonly clock: Clock;
  readonly contextTokenCount?: number;
  readonly remainingBudgetDollars?: number;
  readonly currentState?: AgentPhase;
}

export interface ArchitectExecutionResult {
  readonly plan: string;
  readonly architect: {
    readonly providerId: string;
    readonly modelId: string;
    readonly usage: TokenUsage;
    readonly latencyMs: number;
    readonly costDollars: number;
    readonly response: ModelResponse;
  };
  readonly editor: {
    readonly providerId: string;
    readonly modelId: string;
    readonly usage: TokenUsage;
    readonly latencyMs: number;
    readonly costDollars: number;
    readonly response: ModelResponse;
  };
  readonly totalUsage: TokenUsage;
  readonly totalCostDollars: number;
  readonly totalLatencyMs: number;
  readonly combinedResponse: ModelResponse;
}

export interface ArchitectPreStepState {
  cachedPlan?: string;
  planStep?: number;
}

export class ArchitectExecutor {
  /**
   * Phase 1 (Plan): Call the architect model with the goal and context.
   * Tool definitions are strictly omitted so the architect focuses entirely on reasoning.
   */
  static async plan(params: ArchitectPlanParams): Promise<ArchitectPlanResult> {
    const {
      goal,
      task,
      messages,
      architectProvider,
      architectModelId,
      signal,
      customSystemPrompt,
    } = params;

    const planMessages: ModelMessage[] = [
      {
        role: MessageRole.SYSTEM,
        content: customSystemPrompt ?? ARCHITECT_SYSTEM_PROMPT,
      },
      ...messages,
      {
        role: MessageRole.USER,
        content: `Please provide the structured architectural plan for Goal [${goal.description}] and Task [${task.description}]. List all required file modifications.`,
      },
    ];

    const modelRequest: ModelRequest = {
      modelId: architectModelId,
      messages: planMessages,
      // CRITICAL: Architect NEVER sees tool schemas
      tools: undefined,
      signal,
    };

    const response = await executeResiliently(architectProvider, modelRequest, {
      maxRetries: 2,
      defaultTimeoutMs: 30000,
    });

    return {
      plan: response.content,
      rawResponse: response,
      usage: response.usage,
      latencyMs: response.latencyMs,
      costDollars: response.estimatedCostDollars,
      providerId: architectProvider.providerId,
      modelId: architectModelId,
    };
  }

  /**
   * Phase 2 (Execute): Call the editor model with the generated plan, original messages,
   * and tool definitions to produce structured tool calls.
   */
  static async execute(params: ArchitectExecuteParams): Promise<ArchitectExecuteResult> {
    const { plan, messages, editorProvider, editorModelId, tools, signal, customSystemPrompt } =
      params;

    const editorMessages: ModelMessage[] = [
      {
        role: MessageRole.SYSTEM,
        content: customSystemPrompt ?? EDITOR_SYSTEM_PROMPT,
      },
      ...messages,
      {
        role: MessageRole.ASSISTANT,
        content: `[ARCHITECT PLAN]\n${plan}`,
      },
      {
        role: MessageRole.USER,
        content: 'Execute the above architectural plan by generating the appropriate tool calls.',
      },
    ];

    const modelRequest: ModelRequest = {
      modelId: editorModelId,
      messages: editorMessages,
      // Editor receives tool definitions to produce tool calls
      tools,
      signal,
    };

    const response = await executeResiliently(editorProvider, modelRequest, {
      maxRetries: 2,
      defaultTimeoutMs: 20000,
    });

    return {
      rawResponse: response,
      usage: response.usage,
      latencyMs: response.latencyMs,
      costDollars: response.estimatedCostDollars,
      providerId: editorProvider.providerId,
      modelId: editorModelId,
    };
  }

  /**
   * Coordinates Phase 1 (Plan) -> Phase 2 (Execute) in a single iteration step.
   * Resolves models via router, tracks costs separately, and emits telemetry events.
   */
  static async executePlanAndExecute(
    params: ArchitectPlanAndExecuteParams,
  ): Promise<ArchitectExecutionResult> {
    const {
      goal,
      task,
      messages,
      router,
      tools,
      dualModelConfig,
      signal,
      executionId,
      observerHub,
      clock,
      contextTokenCount = 1000,
      remainingBudgetDollars,
      currentState = AgentPhase.PLAN,
    } = params;

    // 1. Route Architect Model
    const architectRouting = await router.route({
      taskCategory: TaskCategory.ARCHITECTURE,
      complexity: 'HIGH',
      risk: 'LOW',
      currentState,
      targetRole: 'ARCHITECT',
      dualModelConfig,
      contextTokenCount,
      remainingBudgetDollars,
    });

    const architectProvider = architectRouting.selectedProvider;
    const architectModelId = dualModelConfig?.architectModelId ?? architectRouting.selectedModelId;

    // Phase 1: Planning
    const planResult = await ArchitectExecutor.plan({
      goal,
      task,
      messages,
      architectProvider,
      architectModelId,
      signal,
    });

    if (observerHub && executionId) {
      observerHub.emit({
        type: AgentEventType.ArchitectPlanGenerated,
        executionId,
        taskId: task.id,
        timestamp: clock.now(),
        data: {
          plan: planResult.plan,
          providerId: planResult.providerId,
          modelId: planResult.modelId,
          tokens: planResult.usage,
          costDollars: planResult.costDollars,
          latencyMs: planResult.latencyMs,
        },
      });
    }

    // 2. Route Editor Model
    const editorRouting = await router.route({
      taskCategory: TaskCategory.CODE_GEN,
      complexity: 'MEDIUM',
      risk: 'LOW',
      currentState: AgentPhase.IMPLEMENT,
      targetRole: 'EDITOR',
      dualModelConfig,
      contextTokenCount,
      remainingBudgetDollars: remainingBudgetDollars
        ? remainingBudgetDollars - planResult.costDollars
        : undefined,
    });

    const editorProvider = editorRouting.selectedProvider;
    const editorModelId = dualModelConfig?.editorModelId ?? editorRouting.selectedModelId;

    // Phase 2: Execution
    const executeResult = await ArchitectExecutor.execute({
      plan: planResult.plan,
      messages,
      editorProvider,
      editorModelId,
      tools,
      signal,
    });

    if (observerHub && executionId) {
      observerHub.emit({
        type: AgentEventType.EditorExecuted,
        executionId,
        taskId: task.id,
        timestamp: clock.now(),
        data: {
          toolCallsCount: executeResult.rawResponse.toolCalls.length,
          toolCalls: executeResult.rawResponse.toolCalls,
          providerId: executeResult.providerId,
          modelId: executeResult.modelId,
          tokens: executeResult.usage,
          costDollars: executeResult.costDollars,
          latencyMs: executeResult.latencyMs,
        },
      });
    }

    // Aggregate Tokens and Costs
    const totalUsage: TokenUsage = {
      inputTokens: planResult.usage.inputTokens + executeResult.usage.inputTokens,
      outputTokens: planResult.usage.outputTokens + executeResult.usage.outputTokens,
      totalTokens: planResult.usage.totalTokens + executeResult.usage.totalTokens,
      reasoningTokens:
        (planResult.usage.reasoningTokens ?? 0) + (executeResult.usage.reasoningTokens ?? 0),
    };

    const totalCostDollars = planResult.costDollars + executeResult.costDollars;
    const totalLatencyMs = planResult.latencyMs + executeResult.latencyMs;

    const combinedResponse: ModelResponse = {
      requestId: executeResult.rawResponse.requestId,
      modelId: executeResult.modelId,
      providerId: executeResult.providerId,
      content: executeResult.rawResponse.content || planResult.plan,
      structuredOutput: executeResult.rawResponse.structuredOutput,
      toolCalls: executeResult.rawResponse.toolCalls,
      usage: totalUsage,
      finishReason: executeResult.rawResponse.finishReason,
      latencyMs: totalLatencyMs,
      estimatedCostDollars: totalCostDollars,
      metadata: {
        architectMode: true,
        architectPlan: planResult.plan,
        architectProviderId: planResult.providerId,
        architectModelId: planResult.modelId,
        architectCostDollars: planResult.costDollars,
        architectTokens: planResult.usage,
        editorProviderId: executeResult.providerId,
        editorModelId: executeResult.modelId,
        editorCostDollars: executeResult.costDollars,
        editorTokens: executeResult.usage,
      },
    };

    return {
      plan: planResult.plan,
      architect: {
        providerId: planResult.providerId,
        modelId: planResult.modelId,
        usage: planResult.usage,
        latencyMs: planResult.latencyMs,
        costDollars: planResult.costDollars,
        response: planResult.rawResponse,
      },
      editor: {
        providerId: executeResult.providerId,
        modelId: executeResult.modelId,
        usage: executeResult.usage,
        latencyMs: executeResult.latencyMs,
        costDollars: executeResult.costDollars,
        response: executeResult.rawResponse,
      },
      totalUsage,
      totalCostDollars,
      totalLatencyMs,
      combinedResponse,
    };
  }

  /**
   * Factory: Create a PreStepListener for DeepSeek Harness waterfall integration.
   *
   * On step 1 (or turn 1): routes to architect model, generates and captures plan,
   * then injects the plan as context.
   * On subsequent steps: ensures the architect plan is injected for executor steps.
   */
  static createPreStepListener(
    router: ModelRouter,
    goal: Goal,
    task: Task,
    options?: {
      dualModelConfig?: DualModelConfig;
      state?: ArchitectPreStepState;
    },
  ): PreStepListener {
    const state: ArchitectPreStepState = options?.state ?? {};

    return async (event: PreStepEvent): Promise<PreStepDecision> => {
      // If we don't have a plan yet (step 1), generate it using the architect model
      if (!state.cachedPlan && event.step === 1) {
        const architectRouting = await router.route({
          taskCategory: TaskCategory.ARCHITECTURE,
          complexity: 'HIGH',
          risk: 'LOW',
          currentState: AgentPhase.PLAN,
          targetRole: 'ARCHITECT',
          dualModelConfig: options?.dualModelConfig,
          contextTokenCount: 1000,
        });

        const architectProvider = architectRouting.selectedProvider;
        const architectModelId =
          options?.dualModelConfig?.architectModelId ?? architectRouting.selectedModelId;

        const planResult = await ArchitectExecutor.plan({
          goal,
          task,
          messages: event.messages,
          architectProvider,
          architectModelId,
          signal: event.signal,
        });

        state.cachedPlan = planResult.plan;
        state.planStep = event.step;

        // Return modified messages with plan context injected
        const modifiedMessages: ModelMessage[] = [
          ...event.messages,
          {
            role: MessageRole.ASSISTANT,
            content: `[ARCHITECT PLAN]\n${planResult.plan}`,
          },
        ];

        return {
          kind: 'enter',
          messages: modifiedMessages,
        };
      }

      // If we already have a cached plan, ensure it is present in messages
      if (state.cachedPlan) {
        const alreadyHasPlan = event.messages.some((m) => m.content.includes('[ARCHITECT PLAN]'));
        if (!alreadyHasPlan) {
          const modifiedMessages: ModelMessage[] = [
            ...event.messages,
            {
              role: MessageRole.ASSISTANT,
              content: `[ARCHITECT PLAN]\n${state.cachedPlan}`,
            },
          ];
          return {
            kind: 'enter',
            messages: modifiedMessages,
          };
        }
      }

      return {
        kind: 'enter',
        messages: event.messages,
      };
    };
  }
}
