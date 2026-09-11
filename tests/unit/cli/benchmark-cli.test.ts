import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseBenchmarkArgs,
  runBenchmarkCli,
} from '../../../src/cli/commands/benchmark.js';

describe('Benchmark CLI Command Suite', () => {
  let tempDir: string;
  let logSpy: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-bench-cli-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('parseBenchmarkArgs returns expected defaults', () => {
    const args = parseBenchmarkArgs([]);
    expect(args.suite).toBe('canonical');
    expect(args.providerId).toBe('openai');
    expect(args.runs).toBe(3);
    expect(args.concurrency).toBe(1);
    expect(args.format).toBe('both');
    expect(args.dryRun).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parseBenchmarkArgs parses flags correctly', () => {
    const args = parseBenchmarkArgs([
      '--suite', 'projdevbench',
      '--model', 'claude-3-5-sonnet',
      '--provider', 'anthropic',
      '--runs', '5',
      '--limit', '10',
      '--concurrency', '2',
      '--output', '/tmp/custom-bench',
      '--format', 'json',
      '--dry-run',
      '--preserve',
    ]);

    expect(args.suite).toBe('projdevbench');
    expect(args.modelId).toBe('claude-3-5-sonnet');
    expect(args.providerId).toBe('anthropic');
    expect(args.runs).toBe(5);
    expect(args.limit).toBe(10);
    expect(args.concurrency).toBe(2);
    expect(args.format).toBe('json');
    expect(args.dryRun).toBe(true);
    expect(args.preserveWorkspaces).toBe(true);
  });

  it('runBenchmarkCli returns 0 and prints help when --help is passed', async () => {
    const code = await runBenchmarkCli(['--help']);
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Vi-Harness Benchmark Runner');
    expect(printed).toContain('canonical');
    expect(printed).toContain('projdevbench');
    expect(printed).toContain('tbench');
  });

  it('runBenchmarkCli in dry-run mode lists tasks without executing', async () => {
    const code = await runBenchmarkCli(['--dry-run', '--limit', '2']);
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Dry-run mode: Found 2 matching tasks:');
    expect(printed).toContain('VI-HARNESS BENCHMARK RUNNER');
  });

  it('runBenchmarkCli routes to sub-suite runner for context benchmark', async () => {
    const code = await runBenchmarkCli(['--suite', 'context', '--help']);
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(printed).toContain('Context-Efficiency');
  });

  it('runBenchmarkCli executes deterministic canonical reproduction run with mock provider', async () => {
    const code = await runBenchmarkCli([
      '--suite',
      'canonical',
      '--provider',
      'mock',
      '--runs',
      '1',
      '--limit',
      '1',
    ]);
    expect(code).toBe(0);
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
    expect(printed).toContain('BENCHMARK SUMMARY LEADERBOARD');
    expect(printed).toContain('[Vi-Harness]');
    expect(printed).toContain('[Pi]');
  });
});
