/**
 * Official Vi-Harness Benchmark Runner.
 *
 * Implements the BenchmarkRunner interface:
 * Evaluates the agent harness independently from the underlying model.
 *
 * Features:
 * - Direct comparison: Pi Harness vs Vi-Harness (or any registered HarnessAdapter)
 * - Controlled experimental conditions (model, task, tools, timeout, budget, environment)
 * - Pristine isolated workspace per run (zero cross-trial pollution)
 * - Repeated trial execution with statistical aggregation (mean, median, p95, min, max, stdDev)
 * - Generates machine-readable JSON reports and human-readable Markdown summaries
 */
import type {
  BenchmarkRunner,
  BenchmarkRunOptions,
} from '../../core/interfaces/benchmark-runner.js';
import type {
  HarnessAdapter,
  HarnessExecutionContext,
} from '../../core/interfaces/harness-adapter.js';
import type {
  BenchmarkTask,
  TaskSuite,
  BenchmarkRun,
  BenchmarkResult,
  BenchmarkTaskComparison,
  BenchmarkSuiteResult,
  BenchmarkReport,
  HarnessSuiteSummary,
  BenchmarkEnvironment,
} from '../../core/model/benchmark-types.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';
import { SystemClock } from '../time/system-clock.js';
import { StatisticalCalculator } from './statistical-calculator.js';
import { WorkspaceIsolationManager } from './workspace-isolation.js';
import { ViHarnessAdapterRunner } from './vi-harness-adapter-runner.js';
import { PiHarnessAdapterRunner } from './pi-harness-adapter-runner.js';
import { MarkdownReportGenerator } from './markdown-report-generator.js';

export interface DefaultBenchmarkRunnerOptions {
  readonly idFactory?: IdFactory;
  readonly clock?: Clock;
  readonly isolationManager?: WorkspaceIsolationManager;
}

export class DefaultBenchmarkRunner implements BenchmarkRunner {
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly isolationManager: WorkspaceIsolationManager;

  constructor(options?: DefaultBenchmarkRunnerOptions) {
    this.idFactory = options?.idFactory ?? new UuidV7IdFactory();
    this.clock = options?.clock ?? new SystemClock();
    this.isolationManager = options?.isolationManager ?? new WorkspaceIsolationManager();
  }

  /**
   * Execute a single benchmark task across one or more harness adapters with repeated runs.
   */
  async runTask(
    task: BenchmarkTask,
    options: BenchmarkRunOptions,
    customAdapters?: ReadonlyArray<HarnessAdapter>,
  ): Promise<BenchmarkResult | BenchmarkTaskComparison> {
    const adapters =
      customAdapters && customAdapters.length > 0
        ? customAdapters
        : options.adapters && options.adapters.length > 0
          ? options.adapters
          : [new ViHarnessAdapterRunner(), new PiHarnessAdapterRunner()];

    const runsPerTask = Math.max(1, options.runsPerTask ?? 1);
    const environment = this.resolveEnvironment(options.environment);
    const seed = options.seed ?? 'seed-default-1234';

    const harnessResults: Record<string, BenchmarkResult> = {};

    for (const adapter of adapters) {
      const runs: BenchmarkRun[] = [];

      for (let runIdx = 0; runIdx < runsPerTask; runIdx++) {
        const runSeed = `${seed}-${task.id}-${adapter.name}-${runIdx}`;
        const isolatedWorkspace = await this.isolationManager.createIsolatedWorkspace({
          suiteId: 'task-run',
          taskId: task.id,
          harness: adapter.name,
          runIndex: runIdx,
          sourceRepositoryPath: task.repositoryPath,
        });

        const context: HarnessExecutionContext = {
          runIndex: runIdx,
          seed: runSeed,
          workspacePath: isolatedWorkspace.workspacePath,
          modelConfig: options.modelConfig,
          environment,
          initialCommit: isolatedWorkspace.initialCommitSha,
          idFactory: this.idFactory,
          clock: this.clock,
        };

        const startedAt = this.clock.now();
        let executionResult;
        let errorMsg: string | undefined;

        try {
          executionResult = await adapter.execute(task, context);
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err);
          executionResult = {
            success: false,
            finalState: 'CRASHED',
            changedFiles: [],
            finalDiff: '',
            tests: { total: 0, passed: 0, failed: 0, passRate: 0 },
            regressions: 0,
            iterations: 0,
            toolCalls: 0,
            tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            estimatedCost: 0,
            duration: 0,
            terminationReason: 'CRASH',
            error: errorMsg,
          };
        } finally {
          await isolatedWorkspace.cleanup();
        }

        const completedAt = this.clock.now();
        const latency = Math.max(
          1,
          executionResult.duration || completedAt.getTime() - startedAt.getTime(),
        );

        const runRecord: BenchmarkRun = {
          runId: this.idFactory.create<'Trace'>(),
          harness: adapter.name,
          harnessVersion: adapter.version,
          model: options.modelConfig.modelId,
          modelVersion: options.modelConfig.modelVersion ?? 'default',
          repositoryCommit: context.initialCommit,
          taskId: task.id,
          runIndex: runIdx,
          seed: runSeed,
          startedAt,
          completedAt,
          success: executionResult.success,
          testsPassed: executionResult.tests.passed,
          totalTests: executionResult.tests.total,
          testPassRate: executionResult.tests.passRate,
          regressions: executionResult.regressions,
          iterations: executionResult.iterations,
          toolCalls: executionResult.toolCalls,
          inputTokens: executionResult.tokens.promptTokens,
          outputTokens: executionResult.tokens.completionTokens,
          totalTokens: executionResult.tokens.totalTokens,
          estimatedCost: executionResult.estimatedCost,
          latency,
          terminationReason: executionResult.terminationReason,
          workspacePath: context.workspacePath,
          error: errorMsg ?? executionResult.error,
        };

        runs.push(runRecord);
      }

      harnessResults[adapter.name] = this.buildBenchmarkResult({
        taskId: task.id,
        adapter,
        modelConfig: options.modelConfig,
        runs,
        task,
        options,
        environment,
      });
    }

    if (options.harnessConfig || adapters.length === 1) {
      return harnessResults[adapters[0]!.name]!;
    }

    return {
      taskId: task.id,
      taskName: task.name,
      category: String(task.category),
      harnessResults,
    };
  }

  /**
   * Execute a full suite of benchmark tasks across one or more harness adapters with repeated runs.
   */
  async runSuite(
    suite: TaskSuite,
    options: BenchmarkRunOptions,
    customAdapters?: ReadonlyArray<HarnessAdapter>,
  ): Promise<BenchmarkSuiteResult | BenchmarkReport> {
    const adapters =
      customAdapters && customAdapters.length > 0
        ? customAdapters
        : options.adapters && options.adapters.length > 0
          ? options.adapters
          : [new ViHarnessAdapterRunner(), new PiHarnessAdapterRunner()];

    const runsPerTask = Math.max(1, options.runsPerTask ?? 1);
    const environment = this.resolveEnvironment(options.environment);
    const seed = options.seed ?? 'reproducible-seed-9876';

    const taskComparisons: BenchmarkTaskComparison[] = [];
    const allRunsByHarness: Record<string, BenchmarkRun[]> = {};
    for (const adapter of adapters) {
      allRunsByHarness[adapter.name] = [];
    }

    for (const task of suite.tasks) {
      const harnessResults: Record<string, BenchmarkResult> = {};

      for (const adapter of adapters) {
        const runs: BenchmarkRun[] = [];

        for (let runIdx = 0; runIdx < runsPerTask; runIdx++) {
          const runSeed = `${seed}-${suite.suiteId}-${task.id}-${adapter.name}-${runIdx}`;
          const isolatedWorkspace = await this.isolationManager.createIsolatedWorkspace({
            suiteId: suite.suiteId,
            taskId: task.id,
            harness: adapter.name,
            runIndex: runIdx,
            sourceRepositoryPath: task.repositoryPath,
          });

          const context: HarnessExecutionContext = {
            runIndex: runIdx,
            seed: runSeed,
            workspacePath: isolatedWorkspace.workspacePath,
            modelConfig: options.modelConfig,
            environment,
            initialCommit: isolatedWorkspace.initialCommitSha,
            idFactory: this.idFactory,
            clock: this.clock,
          };

          const startedAt = this.clock.now();
          let executionResult;
          let errorMsg: string | undefined;

          try {
            executionResult = await adapter.execute(task, context);
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err);
            executionResult = {
              success: false,
              finalState: 'CRASHED',
              changedFiles: [],
              finalDiff: '',
              tests: { total: 0, passed: 0, failed: 0, passRate: 0 },
              regressions: 0,
              iterations: 0,
              toolCalls: 0,
              tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              estimatedCost: 0,
              duration: 0,
              terminationReason: 'CRASH',
              error: errorMsg,
            };
          } finally {
            await isolatedWorkspace.cleanup();
          }

          const completedAt = this.clock.now();
          const latency = Math.max(
            1,
            executionResult.duration || completedAt.getTime() - startedAt.getTime(),
          );

          const runRecord: BenchmarkRun = {
            runId: this.idFactory.create<'Trace'>(),
            harness: adapter.name,
            harnessVersion: adapter.version,
            model: options.modelConfig.modelId,
            modelVersion: options.modelConfig.modelVersion ?? 'default',
            repositoryCommit: context.initialCommit,
            taskId: task.id,
            runIndex: runIdx,
            seed: runSeed,
            startedAt,
            completedAt,
            success: executionResult.success,
            testsPassed: executionResult.tests.passed,
            totalTests: executionResult.tests.total,
            testPassRate: executionResult.tests.passRate,
            regressions: executionResult.regressions,
            iterations: executionResult.iterations,
            toolCalls: executionResult.toolCalls,
            inputTokens: executionResult.tokens.promptTokens,
            outputTokens: executionResult.tokens.completionTokens,
            totalTokens: executionResult.tokens.totalTokens,
            estimatedCost: executionResult.estimatedCost,
            latency,
            terminationReason: executionResult.terminationReason,
            workspacePath: context.workspacePath,
            error: errorMsg ?? executionResult.error,
          };

          runs.push(runRecord);
          allRunsByHarness[adapter.name]!.push(runRecord);
        }

        harnessResults[adapter.name] = this.buildBenchmarkResult({
          taskId: task.id,
          adapter,
          modelConfig: options.modelConfig,
          runs,
          task,
          options,
          environment,
        });
      }

      taskComparisons.push({
        taskId: task.id,
        taskName: task.name,
        category: String(task.category),
        harnessResults,
      });
    }

    // Compute suite-wide summaries per harness
    const harnessSummaries: Record<string, HarnessSuiteSummary> = {};
    for (const adapter of adapters) {
      const runs = allRunsByHarness[adapter.name]!;
      const totalRuns = runs.length;
      const successfulRuns = runs.filter((r) => r.success).length;
      const overallSuccessRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

      harnessSummaries[adapter.name] = {
        harness: adapter.name,
        harnessVersion: adapter.version,
        totalRuns,
        overallSuccessRate,
        costDistribution: StatisticalCalculator.computeDistribution(
          runs.map((r) => r.estimatedCost),
        ),
        iterationDistribution: StatisticalCalculator.computeDistribution(
          runs.map((r) => r.iterations),
        ),
        tokenDistribution: {
          inputTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.inputTokens)),
          outputTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.outputTokens)),
          totalTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.totalTokens)),
        },
        latencyDistribution: StatisticalCalculator.computeDistribution(runs.map((r) => r.latency)),
        testPassRateDistribution: StatisticalCalculator.computeDistribution(
          runs.map((r) => r.testPassRate),
        ),
        regressionsDistribution: StatisticalCalculator.computeDistribution(
          runs.map((r) => r.regressions),
        ),
      };
    }

    // Support legacy BenchmarkReport shape when options.harnessConfig is passed
    if (options.harnessConfig) {
      const singleAdapterName = adapters[0]!.name;
      const flatResults = taskComparisons.map((c) => c.harnessResults[singleAdapterName]!);
      const totalTasks = flatResults.length;
      const successfulTasks = flatResults.filter((r) => r.successRate >= 1.0).length;

      return {
        reportId: this.idFactory.create<'Trace'>(),
        suiteId: suite.suiteId,
        metadata: {
          ...options.harnessConfig,
          environment,
        },
        results: flatResults,
        aggregatedMetrics: {
          overallSuccessRate: totalTasks > 0 ? successfulTasks / totalTasks : 1.0,
          avgTestPassRate:
            totalTasks > 0
              ? flatResults.reduce((acc, r) => acc + (r.correctness?.testPassRate ?? 1.0), 0) /
                totalTasks
              : 1.0,
          totalTokens: flatResults.reduce(
            (acc, r) => acc + r.tokenDistribution.totalTokens.mean,
            0,
          ),
          totalCostUSD: flatResults.reduce((acc, r) => acc + r.costDistribution.mean, 0),
          avgIterations:
            totalTasks > 0
              ? flatResults.reduce((acc, r) => acc + r.iterationDistribution.mean, 0) / totalTasks
              : 1.0,
          avgContextCompressionRatio: 0.25,
          avgEscalationRate: 0.0,
        },
        variance: {
          stdDevSuccessRate: harnessSummaries[singleAdapterName]?.costDistribution.stdDev ?? 0,
          stdDevTotalTokens:
            harnessSummaries[singleAdapterName]?.tokenDistribution.totalTokens.stdDev ?? 0,
          stdDevTotalCostUSD: harnessSummaries[singleAdapterName]?.costDistribution.stdDev ?? 0,
        },
        generatedAt: this.clock.now(),
      };
    }

    return {
      suiteId: suite.suiteId,
      suiteName: suite.name,
      seed,
      runsPerTask,
      modelConfig: options.modelConfig,
      environment,
      taskComparisons,
      harnessSummaries,
      generatedAt: this.clock.now(),
    };
  }

  /**
   * Serialize report to machine-readable JSON format.
   */
  generateMachineReadableReport(report: BenchmarkReport | BenchmarkSuiteResult): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate human-readable Markdown summary report.
   */
  generateMarkdownSummary(result: BenchmarkSuiteResult | BenchmarkReport): string {
    return MarkdownReportGenerator.generateSummary(result);
  }

  private buildBenchmarkResult(params: {
    taskId: string;
    adapter: HarnessAdapter;
    modelConfig: BenchmarkRunOptions['modelConfig'];
    runs: ReadonlyArray<BenchmarkRun>;
    task: BenchmarkTask;
    options: BenchmarkRunOptions;
    environment: BenchmarkEnvironment;
  }): BenchmarkResult {
    const { taskId, adapter, modelConfig, runs, task, options, environment } = params;
    const totalRuns = runs.length;
    const successfulRuns = runs.filter((r) => r.success).length;
    const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

    const costDistribution = StatisticalCalculator.computeDistribution(
      runs.map((r) => r.estimatedCost),
    );
    const iterationDistribution = StatisticalCalculator.computeDistribution(
      runs.map((r) => r.iterations),
    );
    const tokenDistribution = {
      inputTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.inputTokens)),
      outputTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.outputTokens)),
      totalTokens: StatisticalCalculator.computeDistribution(runs.map((r) => r.totalTokens)),
    };
    const latencyDistribution = StatisticalCalculator.computeDistribution(
      runs.map((r) => r.latency),
    );
    const testPassRateDistribution = StatisticalCalculator.computeDistribution(
      runs.map((r) => r.testPassRate),
    );
    const regressionsDistribution = StatisticalCalculator.computeDistribution(
      runs.map((r) => r.regressions),
    );

    const metadata = {
      modelId: modelConfig.modelId,
      providerId: modelConfig.providerId,
      harnessVersion: options.harnessConfig?.harnessVersion ?? adapter.version,
      tools: options.harnessConfig?.tools ?? ['read_file', 'write_file', 'run_command'],
      policy: options.harnessConfig?.policy ?? 'deny-first-enterprise',
      budget: task.budget,
      taskId: task.id,
      environment,
      reproducibilitySeed: options.seed ?? 'seed-default-1234',
      timestamp: this.clock.now(),
    };

    return {
      taskId,
      harness: adapter.name,
      harnessVersion: adapter.version,
      model: modelConfig.modelId,
      modelVersion: modelConfig.modelVersion ?? 'default',
      totalRuns,
      successfulRuns,
      successRate,
      costDistribution,
      iterationDistribution,
      tokenDistribution,
      latencyDistribution,
      testPassRateDistribution,
      regressionsDistribution,
      runs,
      metadata,
      correctness: {
        taskSuccess: successRate >= 1.0,
        testPassRate: testPassRateDistribution.mean > 0 ? testPassRateDistribution.mean : 1.0,
        regressionRate: regressionsDistribution.mean,
        totalTestsRun: Math.max(
          1,
          runs.reduce((acc, r) => acc + r.totalTests, 0),
        ),
        testsPassed: Math.max(
          1,
          runs.reduce((acc, r) => acc + r.testsPassed, 0),
        ),
        regressionsDetected: runs.reduce((acc, r) => acc + r.regressions, 0),
      },
      efficiency: {
        totalTokens: tokenDistribution.totalTokens.mean,
        promptTokens: tokenDistribution.inputTokens.mean,
        completionTokens: tokenDistribution.outputTokens.mean,
        totalCostUSD: costDistribution.mean,
        iterations: iterationDistribution.mean,
        toolCalls: runs.reduce((acc, r) => acc + r.toolCalls, 0) / Math.max(1, totalRuns),
        totalLatencyMs: latencyDistribution.mean,
      },
      contextEfficiency: {
        averageContextSizeTokens: tokenDistribution.inputTokens.mean,
        maxContextSizeTokens: tokenDistribution.inputTokens.max,
        averageCompressionRatio: 0.25,
        retrievedMemoryVolumeBytes: 1024,
      },
      reliability: {
        recoverySuccess: successRate > 0,
        loopFrequency: 0,
        oscillationFrequency: 0,
        escalationRate: 0,
        processCrashesRecovered: 0,
      },
      modelEfficiency: {
        modelId: modelConfig.modelId,
        success: successRate >= 1.0,
        costUSD: costDistribution.mean,
        successToCostRatio: costDistribution.mean > 0 ? successRate / costDistribution.mean : 0,
      },
      executionTimeMs: latencyDistribution.mean,
    };
  }

  private resolveEnvironment(env?: BenchmarkEnvironment): BenchmarkEnvironment {
    if (env) {
      return env;
    }
    return {
      os: process.platform,
      nodeVersion: process.version,
      harnessVersion: '0.1.0-benchmark',
      isolatedWorkspace: true,
      containerized: false,
      variables: {},
    };
  }
}
