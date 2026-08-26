/**
 * TBench End-to-End Runner Integration Suite (P011).
 *
 * Validates the full Terminal-Bench 2.0 evaluation lifecycle:
 * 1. TaskLoader discovers and filters benchmark tasks.
 * 2. DockerEnvironment creates container sandbox.
 * 3. TerminalTool executes shell commands inside container.
 * 4. Agent solves task using terminal tool.
 * 5. Test script executes to verify resolution (Pass/Fail).
 * 6. ReportGenerator produces final leaderboard standings.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  TBenchRunner,
  TBenchReportGenerator,
  MockDockerEnvironment,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultContextCompiler,
  ScriptedModelProvider,
  UuidV7IdFactory,
  TestClock,
} from '../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../src/runtime/index.js';
import { type ModelRouter, ProviderHealthStatus, FinishReason } from '../../src/core/index.js';

describe('TBench End-to-End Runner Integration — P011', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new TestClock(new Date('2026-01-01T00:00:00Z'));
  const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'tbench');

  it('1. should execute benchmark task against container, verify pass, and produce report', async () => {
    const tempReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-tbench-e2e-'));
    const dockerEnv = new MockDockerEnvironment();

    // Scripted model solving git-bisect-bug
    const provider = new ScriptedModelProvider({
      providerId: 'anthropic',
      steps: [
        {
          content: 'I will fix the regression in regression.js.',
          toolCalls: [
            {
              id: 'call-1',
              name: 'terminal',
              input: {
                command:
                  "node -e \"const fs = require('fs'); fs.writeFileSync('regression.js', 'module.exports = { compute: () => 42 };');\"",
              },
            },
          ],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Verification fix has been applied.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'claude-opus-4-1',
        scores: [],
        rationale: 'TBench Route',
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

    const runner = new TBenchRunner({
      runtime,
      idFactory,
      clock,
      dockerEnv,
    });

    const results = await runner.run({
      tasksDir: fixturesDir,
      model: 'claude-opus-4-1',
      concurrency: 1,
      timeout: 300,
      categories: ['software-engineering'],
      outputDir: tempReportDir,
    });

    expect(results.total).toBe(1);
    expect(results.passed).toBe(1);
    expect(results.resolution_rate).toBe(100.0);
    expect(results.tasks[0]?.task_id).toBe('git-bisect-bug');
    expect(results.tasks[0]?.passed).toBe(true);

    const { jsonPath, mdPath } = await TBenchReportGenerator.writeReportFiles(
      results,
      tempReportDir,
    );
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    expect(mdContent).toContain('🏆 Official Terminal-Bench Leaderboard Standings');
    expect(mdContent).toContain('Harbor + Claude Opus 4.1');
    expect(mdContent).toContain('Vi-Harness (Autonomous Terminal Agent)');

    fs.rmSync(tempReportDir, { recursive: true, force: true });
  });

  it('2. should run smoke mode across all 3 fixture tasks', async () => {
    const tempReportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-tbench-smoke-'));
    const dockerEnv = new MockDockerEnvironment();

    const provider = new ScriptedModelProvider({
      providerId: 'anthropic',
      steps: [
        {
          content: 'Attempting terminal task.',
          toolCalls: [{ id: 'call-smoke', name: 'terminal', input: { command: 'node -v' } }],
          finishReason: FinishReason.TOOL_CALL,
        },
        {
          content: 'Done attempt.',
          toolCalls: [],
          finishReason: FinishReason.STOP,
        },
      ],
    });

    const router: ModelRouter = {
      route: async () => ({
        selectedProvider: provider,
        selectedModelId: 'claude-opus-4-1',
        scores: [],
        rationale: 'TBench Route',
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

    const runner = new TBenchRunner({ runtime, idFactory, clock, dockerEnv });

    const results = await runner.run({
      tasksDir: fixturesDir,
      model: 'claude-opus-4-1',
      concurrency: 2,
      timeout: 300,
      smoke: true,
      outputDir: tempReportDir,
    });

    expect(results.total).toBe(3);
    expect(results.by_category).toHaveProperty('software-engineering');
    expect(results.by_category).toHaveProperty('machine-learning');
    expect(results.by_category).toHaveProperty('security');

    fs.rmSync(tempReportDir, { recursive: true, force: true });
  });
});
