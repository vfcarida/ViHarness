/**
 * Vi-Harness Benchmark Command Handler.
 *
 * Unified CLI interface for executing benchmark evaluation suites:
 * - canonical: Pi vs Vi-Harness comparative baseline evaluation
 * - projdevbench: Project development & full repository construction
 * - tbench: Terminal-Bench 2.0 / Harbor task suites
 * - context: Multi-horizon context efficiency & retention benchmark
 * - swe-bench: Automated software engineering bug reproduction & patching
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  DefaultBenchmarkRunner,
  CANONICAL_BASELINE_SUITE,
  ViHarnessAdapterRunner,
  PiHarnessAdapterRunner,
  SweBenchTaskLoader,
  type SweBenchInstance,
} from '../../infra/index.js';

export type BenchmarkSuiteType =
  | 'canonical'
  | 'projdevbench'
  | 'tbench'
  | 'context'
  | 'swe-bench';

export interface BenchmarkCliArgs {
  suite: BenchmarkSuiteType;
  modelId: string;
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  runs: number;
  tasks?: string;
  category?: string;
  difficulty?: string;
  limit?: number;
  concurrency: number;
  outputDir: string;
  format: 'json' | 'markdown' | 'both';
  preserveWorkspaces: boolean;
  dryRun: boolean;
  help: boolean;
}

export function printBenchmarkHelp(): void {
  console.log(`
Vi-Harness Benchmark Runner — Autonomous Benchmark Evaluation Suite

USAGE:
  vi-harness benchmark [options]
  vi-harness bench [options]
  vih bench [options]

SUITES:
  canonical               Controlled comparative evaluation (Vi-Harness vs Pi baseline)
  projdevbench            Project development & repository construction benchmark
  tbench                  Terminal-Bench 2.0 / Harbor execution suite
  context                 Multi-horizon context retention & token efficiency benchmark
  swe-bench               SWE-bench software engineering bug repair & patch synthesis

OPTIONS:
  -s, --suite <suite>     Benchmark suite to evaluate (default: canonical)
  -m, --model <id>        Model identifier (default: gpt-4o or env MODEL_ID)
  -p, --provider <id>     Model provider: openai, mock, anthropic, bedrock (default: openai)
  --base-url <url>        API endpoint URL (e.g. OpenRouter or local LiteLLM)
  --api-key <key>         API key for the model provider
  -r, --runs <n>          Number of repeated trials per task (default: 3 for canonical, 1 for others)
  --tasks <dir|ids>       Filter specific task IDs or custom dataset directory
  --category <name>       Filter tasks by category
  --difficulty <name>     Filter tasks by difficulty (EASY, MEDIUM, HARD)
  --limit <n>             Maximum number of tasks to execute
  -c, --concurrency <n>   Concurrent execution workers (default: 1)
  -o, --output, -d <dir>  Directory to save output reports (default: ./benchmark-results)
  --format <fmt>          Output format: json, markdown, or both (default: both)
  --preserve              Preserve isolated workspaces on disk for post-mortem inspection
  --dry-run               Inspect and list tasks without invoking model execution
  -h, --help              Show this help message

EXAMPLES:
  vi-harness bench
  vi-harness benchmark --suite projdevbench --category CLI --difficulty EASY
  vi-harness bench --suite tbench --tasks test-env-task
  vi-harness bench --suite canonical --runs 5 -m claude-3-5-sonnet
  vi-harness bench --suite context --output ./reports/context
`);
}

export function parseBenchmarkArgs(args: string[]): BenchmarkCliArgs {
  const result: BenchmarkCliArgs = {
    suite: 'canonical',
    modelId: process.env['MODEL_ID'] ?? 'gpt-4o',
    providerId: 'openai',
    runs: 3,
    concurrency: 1,
    outputDir: path.resolve(process.cwd(), 'benchmark-results'),
    format: 'both',
    preserveWorkspaces: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if ((arg === '--suite' || arg === '-s') && i + 1 < args.length) {
      result.suite = args[++i]!.toLowerCase() as BenchmarkSuiteType;
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      result.modelId = args[++i]!;
    } else if ((arg === '--provider' || arg === '-p') && i + 1 < args.length) {
      result.providerId = args[++i]!;
    } else if (arg === '--base-url' && i + 1 < args.length) {
      result.baseUrl = args[++i]!;
    } else if (arg === '--api-key' && i + 1 < args.length) {
      result.apiKey = args[++i]!;
    } else if ((arg === '--runs' || arg === '-r') && i + 1 < args.length) {
      result.runs = Math.max(1, parseInt(args[++i]!, 10) || 1);
    } else if ((arg === '--tasks' || arg === '-t') && i + 1 < args.length) {
      result.tasks = args[++i]!;
    } else if (arg === '--category' && i + 1 < args.length) {
      result.category = args[++i]!;
    } else if (arg === '--difficulty' && i + 1 < args.length) {
      result.difficulty = args[++i]!;
    } else if (arg === '--limit' && i + 1 < args.length) {
      result.limit = Math.max(1, parseInt(args[++i]!, 10) || 1);
    } else if ((arg === '--concurrency' || arg === '-c') && i + 1 < args.length) {
      result.concurrency = Math.max(1, parseInt(args[++i]!, 10) || 1);
    } else if ((arg === '--output' || arg === '-o' || arg === '--output-dir' || arg === '-d') && i + 1 < args.length) {
      result.outputDir = path.resolve(process.cwd(), args[++i]!);
    } else if (arg === '--format' && i + 1 < args.length) {
      const fmt = args[++i]!.toLowerCase();
      if (fmt === 'json' || fmt === 'markdown' || fmt === 'both') {
        result.format = fmt;
      }
    } else if (arg === '--preserve') {
      result.preserveWorkspaces = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    }
  }

  return result;
}

export async function runBenchmarkCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseBenchmarkArgs(args);

  // Sub-suite delegation (respects sub-suite specific help and flags)
  if (parsed.suite === 'projdevbench') {
    const { runProjDevBenchCli } = await import('../projdevbench-eval.js');
    await runProjDevBenchCli(args);
    return 0;
  }

  if (parsed.suite === 'tbench') {
    const { runTBenchCli } = await import('./tbench.js');
    await runTBenchCli(args);
    return 0;
  }

  if (parsed.suite === 'context') {
    const { runContextCli } = await import('../context-benchmark-cli.js');
    return runContextCli(args);
  }

  if (parsed.help) {
    printBenchmarkHelp();
    return 0;
  }

  if (parsed.suite === 'swe-bench') {
    const datasetPath = parsed.tasks ?? path.resolve(process.cwd(), 'swe-bench.jsonl');
    let instances: SweBenchInstance[] = [];

    if (fs.existsSync(datasetPath)) {
      const stat = fs.statSync(datasetPath);
      instances = stat.isDirectory()
        ? await SweBenchTaskLoader.loadFromDirectory(datasetPath, {
            limit: parsed.limit,
            repo: parsed.category,
          })
        : await SweBenchTaskLoader.loadFromFile(datasetPath, {
            limit: parsed.limit,
            repo: parsed.category,
          });
    }

    console.log('='.repeat(72));
    console.log(' VI-HARNESS SWE-BENCH BENCHMARK RUNNER');
    console.log('='.repeat(72));
    console.log(`Dataset Path   : ${datasetPath} (${instances.length} instance(s) loaded)`);
    console.log(`Model          : ${parsed.providerId}/${parsed.modelId}`);
    console.log(`Dry Run        : ${parsed.dryRun ? 'YES (inspection only)' : 'NO'}`);
    console.log(`Output Dir     : ${parsed.outputDir}`);
    console.log('='.repeat(72));

    if (instances.length === 0) {
      console.log(
        `\n⚠️ No SWE-bench instances found at: ${datasetPath}.\n` +
          `Provide a valid JSON/JSONL dataset file or directory using '--tasks <path>'.\n` +
          `Example: vi-harness bench --suite swe-bench --tasks ./swe-bench-lite.jsonl --dry-run\n`,
      );
      return 0;
    }

    if (parsed.dryRun) {
      console.log(`\nDry-run mode: Discovered ${instances.length} SWE-bench instance(s):`);
      for (const inst of instances) {
        const failTests = SweBenchTaskLoader.parseTestList(inst.FAIL_TO_PASS);
        const snippet = inst.problem_statement.replace(/\s+/g, ' ').slice(0, 80);
        console.log(` - [${inst.instance_id}] (${inst.repo}) [F2P: ${failTests.length} tests]: ${snippet}...`);
      }
      return 0;
    }

    // Export dataset summary and predictions template
    if (!fs.existsSync(parsed.outputDir)) {
      fs.mkdirSync(parsed.outputDir, { recursive: true });
    }
    const manifestPath = path.join(parsed.outputDir, 'swebench-instances.json');
    fs.writeFileSync(manifestPath, JSON.stringify(instances, null, 2), 'utf-8');
    console.log(`\n📄 Manifest of ${instances.length} SWE-bench tasks written to: ${manifestPath}`);
    return 0;
  }

  // Canonical Comparative Benchmark Execution
  console.log('='.repeat(72));
  console.log(` VI-HARNESS BENCHMARK RUNNER [Suite: ${parsed.suite.toUpperCase()}]`);
  console.log('='.repeat(72));
  console.log(`Model          : ${parsed.providerId}/${parsed.modelId}`);
  console.log(`Runs per Task  : ${parsed.runs}`);
  console.log(`Output Dir     : ${parsed.outputDir}`);
  console.log(`Dry Run        : ${parsed.dryRun ? 'YES (inspection only)' : 'NO'}`);
  console.log(`Format         : ${parsed.format}`);
  console.log('='.repeat(72));

  let taskList = CANONICAL_BASELINE_SUITE.tasks;
  if (parsed.limit && parsed.limit > 0) {
    taskList = taskList.slice(0, parsed.limit);
  }

  if (parsed.dryRun) {
    console.log(`\nDry-run mode: Found ${taskList.length} matching tasks:`);
    for (const t of taskList) {
      console.log(` - [${t.id}] ${t.name}: ${t.description} (path: ${t.repositoryPath})`);
    }
    return 0;
  }

  const runner = new DefaultBenchmarkRunner();
  const adapters = [new ViHarnessAdapterRunner(), new PiHarnessAdapterRunner()];

  const effectiveSuite = {
    ...CANONICAL_BASELINE_SUITE,
    tasks: taskList,
  };

  const startTime = Date.now();
  const suiteResult = await runner.runSuite(
    effectiveSuite,
    {
      runsPerTask: parsed.runs,
      preserveWorkspaces: parsed.preserveWorkspaces,
      modelConfig: {
        providerId: parsed.providerId,
        modelId: parsed.modelId,
        temperature: 0.2,
      },
    },
    adapters,
  );

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!fs.existsSync(parsed.outputDir)) {
    fs.mkdirSync(parsed.outputDir, { recursive: true });
  }

  const jsonReport = runner.generateMachineReadableReport(suiteResult);
  const mdReport = runner.generateMarkdownSummary(suiteResult);

  if (parsed.format === 'json' || parsed.format === 'both') {
    const jsonPath = path.join(parsed.outputDir, 'benchmark-report.json');
    fs.writeFileSync(jsonPath, jsonReport, 'utf-8');
    console.log(`\n📄 Machine-readable report saved to : ${jsonPath}`);
  }

  if (parsed.format === 'markdown' || parsed.format === 'both') {
    const mdPath = path.join(parsed.outputDir, 'benchmark-report.md');
    fs.writeFileSync(mdPath, mdReport, 'utf-8');
    console.log(`📄 Markdown summary report saved to: ${mdPath}`);
  }

  console.log(`\n✅ Benchmark suite completed in ${durationSec}s!`);

  // Print Executive Summary
  if ('harnessSummaries' in suiteResult) {
    console.log('\n' + '='.repeat(72));
    console.log(' BENCHMARK SUMMARY LEADERBOARD');
    console.log('='.repeat(72));
    for (const [name, summary] of Object.entries(suiteResult.harnessSummaries)) {
      console.log(`\n[${name}] (Trials: ${summary.totalRuns})`);
      console.log(`  Success Rate   : ${(summary.overallSuccessRate * 100).toFixed(1)}%`);
      console.log(`  Mean Cost (USD): $${summary.costDistribution.mean.toFixed(4)}`);
      console.log(`  Mean Tokens    : ${summary.tokenDistribution.totalTokens.mean.toFixed(0)}`);
      console.log(`  Mean Latency   : ${summary.latencyDistribution.mean.toFixed(0)}ms`);
    }
    console.log('='.repeat(72) + '\n');
  }

  return 0;
}
