/**
 * Meta-Harness Production Flow Integration Test Suite.
 *
 * Verifies end-to-end production readiness integrating:
 * 1. Meta-Harness Structured Causal Trace Logger (.vi-traces/ export).
 * 2. Prefix Caching Compiler with ephemeral cache controls.
 * 3. Loop Fingerprinter & Oscillation Anomaly Monitor.
 * 4. Selective Impacted Test Selector.
 * 5. Multi-Tool Execution, Deny-First Security Policy, and Evidence Invariants.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MetaHarnessTraceLogger,
  PrefixCachingCompiler,
  ImpactedTestSelector,
  DefaultPolicyEngine,
  DefaultToolRegistry,
  DefaultToolExecutor,
  ReadFileTool,
  WriteFileTool,
  DefaultEvidenceStore,
  DefaultContextCompiler,
  ScriptedModelProvider,
  UtilityModelRouter,
  SystemClock,
  UuidV7IdFactory,
} from '../../src/infra/index.js';
import { LoopFingerprinter, DefaultAgentRuntime } from '../../src/runtime/index.js';
import { Goal, GoalStatus, FinishReason, MessageRole, AgentPhase } from '../../src/core/index.js';

describe('Meta-Harness Production Flow Integration Suite', () => {
  it('executes autonomous task with prefix caching, causal trace logging, loop fingerprinting, and impacted test selection', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new SystemClock();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-meta-test-'));
    const tracesDir = path.join(tempDir, 'traces');
    fs.mkdirSync(tracesDir, { recursive: true });

    const sourceFile = path.join(tempDir, 'payment.ts');
    fs.writeFileSync(
      sourceFile,
      'export function processPayment(amount: number) { if (amount <= 0) return false; return true; }',
      'utf-8',
    );

    // 1. Setup Meta-Harness Trace Logger
    const traceLogger = new MetaHarnessTraceLogger({ outputDir: tracesDir, writeToDisk: true });

    // 2. Setup Prefix Caching Compilation
    const promptPayload = PrefixCachingCompiler.compile({
      systemPrompt: 'You are an enterprise software engineering agent.',
      codingStandards: 'Clean Code, 100% test pass required.',
      toolSchemasText: 'read_file(path), write_file(path, content)',
      repoMapOutline: 'class PaymentProcessor { processPayment(amount) }',
      taskDescription: 'Refactor payment validation to support currency codes',
      currentPhase: 'DECIDE',
      iterationNumber: 1,
      dynamicObservations: ['Initial inspect of payment.ts'],
    });

    expect(promptPayload.staticTokenRatio).toBeGreaterThan(0.3);
    expect(promptPayload.segments[0]!.cacheControl).toEqual({ type: 'ephemeral' });

    // 3. Setup Loop Fingerprinter
    const fingerprinter = new LoopFingerprinter();
    const anomaly = fingerprinter.recordAndInspect(
      {
        phase: 'IMPLEMENT',
        modifiedFiles: [sourceFile],
        proposedToolNames: ['write_file'],
        hypothesis: 'Add currency code parameter',
      },
      1,
    );
    expect(anomaly).toBeNull(); // Clean first turn

    // 4. Setup Impacted Test Selector
    const testSelector = new ImpactedTestSelector();
    const selection = testSelector.selectImpactedTests({
      modifiedFiles: [sourceFile],
      allAvailableTestFiles: ['tests/unit/payment.test.ts', 'tests/unit/auth.test.ts'],
      isFinalAcceptancePass: false,
    });
    expect(selection.selectedTestFiles).toContain('tests/unit/payment.test.ts');
    expect(selection.selectedTestFiles).not.toContain('tests/unit/auth.test.ts');

    // 5. Setup Tool Registry & Executor
    const registry = new DefaultToolRegistry();
    registry.register(new ReadFileTool(idFactory));
    registry.register(new WriteFileTool(idFactory));

    const policyEngine = new DefaultPolicyEngine();
    const toolExecutor = new DefaultToolExecutor({ registry, policyEngine, idFactory });
    const evidenceStore = new DefaultEvidenceStore();
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    // 6. Scripted Multi-Turn Execution
    const scriptedSteps = [
      // Turn 1: Read payment.ts
      {
        content: 'I will read payment.ts to check current validation.',
        toolCalls: [{ name: 'read_file', input: { path: sourceFile }, id: 'c_read_pay' }],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Turn 2: Write updated payment.ts
      {
        content: 'I will add currency check support.',
        toolCalls: [
          {
            name: 'write_file',
            input: {
              path: sourceFile,
              content:
                'export function processPayment(amount: number, currency = "USD") { if (amount <= 0) return false; return currency === "USD" || currency === "EUR"; }',
            },
            id: 'c_write_pay',
          },
        ],
        finishReason: FinishReason.TOOL_CALL,
      },
      // Turn 3: Complete
      {
        content: 'Payment module refactored and verified successfully.',
        toolCalls: [],
        finishReason: FinishReason.STOP,
      },
    ];

    const modelProvider = new ScriptedModelProvider({ steps: scriptedSteps });
    const router = new UtilityModelRouter();
    router.registerProvider(modelProvider);

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      policyEngine,
      toolExecutor,
      evidenceStore,
      idFactory,
      clock,
    });

    const executionId = idFactory.create<'Execution'>();
    const goal: Goal = {
      id: idFactory.create<'Goal'>(),
      description: 'Support currency codes in payment processor',
      status: GoalStatus.ACTIVE,
      constraints: { maxIterations: 5, requireVerification: false },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      metadata: {},
    };

    const result = await runtime.execute(goal);
    expect(result.success).toBe(true);
    expect(result.iterationCount).toBe(3);

    // 7. Verify updated file content
    const updatedContent = fs.readFileSync(sourceFile, 'utf-8');
    expect(updatedContent).toContain('currency === "USD"');

    // 8. Record in Meta-Harness Trace Logger
    const summary = traceLogger.finalizeExecution({
      executionId,
      taskId: idFactory.create<'Task'>(),
      goalDescription: goal.description,
      success: true,
      finalPhase: AgentPhase.DONE,
      startedAt: new Date(Date.now() - 500),
      finishedAt: new Date(),
    });

    expect(summary.success).toBe(true);
    expect(summary.finalPhase).toBe(AgentPhase.DONE);

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
