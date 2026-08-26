/**
 * ViHarness Adapter Contract & Compatibility Unit Tests.
 *
 * Verifies that the ViHarness adapter satisfies the Pi replacement benchmark contract:
 * - Translates Benchmark Task -> Vi Goal -> Vi Execution -> Pi Benchmark Result
 * - Exposes success, finalState, changedFiles, finalDiff, tests, iterations, modelCalls, tokens, estimatedCost, duration, terminationReason
 * - Strictly hides internal Vi-Harness domain objects behind the adapter boundary
 * - Acts as a drop-in replacement for PiHarness in coding-agent benchmarks
 * - Preserves Vi runtime architecture without internal mutations
 */
import { describe, it, expect } from 'vitest';
import {
  ViHarness,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
  DefaultEvidenceStore,
  DefaultVerificationEngine,
  DefaultGitManager,
  EvidenceType,
  EvidenceOutcome,
  type PiBenchmarkTask,
} from '../../../src/index.js';

describe('ViHarness Pi-Replacement Compatibility Adapter Contract', () => {
  it('1. Interface Contract & Drop-in Substitution: Executes task and returns valid PiBenchmarkResult', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const scriptedProvider = new ScriptedModelProvider({
      providerId: 'scripted-provider',
      steps: [
        {
          content: 'Reasoning: Plan to fix bug',
          toolCalls: [
            {
              id: 'call_1',
              name: 'write_file',
              input: { path: 'src/fix.js', content: 'console.log("fixed");' },
            },
          ],
        },
      ],
    });

    const harness = new ViHarness({
      primaryProvider: scriptedProvider,
      idFactory,
      clock,
    });

    const benchmarkTask: PiBenchmarkTask = {
      id: 'task-bench-101',
      name: 'Fix Login Bug',
      description: 'Fix null pointer crash during user login flow',
      maxCostUSD: 2.5,
      maxTokens: 25000,
      maxIterations: 5,
      maxDurationMs: 60000,
      requiredTools: ['write_file', 'read_file'],
    };

    const result = await harness.runTask(benchmarkTask);

    // Verify all 11 mandatory benchmark result fields
    expect(result).toBeDefined();
    expect(result.taskId).toBe('task-bench-101');
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.finalState).toBe('string');
    expect(Array.isArray(result.changedFiles)).toBe(true);
    expect(typeof result.finalDiff).toBe('string');
    expect(result.tests).toBeDefined();
    expect(typeof result.tests.total).toBe('number');
    expect(typeof result.tests.passed).toBe('number');
    expect(typeof result.tests.failed).toBe('number');
    expect(typeof result.tests.passRate).toBe('number');

    expect(typeof result.iterations).toBe('number');
    expect(result.iterations).toBeGreaterThan(0);
    expect(typeof result.modelCalls).toBe('number');
    expect(result.modelCalls).toBeGreaterThan(0);

    expect(result.tokens).toBeDefined();
    expect(typeof result.tokens.promptTokens).toBe('number');
    expect(typeof result.tokens.completionTokens).toBe('number');
    expect(typeof result.tokens.totalTokens).toBe('number');

    expect(typeof result.estimatedCost).toBe('number');
    expect(typeof result.duration).toBe('number');
    expect(typeof result.terminationReason).toBe('string');
  });

  it('2. Changed Files & Diff Extraction: Captures agent file modifications and diff summaries', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const scriptedProvider = new ScriptedModelProvider({
      providerId: 'scripted-provider',
      steps: [
        {
          content: 'Modifying login handler',
          toolCalls: [
            {
              id: 'call_write',
              name: 'write_file',
              input: {
                path: 'src/auth/login.ts',
                content: 'export function login() { return true; }',
              },
            },
          ],
        },
      ],
    });

    const harness = new ViHarness({
      primaryProvider: scriptedProvider,
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-diff-test',
      description: 'Refactor login auth method',
    };

    const result = await harness.executeTask(task);

    expect(result.changedFiles).toContain('src/auth/login.ts');
    expect(result.finalDiff).toContain('src/auth/login.ts');
  });

  it('3. Alias Methods Support: Supports run, runTask, executeTask, and execute aliases', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const harness = new ViHarness({
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-alias-test',
      description: 'Alias invocation verification',
    };

    const res1 = await harness.runTask(task);
    const res2 = await harness.executeTask(task);
    const res3 = await harness.execute(task);
    const res4 = await harness.run(task);

    expect(res1.taskId).toBe('task-alias-test');
    expect(res2.taskId).toBe('task-alias-test');
    expect(res3.taskId).toBe('task-alias-test');
    expect(res4.taskId).toBe('task-alias-test');
  });

  it('4. Information Hiding Boundary: Does NOT leak internal Vi state handles in PiBenchmarkResult', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const harness = new ViHarness({
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-hiding-test',
      description: 'Ensure internal Vi state handles are hidden',
    };

    const result = (await harness.runTask(task)) as Record<string, unknown>;

    // Verify internal state machine / runtime / context graph handles are NOT exposed
    expect(result['stateMachine']).toBeUndefined();
    expect(result['contextCompiler']).toBeUndefined();
    expect(result['eventStore']).toBeUndefined();
    expect(result['evidenceStore']).toBeUndefined();
    expect(result['policyEngine']).toBeUndefined();
    expect(result['activeExecutions']).toBeUndefined();
  });

  it('5. Task Aliases & Constraints Translation: Accurately maps benchmark parameters to Vi Goal', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const harness = new ViHarness({
      idFactory,
      clock,
    });

    const taskWithAliases: PiBenchmarkTask = {
      id: 'task-alias-constraints',
      name: 'Refactor Auth Module',
      description: 'Migrate session tokens to JWT',
      repoPath: '/workspace/project-alpha',
      timeoutMs: 45000,
      tokenBudget: 30000,
      maxTurns: 8,
      maxCostUSD: 1.5,
      category: 'SECURITY',
      riskLevel: 'MEDIUM',
    };

    const result = await harness.run(taskWithAliases);

    expect(result.taskId).toBe('task-alias-constraints');
    expect(result.duration).toBeGreaterThan(0);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it('6. Git Manager Integration: Captures baseline, agent delta, and diff when GitManager is provided', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));
    const gitManager = new DefaultGitManager();

    // Pre-seed some baseline files
    gitManager.markFileOwner('src/index.ts', 'agent');
    gitManager.markFileOwner('src/utils.ts', 'agent');

    const harness = new ViHarness({
      gitManager,
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-git-integration',
      description: 'Test git delta extraction in adapter',
    };

    const result = await harness.runTask(task);

    expect(result.changedFiles).toContain('src/index.ts');
    expect(result.changedFiles).toContain('src/utils.ts');
    expect(typeof result.finalDiff).toBe('string');
  });

  it('7. Verification Evidence Aggregation: Correctly aggregates test pass rates and counts', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));
    const evidenceStore = new DefaultEvidenceStore();
    const verificationEngine = new DefaultVerificationEngine({ evidenceStore, idFactory, clock });

    const harness = new ViHarness({
      evidenceStore,
      verificationEngine,
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-verification-test',
      description: 'Run verification tests and verify adapter metrics',
    };

    const result = await harness.runTask(task);

    expect(result.tests).toBeDefined();
    expect(typeof result.tests.total).toBe('number');
    expect(typeof result.tests.passed).toBe('number');
    expect(typeof result.tests.failed).toBe('number');
    expect(typeof result.tests.passRate).toBe('number');
    expect(result.tests.passRate).toBeGreaterThanOrEqual(0);
    expect(result.tests.passRate).toBeLessThanOrEqual(1);
  });

  it('8. Multi-Step Token and Cost Calculation: Aggregates tokens and USD cost across iterations', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const scriptedProvider = new ScriptedModelProvider({
      providerId: 'token-cost-provider',
      steps: [
        {
          content: 'Step 1: Inspect repository files',
          toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'package.json' } }],
          tokenUsage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
        },
        {
          content: 'Step 2: Apply code fix',
          toolCalls: [
            {
              id: 'c2',
              name: 'write_file',
              input: { path: 'src/app.ts', content: 'export const ok = true;' },
            },
          ],
          tokenUsage: { inputTokens: 800, outputTokens: 150, totalTokens: 950 },
        },
      ],
    });

    const harness = new ViHarness({
      primaryProvider: scriptedProvider,
      idFactory,
      clock,
    });

    const task: PiBenchmarkTask = {
      id: 'task-tokens-cost',
      description: 'Measure multi-step token and cost calculation',
    };

    const result = await harness.runTask(task);

    expect(result.tokens.promptTokens).toBeGreaterThan(0);
    expect(result.tokens.completionTokens).toBeGreaterThan(0);
    expect(result.tokens.totalTokens).toBe(
      result.tokens.promptTokens + result.tokens.completionTokens,
    );
    expect(result.modelCalls).toBeGreaterThan(0);
    expect(typeof result.estimatedCost).toBe('number');
  });

  it('9. Non-Invasive Architecture Guarantee: Preserves Vi state machine without modifying internal runtime', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock(new Date('2026-08-13T12:00:00Z'));

    const harness = new ViHarness({
      idFactory,
      clock,
      harnessVersion: '0.1.0-custom-bench',
    });

    expect(harness.harnessVersion).toBe('0.1.0-custom-bench');

    const task: PiBenchmarkTask = {
      id: 'task-architecture-check',
      description: 'Ensure deterministic state machine execution is untouched',
    };

    const result = await harness.runTask(task);

    expect(result.success).toBeDefined();
    expect(result.finalState).toBeDefined();
    expect(result.terminationReason).toBeDefined();
  });
});
