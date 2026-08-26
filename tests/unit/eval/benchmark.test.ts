import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultBenchmarkRunner,
  BASELINE_SCENARIOS,
  CANONICAL_BASELINE_SUITE,
  BaselineScenarioCategory,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/index.js';
import type { BenchmarkRunOptions, BenchmarkReport } from '../../../src/index.js';

describe('Benchmark and Evaluation Framework', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let runner: DefaultBenchmarkRunner;
  let options: BenchmarkRunOptions;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2026-08-13T00:00:00Z'));
    runner = new DefaultBenchmarkRunner({ idFactory, clock });

    options = {
      seed: 'reproducible-seed-9876',
      runsPerTask: 1,
      modelConfig: {
        providerId: 'openai',
        modelId: 'gpt-4o',
        temperature: 0.2,
      },
      harnessConfig: {
        harnessVersion: '0.1.0-benchmark',
        tools: ['read_file', 'write_file', 'run_command'],
        policy: 'deny-first-enterprise',
        contextStrategy: 'compaction-5-stage',
        memoryEnabled: true,
      },
      environment: {
        os: 'windows-x64',
        nodeVersion: 'v20.11.0',
        harnessVersion: '0.1.0-benchmark',
        isolatedWorkspace: true,
        containerized: true,
        variables: { NODE_ENV: 'benchmark' },
      },
    };
  });

  it('1. Task Suite: Validates all 7 baseline scenarios exist in CANONICAL_BASELINE_SUITE', () => {
    expect(CANONICAL_BASELINE_SUITE.tasks).toHaveLength(7);

    const categories = CANONICAL_BASELINE_SUITE.tasks.map((t) => t.category);
    expect(categories).toContain(BaselineScenarioCategory.SMALL_BUG);
    expect(categories).toContain(BaselineScenarioCategory.MEDIUM_FEATURE);
    expect(categories).toContain(BaselineScenarioCategory.MULTI_FILE_REFACTOR);
    expect(categories).toContain(BaselineScenarioCategory.TEST_REPAIR);
    expect(categories).toContain(BaselineScenarioCategory.LONG_DEBUGGING_TASK);
    expect(categories).toContain(BaselineScenarioCategory.SECURITY_SENSITIVE_CHANGE);
    expect(categories).toContain(BaselineScenarioCategory.REGRESSION_REPAIR);
  });

  it('2. Metadata Contract: Ensures every benchmark result contains mandatory metadata', async () => {
    const task = BASELINE_SCENARIOS[0]!;
    const result = await runner.runTask(task, options);

    expect(result.metadata.modelId).toBe('gpt-4o');
    expect(result.metadata.providerId).toBe('openai');
    expect(result.metadata.harnessVersion).toBe('0.1.0-benchmark');
    expect(result.metadata.tools).toContain('read_file');
    expect(result.metadata.policy).toBe('deny-first-enterprise');
    expect(result.metadata.budget).toEqual(task.budget);
    expect(result.metadata.taskId).toBe(task.id);
    expect(result.metadata.environment.os).toBe('windows-x64');
    expect(result.metadata.reproducibilitySeed).toBe('reproducible-seed-9876');
    expect(result.metadata.timestamp).toEqual(clock.now());
  });

  it('3. Metrics Collection: Captures metrics across Correctness, Efficiency, Context, Reliability, and Model Efficiency', async () => {
    const task = BASELINE_SCENARIOS[1]!;
    const result = await runner.runTask(task, options);

    // Correctness
    expect(result.correctness.taskSuccess).toBe(true);
    expect(result.correctness.testPassRate).toBeGreaterThanOrEqual(1.0);
    expect(result.correctness.regressionRate).toBe(0.0);

    // Efficiency
    expect(result.efficiency.totalTokens).toBeGreaterThan(0);
    expect(result.efficiency.totalCostUSD).toBeGreaterThan(0);
    expect(result.efficiency.iterations).toBeGreaterThan(0);
    expect(result.efficiency.toolCalls).toBeGreaterThan(0);

    // Context Efficiency
    expect(result.contextEfficiency.averageContextSizeTokens).toBeGreaterThan(0);
    expect(result.contextEfficiency.maxContextSizeTokens).toBeGreaterThan(0);
    expect(result.contextEfficiency.averageCompressionRatio).toBeGreaterThan(0);

    // Reliability
    expect(result.reliability.recoverySuccess).toBe(true);
    expect(result.reliability.escalationRate).toBe(0.0);

    // Model Efficiency
    expect(result.modelEfficiency.modelId).toBe('gpt-4o');
    expect(result.modelEfficiency.success).toBe(true);
    expect(result.modelEfficiency.successToCostRatio).toBeGreaterThan(0);
  });

  it('4. Benchmark Runner Suite Execution: Computes suite-wide aggregated metrics and variance', async () => {
    const report: BenchmarkReport = await runner.runSuite(CANONICAL_BASELINE_SUITE, options);

    expect(report.results).toHaveLength(7);
    expect(report.aggregatedMetrics.overallSuccessRate).toBe(1.0);
    expect(report.aggregatedMetrics.totalTokens).toBeGreaterThan(0);
    expect(report.aggregatedMetrics.totalCostUSD).toBeGreaterThan(0);
    expect(report.aggregatedMetrics.avgIterations).toBeGreaterThan(0);

    expect(report.variance.stdDevSuccessRate).toBeDefined();
    expect(report.variance.stdDevTotalTokens).toBeGreaterThanOrEqual(0);
    expect(report.variance.stdDevTotalCostUSD).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('5. Machine-Readable Output: Serializes full benchmark report into valid JSON', async () => {
    const report = await runner.runSuite(CANONICAL_BASELINE_SUITE, options);
    const jsonOutput = runner.generateMachineReadableReport(report);

    expect(typeof jsonOutput).toBe('string');
    const parsed = JSON.parse(jsonOutput);

    expect(parsed.reportId).toBeDefined();
    expect(parsed.suiteId).toBe(CANONICAL_BASELINE_SUITE.suiteId);
    expect(parsed.results).toHaveLength(7);
    expect(parsed.aggregatedMetrics.overallSuccessRate).toBe(1.0);
    expect(parsed.variance).toBeDefined();
  }, 60000);
});
