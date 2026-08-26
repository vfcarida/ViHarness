#!/usr/bin/env node
/**
 * TBench Command Handler (Vi-Harness CLI).
 *
 * Usage:
 *   vi-harness bench:tbench [options]
 *   npx tsx src/cli/commands/tbench.ts [options]
 */
import * as path from 'node:path';
import {
  TBenchRunner,
  TBenchReportGenerator,
  type TBenchCategory,
  type TBenchDifficulty,
} from '../../infra/index.js';
import { DefaultAgentRuntime } from '../../runtime/index.js';
import { DefaultContextCompiler } from '../../infra/compiler/default-context-compiler.js';
import { DefaultToolRegistry } from '../../infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../infra/tools/default-tool-executor.js';
import { OpenAICompatibleProvider } from '../../infra/model/openai-compatible-provider.js';
import { MockModelProvider } from '../../infra/model/mock-model-provider.js';
import { UuidV7IdFactory } from '../../infra/id/uuid-id-factory.js';
import { SystemClock } from '../../infra/time/system-clock.js';
import { UtilityModelRouter } from '../../infra/router/utility-model-router.js';

export interface TBenchCliArgs {
  tasksDir: string;
  modelId: string;
  providerId: string;
  concurrency: number;
  timeout: number;
  category?: TBenchCategory;
  difficulty?: TBenchDifficulty;
  smoke: boolean;
  compareLeaderboard: boolean;
  outputDir: string;
  driver?: 'docker' | 'mock';
  help: boolean;
}

export function parseTBenchArgs(args: string[]): TBenchCliArgs {
  const result: TBenchCliArgs = {
    tasksDir: path.resolve(process.cwd(), 'tests', 'fixtures', 'tbench'),
    modelId: 'claude-opus-4-1',
    providerId: 'openai',
    concurrency: 1,
    timeout: 1800,
    smoke: false,
    compareLeaderboard: false,
    outputDir: path.resolve(process.cwd(), 'benchmark-results', 'tbench'),
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--tasks' || arg === '-t') && i + 1 < args.length) {
      result.tasksDir = path.resolve(process.cwd(), args[++i]!);
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      result.modelId = args[++i]!;
    } else if ((arg === '--provider' || arg === '--prov') && i + 1 < args.length) {
      result.providerId = args[++i]!;
    } else if ((arg === '--concurrency' || arg === '-c') && i + 1 < args.length) {
      result.concurrency = parseInt(args[++i]!, 10) || 1;
    } else if (arg === '--timeout' && i + 1 < args.length) {
      result.timeout = parseInt(args[++i]!, 10) || 1800;
    } else if (arg === '--category' && i + 1 < args.length) {
      result.category = args[++i]! as TBenchCategory;
    } else if (arg === '--difficulty' && i + 1 < args.length) {
      result.difficulty = args[++i]! as TBenchDifficulty;
    } else if (arg === '--smoke') {
      result.smoke = true;
    } else if (arg === '--compare-leaderboard') {
      result.compareLeaderboard = true;
    } else if (arg === '--driver' && i + 1 < args.length) {
      result.driver = args[++i]! as 'docker' | 'mock';
    } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
      result.outputDir = path.resolve(process.cwd(), args[++i]!);
    }
  }

  return result;
}

export function printTBenchHelp(): void {
  console.log(`
======================================================================
         Terminal-Bench (TBench 2.0 / Harbor) Runner CLI
======================================================================

Usage:
  vi-harness bench:tbench [options]
  npx tsx src/cli/commands/tbench.ts [options]

Options:
  --tasks, -t <dir>       Tasks directory (default: './tests/fixtures/tbench')
  --model, -m <modelId>   Model identifier (default: 'claude-opus-4-1')
  --provider <id>         Model provider: openai | mock (default: 'openai')
  --concurrency, -c <n>   Parallel task executions (default: 1)
  --timeout <sec>         Per-task execution timeout in seconds (default: 1800)
  --category <name>       Filter: software-engineering | machine-learning | security | data-science | scientific-computing | games
  --difficulty <name>     Filter: easy | medium | hard
  --smoke                 Run quick smoke test on 3 tasks
  --compare-leaderboard   Display comparison against known TBench standings
  --driver <docker|mock>  Container execution driver (auto-detected default)
  --output, -o <dir>      Output report directory (default: './benchmark-results/tbench')
  --help, -h              Show this help message
`);
}

export async function runTBenchCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseTBenchArgs(rawArgs);

  if (args.help) {
    printTBenchHelp();
    return;
  }

  console.log('\n======================================================================');
  console.log('       Terminal-Bench (TBench 2.0 / Harbor) Benchmark Runner');
  console.log('======================================================================\n');
  console.log(`- Tasks Path:    ${args.tasksDir}`);
  console.log(`- Target Model:  ${args.modelId} (${args.providerId})`);
  console.log(`- Concurrency:   ${args.concurrency}`);
  console.log(`- Smoke Mode:    ${args.smoke ? 'YES (3 tasks)' : 'NO (all matching)'}`);
  console.log(`- Output Dir:    ${args.outputDir}\n`);

  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  const provider =
    args.providerId === 'mock' || args.smoke
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

  const runner = new TBenchRunner({ runtime, idFactory, clock });

  console.log('[INFO] Executing TBench evaluation suite...');
  const results = await runner.run({
    tasksDir: args.tasksDir,
    model: args.modelId,
    concurrency: args.concurrency,
    timeout: args.timeout,
    categories: args.category ? [args.category] : undefined,
    difficulties: args.difficulty ? [args.difficulty] : undefined,
    smoke: args.smoke,
    driver: args.driver,
    outputDir: args.outputDir,
  });

  console.log('\n======================================================================');
  console.log(
    `🏆 TBench Resolution Rate: ${results.resolution_rate.toFixed(2)}% (${results.passed}/${results.total} tasks)`,
  );
  console.log(`⏱ Total Benchmark Duration: ${(results.duration_total / 1000).toFixed(1)}s`);
  console.log('======================================================================\n');

  // Print results table
  console.log(TBenchReportGenerator.generateMarkdownReport(results));

  const { jsonPath, mdPath } = await TBenchReportGenerator.writeReportFiles(
    results,
    args.outputDir,
  );
  console.log(`📄 Saved JSON report to: ${jsonPath}`);
  console.log(`📄 Saved Markdown report to: ${mdPath}\n`);
}

if (process.argv[1]?.endsWith('tbench.ts') || process.argv[1]?.endsWith('tbench.js')) {
  runTBenchCli().catch((err) => {
    console.error('[ERROR] TBench runner failed:', err);
    process.exit(1);
  });
}
