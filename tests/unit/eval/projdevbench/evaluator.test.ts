/**
 * ProjDevBench Evaluator Unit Tests (P010).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ProjDevEvaluator,
  type ProjDevProblem,
  type ProjDevProblemScore,
} from '../../../../src/infra/eval/projdevbench/index.js';

describe('ProjDevBench Evaluator — P010', () => {
  const evaluator = new ProjDevEvaluator({
    harnessName: 'Vi-Harness',
    modelId: 'claude-3-7-sonnet',
  });

  it('1. should score execution test commands and map verdicts', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-eval-exec-'));

    // Write a passing test
    fs.writeFileSync(
      path.join(tempDir, 'pass.js'),
      'console.log("PASS"); process.exit(0);',
      'utf-8',
    );
    // Write a failing test
    fs.writeFileSync(
      path.join(tempDir, 'fail.js'),
      'console.error("AssertionError: 1 !== 2"); process.exit(1);',
      'utf-8',
    );

    const result = await evaluator.evaluateExecution(tempDir, ['node pass.js', 'node fail.js']);

    expect(result.executionScore).toBe(0.5);
    expect(result.verdicts).toHaveLength(2);
    expect(result.verdicts[0]?.verdict).toBe('AC');
    expect(result.verdicts[1]?.verdict).toBe('WA');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. should evaluate rule-based code review criteria', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-eval-review-'));

    // Write meaningful source file
    fs.writeFileSync(
      path.join(tempDir, 'service.js'),
      'export class DataService {\n  fetchData() {\n    return [1, 2, 3];\n  }\n}\n',
      'utf-8',
    );

    const customRule = {
      id: 'has-service-export',
      description: 'Must export DataService',
      check: async (ws: string) => {
        const content = fs.readFileSync(path.join(ws, 'service.js'), 'utf-8');
        return {
          passed: content.includes('DataService'),
          score: content.includes('DataService') ? 1.0 : 0.0,
          feedback: 'DataService export verified.',
        };
      },
    };

    const review = await evaluator.evaluateCodeReview(tempDir, [customRule]);

    expect(review.codeReviewScore).toBe(1.0);
    expect(review.feedback.length).toBeGreaterThanOrEqual(2);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('3. should calculate weighted composite score: 0.8 * execution + 0.2 * codeReview', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-eval-prob-'));
    fs.writeFileSync(path.join(tempDir, 'test.js'), 'process.exit(0);', 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'impl.js'), 'export const hello = "world";', 'utf-8');

    const mockProblem: ProjDevProblem = {
      id: 'prob-1',
      title: 'Sample Problem',
      category: 'CLI_TOOL',
      difficulty: 'EASY',
      mode: 'FROM_SCRATCH',
      specMarkdown: 'Test spec',
      testCommands: ['node test.js'],
    };

    const score = await evaluator.evaluateProblem({
      problem: mockProblem,
      workspacePath: tempDir,
      tokenUsage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
      costDollars: 0.01,
      durationMs: 450,
      iterationCount: 2,
      runtimeSuccess: true,
    });

    expect(score.executionScore).toBe(1.0);
    expect(score.codeReviewScore).toBe(1.0);
    expect(score.finalScore).toBe(1.0);
    expect(score.success).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('4. should generate benchmark report and rank Vi-Harness against known leaderboard baselines', () => {
    const scores: ProjDevProblemScore[] = [
      {
        problemId: 'prob-1',
        title: 'Problem 1',
        category: 'CLI_TOOL',
        difficulty: 'EASY',
        mode: 'FROM_SCRATCH',
        executionScore: 1.0,
        codeReviewScore: 1.0,
        finalScore: 1.0,
        testVerdicts: [{ name: 't1', verdict: 'AC', executionTimeMs: 50 }],
        reviewFeedback: [],
        tokenUsage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
        costDollars: 0.01,
        durationMs: 500,
        iterationCount: 2,
        success: true,
      },
      {
        problemId: 'prob-2',
        title: 'Problem 2',
        category: 'WEB_SERVICE',
        difficulty: 'HARD',
        mode: 'FROM_SCRATCH',
        executionScore: 0.5,
        codeReviewScore: 1.0,
        finalScore: 0.6,
        testVerdicts: [{ name: 't2', verdict: 'WA', executionTimeMs: 60 }],
        reviewFeedback: [],
        tokenUsage: { inputTokens: 2000, outputTokens: 400, totalTokens: 2400 },
        costDollars: 0.02,
        durationMs: 800,
        iterationCount: 3,
        success: false,
      },
    ];

    const report = evaluator.generateBenchmarkReport(scores, {
      harnessName: 'Vi-Harness',
      modelId: 'claude-3-7-sonnet',
    });

    expect(report.totalProblems).toBe(2);
    expect(report.completedProblems).toBe(1);
    expect(report.overallScore).toBe(80.0); // (1.0 + 0.6) / 2 = 0.8 -> 80%

    // Verify leaderboard inclusion and sorting
    expect(report.leaderboardComparison.length).toBeGreaterThan(5);
    const viHarnessEntry = report.leaderboardComparison.find((e) => e.agent === 'Vi-Harness');
    expect(viHarnessEntry).toBeDefined();
    expect(viHarnessEntry?.score).toBe(80.0);
  });
});
