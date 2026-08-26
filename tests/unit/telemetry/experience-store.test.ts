/**
 * Experience Store Unit Tests (Meta-Harness Pattern) — P009.
 *
 * Validates:
 * 1. Filesystem experience accumulation: harness-config.json, traces.jsonl, scores.json, summary.md.
 * 2. Indefinite growth and non-Markovian index catalog tracking.
 * 3. Retrieval of full raw iteration traces across runs.
 * 4. Auto-tune decision logging.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DefaultExperienceStore,
  type RecordRunParams,
  type AutoTuneDecision,
} from '../../../src/infra/index.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { AgentPhase, ActionResultStatus } from '../../../src/core/index.js';

describe('Experience Store (Meta-Harness Pattern) — P009', () => {
  const clock = new TestClock(new Date('2026-01-01T00:00:00.000Z'));
  const idFactory = new UuidV7IdFactory();

  it('1. should persist run artifacts to filesystem directory and update index.json', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-exp-store-'));
    const store = new DefaultExperienceStore({ baseDir: tempDir, clock, idFactory });

    const runParams: RecordRunParams = {
      runId: 'run-001',
      goalId: 'goal-001',
      taskId: 'task-001',
      goalDescription: 'Implement OAuth2 auth endpoint',
      harnessConfig: {
        architectMode: false,
        maxAutoCorrectionsPerFile: 2,
        enablePrefixCaching: true,
      },
      executionResult: {
        executionId: 'run-001' as any,
        goalId: 'goal-001' as any,
        taskId: 'task-001' as any,
        success: true,
        status: 'COMPLETED',
        summary: 'Goal completed successfully in 3 iterations.',
        iterationCount: 3,
        durationMs: 1250,
        totalCostDollars: 0.045,
        totalTokens: 6200,
        iterations: [
          {
            iterationId: 'it-1' as any,
            sequenceNumber: 1,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.INIT,
            stateAfter: AgentPhase.EXPLORE,
            modelId: 'model-a',
            providerId: 'provider-a',
            actionProposed: null,
            toolResults: [],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 1500, outputTokens: 200, totalTokens: 1700 },
            costDollars: 0.012,
            terminationDecision: { terminal: false } as any,
          },
          {
            iterationId: 'it-2' as any,
            sequenceNumber: 2,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.EXPLORE,
            stateAfter: AgentPhase.IMPLEMENT,
            modelId: 'model-a',
            providerId: 'provider-a',
            actionProposed: null,
            toolResults: [
              {
                actionId: 'act-1' as any,
                status: ActionResultStatus.SUCCESS,
                output: 'File written successfully',
                durationMs: 25,
                executedAt: clock.now(),
                metadata: { toolName: 'write_file' },
              },
            ],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 2000, outputTokens: 400, totalTokens: 2400 },
            costDollars: 0.018,
            terminationDecision: { terminal: false } as any,
          },
          {
            iterationId: 'it-3' as any,
            sequenceNumber: 3,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.IMPLEMENT,
            stateAfter: AgentPhase.DONE,
            modelId: 'model-a',
            providerId: 'provider-a',
            actionProposed: null,
            toolResults: [],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 1800, outputTokens: 300, totalTokens: 2100 },
            costDollars: 0.015,
            terminationDecision: { terminal: true } as any,
          },
        ],
      },
    };

    const record = await store.recordRun(runParams);

    expect(record.indexEntry.runId).toBe('run-001');
    expect(record.indexEntry.success).toBe(true);
    expect(record.indexEntry.totalTokens).toBe(6200);

    // Verify files on disk
    const runDir = path.join(tempDir, 'run-001');
    expect(fs.existsSync(path.join(runDir, 'harness-config.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'traces.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'scores.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'summary.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'index.json'))).toBe(true);

    // Verify traces.jsonl contents
    const traceLines = fs
      .readFileSync(path.join(runDir, 'traces.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(traceLines).toHaveLength(3);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('2. should retrieve full run records and raw non-Markovian traces via getRun and getRecentTraces', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-exp-store-traces-'));
    const store = new DefaultExperienceStore({ baseDir: tempDir, clock, idFactory });

    // Seed 3 historical runs
    for (let i = 1; i <= 3; i++) {
      await store.recordRun({
        runId: `run-00${i}`,
        goalDescription: `Task ${i} description`,
        harnessConfig: { runIndex: i },
        executionResult: {
          executionId: `run-00${i}` as any,
          goalId: `goal-${i}` as any,
          taskId: `task-${i}` as any,
          success: i % 2 === 1,
          status: i % 2 === 1 ? 'COMPLETED' : 'FAILED',
          summary: `Run ${i} summary`,
          iterationCount: i * 2,
          durationMs: i * 500,
          totalCostDollars: i * 0.02,
          totalTokens: i * 3000,
          iterations: [
            {
              iterationId: `it-${i}` as any,
              sequenceNumber: 1,
              startedAt: clock.now(),
              completedAt: clock.now(),
              stateBefore: AgentPhase.INIT,
              stateAfter: AgentPhase.EXPLORE,
              modelId: 'model-a',
              providerId: 'provider-a',
              actionProposed: null,
              toolResults: [],
              evidenceCreated: [],
              tokenUsage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
              costDollars: 0.01,
              terminationDecision: { terminal: true } as any,
            },
          ],
        },
      });
    }

    const runs = await store.listRuns();
    expect(runs).toHaveLength(3);
    expect(runs[0]?.runId).toBe('run-001');
    expect(runs[2]?.runId).toBe('run-003');

    const run2 = await store.getRun('run-002');
    expect(run2).not.toBeNull();
    expect(run2?.indexEntry.success).toBe(false);
    expect(run2?.harnessConfig['runIndex']).toBe(2);
    expect(run2?.traces).toHaveLength(1);

    const recent = await store.getRecentTraces(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.runId).toBe('run-002');
    expect(recent[1]?.runId).toBe('run-003');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('3. should log auto-tune decisions to tuning-history.json', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-exp-store-tuning-'));
    const store = new DefaultExperienceStore({ baseDir: tempDir, clock, idFactory });

    const decision: AutoTuneDecision = {
      decisionId: 'dec-101',
      timestamp: clock.now().toISOString(),
      recommendation: {
        type: 'COMPACTION_TUNING',
        parameter: 'aggressiveCompactionThreshold',
        currentValue: 0.85,
        suggestedValue: 0.65,
        evidence: ['Context token accumulation exceeded 40,000 tokens in 3 consecutive runs'],
        confidence: 0.9,
        rationale: 'Engage progressive compaction earlier to prevent context exhaustion.',
      },
      applied: true,
      previousConfig: { aggressiveCompactionThreshold: 0.85 },
      updatedConfig: { aggressiveCompactionThreshold: 0.65 },
    };

    await store.logTuningDecision(decision);

    const history = await store.getTuningHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.decisionId).toBe('dec-101');
    expect(history[0]?.recommendation.parameter).toBe('aggressiveCompactionThreshold');
    expect(history[0]?.updatedConfig['aggressiveCompactionThreshold']).toBe(0.65);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
