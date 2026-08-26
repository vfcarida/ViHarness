/**
 * ProjDevBench Evaluation Protocol.
 *
 * Dual evaluation combining execution testing (80%) and rule-based code review (20%).
 * Reference: https://github.com/zsworld6/projdevbench
 */
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ProjDevProblem,
  ProjDevProblemScore,
  TestCaseResult,
  TestVerdict,
  CodeReviewRule,
  ProjDevBenchmarkReport,
  LeaderboardEntry,
} from './types.js';
import { PROJDEVBENCH_KNOWN_LEADERBOARD } from './types.js';
import type { TokenUsage } from '../../../core/model/model-io.js';

export interface EvaluatorOptions {
  readonly testTimeoutMs?: number;
  readonly harnessName?: string;
  readonly modelId?: string;
}

export class ProjDevEvaluator {
  private readonly defaultTimeoutMs: number;

  constructor(options?: EvaluatorOptions) {
    this.defaultTimeoutMs = options?.testTimeoutMs ?? 30000;
  }

  /**
   * Executes test commands and extracts verdicts (AC, WA, TLE, RE, CE, MLE).
   */
  async evaluateExecution(
    workspacePath: string,
    testCommands: ReadonlyArray<string>,
    timeoutMs?: number,
  ): Promise<{ executionScore: number; verdicts: TestCaseResult[] }> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const verdicts: TestCaseResult[] = [];

    if (testCommands.length === 0) {
      return { executionScore: 1.0, verdicts: [] };
    }

    for (let i = 0; i < testCommands.length; i++) {
      const cmd = testCommands[i]!;
      const startTime = Date.now();

      try {
        const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          child_process.exec(
            cmd,
            { cwd: workspacePath, timeout, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                reject({ error, stdout, stderr });
              } else {
                resolve({ stdout, stderr });
              }
            },
          );
        });

        const duration = Date.now() - startTime;
        verdicts.push({
          name: `Test #${i + 1} (${cmd})`,
          verdict: 'AC',
          executionTimeMs: duration,
          output: output.stdout.slice(0, 500),
        });
      } catch (err: any) {
        const duration = Date.now() - startTime;
        const errorObj = err?.error;
        const stdout = String(err?.stdout ?? '');
        const stderr = String(err?.stderr ?? '');
        const combined = `${stdout}\n${stderr}`;

        let verdict: TestVerdict = 'WA';

        if (errorObj?.killed || errorObj?.signal === 'SIGTERM' || duration >= timeout) {
          verdict = 'TLE';
        } else if (
          combined.includes('SyntaxError') ||
          combined.includes('TS2304') ||
          combined.includes('Cannot find module')
        ) {
          verdict = 'CE';
        } else if (combined.includes('JavaScript heap out of memory')) {
          verdict = 'MLE';
        } else if (
          errorObj?.code &&
          errorObj.code !== 0 &&
          !combined.includes('AssertionError') &&
          !combined.includes('FAIL')
        ) {
          verdict = 'RE';
        }

        verdicts.push({
          name: `Test #${i + 1} (${cmd})`,
          verdict,
          executionTimeMs: duration,
          output: stdout.slice(0, 500),
          error: stderr.slice(0, 500) || String(errorObj?.message ?? err),
        });
      }
    }

    const acCount = verdicts.filter((v) => v.verdict === 'AC').length;
    const executionScore = acCount / verdicts.length;

    return { executionScore, verdicts };
  }

  /**
   * Evaluates code quality and architectural constraints via rule-based checks.
   */
  async evaluateCodeReview(
    workspacePath: string,
    customRules?: ReadonlyArray<CodeReviewRule>,
  ): Promise<{ codeReviewScore: number; feedback: string[] }> {
    const feedback: string[] = [];
    let totalScore = 0;
    let ruleCount = 0;

    // Default Baseline Rules
    // Rule 1: Project files exist and are non-empty
    const files = this.listCodeFiles(workspacePath);
    ruleCount++;
    if (files.length > 0) {
      totalScore += 1.0;
      feedback.push(`PASS: Found ${files.length} project source files.`);
    } else {
      feedback.push('FAIL: No source code files detected in workspace.');
    }

    // Rule 2: Syntax and basic structural check (no corrupted empty implementations)
    ruleCount++;
    let nonTrivialFiles = 0;
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(workspacePath, f), 'utf-8');
        if (content.trim().length > 10) {
          nonTrivialFiles++;
        }
      } catch {
        // Skip unreadable file
      }
    }
    if (nonTrivialFiles > 0) {
      const ratio = Math.min(1.0, nonTrivialFiles / Math.max(1, files.length));
      totalScore += ratio;
      feedback.push(`PASS: ${nonTrivialFiles} files contain non-trivial implementations.`);
    } else {
      feedback.push('FAIL: Source files are empty or trivial stubs.');
    }

    // Custom problem-specific rules
    if (customRules && customRules.length > 0) {
      for (const rule of customRules) {
        ruleCount++;
        try {
          const res = await rule.check(workspacePath);
          totalScore += Math.max(0, Math.min(1.0, res.score));
          feedback.push(`${res.passed ? 'PASS' : 'WARN'}: ${rule.description} — ${res.feedback}`);
        } catch (err) {
          feedback.push(`FAIL: ${rule.description} — check threw error: ${err}`);
        }
      }
    }

    const codeReviewScore = ruleCount > 0 ? totalScore / ruleCount : 1.0;
    return { codeReviewScore, feedback };
  }

  private listCodeFiles(dir: string, rel = ''): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      const relPath = path.join(rel, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push(...this.listCodeFiles(full, relPath));
      } else if (
        entry.isFile() &&
        (relPath.endsWith('.ts') ||
          relPath.endsWith('.js') ||
          relPath.endsWith('.py') ||
          relPath.endsWith('.json'))
      ) {
        results.push(relPath);
      }
    }
    return results;
  }

  /**
   * Computes the combined problem score: 0.8 * execution + 0.2 * codeReview.
   */
  async evaluateProblem(params: {
    problem: ProjDevProblem;
    workspacePath: string;
    tokenUsage: TokenUsage;
    costDollars: number;
    durationMs: number;
    iterationCount: number;
    runtimeSuccess: boolean;
  }): Promise<ProjDevProblemScore> {
    const { problem, workspacePath, tokenUsage, costDollars, durationMs, iterationCount } = params;

    // 1. Execution Evaluation
    const { executionScore, verdicts } = await this.evaluateExecution(
      workspacePath,
      problem.testCommands,
      problem.timeoutMs,
    );

    // 2. Code Review Evaluation
    const { codeReviewScore, feedback } = await this.evaluateCodeReview(
      workspacePath,
      problem.reviewRules,
    );

    // 3. Composite Final Score
    const finalScore = Number((0.8 * executionScore + 0.2 * codeReviewScore).toFixed(4));
    const success = finalScore >= 0.7;

    return {
      problemId: problem.id,
      title: problem.title,
      category: problem.category,
      difficulty: problem.difficulty,
      mode: problem.mode,
      executionScore,
      codeReviewScore,
      finalScore,
      testVerdicts: verdicts,
      reviewFeedback: feedback,
      tokenUsage,
      costDollars,
      durationMs,
      iterationCount,
      success,
    };
  }

  /**
   * Generates a complete benchmark report with leaderboard standings.
   */
  generateBenchmarkReport(
    problemScores: ReadonlyArray<ProjDevProblemScore>,
    options?: { harnessName?: string; modelId?: string },
  ): ProjDevBenchmarkReport {
    const harnessName = options?.harnessName ?? 'Vi-Harness';
    const modelId = options?.modelId ?? 'claude-3-7-sonnet';

    let totalScoreSum = 0;
    let totalExecSum = 0;
    let totalReviewSum = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalDuration = 0;

    const categoryMap: Record<string, { total: number; count: number }> = {};

    for (const ps of problemScores) {
      totalScoreSum += ps.finalScore;
      totalExecSum += ps.executionScore;
      totalReviewSum += ps.codeReviewScore;
      totalTokens += ps.tokenUsage.totalTokens;
      totalCost += ps.costDollars;
      totalDuration += ps.durationMs;

      const catEntry = categoryMap[ps.category] ?? { total: 0, count: 0 };
      catEntry.total += ps.finalScore;
      catEntry.count += 1;
      categoryMap[ps.category] = catEntry;
    }

    const n = Math.max(1, problemScores.length);
    const overallScore = Number(((totalScoreSum / n) * 100).toFixed(2));
    const executionScoreAverage = Number(((totalExecSum / n) * 100).toFixed(2));
    const codeReviewScoreAverage = Number(((totalReviewSum / n) * 100).toFixed(2));

    const categoryScores: Record<string, { score: number; count: number }> = {};
    for (const [cat, data] of Object.entries(categoryMap)) {
      categoryScores[cat] = {
        score: Number(((data.total / data.count) * 100).toFixed(2)),
        count: data.count,
      };
    }

    // Build Leaderboard comparison including Vi-Harness score
    const viHarnessEntry: LeaderboardEntry = {
      agent: harnessName,
      score: overallScore,
      referenceModel: modelId,
      isBaseline: false,
    };

    const leaderboardComparison = [...PROJDEVBENCH_KNOWN_LEADERBOARD, viHarnessEntry].sort(
      (a, b) => b.score - a.score,
    );

    return {
      benchmarkName: 'ProjDevBench',
      timestamp: new Date().toISOString(),
      harnessName,
      modelId,
      totalProblems: problemScores.length,
      completedProblems: problemScores.filter((p) => p.success).length,
      overallScore,
      executionScoreAverage,
      codeReviewScoreAverage,
      categoryScores,
      problemScores,
      leaderboardComparison,
      totalTokens,
      totalCostDollars: Number(totalCost.toFixed(4)),
      totalDurationMs: totalDuration,
    };
  }
}
