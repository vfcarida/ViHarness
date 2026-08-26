/**
 * ProjDevBench End-to-End Integration Suite (P010).
 *
 * Validates the full ProjDevBench lifecycle:
 * 1. TaskLoader discovers and parses problems from fixtures.
 * 2. WorkspaceManager isolates trial workspace.
 * 3. ExecutionAdapter runs agent loop with workspace-contained tools.
 * 4. Model writes solution to workspace.
 * 5. Evaluator runs test suite (AC verdict) and rule-based code review.
 * 6. ReportGenerator produces final leaderboard standings.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  ProjDevTaskLoader,
  ProjDevWorkspaceManager,
  ProjDevEvaluator,
  ProjDevExecutionAdapter,
  ProjDevReportGenerator,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultContextCompiler,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/index.js';
import { type ModelRouter, ProviderHealthStatus, FinishReason } from '../../src/core/index.js';

describe('ProjDevBench End-to-End Runner Integration — P010', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));
  const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'projdevbench');

  it('should load problems, execute agent loop against spec, score results, and generate leaderboard report', async () => {
    const tempReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-pdb-integration-'));

    // 1. Discover problems
    const problems = await ProjDevTaskLoader.loadProblemsFromDirectory(fixturesDir, {
      problemIds: ['cli-markdown-parser'],
    });
    expect(problems).toHaveLength(1);
    const problem = problems[0]!;

    // 2. Setup Solution Code
    const solutionCode = `
export function parseMarkdown(markdown) {
  const lines = markdown.split('\\n');
  const result = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h3>' + line.slice(4) + '</h3>');
    } else if (line.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h2>' + line.slice(3) + '</h2>');
    } else if (line.startsWith('# ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<h1>' + line.slice(2) + '</h1>');
    } else if (line.startsWith('- ')) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push('<li>' + line.slice(2) + '</li>');
    } else if (line.trim().length > 0) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<p>' + line + '</p>');
    }
  }
  if (inList) result.push('</ul>');
  return result.join('\\n');
}
`;

    // 3. Setup Scripted Model Provider to write parser.js
    const provider = new ScriptedModelProvider({
      providerId: 'anthropic',
      steps: [
        {
          content: 'I will write the Markdown parser implementation in parser.js.',
          toolCalls: [
            {
              id: 'call-write-1',
              name: 'write_file',
              input: { path: 'parser.js', content: solutionCode },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'parser.js has been created and verified.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'claude-3-7-sonnet',
        scores: [],
        rationale: 'ProjDevBench benchmark route',
        decidedAt: clock.now(),
        deterministic: true,
      }),
      listAvailableModels: () => [],
      getProviderHealth: () => ProviderHealthStatus.HEALTHY,
      updateMetrics: () => {},
      hasCapability: () => true,
    };

    const toolRegistry = new DefaultToolRegistry();
    const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory, clock });
    const compiler = new DefaultContextCompiler({ idFactory, clock });

    const runtime = new DefaultAgentRuntime({
      router,
      compiler,
      toolExecutor,
      idFactory,
      clock,
    });

    const workspaceManager = new ProjDevWorkspaceManager();
    const evaluator = new ProjDevEvaluator({
      harnessName: 'Vi-Harness',
      modelId: 'claude-3-7-sonnet',
    });
    const adapter = new ProjDevExecutionAdapter({ runtime, idFactory, clock, evaluator });

    // 4. Run Problem
    const workspace = await workspaceManager.createWorkspace(problem);
    let problemScore;

    try {
      problemScore = await adapter.runProblem(problem, workspace);
    } finally {
      await workspace.cleanup();
    }

    expect(problemScore).toBeDefined();
    expect(problemScore.executionScore).toBe(1.0);
    expect(problemScore.testVerdicts).toHaveLength(1);
    expect(problemScore.testVerdicts[0]?.verdict).toBe('AC');
    expect(problemScore.codeReviewScore).toBe(1.0);
    expect(problemScore.finalScore).toBe(1.0);
    expect(problemScore.success).toBe(true);

    // 5. Generate Benchmark Report
    const report = evaluator.generateBenchmarkReport([problemScore], {
      harnessName: 'Vi-Harness',
      modelId: 'claude-3-7-sonnet',
    });

    expect(report.overallScore).toBe(100.0);
    expect(report.completedProblems).toBe(1);

    const { jsonPath, mdPath } = await ProjDevReportGenerator.writeReportFiles(
      report,
      tempReportDir,
    );
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('🏆 Official ProjDevBench Leaderboard Comparison');
    expect(mdContent).toContain('OpenAI Codex');
    expect(mdContent).toContain('Vi-Harness');

    fs.rmSync(tempReportDir, { recursive: true, force: true });
  });
});
