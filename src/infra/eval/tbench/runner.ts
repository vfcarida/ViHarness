/**
 * TBench Evaluation Runner.
 *
 * Orchestrates container lifecycle, agent loop execution, and test verification across TBench tasks.
 */
import type {
  TBenchRunConfig,
  TBenchResults,
  TBenchTask,
  TBenchTaskResult,
  TBenchCategoryStat,
  DockerEnvironment,
  TBenchLeaderboardEntry,
} from './types.js';
import { TBENCH_KNOWN_LEADERBOARD } from './types.js';
import { TBenchTaskLoader } from './task-loader.js';
import { DefaultDockerEnvironment, MockDockerEnvironment } from './docker-env.js';
import { ViHarnessHarborAgent } from './harbor-agent.js';
import type { AgentRuntime } from '../../../core/interfaces/agent-runtime.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import type { Clock } from '../../../core/interfaces/clock.js';

export interface TBenchRunnerOptions {
  readonly runtime: AgentRuntime;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly dockerEnv?: DockerEnvironment;
}

export class TBenchRunner {
  private readonly runtime: AgentRuntime;
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;
  private readonly defaultDockerEnv?: DockerEnvironment;

  constructor(options: TBenchRunnerOptions) {
    this.runtime = options.runtime;
    this.idFactory = options.idFactory;
    this.clock = options.clock;
    this.defaultDockerEnv = options.dockerEnv;
  }

  async run(config: TBenchRunConfig): Promise<TBenchResults> {
    const startTime = Date.now();

    // 1. Discover & filter tasks
    let tasks = await TBenchTaskLoader.loadFromDir(config.tasksDir, {
      categories: config.categories,
      difficulties: config.difficulties,
      tags: config.tags,
    });

    if (config.smoke) {
      tasks = tasks.slice(0, 3);
    }

    // 2. Setup Docker Environment
    const dockerEnv: DockerEnvironment =
      this.defaultDockerEnv ??
      (config.driver === 'mock'
        ? new MockDockerEnvironment({ timeoutMs: config.timeout * 1000 })
        : new DefaultDockerEnvironment({
            driver: config.driver,
            timeoutMs: config.timeout * 1000,
          }));

    const agent = new ViHarnessHarborAgent({
      runtime: this.runtime,
      idFactory: this.idFactory,
      clock: this.clock,
      dockerEnv,
    });

    // 3. Concurrency control & Task execution
    const taskResults: TBenchTaskResult[] = [];
    const concurrency = Math.max(1, config.concurrency || 1);

    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchPromises = batch.map((task) => this.runSingleTask(task, dockerEnv, agent));
      const batchResults = await Promise.all(batchPromises);
      taskResults.push(...batchResults);
    }

    const durationTotal = Date.now() - startTime;

    // 4. Aggregate Statistics
    const passedCount = taskResults.filter((r) => r.passed).length;
    const totalCount = taskResults.length;
    const resolutionRate =
      totalCount > 0 ? Number(((passedCount / totalCount) * 100).toFixed(2)) : 0;

    const byCategory: Record<string, { passed: number; total: number }> = {};
    const byDifficulty: Record<string, { passed: number; total: number }> = {};

    for (const res of taskResults) {
      // Category
      const catEntry = byCategory[res.category] ?? { passed: 0, total: 0 };
      catEntry.total += 1;
      if (res.passed) catEntry.passed += 1;
      byCategory[res.category] = catEntry;

      // Difficulty
      const diffEntry = byDifficulty[res.difficulty] ?? { passed: 0, total: 0 };
      diffEntry.total += 1;
      if (res.passed) diffEntry.passed += 1;
      byDifficulty[res.difficulty] = diffEntry;
    }

    const formattedCategoryStats: Record<string, TBenchCategoryStat> = {};
    for (const [cat, data] of Object.entries(byCategory)) {
      formattedCategoryStats[cat] = {
        passed: data.passed,
        total: data.total,
        resolution_rate: Number(((data.passed / data.total) * 100).toFixed(2)),
      };
    }

    const formattedDifficultyStats: Record<string, TBenchCategoryStat> = {};
    for (const [diff, data] of Object.entries(byDifficulty)) {
      formattedDifficultyStats[diff] = {
        passed: data.passed,
        total: data.total,
        resolution_rate: Number(((data.passed / data.total) * 100).toFixed(2)),
      };
    }

    // 5. Build Leaderboard Comparison
    const viHarnessEntry: TBenchLeaderboardEntry = {
      agent: 'Vi-Harness (Autonomous Terminal Agent)',
      model: config.model,
      resolution_rate: resolutionRate,
      is_baseline: false,
    };

    const leaderboardComparison = [...TBENCH_KNOWN_LEADERBOARD, viHarnessEntry].sort(
      (a, b) => b.resolution_rate - a.resolution_rate,
    );

    return {
      total: totalCount,
      passed: passedCount,
      failed: totalCount - passedCount,
      resolution_rate: resolutionRate,
      by_category: formattedCategoryStats,
      by_difficulty: formattedDifficultyStats,
      tasks: taskResults,
      duration_total: durationTotal,
      model: config.model,
      timestamp: new Date().toISOString(),
      leaderboard_comparison: leaderboardComparison,
    };
  }

  private async runSingleTask(
    task: TBenchTask,
    dockerEnv: DockerEnvironment,
    agent: ViHarnessHarborAgent,
  ): Promise<TBenchTaskResult> {
    const taskStart = Date.now();
    let container;
    let passed = false;
    let error: string | undefined;
    let tokens = 0;
    let cost = 0;
    let commandsExecuted = 0;

    try {
      container = await dockerEnv.create(task);

      // Run agent against container environment
      const execRes = await agent.run(task, container);
      tokens = execRes.tokens;
      cost = execRes.cost;
      commandsExecuted = Math.max(1, Math.round(execRes.durationMs / 100));

      // Run verification test script
      passed = await dockerEnv.verify(container, task.testScript);
    } catch (err: any) {
      passed = false;
      error = err.message;
    } finally {
      if (container) {
        try {
          await dockerEnv.destroy(container);
        } catch {
          // Ignore container cleanup error
        }
      }
    }

    return {
      task_id: task.id,
      category: task.category,
      difficulty: task.difficulty,
      passed,
      duration: Date.now() - taskStart,
      commands_executed: commandsExecuted,
      tokens_used: tokens,
      cost_dollars: cost,
      error,
    };
  }
}
