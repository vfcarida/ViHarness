import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runBenchmarkPredictions } from '../../../scripts/eval/run-benchmark-predictions.js';

describe('Benchmark Predictions Runner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-bench-preds-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore teardown cleanup errors
    }
  });

  it('runs instances and writes predictions.jsonl with model_patch', async () => {
    const outputDir = path.join(tempDir, 'output');
    const instances = [
      {
        instance_id: 'test-case-001',
        prompt: 'Create solution in solution.txt',
        workspace_dir: tempDir,
      },
    ];

    const predictions = await runBenchmarkPredictions({
      instances,
      outputDir,
      modelId: 'mock-model',
      providerId: 'mock',
    });

    expect(predictions).toHaveLength(1);
    expect(predictions[0]?.instance_id).toBe('test-case-001');
    expect(predictions[0]?.exit_code).toBe(0);

    const predictionsFile = path.join(outputDir, 'predictions.jsonl');
    expect(fs.existsSync(predictionsFile)).toBe(true);

    const raw = fs.readFileSync(predictionsFile, 'utf-8');
    const parsed = JSON.parse(raw.trim());
    expect(parsed.instance_id).toBe('test-case-001');
    expect(parsed.model_name_or_path).toBe('mock-model');
  });
});
