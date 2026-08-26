/**
 * End-to-End Integration Tests for Architect Mode & Pre-Step Interception.
 *
 * Validates:
 * 1. End-to-end execution of DefaultAgentRuntime with architectMode: true.
 * 2. Architect model never sees tool schemas; Editor model receives plan and tool schemas.
 * 3. Separate cost and token accounting for architect and editor in iteration records.
 * 4. Observable events (ArchitectPlanGenerated, EditorExecuted) emitted during execution.
 * 5. Pre-step waterfall interception modifying messages and enforcing security gates.
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
  AgentEventType,
} from '../../src/core/index.js';
import type { PreStepListener } from '../../src/core/model/pre-step.js';

describe('Architect Mode (Dual-Model Plan->Execute) & Pre-Step Interception E2E Flow', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  const architectDescriptor: ModelDescriptor = {
    id: 'gpt-5-architect',
    name: 'Frontier Architect Reasoning Model',
    providerId: 'architect-provider',
    version: '1.0.0',
    capabilities: {
      capabilities: new Set([ModelCapability.REASONING, ModelCapability.CODING]),
      maxContextTokens: 200000,
      maxOutputTokens: 32000,
      supportsSystemPrompt: true,
    },
    costPer1kInputTokensDollars: 0.015,
    costPer1kOutputTokensDollars: 0.06,
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

  it('1. End-to-end task execution in Architect Mode (Plan -> Execute -> Write -> Done)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-arch-mode-'));
    const targetFile = path.join(tempDir, 'math-service.ts');
    fs.writeFileSync(targetFile, 'export function add() { return 0; }', 'utf-8');

    const toolRegistry = new DefaultToolRegistry();
    const writeTool: Tool = {
      definition: {
        name: 'write_code',
        version: '1.0.0',
        description: 'Writes code to file',
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

    // Architect Provider: Produces natural language Markdown plans
    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: `## Changes Required\n1. In \`${targetFile}\`: Rewrite add(a, b) to return a + b.`,
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
        {
          content: `## Changes Required\nAll required changes are completed and verified.`,
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    // Editor Provider: Translates architectural plan into tool calls
    const editorProvider = new ScriptedModelProvider({
      providerId: 'editor-provider',
      descriptor: editorDescriptor,
      steps: [
        {
          content: 'Executing plan: updating math-service.ts',
          toolCalls: [
            {
              id: 'call_edit_1',
              name: 'write_code',
              input: {
                path: targetFile,
                code: 'export function add(a: number, b: number) { return a + b; }',
              },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Verification complete. Task finished.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router = new UtilityModelRouter({
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'gpt-5-architect',
        editorProviderId: 'editor-provider',
        editorModelId: 'gpt-4o-mini-editor',
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

    const capturedEvents: any[] = [];
    runtime.subscribe({
      onEvent: (evt) => capturedEvents.push(evt),
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Implement addition logic in math-service.ts',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 4,
        maxCostDollars: 10.0,
        maxDurationMs: 15000,
        maxRepairAttempts: 2,
        maxNoProgressIterations: 2,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal, {
      architectMode: true,
      dualModelConfig: {
        architectProviderId: 'architect-provider',
        architectModelId: 'gpt-5-architect',
        editorProviderId: 'editor-provider',
        editorModelId: 'gpt-4o-mini-editor',
      },
    });

    expect(result.success).toBe(true);
    expect(result.iterationCount).toBeGreaterThanOrEqual(1);

    // 1. Verify Architect requests NEVER had tools schema
    for (const req of architectProvider.requestHistory) {
      expect(req.tools).toBeUndefined();
    }

    // 2. Verify Editor requests HAD tools schema
    for (const req of editorProvider.requestHistory) {
      expect(req.tools).toBeDefined();
      expect(req.tools?.length).toBeGreaterThan(0);
    }

    // 3. Verify file on disk was modified by editor tool call
    const updatedContent = fs.readFileSync(targetFile, 'utf-8');
    expect(updatedContent).toContain('return a + b;');

    // 4. Verify separate cost & token tracking in iteration records
    const firstIter = result.iterations[0]!;
    expect(firstIter.phases?.modelDecision.isArchitectMode).toBe(true);
    expect(firstIter.phases?.modelDecision.architect).toBeDefined();
    expect(firstIter.phases?.modelDecision.editor).toBeDefined();
    expect(firstIter.phases?.modelDecision.architect?.providerId).toBe('architect-provider');
    expect(firstIter.phases?.modelDecision.editor?.providerId).toBe('editor-provider');
    expect(firstIter.metadata?.['architectMode']).toBe(true);
    expect(firstIter.metadata?.['architectCostDollars']).toBeDefined();
    expect(firstIter.metadata?.['editorCostDollars']).toBeDefined();

    // 5. Verify telemetry events emitted
    const planEvents = capturedEvents.filter(
      (e) => e.type === AgentEventType.ArchitectPlanGenerated,
    );
    expect(planEvents.length).toBeGreaterThanOrEqual(1);

    const editorEvents = capturedEvents.filter((e) => e.type === AgentEventType.EditorExecuted);
    expect(editorEvents.length).toBeGreaterThanOrEqual(1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. Pre-Step Interception waterfall in Agent Runtime (Context Injection & Rejection Guard)', async () => {
    const architectProvider = new ScriptedModelProvider({
      providerId: 'architect-provider',
      descriptor: architectDescriptor,
      steps: [
        {
          content: 'Normal task execution',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router = new UtilityModelRouter();
    router.registerProvider(architectProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler: new DefaultContextCompiler({ idFactory, clock }),
      idFactory,
      clock,
    });

    // Test 2a: Context Injection Listener
    let capturedPrompt = '';
    const enricherListener: PreStepListener = (evt) => {
      const enriched = evt.messages.map((m) => {
        if (m.role === MessageRole.USER) {
          capturedPrompt = `${m.content} [INJECTED_CONTEXT]`;
          return { ...m, content: capturedPrompt };
        }
        return m;
      });
      return { kind: 'enter', messages: enriched };
    };

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Run with pre-step enrichment',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 2,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal, {
      preStepInterceptors: [enricherListener],
    });

    expect(result.success).toBe(true);
    expect(capturedPrompt).toContain('[INJECTED_CONTEXT]');

    // Test 2b: Pre-step Rejection Guard
    const rejectListener: PreStepListener = () => {
      return { kind: 'reject', reason: 'Blocked by policy rule 403' };
    };

    const rejectedGoal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Run with pre-step reject',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 2,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const rejectResult = await runtime.execute(rejectedGoal, {
      preStepInterceptors: [rejectListener],
    });

    // Verify iteration recorded rejection evidence
    expect(
      rejectResult.iterations[0]?.evidenceCreated.some((e) =>
        e.summary.includes('PRE_STEP_REJECTED'),
      ),
    ).toBe(true);
  });
});
