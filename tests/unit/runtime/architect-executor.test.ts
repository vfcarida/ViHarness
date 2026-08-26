/**
 * ArchitectExecutor Unit Tests.
 *
 * Validates:
 * 1. Architect model NEVER sees tool schemas (lighter prompt, maximum reasoning tokens).
 * 2. Editor model receives plan + file context + tool schemas and outputs tool calls.
 * 3. executePlanAndExecute orchestrates both models with separate cost & token tracking.
 * 4. Observable events (ArchitectPlanGenerated & EditorExecuted) are emitted with detailed metrics.
 * 5. PreStepListener waterfall integration.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ArchitectExecutor,
  ARCHITECT_SYSTEM_PROMPT,
  EDITOR_SYSTEM_PROMPT,
} from '../../../src/runtime/architect-executor.js';
import { AgentObserverHub } from '../../../src/runtime/agent-observer.js';
import {
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import {
  GoalStatus,
  type Goal,
  type Task,
  TaskStatus,
  FinishReason,
  ModelCapability,
  type ModelDescriptor,
  MessageRole,
  type ModelMessage,
  type ToolDefinition,
  ToolCategory,
  ToolRiskLevel,
  AgentEventType,
} from '../../../src/core/index.js';

describe('ArchitectExecutor (Dual-Model Plan -> Execute)', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const architectDescriptor: ModelDescriptor = {
    id: 'o3-architect',
    name: 'Frontier Architect Model',
    providerId: 'architect-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
      maxContextTokens: 200000,
      maxOutputTokens: 32000,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.02,
    costPer1kOutputTokensDollars: 0.08,
  };

  const editorDescriptor: ModelDescriptor = {
    id: 'gpt-4o-mini-editor',
    name: 'Fast Lightweight Editor Model',
    providerId: 'editor-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.CODING, ModelCapability.TOOL_USE]),
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.00015,
    costPer1kOutputTokensDollars: 0.0006,
  };

  const mockToolDef: ToolDefinition = {
    name: 'write_file',
    version: '1.0.0',
    description: 'Write contents to a file',
    category: ToolCategory.WRITE,
    riskLevel: ToolRiskLevel.LOW,
    mutating: true,
    requiredPermissions: [],
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } },
    },
  };

  const sampleGoal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'Add error handling to payment processor',
    status: GoalStatus.ACTIVE,
    constraints: {
      maxIterations: 5,
      maxCostDollars: 5.0,
      maxDurationMs: 10000,
      maxRepairAttempts: 2,
      maxNoProgressIterations: 2,
      requireVerification: false,
    },
    createdAt: clock.now(),
    updatedAt: clock.now(),
    metadata: {},
  };

  const sampleTask: Task = {
    id: idFactory.create<'Task'>(),
    goalId: sampleGoal.id,
    description: 'Implement retry and validation in payment.ts',
    status: TaskStatus.ACTIVE,
    priority: 1,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    metadata: {},
  };

  it('1. Architect.plan calls architect model WITHOUT tools and returns structured Markdown plan', async () => {
    let capturedRequest: any;

    const architectPlanText = `## Changes Required
1. In \`src/payment.ts\`: Add try/catch block around charge() and validate card format.
2. In \`tests/payment.test.ts\`: Add test for invalid card format exception.`;

    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        (req) => {
          capturedRequest = req;
          return {
            content: architectPlanText,
            toolCalls: [],
            finishReason: FinishReason.STOP,
          };
        },
      ],
    });

    const messages: ModelMessage[] = [
      { role: MessageRole.USER, content: 'Please inspect payment system.' },
    ];

    const result = await ArchitectExecutor.plan({
      goal: sampleGoal,
      task: sampleTask,
      messages,
      architectProvider,
      architectModelId: 'o3-architect',
    });

    expect(result.plan).toBe(architectPlanText);
    expect(result.providerId).toBe('architect-provider');
    expect(result.modelId).toBe('o3-architect');
    expect(result.costDollars).toBeGreaterThanOrEqual(0);

    // CRITICAL: Verify Architect NEVER received tools schema
    expect(capturedRequest.tools).toBeUndefined();
    expect(capturedRequest.messages[0].content).toBe(ARCHITECT_SYSTEM_PROMPT);
  });

  it('2. Architect.execute calls editor model with plan and tool definitions, returning tool calls', async () => {
    let capturedRequest: any;

    const editorProvider = new ScriptedModelProvider({
      providerId: 'editor-provider',
      descriptor: editorDescriptor,
      steps: [
        (req) => {
          capturedRequest = req;
          return {
            content: 'Applying changes per architect plan.',
            toolCalls: [
              {
                id: 'call_edit_1',
                name: 'write_file',
                input: {
                  path: 'src/payment.ts',
                  content: 'export function charge() { /* with retry */ }',
                },
              },
            ],
            finishReason: FinishReason.TOOL_CALL,
          };
        },
      ],
    });

    const plan = `## Changes Required\n1. In \`src/payment.ts\`: Implement charge retry`;
    const messages: ModelMessage[] = [
      { role: MessageRole.USER, content: 'Please inspect payment system.' },
    ];

    const result = await ArchitectExecutor.execute({
      plan,
      messages,
      editorProvider,
      editorModelId: 'gpt-4o-mini-editor',
      tools: [mockToolDef],
    });

    expect(result.rawResponse.toolCalls).toHaveLength(1);
    expect(result.rawResponse.toolCalls[0]?.name).toBe('write_file');
    expect(result.providerId).toBe('editor-provider');
    expect(result.modelId).toBe('gpt-4o-mini-editor');

    // Verify Editor received tools
    expect(capturedRequest.tools).toHaveLength(1);
    expect(capturedRequest.tools[0].name).toBe('write_file');
    // Verify Editor received plan in messages
    const planMessage = capturedRequest.messages.find((m: ModelMessage) =>
      m.content.includes('[ARCHITECT PLAN]'),
    );
    expect(planMessage).toBeDefined();
    expect(planMessage?.content).toContain(plan);
  });

  it('3. executePlanAndExecute runs end-to-end plan->execute flow, tracks separate costs and emits telemetry', async () => {
    const architectPlanText = `## Changes Required\n1. In \`src/foo.ts\`: Fix calculation bug`;

    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: architectPlanText,
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const editorProvider = new ScriptedModelProvider({
      providerId: 'editor-provider',
      descriptor: editorDescriptor,
      steps: [
        {
          content: 'Applied changes.',
          toolCalls: [
            {
              id: 'call_1',
              name: 'write_file',
              input: { path: 'src/foo.ts', content: 'export const val = 42;' },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
      ],
    });

    const router = new UtilityModelRouter({
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'o3-architect',
        editorProviderId: 'editor-provider',
        editorModelId: 'gpt-4o-mini-editor',
      },
    });
    router.registerProvider(architectProvider);
    router.registerProvider(editorProvider);

    const observerHub = new AgentObserverHub();
    const capturedEvents: any[] = [];
    observerHub.subscribe({
      onEvent: (evt) => capturedEvents.push(evt),
    });

    const executionId = idFactory.create<'Execution'>();

    const result = await ArchitectExecutor.executePlanAndExecute({
      goal: sampleGoal,
      task: sampleTask,
      messages: [{ role: MessageRole.USER, content: 'Fix calculation' }],
      router,
      tools: [mockToolDef],
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'o3-architect',
        editorProviderId: 'editor-provider',
        editorModelId: 'gpt-4o-mini-editor',
      },
      executionId,
      observerHub,
      clock,
    });

    expect(result.plan).toBe(architectPlanText);
    expect(result.architect.providerId).toBe('architect-provider');
    expect(result.editor.providerId).toBe('editor-provider');
    expect(result.combinedResponse.toolCalls).toHaveLength(1);
    expect(result.totalCostDollars).toBe(result.architect.costDollars + result.editor.costDollars);

    // Verify Telemetry Events
    const planEvent = capturedEvents.find((e) => e.type === AgentEventType.ArchitectPlanGenerated);
    expect(planEvent).toBeDefined();
    expect(planEvent.data.plan).toBe(architectPlanText);
    expect(planEvent.data.providerId).toBe('architect-provider');

    const editorEvent = capturedEvents.find((e) => e.type === AgentEventType.EditorExecuted);
    expect(editorEvent).toBeDefined();
    expect(editorEvent.data.toolCalls).toHaveLength(1);
    expect(editorEvent.data.providerId).toBe('editor-provider');
  });

  it('4. createPreStepListener generates plan on step 1 and injects cached plan on step 2+', async () => {
    const architectPlanText = `## Changes Required\n1. In \`src/config.ts\`: Update port`;

    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: architectPlanText,
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router = new UtilityModelRouter({
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'o3-architect',
        editorProviderId: 'editor-provider',
        editorModelId: 'gpt-4o-mini-editor',
      },
    });
    router.registerProvider(architectProvider);

    const preStepState = {};
    const listener = ArchitectExecutor.createPreStepListener(router, sampleGoal, sampleTask, {
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'o3-architect',
      },
      state: preStepState,
    });

    // Step 1: Generates plan and injects
    const step1Decision = await listener({
      messages: [{ role: MessageRole.USER, content: 'Start task' }],
      turn: 1,
      step: 1,
    });

    expect(step1Decision.kind).toBe('enter');
    if (step1Decision.kind === 'enter') {
      const planMsg = step1Decision.messages.find((m) => m.content.includes('[ARCHITECT PLAN]'));
      expect(planMsg).toBeDefined();
      expect(planMsg?.content).toContain(architectPlanText);
    }

    // Step 2: Uses cached plan without recalling architect model
    const step2Decision = await listener({
      messages: [{ role: MessageRole.USER, content: 'Next step' }],
      turn: 2,
      step: 2,
    });

    expect(step2Decision.kind).toBe('enter');
    if (step2Decision.kind === 'enter') {
      const planMsg = step2Decision.messages.find((m) => m.content.includes('[ARCHITECT PLAN]'));
      expect(planMsg).toBeDefined();
      expect(planMsg?.content).toContain(architectPlanText);
    }

    // Architect model called only once
    expect(architectProvider.requestHistory).toHaveLength(1);
  });
});
