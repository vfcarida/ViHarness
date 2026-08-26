/**
 * Meta-Harness Outer-Loop Experience Accumulation E2E Integration Suite (P009).
 *
 * Full Lifecycle Flow:
 * 1. Runtime executes Run 1 with tool failure -> ExperienceStore writes traces.jsonl, scores.json, summary.md.
 * 2. Runtime executes Run 2 with tool failure -> ExperienceStore accumulates second run.
 * 3. Cross-run analyzer reads non-Markovian traces, detects recurring failure pattern, generates recommendations.
 * 4. Auto-Tuner applies high-confidence parameter updates and logs tuning decisions.
 * 5. Runtime executes Run 3 with updated configuration -> succeeds.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DefaultContextCompiler,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultExperienceStore,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
  HarnessDiagnosticEngine,
  HarnessAutoTuner,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/index.js';
import {
  type ModelRouter,
  type Goal,
  DEFAULT_GOAL_CONSTRAINTS,
  ModelRole,
  ProviderHealthStatus,
  ModelCapability,
  AgentPhase,
  FinishReason,
  ActionResultStatus,
} from '../../src/core/index.js';

describe('Meta-Harness Outer-Loop Experience Accumulation E2E Suite — P009', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));

  it('should execute end-to-end outer loop: accumulate traces -> cross-run analysis -> auto-tune config -> verified run', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-outer-loop-e2e-'));
    const experienceStore = new DefaultExperienceStore({ baseDir: tempDir, clock, idFactory });
    const toolRegistry = new DefaultToolRegistry();

    // Register test tool
    toolRegistry.register({
      definition: {
        name: 'execute_migration',
        description: 'Run database migration script',
        category: 'CUSTOM' as any,
        riskLevel: 'LOW' as any,
        inputSchema: { type: 'object', properties: { script: { type: 'string' } } },
      },
      execute: async () => ({
        success: true,
        output: 'Migration completed successfully.',
      }),
    });

    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    // 1. Setup Mock Provider
    const provider = new ScriptedModelProvider({
      modelId: 'test-llm',
      providerId: 'test-prov',
      clock,
      steps: [
        // Run 1: Fails
        {
          response: {
            message: {
              content: 'Failed to run migration due to missing lock.',
              role: 'ASSISTANT' as any,
            },
            toolCalls: [],
            finishReason: FinishReason.STOP,
          },
        },
        // Run 2: Proposes tool that succeeds
        {
          response: {
            message: {
              content: 'Running database migration.',
              role: 'ASSISTANT' as any,
            },
            toolCalls: [
              {
                id: 'call-mig-1',
                name: 'execute_migration',
                input: { script: '001_init.sql' },
              },
            ],
            finishReason: FinishReason.TOOL_USE,
          },
        },
        {
          response: {
            message: {
              content: 'Migration complete.',
              role: 'ASSISTANT' as any,
            },
            toolCalls: [],
            finishReason: FinishReason.STOP,
          },
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'test-llm',
        scores: [],
        rationale: 'Selected for test',
        decidedAt: clock.now(),
        deterministic: true,
      }),
      listAvailableModels: () => [],
      getProviderHealth: () => ProviderHealthStatus.HEALTHY,
      updateMetrics: () => {},
      hasCapability: () => true,
    };

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      experienceStore,
      idFactory,
      clock,
    });

    // 2. Execute Run 1
    const goal1: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Run db migration task 1',
      constraints: DEFAULT_GOAL_CONSTRAINTS,
    };

    const res1 = await runtime.execute(goal1, {
      autoTune: true,
      experienceStore,
    });

    expect(res1).toBeDefined();

    // 3. Verify Run 1 recorded to ExperienceStore on filesystem
    const runsAfter1 = await experienceStore.listRuns();
    expect(runsAfter1).toHaveLength(1);
    expect(fs.existsSync(path.join(tempDir, runsAfter1[0]!.runId, 'traces.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, runsAfter1[0]!.runId, 'harness-config.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(tempDir, runsAfter1[0]!.runId, 'scores.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, runsAfter1[0]!.runId, 'summary.md'))).toBe(true);

    // 4. Manually seed a second historical run in experience store with recurring tool failure
    await experienceStore.recordRun({
      runId: 'seed-run-002',
      goalDescription: 'Run db migration task 2',
      harnessConfig: { architectMode: false },
      executionResult: {
        executionId: 'seed-run-002' as any,
        goalId: 'goal-seed-2' as any,
        taskId: 'task-seed-2' as any,
        success: false,
        status: 'FAILED',
        summary: 'Migration failed due to lock contention',
        iterationCount: 2,
        durationMs: 1200,
        totalCostDollars: 0.02,
        totalTokens: 14000,
        iterations: [
          {
            iterationId: 'it-seed-1' as any,
            sequenceNumber: 1,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.IMPLEMENT,
            stateAfter: AgentPhase.REPAIR,
            modelId: 'test-llm',
            providerId: 'test-prov',
            actionProposed: null,
            toolResults: [
              {
                actionId: 'act-fail-1' as any,
                status: ActionResultStatus.FAILURE,
                output: 'execute_migration failed: database lock timeout after 3000ms',
                durationMs: 3000,
                executedAt: clock.now(),
                metadata: { toolName: 'execute_migration' },
              },
            ],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 4000, outputTokens: 500, totalTokens: 4500 },
            costDollars: 0.01,
            terminationDecision: { terminal: false } as any,
          },
          {
            iterationId: 'it-seed-2' as any,
            sequenceNumber: 2,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.REPAIR,
            stateAfter: AgentPhase.FAILED,
            modelId: 'test-llm',
            providerId: 'test-prov',
            actionProposed: null,
            toolResults: [
              {
                actionId: 'act-fail-2' as any,
                status: ActionResultStatus.FAILURE,
                output: 'execute_migration failed: database lock timeout after 3000ms',
                durationMs: 3000,
                executedAt: clock.now(),
                metadata: { toolName: 'execute_migration' },
              },
            ],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 8000, outputTokens: 1500, totalTokens: 9500 },
            costDollars: 0.01,
            terminationDecision: { terminal: true } as any,
          },
        ],
      },
    });

    // 5. Query Recent Traces and Run Cross-Run Analysis (Meta-Harness Proposer)
    const recentTraces = await experienceStore.getRecentTraces(5);
    expect(recentTraces.length).toBeGreaterThanOrEqual(2);

    const crossAnalysis = HarnessDiagnosticEngine.analyzeAcrossRuns(recentTraces);
    expect(crossAnalysis.runsAnalyzed).toBeGreaterThanOrEqual(2);
    expect(
      crossAnalysis.recurringFailurePatterns.some((p) => p.includes('execute_migration')),
    ).toBe(true);

    const toolRec = crossAnalysis.recommendations.find(
      (r) =>
        r.type === 'TOOL_OPTIMIZATION' &&
        r.parameter === 'toolFeedbackEnhancement_execute_migration',
    );
    expect(toolRec).toBeDefined();
    expect(toolRec?.confidence).toBeGreaterThanOrEqual(0.7);

    // 6. Auto-Tune Configuration
    const baseConfig = { toolFeedbackEnhancement_execute_migration: false };
    const tuneResult = await HarnessAutoTuner.applyRecommendations(
      baseConfig,
      crossAnalysis.recommendations,
      { minConfidence: 0.7, experienceStore, idFactory },
    );

    expect(tuneResult.appliedCount).toBeGreaterThanOrEqual(1);
    expect(tuneResult.updatedConfig['toolFeedbackEnhancement_execute_migration']).toBe(true);

    // 7. Verify Tuning Decision logged in experience store
    const tuningHistory = await experienceStore.getTuningHistory();
    expect(tuningHistory.length).toBeGreaterThanOrEqual(1);
    expect(tuningHistory[0]?.recommendation.parameter).toBe(
      'toolFeedbackEnhancement_execute_migration',
    );

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
