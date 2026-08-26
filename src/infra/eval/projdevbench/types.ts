/**
 * ProjDevBench (Project Development Benchmark) Domain Types.
 *
 * Reference: https://github.com/zsworld6/projdevbench
 * Evaluates generative whole-project construction from specifications across 8 categories.
 */
import type { TokenUsage } from '../../../core/model/model-io.js';

export type ProjDevCategory =
  | 'CLI_TOOL'
  | 'WEB_SERVICE'
  | 'DATA_PROCESSING'
  | 'ALGORITHM_SYSTEM'
  | 'GAME_ENGINE'
  | 'DATABASE_ENGINE'
  | 'NETWORKING'
  | 'SYSTEMS_UTILITY';

export type ProjDevDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type ProjDevMode = 'SCAFFOLD' | 'FROM_SCRATCH';

export type TestVerdict = 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' | 'MLE';

export interface TestCaseResult {
  readonly name: string;
  readonly verdict: TestVerdict;
  readonly executionTimeMs: number;
  readonly output?: string;
  readonly error?: string;
}

export interface CodeReviewRule {
  readonly id: string;
  readonly description: string;
  readonly check: (workspacePath: string) => Promise<{
    readonly passed: boolean;
    readonly score: number; // 0.0 to 1.0
    readonly feedback: string;
  }>;
}

export interface ProjDevProblem {
  readonly id: string;
  readonly title: string;
  readonly category: ProjDevCategory;
  readonly difficulty: ProjDevDifficulty;
  readonly mode: ProjDevMode;
  readonly specMarkdown: string;
  readonly testCommands: ReadonlyArray<string>;
  readonly reviewRules?: ReadonlyArray<CodeReviewRule>;
  readonly templateFiles?: Readonly<Record<string, string>>;
  readonly sourcePath?: string;
  readonly timeoutMs?: number;
  readonly maxCostDollars?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProjDevProblemScore {
  readonly problemId: string;
  readonly title: string;
  readonly category: ProjDevCategory;
  readonly difficulty: ProjDevDifficulty;
  readonly mode: ProjDevMode;
  readonly executionScore: number; // 0.0 - 1.0
  readonly codeReviewScore: number; // 0.0 - 1.0
  readonly finalScore: number; // 0.8 * execution + 0.2 * codeReview
  readonly testVerdicts: ReadonlyArray<TestCaseResult>;
  readonly reviewFeedback: ReadonlyArray<string>;
  readonly tokenUsage: TokenUsage;
  readonly costDollars: number;
  readonly durationMs: number;
  readonly iterationCount: number;
  readonly success: boolean;
}

export interface LeaderboardEntry {
  readonly agent: string;
  readonly score: number; // 0.0 - 100.0%
  readonly referenceModel?: string;
  readonly isBaseline?: boolean;
}

export interface ProjDevBenchmarkReport {
  readonly benchmarkName: 'ProjDevBench';
  readonly timestamp: string;
  readonly harnessName: string;
  readonly modelId: string;
  readonly totalProblems: number;
  readonly completedProblems: number;
  readonly overallScore: number; // 0.0 - 100.0%
  readonly executionScoreAverage: number;
  readonly codeReviewScoreAverage: number;
  readonly categoryScores: Record<string, { readonly score: number; readonly count: number }>;
  readonly problemScores: ReadonlyArray<ProjDevProblemScore>;
  readonly leaderboardComparison: ReadonlyArray<LeaderboardEntry>;
  readonly totalTokens: number;
  readonly totalCostDollars: number;
  readonly totalDurationMs: number;
}

export const PROJDEVBENCH_KNOWN_LEADERBOARD: ReadonlyArray<LeaderboardEntry> = [
  { agent: 'OpenAI Codex', score: 77.85, referenceModel: 'code-davinci-002', isBaseline: true },
  { agent: 'Cursor', score: 75.32, referenceModel: 'claude-3-5-sonnet', isBaseline: true },
  { agent: 'Claude Code', score: 73.1, referenceModel: 'claude-3-7-sonnet', isBaseline: true },
  { agent: 'Gemini CLI', score: 68.45, referenceModel: 'gemini-1.5-pro', isBaseline: true },
  {
    agent: 'Aider (Architect)',
    score: 67.2,
    referenceModel: 'claude-3-5-sonnet',
    isBaseline: true,
  },
];
