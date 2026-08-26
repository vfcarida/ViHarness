/**
 * Comprehensive Benchmark Runner & Evaluation Unit Tests.
 *
 * Verifies that the official Vi-Harness benchmark runner satisfies all evaluation criteria:
 * - Independent evaluation of the harness as the primary independent variable
 * - Multi-trial repeated run support
 * - Non-average statistics reporting: mean, median, p95, min, max, stdDev, distributions
 * - Isolated temporary workspace per trial (no cross-trial interference)
 * - Machine-readable JSON and human-readable Markdown summary generation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultBenchmarkRunner,
  StatisticalCalculator,
  WorkspaceIsolationManager,
  ViHarnessAdapterRunner,
  PiHarnessAdapterRunner,
  MarkdownReportGenerator,
  CANONICAL_BASELINE_SUITE,
  BASELINE_SCENARIOS,
  UuidV7IdFactory,
  TestClock,
  type BenchmarkTask,
  type BenchmarkSuiteResult,
} from '../../../src/index.js';

describe('Official Vi-Harness Benchmark Runner Suite', () => {
  let idFactory: UuidV7IdFactory;
  let clock: TestClock;
  let runner: DefaultBenchmarkRunner;
  let testTempDir: string;

  beforeEach(() => {
    idFactory = new UuidV7IdFactory();
    clock = new TestClock(new Date('2026-08-13T00:00:00Z'));
    testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-bench-test-'));
    const isolationManager = new WorkspaceIsolationManager({
      baseDir: path.join(testTempDir, 'workspaces'),
    });
    runner = new DefaultBenchmarkRunner({ idFactory, clock, isolationManager });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors in test temp
    }
  });

  it('1. Statistical Calculator: Computes mean, median, p95, min, max, and sample stdDev', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const dist = StatisticalCalculator.computeDistribution(samples);

    expect(dist.mean).toBe(55);
    expect(dist.median).toBe(55);
    expect(dist.min).toBe(10);
    expect(dist.max).toBe(100);
    expect(dist.p95).toBe(100);
    expect(dist.stdDev).toBeGreaterThan(30);
    expect(dist.samples).toEqual(samples);

    // Edge cases: empty & single sample
    const emptyDist = StatisticalCalculator.computeDistribution([]);
    expect(emptyDist.mean).toBe(0);
    expect(emptyDist.p95).toBe(0);

    const singleDist = StatisticalCalculator.computeDistribution([42]);
    expect(singleDist.mean).toBe(42);
    expect(singleDist.median).toBe(42);
    expect(singleDist.p95).toBe(42);
    expect(singleDist.stdDev).toBe(0);
  });

  it('2. Workspace Isolation: Creates distinct, pristine workspaces and prevents cross-run pollution', async () => {
    const manager = new WorkspaceIsolationManager({
      baseDir: path.join(testTempDir, 'isolation-check'),
    });

    const ws1 = await manager.createIsolatedWorkspace({
      suiteId: 'suite-iso',
      taskId: 'task-1',
      harness: 'Vi-Harness',
      runIndex: 0,
    });

    const ws2 = await manager.createIsolatedWorkspace({
      suiteId: 'suite-iso',
      taskId: 'task-1',
      harness: 'Vi-Harness',
      runIndex: 1,
    });

    // Workspaces must be completely distinct directory paths
    expect(ws1.workspacePath).not.toBe(ws2.workspacePath);
    expect(fs.existsSync(ws1.workspacePath)).toBe(true);
    expect(fs.existsSync(ws2.workspacePath)).toBe(true);

    // Mutating ws1 must NOT affect ws2
    fs.writeFileSync(path.join(ws1.workspacePath, 'mutated-file.txt'), 'agent changed ws1');
    expect(fs.existsSync(path.join(ws2.workspacePath, 'mutated-file.txt'))).toBe(false);

    // Cleanup ws1
    await ws1.cleanup();
    expect(fs.existsSync(ws1.workspacePath)).toBe(false);
    expect(fs.existsSync(ws2.workspacePath)).toBe(true);

    await ws2.cleanup();
    expect(fs.existsSync(ws2.workspacePath)).toBe(false);
  });

  it('3. Repeated Runs & Mandatory Field Records: Every run records full experimental metadata', async () => {
    const task: BenchmarkTask = BASELINE_SCENARIOS[0]!;
    const viAdapter = new ViHarnessAdapterRunner();

    const result = await runner.runTask(
      task,
      {
        runsPerTask: 3,
        seed: 'repro-seed-42',
        modelConfig: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          modelVersion: '2024-08-06',
          temperature: 0.2,
        },
      },
      [viAdapter],
    );

    // Single adapter run returns BenchmarkResult
    expect('runs' in result).toBe(true);
    const benchResult = result as any;
    expect(benchResult.runs).toHaveLength(3);

    for (let i = 0; i < benchResult.runs.length; i++) {
      const run = benchResult.runs[i]!;
      expect(run.harness).toBe('Vi-Harness');
      expect(run.harnessVersion).toBeDefined();
      expect(run.model).toBe('gpt-4o');
      expect(run.modelVersion).toBe('2024-08-06');
      expect(run.repositoryCommit).toBeDefined();
      expect(run.taskId).toBe(task.id);
      expect(run.runIndex).toBe(i);
      expect(run.seed).toContain('repro-seed-42');
      expect(run.startedAt).toBeDefined();
      expect(run.completedAt).toBeDefined();
      expect(typeof run.success).toBe('boolean');
      expect(typeof run.testsPassed).toBe('number');
      expect(typeof run.totalTests).toBe('number');
      expect(typeof run.testPassRate).toBe('number');
      expect(typeof run.regressions).toBe('number');
      expect(typeof run.iterations).toBe('number');
      expect(typeof run.toolCalls).toBe('number');
      expect(typeof run.inputTokens).toBe('number');
      expect(typeof run.outputTokens).toBe('number');
      expect(typeof run.totalTokens).toBe('number');
      expect(typeof run.estimatedCost).toBe('number');
      expect(typeof run.latency).toBe('number');
      expect(typeof run.terminationReason).toBe('string');
      expect(typeof run.workspacePath).toBe('string');
    }

    // Statistical distributions across repeated runs
    expect(benchResult.costDistribution.mean).toBeGreaterThanOrEqual(0);
    expect(benchResult.costDistribution.median).toBeGreaterThanOrEqual(0);
    expect(benchResult.costDistribution.p95).toBeGreaterThanOrEqual(0);
    expect(benchResult.iterationDistribution.mean).toBeGreaterThanOrEqual(1);
    expect(benchResult.iterationDistribution.p95).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('4. Multi-Harness Comparison Suite: Executes Pi vs Vi-Harness side-by-side', async () => {
    const miniSuite = {
      suiteId: 'mini-comparison-suite',
      name: 'Mini Comparison Suite (Pi vs Vi-Harness)',
      description: 'Evaluating Pi vs Vi-Harness under identical conditions',
      tasks: [BASELINE_SCENARIOS[0]!, BASELINE_SCENARIOS[1]!],
    };

    const viAdapter = new ViHarnessAdapterRunner();
    const piAdapter = new PiHarnessAdapterRunner();

    const suiteResult = (await runner.runSuite(
      miniSuite,
      {
        runsPerTask: 2,
        seed: 'seed-pi-vs-vi',
        modelConfig: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          temperature: 0.1,
        },
      },
      [viAdapter, piAdapter],
    )) as BenchmarkSuiteResult;

    expect(suiteResult.suiteId).toBe('mini-comparison-suite');
    expect(suiteResult.runsPerTask).toBe(2);
    expect(suiteResult.taskComparisons).toHaveLength(2);

    // Harness summaries
    expect(suiteResult.harnessSummaries['Vi-Harness']).toBeDefined();
    expect(suiteResult.harnessSummaries['Pi']).toBeDefined();

    const viSummary = suiteResult.harnessSummaries['Vi-Harness']!;
    const piSummary = suiteResult.harnessSummaries['Pi']!;

    expect(viSummary.totalRuns).toBe(4); // 2 tasks * 2 runs
    expect(piSummary.totalRuns).toBe(4);

    expect(viSummary.overallSuccessRate).toBeGreaterThanOrEqual(0);
    expect(piSummary.overallSuccessRate).toBeGreaterThanOrEqual(0);

    expect(viSummary.costDistribution.mean).toBeGreaterThan(0);
    expect(piSummary.costDistribution.mean).toBeGreaterThan(0);
    expect(viSummary.tokenDistribution.totalTokens.p95).toBeGreaterThan(0);
    expect(piSummary.tokenDistribution.totalTokens.p95).toBeGreaterThan(0);
  }, 30000);

  it('5. Machine-Readable JSON Output: Serializes full suite comparison report', async () => {
    const miniSuite = {
      suiteId: 'json-report-suite',
      name: 'JSON Test Suite',
      description: 'Validating JSON serialization',
      tasks: [BASELINE_SCENARIOS[0]!],
    };

    const suiteResult = (await runner.runSuite(miniSuite, {
      runsPerTask: 1,
      modelConfig: { providerId: 'openai', modelId: 'gpt-4o', temperature: 0.2 },
    })) as BenchmarkSuiteResult;

    const jsonReport = runner.generateMachineReadableReport(suiteResult);
    expect(typeof jsonReport).toBe('string');

    const parsed = JSON.parse(jsonReport);
    expect(parsed.suiteId).toBe('json-report-suite');
    expect(parsed.harnessSummaries['Vi-Harness']).toBeDefined();
    expect(parsed.harnessSummaries['Pi']).toBeDefined();
    expect(parsed.taskComparisons).toHaveLength(1);
  }, 30000);

  it('6. Human-Readable Markdown Summary: Formats comparison tables and distributions', async () => {
    const miniSuite = {
      suiteId: 'markdown-report-suite',
      name: 'Markdown Test Suite',
      description: 'Validating Markdown formatting',
      tasks: [BASELINE_SCENARIOS[0]!],
    };

    const suiteResult = (await runner.runSuite(miniSuite, {
      runsPerTask: 2,
      modelConfig: { providerId: 'openai', modelId: 'gpt-4o', temperature: 0.2 },
    })) as BenchmarkSuiteResult;

    const markdown = runner.generateMarkdownSummary(suiteResult);
    expect(typeof markdown).toBe('string');

    // Verify markdown sections and table headers
    expect(markdown).toContain('# Vi-Harness Official Benchmark Evaluation Report');
    expect(markdown).toContain('## 2. Executive Comparison: Pi vs Vi-Harness');
    expect(markdown).toContain(
      '| Harness | Version | Runs | Success Rate | Mean Cost | Median Cost | P95 Cost |',
    );
    expect(markdown).toContain('**Vi-Harness**');
    expect(markdown).toContain('**Pi**');
    expect(markdown).toContain('## 3. Token Consumption Distributions');
    expect(markdown).toContain('## 4. Task-by-Task Comparison Breakdown');
    expect(markdown).toContain('## 5. Statistical Distribution Details');
  }, 30000);
});
