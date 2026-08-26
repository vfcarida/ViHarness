#!/usr/bin/env node
/**
 * Official Vi-Harness Benchmark Runner CLI.
 *
 * Usage:
 *   npm run benchmark -- [options]
 *   npx tsx src/cli/benchmark-cli.ts [options]
 *
 * Options:
 *   --runs, -r <n>          Number of trials per task (default: 3)
 *   --suite, -s <id>        Task suite ID (default: 'canonical')
 *   --model, -m <modelId>   Model identifier (default: 'gpt-4o')
 *   --provider, -p <id>     Model provider (default: 'openai')
 *   --temperature, -t <num> Model temperature (default: 0.2)
 *   --output, -o <dir>      Output directory for reports (default: './benchmark-results')
 *   --preserve              Preserve isolated workspaces for debugging (default: false)
 *   --help, -h              Display help message
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DefaultBenchmarkRunner,
  CANONICAL_BASELINE_SUITE,
  ViHarnessAdapterRunner,
  PiHarnessAdapterRunner,
} from '../index.js';

interface CliArgs {
  runs: number;
  suiteId: string;
  modelId: string;
  providerId: string;
  temperature: number;
  outputDir: string;
  preserveWorkspaces: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    runs: 3,
    suiteId: 'canonical',
    modelId: 'gpt-4o',
    providerId: 'openai',
    temperature: 0.2,
    outputDir: path.resolve(process.cwd(), 'benchmark-results'),
    preserveWorkspaces: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--runs' || arg === '-r') && i + 1 < args.length) {
      result.runs = parseInt(args[++i]!, 10) || 3;
    } else if ((arg === '--suite' || arg === '-s') && i + 1 < args.length) {
      result.suiteId = args[++i]!;
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      result.modelId = args[++i]!;
    } else if ((arg === '--provider' || arg === '-p') && i + 1 < args.length) {
      result.providerId = args[++i]!;
    } else if ((arg === '--temperature' || arg === '-t') && i + 1 < args.length) {
      result.temperature = parseFloat(args[++i]!) || 0.2;
    } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
      result.outputDir = path.resolve(process.cwd(), args[++i]!);
    } else if (arg === '--preserve') {
      result.preserveWorkspaces = true;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
Vi-Harness Official Benchmark Runner CLI

Compares Pi Harness vs Vi-Harness with all experimental variables controlled:
Model, Task, Repository Baseline, Tools, Timeout, Budget, and Workspace Environment.

Usage:
  npm run benchmark -- [options]
  npx tsx src/cli/benchmark-cli.ts [options]

Options:
  -r, --runs <number>       Number of repeated trials per task (default: 3)
  -s, --suite <suiteId>     Task suite to execute ('canonical') (default: canonical)
  -m, --model <modelId>     Model identifier (default: gpt-4o)
  -p, --provider <provider> Model provider ID (default: openai)
  -t, --temperature <num>   Sampling temperature (default: 0.2)
  -o, --output <dir>        Directory to store JSON & Markdown reports (default: ./benchmark-results)
      --preserve            Preserve isolated test workspaces on disk for post-mortem analysis
  -h, --help                Display this help message
`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  console.log('='.repeat(70));
  console.log(' VI-HARNESS BENCHMARK RUNNER: Pi vs Vi-Harness');
  console.log('='.repeat(70));
  console.log(`Suite       : ${args.suiteId} (${CANONICAL_BASELINE_SUITE.tasks.length} tasks)`);
  console.log(`Model       : ${args.providerId}/${args.modelId} (temp: ${args.temperature})`);
  console.log(`Trials/Task : ${args.runs} repeated runs per harness`);
  console.log(`Output Dir  : ${args.outputDir}`);
  console.log(`Isolation   : Enabled (dedicated pristine workspace per trial)`);
  console.log('='.repeat(70));
  console.log('\nExecuting benchmark trials...');

  const runner = new DefaultBenchmarkRunner();
  const adapters = [new ViHarnessAdapterRunner(), new PiHarnessAdapterRunner()];

  const startTime = Date.now();
  const suiteResult = await runner.runSuite(
    CANONICAL_BASELINE_SUITE,
    {
      runsPerTask: args.runs,
      preserveWorkspaces: args.preserveWorkspaces,
      modelConfig: {
        providerId: args.providerId,
        modelId: args.modelId,
        temperature: args.temperature,
      },
    },
    adapters,
  );
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // Generate outputs
  const jsonReport = runner.generateMachineReadableReport(suiteResult);
  const markdownReport = runner.generateMarkdownSummary(suiteResult);

  // Ensure output directory exists
  if (!fs.existsSync(args.outputDir)) {
    fs.mkdirSync(args.outputDir, { recursive: true });
  }

  const jsonPath = path.join(args.outputDir, 'benchmark-report.json');
  const mdPath = path.join(args.outputDir, 'benchmark-report.md');

  fs.writeFileSync(jsonPath, jsonReport, 'utf-8');
  fs.writeFileSync(mdPath, markdownReport, 'utf-8');

  console.log(`\nBenchmark completed in ${elapsedSec}s!`);
  console.log(`\nMachine-readable JSON report written to : ${jsonPath}`);
  console.log(`Human-readable Markdown summary written to: ${mdPath}`);

  // Print executive summary to stdout
  console.log('\n' + '='.repeat(70));
  console.log(' EXECUTIVE SUMMARY');
  console.log('='.repeat(70));

  if ('harnessSummaries' in suiteResult) {
    for (const [name, summary] of Object.entries(suiteResult.harnessSummaries)) {
      console.log(`\n[${name}] (version: ${summary.harnessVersion}, trials: ${summary.totalRuns})`);
      console.log(`  Success Rate   : ${(summary.overallSuccessRate * 100).toFixed(1)}%`);
      console.log(
        `  Cost (USD)     : Mean: $${summary.costDistribution.mean.toFixed(4)} | Median: $${summary.costDistribution.median.toFixed(4)} | P95: $${summary.costDistribution.p95.toFixed(4)}`,
      );
      console.log(
        `  Iterations     : Mean: ${summary.iterationDistribution.mean.toFixed(1)} | Median: ${summary.iterationDistribution.median.toFixed(1)} | P95: ${summary.iterationDistribution.p95.toFixed(1)}`,
      );
      console.log(
        `  Total Tokens   : Mean: ${summary.tokenDistribution.totalTokens.mean.toFixed(0)} | Median: ${summary.tokenDistribution.totalTokens.median.toFixed(0)} | P95: ${summary.tokenDistribution.totalTokens.p95.toFixed(0)}`,
      );
      console.log(
        `  Latency (ms)   : Mean: ${summary.latencyDistribution.mean.toFixed(0)}ms | Median: ${summary.latencyDistribution.median.toFixed(0)}ms | P95: ${summary.latencyDistribution.p95.toFixed(0)}ms`,
      );
    }
  }
  console.log('\n' + '='.repeat(70));

  return 0;
}

// Execute if invoked directly via CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith('benchmark-cli.ts') || process.argv[1].endsWith('benchmark-cli.js'))
) {
  runCli().catch((err) => {
    console.error('Benchmark execution failed:', err);
    process.exit(1);
  });
}
