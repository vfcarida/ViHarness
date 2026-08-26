/**
 * TBench (Terminal-Bench 2.0 / Harbor Framework) Types & Interfaces.
 *
 * References:
 * - Terminal-Bench (ICLR 2026): https://www.tbench.ai/
 * - Harbor Framework: https://github.com/laude-institute/harbor
 * - TB 2.0 Tasks: https://github.com/harbor-framework/terminal-bench-2
 */

export type TBenchCategory =
  | 'software-engineering'
  | 'machine-learning'
  | 'security'
  | 'data-science'
  | 'scientific-computing'
  | 'games';

export type TBenchDifficulty = 'easy' | 'medium' | 'hard';

export interface TBenchTask {
  readonly id: string;
  readonly instruction: string;
  readonly category: TBenchCategory;
  readonly difficulty: TBenchDifficulty;
  readonly tags: ReadonlyArray<string>;
  readonly testScript: string;
  readonly oracleSolution?: string;
  readonly timeout: number; // in seconds
  readonly workdir?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface FilterOpts {
  readonly categories?: ReadonlyArray<string>;
  readonly difficulties?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly maxTasks?: number;
  readonly taskIds?: ReadonlyArray<string>;
}

export interface Container {
  readonly id: string;
  readonly name: string;
  readonly task: TBenchTask;
  status: 'running' | 'stopped' | 'destroyed';
  readonly createdAt: number;
  readonly workdir: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly duration: number; // in milliseconds
}

export interface DockerEnvironmentOptions {
  readonly baseImage?: string;
  readonly cpuLimit?: number;
  readonly memoryLimitMb?: number;
  readonly diskLimitGb?: number;
  readonly networkIsolated?: boolean;
  readonly timeoutMs?: number;
  readonly driver?: 'docker' | 'mock';
}

export interface DockerEnvironment {
  create(task: TBenchTask): Promise<Container>;
  exec(container: Container, cmd: string): Promise<ExecResult>;
  verify(container: Container, testScript: string): Promise<boolean>;
  destroy(container: Container): Promise<void>;
}

export interface TBenchRunConfig {
  readonly tasksDir: string;
  readonly model: string;
  readonly concurrency: number;
  readonly timeout: number; // seconds per task
  readonly categories?: ReadonlyArray<string>;
  readonly difficulties?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly outputDir: string;
  readonly smoke?: boolean;
  readonly driver?: 'docker' | 'mock';
}

export interface TBenchTaskResult {
  readonly task_id: string;
  readonly category: TBenchCategory;
  readonly difficulty: TBenchDifficulty;
  readonly passed: boolean;
  readonly duration: number; // ms
  readonly commands_executed: number;
  readonly tokens_used: number;
  readonly cost_dollars: number;
  readonly error?: string;
}

export interface TBenchCategoryStat {
  readonly passed: number;
  readonly total: number;
  readonly resolution_rate: number; // percentage 0-100
}

export interface TBenchLeaderboardEntry {
  readonly agent: string;
  readonly model: string;
  readonly resolution_rate: number; // percentage 0-100
  readonly is_baseline: boolean;
}

export interface TBenchResults {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly resolution_rate: number; // percentage 0-100
  readonly by_category: Record<string, TBenchCategoryStat>;
  readonly by_difficulty: Record<string, TBenchCategoryStat>;
  readonly tasks: ReadonlyArray<TBenchTaskResult>;
  readonly duration_total: number; // ms
  readonly model: string;
  readonly timestamp: string;
  readonly leaderboard_comparison: ReadonlyArray<TBenchLeaderboardEntry>;
}

/**
 * Published Baseline Standings from Terminal-Bench (ICLR 2026 / Harbor Leaderboard).
 */
export const TBENCH_KNOWN_LEADERBOARD: ReadonlyArray<TBenchLeaderboardEntry> = [
  {
    agent: 'Harbor + Claude Opus 4.1',
    model: 'anthropic/claude-opus-4-1',
    resolution_rate: 52.5,
    is_baseline: true,
  },
  {
    agent: 'Harbor + Claude 3.5 Sonnet',
    model: 'anthropic/claude-3-5-sonnet',
    resolution_rate: 48.3,
    is_baseline: true,
  },
  { agent: 'Harbor + GPT-4o', model: 'openai/gpt-4o', resolution_rate: 43.8, is_baseline: true },
  {
    agent: 'Harbor + Gemini 1.5 Pro',
    model: 'google/gemini-1.5-pro',
    resolution_rate: 38.5,
    is_baseline: true,
  },
  {
    agent: 'Harbor + DeepSeek V3',
    model: 'deepseek/deepseek-chat-v3',
    resolution_rate: 36.2,
    is_baseline: true,
  },
];
