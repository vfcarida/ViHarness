#!/usr/bin/env node
/**
 * Benchmark Predictions Generator for Vi-Harness.
 *
 * Runs Vi-Harness against a dataset of benchmark problems and produces
 * the canonical predictions.jsonl containing generated git diff patches.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runSolveCli } from '../../src/cli/commands/solve.js';

export interface BenchmarkInstance {
  readonly id?: string;
  readonly instance_id?: string;
  readonly problem_id?: string;
  readonly prompt?: string;
  readonly description?: string;
  readonly problem_statement?: string;
  readonly workspace_dir?: string;
  readonly cwd?: string;
}

export interface PredictionEntry {
  readonly instance_id: string;
  readonly model_patch: string;
  readonly model_name_or_path: string;
  readonly duration_seconds: number;
  readonly exit_code: number;
}

export async function runBenchmarkPredictions(options?: {
  instances?: BenchmarkInstance[];
  datasetPath?: string;
  outputDir?: string;
  modelId?: string;
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<PredictionEntry[]> {
  const outputDir = path.resolve(options?.outputDir ?? 'benchmark-results/upstream-predictions');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let instances: BenchmarkInstance[] = options?.instances ?? [];

  if (options?.datasetPath && fs.existsSync(options.datasetPath)) {
    const raw = fs.readFileSync(options.datasetPath, 'utf-8');
    if (options.datasetPath.endsWith('.jsonl')) {
      instances = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
    } else {
      const parsed = JSON.parse(raw);
      instances = Array.isArray(parsed) ? parsed : [parsed];
    }
  }

  if (instances.length === 0) {
    instances = [
      {
        instance_id: 'default-smoke-001',
        prompt: 'Verify code builds with zero warnings',
        workspace_dir: process.cwd(),
      },
    ];
  }

  const predictions: PredictionEntry[] = [];
  const predictionsFile = path.join(outputDir, 'predictions.jsonl');
  const writeStream = fs.createWriteStream(predictionsFile, { encoding: 'utf-8', flags: 'w' });

  for (const inst of instances) {
    const instanceId = inst.instance_id ?? inst.id ?? inst.problem_id ?? 'unknown';
    const prompt = inst.prompt ?? inst.description ?? inst.problem_statement ?? 'Complete task';
    const workspaceDir = path.resolve(inst.workspace_dir ?? inst.cwd ?? process.cwd());
    const patchFile = path.join(outputDir, `${instanceId}.patch`);

    const args: string[] = [
      '-p',
      prompt,
      '--cwd',
      workspaceDir,
      '--model',
      options?.modelId ?? 'gpt-4o',
      '--provider-id',
      options?.providerId ?? 'mock',
      '--output-patch',
      patchFile,
      '--mode',
      'jsonl',
      '--max-iterations',
      '10',
    ];

    if (options?.baseUrl) args.push('--base-url', options.baseUrl);
    if (options?.apiKey) args.push('--api-key', options.apiKey);

    const start = Date.now();
    let exitCode = 0;
    try {
      exitCode = await runSolveCli(args);
    } catch {
      exitCode = 1;
    }
    const durationSeconds = Math.round((Date.now() - start) / 10) / 100;

    let modelPatch = '';
    if (fs.existsSync(patchFile)) {
      try {
        modelPatch = fs.readFileSync(patchFile, 'utf-8');
      } catch {
        // Ignore read failure
      }
    }

    const prediction: PredictionEntry = {
      instance_id: instanceId,
      model_patch: modelPatch,
      model_name_or_path: options?.modelId ?? 'gpt-4o',
      duration_seconds: durationSeconds,
      exit_code: exitCode,
    };

    predictions.push(prediction);
    writeStream.write(JSON.stringify(prediction) + '\n');
  }

  writeStream.end();
  return predictions;
}

if (process.argv[1]?.includes('run-benchmark-predictions')) {
  runBenchmarkPredictions().then((preds) => {
    console.log(`\nGenerated ${preds.length} prediction entries.`);
  });
}
