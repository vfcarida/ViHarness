// Pattern: Outer-loop experience store (ref: Meta-Harness)
/**
 * Experience Store (Meta-Harness Outer-Loop Accumulation).
 *
 * Implements the filesystem-mediated experience accumulation store inspired by
 * Meta-Harness (Stanford IRIS Lab, arXiv:2603.28052).
 *
 * Persists raw, non-Markovian execution traces, harness configurations, and metrics across runs:
 * `~/.vi-harness/experience/{runId}/`
 *   - `harness-config.json`
 *   - `traces.jsonl`
 *   - `scores.json`
 *   - `summary.md`
 * `~/.vi-harness/experience/index.json`
 * `~/.vi-harness/experience/tuning-history.json`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { IterationTraceRecord } from '../../core/model/trace-types.js';
import type { ExecutionResult } from '../../core/model/runtime-types.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { IdFactory } from '../../core/types/identifiers.js';
import type { HarnessRecommendation } from './harness-diagnostic-engine.js';
import { SystemClock } from '../time/system-clock.js';

export interface RunIndexEntry {
  readonly runId: string;
  readonly goalId?: string;
  readonly taskId?: string;
  readonly goalDescription: string;
  readonly timestamp: string;
  readonly success: boolean;
  readonly status: string;
  readonly totalTokens: number;
  readonly totalCostDollars: number;
  readonly iterationCount: number;
  readonly finalPhase: string;
  readonly durationMs: number;
  readonly runDir: string;
}

export interface RunRecord {
  readonly indexEntry: RunIndexEntry;
  readonly harnessConfig: Record<string, unknown>;
  readonly traces: ReadonlyArray<IterationTraceRecord>;
  readonly scores: Record<string, unknown>;
  readonly summaryMarkdown: string;
}

export interface RecordRunParams {
  readonly runId: string;
  readonly goalId?: string;
  readonly taskId?: string;
  readonly goalDescription: string;
  readonly executionResult: ExecutionResult;
  readonly harnessConfig: Record<string, unknown>;
  readonly traceRecords?: ReadonlyArray<IterationTraceRecord>;
  readonly summaryMarkdown?: string;
}

export interface RunTraceData {
  readonly runId: string;
  readonly goalDescription: string;
  readonly success: boolean;
  readonly finalPhase: string;
  readonly durationMs: number;
  readonly harnessConfig: Record<string, unknown>;
  readonly traces: ReadonlyArray<IterationTraceRecord>;
  readonly scores: Record<string, unknown>;
}

export interface AutoTuneDecision {
  readonly decisionId: string;
  readonly timestamp: string;
  readonly recommendation: HarnessRecommendation;
  readonly applied: boolean;
  readonly previousConfig: Record<string, unknown>;
  readonly updatedConfig: Record<string, unknown>;
}

export interface ExperienceStore {
  readonly baseDir: string;
  recordRun(params: RecordRunParams): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  listRuns(limit?: number): Promise<ReadonlyArray<RunIndexEntry>>;
  getRecentTraces(lastN?: number): Promise<ReadonlyArray<RunTraceData>>;
  logTuningDecision(decision: AutoTuneDecision): Promise<void>;
  getTuningHistory(): Promise<ReadonlyArray<AutoTuneDecision>>;
}

export interface ExperienceStoreOptions {
  readonly baseDir?: string;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
}

export class DefaultExperienceStore implements ExperienceStore {
  public readonly baseDir: string;
  private readonly clock: Clock;

  constructor(options?: ExperienceStoreOptions) {
    this.baseDir = options?.baseDir ?? path.join(os.homedir(), '.vi-harness', 'experience');
    this.clock = options?.clock ?? new SystemClock();

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getIndexPath(): string {
    return path.join(this.baseDir, 'index.json');
  }

  private getTuningHistoryPath(): string {
    return path.join(this.baseDir, 'tuning-history.json');
  }

  private getRunDir(runId: string): string {
    return path.join(this.baseDir, runId);
  }

  async recordRun(params: RecordRunParams): Promise<RunRecord> {
    const runDir = this.getRunDir(params.runId);
    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }

    const now = this.clock.now();
    const result = params.executionResult;

    // 1. Build Scores Record
    const scores: Record<string, unknown> = {
      runId: params.runId,
      goalId: params.goalId,
      taskId: params.taskId,
      success: result.success,
      status: result.status,
      iterationCount: result.iterationCount,
      totalTokens: result.totalTokens,
      totalCostDollars: result.totalCostDollars,
      durationMs: result.durationMs,
      timestamp: now.toISOString(),
      metadata: result.metadata ?? {},
    };

    // 2. Build Summary Markdown
    const summaryMd =
      params.summaryMarkdown ??
      `# Run Execution Summary: ${params.runId}\n\n` +
        `- **Goal**: ${params.goalDescription}\n` +
        `- **Status**: ${result.status} (${result.success ? 'PASSED' : 'FAILED'})\n` +
        `- **Iterations**: ${result.iterationCount}\n` +
        `- **Tokens**: ${result.totalTokens.toLocaleString()}\n` +
        `- **Cost**: $${result.totalCostDollars.toFixed(4)}\n` +
        `- **Duration**: ${result.durationMs}ms\n` +
        `- **Recorded At**: ${now.toISOString()}\n`;

    // 3. Extract traces (from passed params or synthesized from iteration records)
    let traces: ReadonlyArray<IterationTraceRecord> = params.traceRecords ?? [];
    if (traces.length === 0 && result.iterations && result.iterations.length > 0) {
      traces = result.iterations.map((it, idx) => ({
        traceId: `${params.runId}-iter-${it.sequenceNumber || idx + 1}`,
        executionId: params.runId as any,
        taskId: (params.taskId ?? 'task-1') as any,
        iterationId: ((it as any).id ?? `iter-${idx + 1}`) as any,
        sequenceNumber: it.sequenceNumber || idx + 1,
        phaseBefore: it.stateBefore,
        phaseAfter: it.stateAfter,
        selectedProviderId: (it as any).selectedProviderId ?? 'default-provider',
        selectedModelId: (it as any).selectedModelId ?? 'default-model',
        targetRole: (it as any).targetRole ?? 'GENERALIST',
        promptTokens: it.tokenUsage?.inputTokens ?? 0,
        completionTokens: it.tokenUsage?.outputTokens ?? 0,
        cachedTokens: it.tokenUsage?.cacheReadTokens ?? 0,
        totalTokens: (it.tokenUsage?.inputTokens ?? 0) + (it.tokenUsage?.outputTokens ?? 0),
        costDollars: it.costDollars ?? 0,
        messages: [],
        proposedToolCalls:
          it.actionProposals?.map((p) => ({
            id: p.id,
            name: String(p.parameters['toolName'] ?? p.description),
            input: p.parameters,
          })) ?? [],
        policyDecisions: [],
        executedToolResults: it.toolResults ?? [],
        evidenceCreated: it.evidenceCreated ?? [],
        durationMs: (it as any).durationMs ?? 0,
        timestamp: (it as any).timestamp ?? now,
      }));
    }

    // 4. Write run files to disk
    const configPath = path.join(runDir, 'harness-config.json');
    const tracesPath = path.join(runDir, 'traces.jsonl');
    const scoresPath = path.join(runDir, 'scores.json');
    const summaryPath = path.join(runDir, 'summary.md');

    await fs.promises.writeFile(configPath, JSON.stringify(params.harnessConfig, null, 2), 'utf-8');
    await fs.promises.writeFile(scoresPath, JSON.stringify(scores, null, 2), 'utf-8');
    await fs.promises.writeFile(summaryPath, summaryMd, 'utf-8');

    // Write traces as JSONL (one raw trace record per line)
    const tracesContent = traces.map((t) => JSON.stringify(t)).join('\n') + '\n';
    await fs.promises.writeFile(tracesPath, tracesContent, 'utf-8');

    // 5. Update index.json catalog
    const lastIteration = traces[traces.length - 1];
    const finalPhase = String(
      lastIteration?.phaseAfter ??
        (result as any).finalPhase ??
        (result.success ? 'DONE' : 'FAILED'),
    );

    const indexEntry: RunIndexEntry = {
      runId: params.runId,
      goalId: params.goalId,
      taskId: params.taskId,
      goalDescription: params.goalDescription,
      timestamp: now.toISOString(),
      success: result.success,
      status: result.status,
      totalTokens: result.totalTokens,
      totalCostDollars: result.totalCostDollars,
      iterationCount: result.iterationCount,
      finalPhase,
      durationMs: result.durationMs,
      runDir,
    };

    await this.appendToIndex(indexEntry);

    return {
      indexEntry,
      harnessConfig: params.harnessConfig,
      traces,
      scores,
      summaryMarkdown: summaryMd,
    };
  }

  private async appendToIndex(entry: RunIndexEntry): Promise<void> {
    const indexPath = this.getIndexPath();
    let entries: RunIndexEntry[] = [];

    if (fs.existsSync(indexPath)) {
      try {
        const raw = await fs.promises.readFile(indexPath, 'utf-8');
        entries = JSON.parse(raw);
      } catch {
        entries = [];
      }
    }

    // Upsert entry by runId
    const existingIndex = entries.findIndex((e) => e.runId === entry.runId);
    if (existingIndex >= 0) {
      entries[existingIndex] = entry;
    } else {
      entries.push(entry);
    }

    await fs.promises.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const runDir = this.getRunDir(runId);
    if (!fs.existsSync(runDir)) {
      return null;
    }

    const configPath = path.join(runDir, 'harness-config.json');
    const tracesPath = path.join(runDir, 'traces.jsonl');
    const scoresPath = path.join(runDir, 'scores.json');
    const summaryPath = path.join(runDir, 'summary.md');

    let harnessConfig: Record<string, unknown> = {};
    let scores: Record<string, unknown> = {};
    let summaryMarkdown = '';
    const traces: IterationTraceRecord[] = [];

    if (fs.existsSync(configPath)) {
      try {
        harnessConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      } catch {
        harnessConfig = {};
      }
    }

    if (fs.existsSync(scoresPath)) {
      try {
        scores = JSON.parse(await fs.promises.readFile(scoresPath, 'utf-8'));
      } catch {
        scores = {};
      }
    }

    if (fs.existsSync(summaryPath)) {
      summaryMarkdown = await fs.promises.readFile(summaryPath, 'utf-8');
    }

    if (fs.existsSync(tracesPath)) {
      const content = await fs.promises.readFile(tracesPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          traces.push(JSON.parse(line));
        } catch {
          // Skip malformed trace line
        }
      }
    }

    const allIndex = await this.listRuns();
    const indexEntry = allIndex.find((e) => e.runId === runId) ?? {
      runId,
      goalDescription: String(scores['goalDescription'] ?? 'Unknown'),
      timestamp: String(scores['timestamp'] ?? new Date().toISOString()),
      success: Boolean(scores['success']),
      status: String(scores['status'] ?? 'COMPLETED'),
      totalTokens: Number(scores['totalTokens'] ?? 0),
      totalCostDollars: Number(scores['totalCostDollars'] ?? 0),
      iterationCount: Number(scores['iterationCount'] ?? traces.length),
      finalPhase: String(scores['finalPhase'] ?? 'DONE'),
      durationMs: Number(scores['durationMs'] ?? 0),
      runDir,
    };

    return {
      indexEntry,
      harnessConfig,
      traces,
      scores,
      summaryMarkdown,
    };
  }

  async listRuns(limit?: number): Promise<ReadonlyArray<RunIndexEntry>> {
    const indexPath = this.getIndexPath();
    if (!fs.existsSync(indexPath)) {
      return [];
    }

    try {
      const raw = await fs.promises.readFile(indexPath, 'utf-8');
      const entries: RunIndexEntry[] = JSON.parse(raw);
      if (limit && limit > 0) {
        return entries.slice(-limit);
      }
      return entries;
    } catch {
      return [];
    }
  }

  async getRecentTraces(lastN: number = 10): Promise<ReadonlyArray<RunTraceData>> {
    const runs = await this.listRuns(lastN);
    const result: RunTraceData[] = [];

    for (const entry of runs) {
      const fullRun = await this.getRun(entry.runId);
      if (fullRun) {
        result.push({
          runId: fullRun.indexEntry.runId,
          goalDescription: fullRun.indexEntry.goalDescription,
          success: fullRun.indexEntry.success,
          finalPhase: fullRun.indexEntry.finalPhase,
          durationMs: fullRun.indexEntry.durationMs,
          harnessConfig: fullRun.harnessConfig,
          traces: fullRun.traces,
          scores: fullRun.scores,
        });
      }
    }

    return result;
  }

  async logTuningDecision(decision: AutoTuneDecision): Promise<void> {
    const historyPath = this.getTuningHistoryPath();
    let history: AutoTuneDecision[] = [];

    if (fs.existsSync(historyPath)) {
      try {
        const raw = await fs.promises.readFile(historyPath, 'utf-8');
        history = JSON.parse(raw);
      } catch {
        history = [];
      }
    }

    history.push(decision);
    await fs.promises.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8');
  }

  async getTuningHistory(): Promise<ReadonlyArray<AutoTuneDecision>> {
    const historyPath = this.getTuningHistoryPath();
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    try {
      const raw = await fs.promises.readFile(historyPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
