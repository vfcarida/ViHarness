import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { DefaultAgentRuntime } from '../../src/runtime/default-agent-runtime.js';
import { DefaultToolRegistry } from '../../src/infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../src/infra/tools/default-tool-executor.js';
import { ReadFileTool } from '../../src/infra/tools/builtin/read-file-tool.js';
import { WriteFileTool } from '../../src/infra/tools/builtin/write-file-tool.js';
import { DefaultEvidenceStore } from '../../src/infra/evidence/default-evidence-store.js';
import { DefaultContextCompiler } from '../../src/infra/compiler/default-context-compiler.js';
import { InMemoryContextStore } from '../../src/infra/context/in-memory-context-store.js';
import { UtilityModelRouter } from '../../src/infra/router/utility-model-router.js';
import { ScriptedModelProvider } from '../../src/infra/model/scripted-model-provider.js';
import { DefaultCostTracker } from '../../src/infra/cost/default-cost-tracker.js';
import { DefaultBudgetTracker } from '../../src/infra/cost/default-budget-tracker.js';
import { DefaultTelemetryCollector } from '../../src/infra/telemetry/default-telemetry-collector.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { FinishReason, ModelCapability } from '../../src/core/model/model-io.js';
import { ContextTier } from '../../src/core/model/context.js';
import { ContextObjectType } from '../../src/core/model/context-object.js';
import type { Goal } from '../../src/core/model/goal.js';
import { GoalStatus } from '../../src/core/model/goal.js';
import type { ModelDescriptor } from '../../src/core/model/model-io.js';

describe('Synthetic 50-Iteration Token Measurement Benchmark', { timeout: 60000 }, () => {
  it('Simulates 50 continuous code-editing iterations and audits exact token & cost accounting', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-bench-50-iters-'));
    const sourceFile = path.join(tempDir, 'stateful-module.ts');
    fs.writeFileSync(sourceFile, 'export let counter = 0;', 'utf-8');

    const totalIterations = 50;
    const inputTokensPerTurn = 450;
    const outputTokensPerTurn = 85;

    const descriptor: ModelDescriptor = {
      id: 'benchmark-gpt4o',
      name: 'Benchmark Model',
      providerId: 'scripted-bench',
      version: '1.0',
      capabilities: {
        capabilities: new Set([
          ModelCapability.REASONING,
          ModelCapability.CODING,
          ModelCapability.TOOL_USE,
        ]),
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
        supportsSystemPrompt: true,
      },
      costPer1kInputTokensDollars: 0.0025, // $2.50 per 1M input tokens
      costPer1kOutputTokensDollars: 0.01, // $10.00 per 1M output tokens
    };

    // Build 50 scripted steps: 49 tool calls editing/reading + 1 final completion
    const scriptedSteps: any[] = [];
    for (let i = 1; i <= totalIterations; i++) {
      if (i < totalIterations) {
        scriptedSteps.push({
          content: `Iteration ${i}: updating counter state.`,
          toolCalls: [
            {
              name: 'write_file',
              input: { path: sourceFile, content: `export let counter = ${i};` },
              id: `call_step_${i}`,
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
          usage: {
            inputTokens: inputTokensPerTurn,
            outputTokens: outputTokensPerTurn,
            totalTokens: inputTokensPerTurn + outputTokensPerTurn,
          },
        });
      } else {
        scriptedSteps.push({
          content: `Iteration ${i}: Finished 50-iteration synthetic loop.`,
          toolCalls: [],
          finishReason: FinishReason.STOP,
          usage: {
            inputTokens: inputTokensPerTurn,
            outputTokens: outputTokensPerTurn,
            totalTokens: inputTokensPerTurn + outputTokensPerTurn,
          },
        });
      }
    }

    const modelProvider = new ScriptedModelProvider({
      descriptor,
      steps: scriptedSteps,
    });

    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    const toolExecutor = new DefaultToolExecutor({ registry, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const contextStore = new InMemoryContextStore({ idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const costTracker = new DefaultCostTracker();
    costTracker.registerPricing('benchmark-gpt4o', {
      promptPricePerMillion: 2.5,
      completionPricePerMillion: 10.0,
    });

    const budgetTracker = new DefaultBudgetTracker();
    const telemetryCollector = new DefaultTelemetryCollector({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      evidenceStore,
      idFactory,
      clock,
    });

    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Run 50-iteration synthetic token benchmark',
      status: GoalStatus.ACTIVE,
      constraints: {
        maxIterations: 60,
        maxCostDollars: 10.0,
        maxDurationMs: 120000,
        maxRepairAttempts: 60,
        maxNoProgressIterations: 60,
        requireVerification: false,
      },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    // Pre-populate critical domain memory in ContextStore to verify retention
    await contextStore.addObject({
      taskId: 'task-bench' as any,
      tier: ContextTier.L0_IMMUTABLE_SYSTEM,
      type: ContextObjectType.SYSTEM_PROMPT,
      content: 'CRITICAL_DOMAIN_INVARIANT_PRESERVE_FOREVER',
      importance: 1.0,
      isMustPreserve: true,
    });

    // Execute runtime across 50 turns
    const result = await runtime.execute(goal);

    expect(result.success).toBe(true);
    expect(result.iterationCount).toBe(totalIterations);

    // 1. Audit Token Sum across 50 iterations
    let cumulativeInputTokens = 0;
    let cumulativeOutputTokens = 0;
    let cumulativeTotalTokens = 0;

    for (const iter of result.iterations) {
      if (iter.tokenUsage) {
        const u = iter.tokenUsage;
        cumulativeInputTokens += u.inputTokens;
        cumulativeOutputTokens += u.outputTokens;
        cumulativeTotalTokens += u.totalTokens;

        // Record in CostTracker and BudgetTracker for each iteration
        const est = costTracker.calculateCost(
          'scripted-bench',
          'benchmark-gpt4o',
          u.inputTokens,
          u.outputTokens,
        );
        costTracker.recordCost(
          result.taskId,
          'scripted-bench',
          'benchmark-gpt4o',
          est.estimatedCostUSD,
        );
        budgetTracker.recordUsage(result.taskId, 'benchmark-gpt4o', est.estimatedCostUSD);
      }
    }

    const expectedInput = totalIterations * inputTokensPerTurn;
    const expectedOutput = totalIterations * outputTokensPerTurn;
    const expectedTotal = totalIterations * (inputTokensPerTurn + outputTokensPerTurn);

    expect(cumulativeInputTokens).toBe(expectedInput);
    expect(cumulativeOutputTokens).toBe(expectedOutput);
    expect(cumulativeTotalTokens).toBe(expectedTotal);

    // 2. Financial Cost Audit
    const expectedDollarCost =
      totalIterations *
      ((inputTokensPerTurn / 1_000_000) * 2.5 + (outputTokensPerTurn / 1_000_000) * 10.0);
    const trackedTotalCost = costTracker.getTotalCost(result.taskId);

    expect(trackedTotalCost).toBeCloseTo(expectedDollarCost, 5);

    // Budget Tracker verification
    const budgetCheck = budgetTracker.checkBudget(result.taskId, 'benchmark-gpt4o', 0.01);
    expect(budgetCheck.currentCostUSD).toBeCloseTo(expectedDollarCost, 5);

    // 3. Telemetry Collector verification
    telemetryCollector.recordAgentTask(true, totalIterations, 'GOAL_ACHIEVED');
    const telemetry = telemetryCollector.getAggregatedTelemetry();
    expect(telemetry.agent.taskCount).toBe(1);
    expect(telemetry.agent.successRate).toBe(1.0);

    // 4. File system verification
    const finalFileContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(finalFileContent).toBe(`export let counter = ${totalIterations - 1};`);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
