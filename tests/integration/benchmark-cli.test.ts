/**
 * Benchmark CLI Integration Tests.
 *
 * Verifies that the CLI entry point runs properly, parses options,
 * runs the comparison suite, and generates report files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCli } from '../../src/cli/benchmark-cli.js';

describe('Vi-Harness Benchmark CLI Integration', () => {
  let testOutDir: string;

  beforeEach(() => {
    testOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-bench-cli-test-'));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testOutDir)) {
        fs.rmSync(testOutDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('1. CLI Help Flag: Displays help and returns 0', async () => {
    const exitCode = await runCli(['--help']);
    expect(exitCode).toBe(0);
  });

  it('2. CLI Execution: Runs benchmark and produces JSON & Markdown report files', async () => {
    const exitCode = await runCli(['--runs', '1', '--model', 'gpt-4o', '--output', testOutDir]);

    expect(exitCode).toBe(0);

    const jsonFile = path.join(testOutDir, 'benchmark-report.json');
    const mdFile = path.join(testOutDir, 'benchmark-report.md');

    expect(fs.existsSync(jsonFile)).toBe(true);
    expect(fs.existsSync(mdFile)).toBe(true);

    const jsonContent = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    expect(jsonContent.suiteId).toBe('suite-baseline-v1');
    expect(jsonContent.harnessSummaries['Vi-Harness']).toBeDefined();
    expect(jsonContent.harnessSummaries['Pi']).toBeDefined();

    const mdContent = fs.readFileSync(mdFile, 'utf-8');
    expect(mdContent).toContain('Executive Comparison: Pi vs Vi-Harness');
    expect(mdContent).toContain('Token Consumption Distributions');
  }, 30000);
});
