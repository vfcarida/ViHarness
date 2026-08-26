#!/usr/bin/env node
/**
 * ProjDevBench Benchmark Runner CLI.
 *
 * Usage:
 *   npx tsx src/cli/projdevbench-eval.ts [options]
 *
 * Options:
 *   --problems, -p <dir>      Problems directory (default: './tests/fixtures/projdevbench')
 *   --model, -m <modelId>     Model identifier (default: 'gpt-4o')
 *   --provider, --prov <id>   Model provider (default: 'openai')
 *   --concurrency, -c <n>     Max parallel problem evaluations (default: 1)
 *   --category <name>         Filter by category (optional)
 *   --difficulty <name>       Filter by difficulty: EASY | MEDIUM | HARD (optional)
 *   --output, -o <dir>        Output directory for reports (default: './benchmark-results/projdevbench')
 *   --help, -h                Display help message
 */
import * as path from 'node:path';
import {
  ProjDevTaskLoader,
  ProjDevWorkspaceManager,
  ProjDevEvaluator,
  ProjDevExecutionAdapter,
  ProjDevReportGenerator,
  type ProjDevCategory,
  type ProjDevDifficulty,
  type ProjDevProblemScore,
} from '../infra/index.js';
import { DefaultAgentRuntime } from '../runtime/index.js';
import { DefaultContextCompiler } from '../infra/compiler/default-context-compiler.js';
import { DefaultToolRegistry } from '../infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../infra/tools/default-tool-executor.js';
import { OpenAICompatibleProvider } from '../infra/model/openai-compatible-provider.js';
import { MockModelProvider } from '../infra/model/mock-model-provider.js';
import { UuidV7IdFactory } from '../infra/id/uuid-id-factory.js';
import { SystemClock } from '../infra/time/system-clock.js';
import { UtilityModelRouter } from '../infra/router/utility-model-router.js';

interface CliArgs {
  problemsDir: string;
  modelId: string;
  providerId: string;
  concurrency: number;
  category?: ProjDevCategory;
  difficulty?: ProjDevDifficulty;
  outputDir: string;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    problemsDir: path.resolve(process.cwd(), 'tests', 'fixtures', 'projdevbench'),
    modelId: 'gpt-4o',
    providerId: 'openai',
    concurrency: 1,
    outputDir: path.resolve(process.cwd(), 'benchmark-results', 'projdevbench'),
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--problems' || arg === '-p') && i + 1 < args.length) {
      result.problemsDir = path.resolve(process.cwd(), args[++i]!);
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      result.modelId = args[++i]!;
    } else if ((arg === '--provider' || arg === '--prov') && i + 1 < args.length) {
      result.providerId = args[++i]!;
    } else if ((arg === '--concurrency' || arg === '-c') && i + 1 < args.length) {
      result.concurrency = parseInt(args[++i]!, 10) || 1;
    } else if (arg === '--category' && i + 1 < args.length) {
      result.category = args[++i]! as ProjDevCategory;
    } else if (arg === '--difficulty' && i + 1 < args.length) {
      result.difficulty = args[++i]! as ProjDevDifficulty;
    } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
      result.outputDir = path.resolve(process.cwd(), args[++i]!);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
======================================================================
         ProjDevBench Runner CLI — Vi-Harness Evaluation
======================================================================

Usage:
  npx tsx src/cli/projdevbench-eval.ts [options]

Options:
  --problems, -p <dir>      Problems directory (default: './tests/fixtures/projdevbench')
  --model, -m <modelId>     Model identifier (default: 'gpt-4o')
  --provider, --prov <id>   Model provider: openai | mock (default: 'openai')
  --concurrency, -c <n>     Max parallel problem evaluations (default: 1)
  --category <name>         Filter by category: CLI_TOOL, WEB_SERVICE, etc.
  --difficulty <name>       Filter by difficulty: EASY | MEDIUM | HARD
  --output, -o <dir>        Output directory (default: './benchmark-results/projdevbench')
  --help, -h                Show this help message
`);
}

async function main(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(rawArgs);

  if (args.help) {
    printHelp();
    return;
  }

  console.log('\n======================================================================');
  console.log('         ProjDevBench Benchmark Runner (Generative Evaluation)');
  console.log('======================================================================\n');
  console.log(`- Problems Path:  ${args.problemsDir}`);
  console.log(`- Target Model:   ${args.modelId} (${args.providerId})`);
  console.log(`- Concurrency:    ${args.concurrency}`);
  console.log(`- Output Dir:     ${args.outputDir}\n`);

  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  // 1. Discover problems
  const problems = await ProjDevTaskLoader.loadProblemsFromDirectory(args.problemsDir, {
    categories: args.category ? [args.category] : undefined,
    difficulties: args.difficulty ? [args.difficulty] : undefined,
  });

  if (problems.length === 0) {
    console.warn(`[WARN] No ProjDevBench problems found matching filters in ${args.problemsDir}`);
    process.exit(0);
  }

  console.log(`[INFO] Loaded ${problems.length} ProjDevBench problem(s).\n`);

  // 2. Setup Provider & Router
  const provider =
    args.providerId === 'mock'
      ? new MockModelProvider({ descriptor: { id: args.modelId }, providerId: 'mock' })
      : new OpenAICompatibleProvider({
          apiKey: process.env['OPENAI_API_KEY'] ?? 'dummy-key',
          defaultModelId: args.modelId,
          providerId: args.providerId,
        });

  const router = new UtilityModelRouter();
  router.registerProvider(provider);

  const toolRegistry = new DefaultToolRegistry();
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory });
  const compiler = new DefaultContextCompiler({ idFactory, clock });

  const runtime = new DefaultAgentRuntime({
    router,
    compiler,
    toolExecutor,
    idFactory,
    clock,
  });

  const workspaceManager = new ProjDevWorkspaceManager();
  const evaluator = new ProjDevEvaluator({ harnessName: 'Vi-Harness', modelId: args.modelId });
  const adapter = new ProjDevExecutionAdapter({ runtime, idFactory, clock, evaluator });

  const problemScores: ProjDevProblemScore[] = [];

  // 3. Execute problems with concurrency control
  for (let i = 0; i < problems.length; i++) {
    const prob = problems[i]!;
    console.log(
      `[${i + 1}/${problems.length}] Running problem [${prob.id}] (${prob.category}, ${prob.difficulty})...`,
    );

    const workspace = await workspaceManager.createWorkspace(prob);
    try {
      const score = await adapter.runProblem(prob, workspace);
      problemScores.push(score);

      const statusBadge = score.success ? '✅ PASSED' : '❌ FAILED';
      console.log(
        `   -> ${statusBadge} | Score: ${(score.finalScore * 100).toFixed(1)}% (Exec: ${(score.executionScore * 100).toFixed(1)}%, Review: ${(score.codeReviewScore * 100).toFixed(1)}%)\n`,
      );
    } finally {
      await workspace.cleanup();
    }
  }

  // 4. Generate Reports
  const report = evaluator.generateBenchmarkReport(problemScores, {
    harnessName: 'Vi-Harness',
    modelId: args.modelId,
  });

  const { jsonPath, mdPath } = await ProjDevReportGenerator.writeReportFiles(
    report,
    args.outputDir,
  );

  console.log('======================================================================');
  console.log(`🏆 Overall ProjDevBench Score: ${report.overallScore.toFixed(2)}%`);
  console.log(`📄 JSON Report saved to: ${jsonPath}`);
  console.log(`📄 Markdown Report saved to: ${mdPath}`);
  console.log('======================================================================\n');
}

export { main as runProjDevBenchCli };

if (
  process.argv[1]?.endsWith('projdevbench-eval.ts') ||
  process.argv[1]?.endsWith('projdevbench-eval.js')
) {
  main().catch((err) => {
    console.error('[ERROR] ProjDevBench runner failed:', err);
    process.exit(1);
  });
}
