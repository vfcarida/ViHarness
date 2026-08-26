/**
 * TBench Report Generator Unit Tests (P011).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TBenchReportGenerator,
  type TBenchResults,
} from '../../../../src/infra/eval/tbench/index.js';

describe('TBench Report Generator — P011', () => {
  const mockResults: TBenchResults = {
    total: 3,
    passed: 2,
    failed: 1,
    resolution_rate: 66.67,
    by_category: {
      'software-engineering': { passed: 1, total: 1, resolution_rate: 100.0 },
      'machine-learning': { passed: 1, total: 1, resolution_rate: 100.0 },
      security: { passed: 0, total: 1, resolution_rate: 0.0 },
    },
    by_difficulty: {
      easy: { passed: 1, total: 1, resolution_rate: 100.0 },
      medium: { passed: 1, total: 1, resolution_rate: 100.0 },
      hard: { passed: 0, total: 1, resolution_rate: 0.0 },
    },
    tasks: [
      {
        task_id: 'git-bisect-bug',
        category: 'software-engineering',
        difficulty: 'easy',
        passed: true,
        duration: 450,
        commands_executed: 2,
        tokens_used: 1200,
        cost_dollars: 0.01,
      },
      {
        task_id: 'train-mnist-classifier',
        category: 'machine-learning',
        difficulty: 'medium',
        passed: true,
        duration: 600,
        commands_executed: 3,
        tokens_used: 2400,
        cost_dollars: 0.02,
      },
      {
        task_id: 'inspect-pcap-traffic',
        category: 'security',
        difficulty: 'hard',
        passed: false,
        duration: 800,
        commands_executed: 1,
        tokens_used: 800,
        cost_dollars: 0.008,
      },
    ],
    duration_total: 1850,
    model: 'claude-opus-4-1',
    timestamp: '2026-01-01T00:00:00Z',
    leaderboard_comparison: [
      {
        agent: 'Vi-Harness (Autonomous Terminal Agent)',
        model: 'claude-opus-4-1',
        resolution_rate: 66.67,
        is_baseline: false,
      },
      {
        agent: 'Harbor + Claude Opus 4.1',
        model: 'anthropic/claude-opus-4-1',
        resolution_rate: 52.5,
        is_baseline: true,
      },
      {
        agent: 'Harbor + Claude 3.5 Sonnet',
        model: 'anthropic/claude-3-5-sonnet',
        resolution_rate: 48.3,
        is_baseline: true,
      },
    ],
  };

  it('1. should generate Markdown report with leaderboard comparison and category matrix', () => {
    const md = TBenchReportGenerator.generateMarkdownReport(mockResults);

    expect(md).toContain('# Terminal-Bench (TBench 2.0 / Harbor) Benchmark Report');
    expect(md).toContain('66.67%');
    expect(md).toContain('Official Terminal-Bench Leaderboard Standings');
    expect(md).toContain('Vi-Harness (Autonomous Terminal Agent)');
    expect(md).toContain('Harbor + Claude Opus 4.1');
    expect(md).toContain('software-engineering');
    expect(md).toContain('git-bisect-bug');
  });

  it('2. should persist JSON and Markdown report files to disk', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-tbench-report-'));

    const { jsonPath, mdPath } = await TBenchReportGenerator.writeReportFiles(mockResults, tempDir);

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const savedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(savedJson.resolution_rate).toBe(66.67);
    expect(savedJson.tasks).toHaveLength(3);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
