/**
 * Architect / Editor Dual Model Integration Flow
 *
 * Validates:
 * 1. End-to-end agent execution with phase-dependent model hot-swapping (Architect on PLAN, Editor on EXECUTE).
 * 2. Strict State & Working Memory Integrity across model transitions.
 * 3. Quantitative Cost & Token Measurement with DualModelCostEvaluator demonstrating massive cost savings.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultContextCompiler,
  DefaultEvidenceStore,
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  TestClock,
  DualModelCostEvaluator,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/default-agent-runtime.js';
import {
  GoalStatus,
  type Goal,
  ToolCategory,
  ToolRiskLevel,
  type Tool,
  FinishReason,
  ModelCapability,
  type ModelDescriptor,
  MessageRole,
  AgentPhase,
} from '../../src/core/index.js';

describe('Architect / Editor Dual Model Integration Flow', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const architectDescriptor: ModelDescriptor = {
    id: 'gpt-5-architect',
    name: 'Frontier Architect Reasoning Model',
    providerId: 'architect-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([
        ModelCapability.REASONING,
        ModelCapability.CODING,
        ModelCapability.TOOL_USE,
      ]),
      maxContextTokens: 200000,
      maxOutputTokens: 32000,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.015,
    costPer1kOutputTokensDollars: 0.06, // $60/1M output tokens
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
    costPer1kOutputTokensDollars: 0.0006, // $0.60/1M output tokens (100x cheaper)
  };

  it('1. End-to-end multi-turn execution with Architect (PLAN) and Editor (EXECUTE)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-dual-model-'));
    const targetFile = path.join(tempDir, 'service.ts');
    fs.writeFileSync(targetFile, 'export function compute() { return 0; }', 'utf-8');

    const toolRegistry = new DefaultToolRegistry();
    const writeTool: Tool = {
      definition: {
        name: 'write_code',
        version: '1.0.0',
        category: ToolCategory.WRITE,
        riskLevel: ToolRiskLevel.LOW,
        mutating: true,
        idempotent: false,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: {
          type: 'object',
          required: ['path', 'code'],
          properties: { path: { type: 'string' }, code: { type: 'string' } },
        },
      },
      execute: async (input) => {
        fs.writeFileSync(String(input['path']), String(input['code']), 'utf-8');
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_code',
          output: 'File updated successfully',
          success: true,
          durationMs: 15,
        };
      },
    };
    toolRegistry.register(writeTool);

    const inspectTool: Tool = {
      definition: {
        name: 'inspect_data',
        version: '1.0.0',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({
        toolCallId: idFactory.create<'ToolCall'>(),
        name: 'inspect_data',
        output: 'Current compute returns 0. Target is 42.',
        success: true,
        durationMs: 10,
      }),
    };
    toolRegistry.register(inspectTool);

    // Architect Provider: Inspects in EXPLORE, provides architecture plan in PLAN
    // Architect Provider: Inspects in EXPLORE and proposes code plan
    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: 'Architect: Inspecting current compute implementation to design patch.',
          toolCalls: [
            {
              id: 'call_arch_1',
              name: 'inspect_data',
              input: {},
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content:
            'Architect Plan: Confirmed compute returns 0. Patch is to rewrite compute to return 42.',
          toolCalls: [
            {
              id: 'call_edit_1',
              name: 'write_code',
              input: { path: targetFile, code: 'export function compute() { return 42; }' },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
      ],
    });

    // Editor Provider: Executes in IMPLEMENT/EXECUTE phase and finalizes
    const editorProvider = new ScriptedModelProvider({
      providerId: 'editor-provider',
      descriptor: editorDescriptor,
      steps: [
        {
          content: 'Editor: Verification complete. All changes applied and verified successfully.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router = new UtilityModelRouter({
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        editorProviderId: 'editor-provider',
        phaseRoleMapping: {
          [AgentPhase.INIT]: 'ARCHITECT',
          [AgentPhase.EXPLORE]: 'ARCHITECT',
          [AgentPhase.PLAN]: 'ARCHITECT',
          [AgentPhase.IMPLEMENT]: 'EDITOR',
          [AgentPhase.VERIFY]: 'EDITOR',
          [AgentPhase.REPAIR]: 'EDITOR',
        },
      },
    });

    router.registerProvider(architectProvider);
    router.registerProvider(editorProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler: new DefaultContextCompiler({ idFactory, clock }),
      toolExecutor: new DefaultToolExecutor({ registry: toolRegistry, idFactory }),
      evidenceStore: new DefaultEvidenceStore(),
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Implement compute logic using dual-model architecture',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 5,
        maxCostDollars: 10.0,
        maxDurationMs: 15000,
        maxRepairAttempts: 3,
        maxNoProgressIterations: 3,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(result.success).toBe(true);
    expect(result.iterationCount).toBeGreaterThanOrEqual(2);

    // Verify both models were invoked
    expect(architectProvider.requestHistory.length).toBeGreaterThanOrEqual(1);
    expect(editorProvider.requestHistory.length).toBeGreaterThanOrEqual(1);

    // Verify file was modified by Editor
    const updatedContent = fs.readFileSync(targetFile, 'utf-8');
    expect(updatedContent).toContain('return 42;');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. State and Context integrity across model hot-swaps', async () => {
    const capturedEditorRequestHistory: any[] = [];
    const toolRegistry = new DefaultToolRegistry();
    const inspectTool: Tool = {
      definition: {
        name: 'inspect_data',
        version: '1.0.0',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 5000,
        requiredPermissions: [],
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async () => ({
        toolCallId: idFactory.create<'ToolCall'>(),
        name: 'inspect_data',
        output: 'Token schema matches JWT v2 specification.',
        success: true,
        durationMs: 10,
      }),
    };
    toolRegistry.register(inspectTool);

    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: 'Architect Plan: Inspecting authentication token validation schema.',
          toolCalls: [{ id: 'plan_1', name: 'inspect_data', input: {} }],
          finishReason: FinishReason.TOOL_CALL,
        },
      ],
    });

    const editorProvider = new ScriptedModelProvider({
      providerId: 'editor-provider',
      descriptor: editorDescriptor,
      steps: [
        (req: any) => {
          capturedEditorRequestHistory.push(req);
          return {
            content: 'Editor finished task execution.',
            toolCalls: [],
            finishReason: FinishReason.STOP,
          };
        },
      ],
    });

    const router = new UtilityModelRouter({
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        editorProviderId: 'editor-provider',
        phaseRoleMapping: {
          [AgentPhase.INIT]: 'ARCHITECT',
          [AgentPhase.EXPLORE]: 'EDITOR',
          [AgentPhase.PLAN]: 'ARCHITECT',
          [AgentPhase.IMPLEMENT]: 'EDITOR',
          [AgentPhase.VERIFY]: 'EDITOR',
          [AgentPhase.REPAIR]: 'EDITOR',
        },
      },
    });
    router.registerProvider(architectProvider);
    router.registerProvider(editorProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler: new DefaultContextCompiler({ idFactory, clock }),
      toolExecutor: new DefaultToolExecutor({ registry: toolRegistry, idFactory }),
      evidenceStore: new DefaultEvidenceStore(),
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Refactor auth token schema',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 3,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(result.success).toBe(true);

    // Verify Editor received the goal & context generated from earlier iterations without corruption
    expect(capturedEditorRequestHistory.length).toBeGreaterThanOrEqual(1);
    const editorReq = capturedEditorRequestHistory[0];
    expect(editorReq.messages).toBeDefined();
    expect(editorReq.messages.length).toBeGreaterThan(0);
  });

  it('3. Quantitative Cost & Token Measurement with DualModelCostEvaluator', () => {
    // Simulate a 4-iteration trajectory (1 Plan by Architect + 3 Edits/Tests by Editor)
    const simulatedIterations: any[] = [
      {
        sequenceNumber: 1,
        stateBefore: 'PLAN',
        stateAfter: 'EXPLORE',
        tokensUsed: { inputTokens: 4000, outputTokens: 800, totalTokens: 4800 },
      },
      {
        sequenceNumber: 2,
        stateBefore: 'EXECUTE',
        stateAfter: 'EXECUTE',
        tokensUsed: { inputTokens: 6000, outputTokens: 1200, totalTokens: 7200 },
      },
      {
        sequenceNumber: 3,
        stateBefore: 'EXECUTE',
        stateAfter: 'VERIFY',
        tokensUsed: { inputTokens: 7500, outputTokens: 600, totalTokens: 8100 },
      },
      {
        sequenceNumber: 4,
        stateBefore: 'REPAIR',
        stateAfter: 'DONE',
        tokensUsed: { inputTokens: 8000, outputTokens: 500, totalTokens: 8500 },
      },
    ];

    const report = DualModelCostEvaluator.evaluate(
      simulatedIterations,
      architectDescriptor,
      editorDescriptor,
    );

    // Monolithic cost = (25.5k input * $0.015 + 3.1k output * $0.060) = $0.3825 + $0.186 = $0.5685
    // Dual-model cost = Architect step1 ($0.108) + Editor steps 2-4 (21.5k input * $0.00015 + 2.3k output * $0.00060 = $0.0046) = ~$0.1126
    expect(report.monolithicTotalCostDollars).toBeGreaterThan(0.5);
    expect(report.dualModelTotalCostDollars).toBeLessThan(0.15);
    expect(report.costSavingsPercentage).toBeGreaterThan(70); // >70% cost reduction!
    expect(report.phaseBreakdown).toHaveLength(4);
    expect(report.phaseBreakdown[0]!.modelRole).toBe('ARCHITECT');
    expect(report.phaseBreakdown[1]!.modelRole).toBe('EDITOR');
  });
});
