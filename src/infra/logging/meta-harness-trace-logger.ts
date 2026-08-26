/**
 * Meta-Harness Structured Causal Trace Logger.
 *
 * Implements persistent execution trace capture inspired by Meta-Harness (Stanford IRIS Lab, arXiv:2603.28052).
 * Records machine-readable JSONL logs per iteration to enable causal reasoning over
 * agent successes, failure modes, token bottlenecks, and harness optimization.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IterationTraceRecord, ExecutionTraceSummary } from '../../core/model/trace-types.js';
import type { ExecutionId } from '../../core/types/identifiers.js';
import type { AgentPhase } from '../../core/model/state.js';

export interface MetaHarnessTraceLoggerOptions {
  readonly outputDir?: string;
  readonly writeToDisk?: boolean;
}

export class MetaHarnessTraceLogger {
  private readonly outputDir: string;
  private readonly writeToDisk: boolean;
  private readonly traces = new Map<ExecutionId, IterationTraceRecord[]>();
  private readonly summaries = new Map<ExecutionId, ExecutionTraceSummary>();

  constructor(options?: MetaHarnessTraceLoggerOptions) {
    this.outputDir = path.resolve(options?.outputDir ?? './.vi-traces');
    this.writeToDisk = options?.writeToDisk ?? false;

    if (this.writeToDisk && !fs.existsSync(this.outputDir)) {
      try {
        fs.mkdirSync(this.outputDir, { recursive: true });
      } catch {
        // Ignore directory creation failure
      }
    }
  }

  /**
   * Record a single iteration's structured trace.
   */
  recordIteration(record: IterationTraceRecord): void {
    const list = this.traces.get(record.executionId) ?? [];
    list.push(record);
    this.traces.set(record.executionId, list);

    if (this.writeToDisk) {
      this.appendTraceToDisk(record);
    }
  }

  /**
   * Finalize and store the execution summary.
   */
  finalizeExecution(params: {
    executionId: ExecutionId;
    taskId: any;
    goalDescription: string;
    success: boolean;
    finalPhase: AgentPhase;
    startedAt: Date;
    finishedAt: Date;
  }): ExecutionTraceSummary {
    const iterationTraces = this.traces.get(params.executionId) ?? [];

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let totalCostDollars = 0;
    let totalToolCalls = 0;
    let failureEvidenceCount = 0;
    let passesEvidenceCount = 0;

    for (const t of iterationTraces) {
      totalTokens += t.totalTokens;
      promptTokens += t.promptTokens;
      completionTokens += t.completionTokens;
      cachedTokens += t.cachedTokens ?? 0;
      totalCostDollars += t.costDollars;
      totalToolCalls += t.executedToolResults.length;

      for (const ev of t.evidenceCreated) {
        if (ev.pass) {
          passesEvidenceCount++;
        } else {
          failureEvidenceCount++;
        }
      }
    }

    const totalDurationMs = params.finishedAt.getTime() - params.startedAt.getTime();

    const summary: ExecutionTraceSummary = {
      executionId: params.executionId,
      taskId: params.taskId,
      goalDescription: params.goalDescription,
      success: params.success,
      finalPhase: params.finalPhase,
      totalIterations: iterationTraces.length,
      totalTokens,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalCostDollars,
      totalDurationMs,
      totalToolCalls,
      failureEvidenceCount,
      passesEvidenceCount,
      traces: iterationTraces,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
    };

    this.summaries.set(params.executionId, summary);

    if (this.writeToDisk) {
      this.writeSummaryToDisk(summary);
    }

    return summary;
  }

  /**
   * Retrieve all recorded traces for an execution.
   */
  getTraces(executionId: ExecutionId): ReadonlyArray<IterationTraceRecord> {
    return this.traces.get(executionId) ?? [];
  }

  /**
   * Retrieve summary for an execution.
   */
  getSummary(executionId: ExecutionId): ExecutionTraceSummary | undefined {
    return this.summaries.get(executionId);
  }

  /**
   * Export all traces for an execution as formatted JSONL.
   */
  exportJsonl(executionId: ExecutionId): string {
    const list = this.getTraces(executionId);
    return list.map((r) => JSON.stringify(r)).join('\n');
  }

  private appendTraceToDisk(record: IterationTraceRecord): void {
    try {
      const filePath = path.join(this.outputDir, `${record.executionId}-traces.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Ignore disk write errors
    }
  }

  private writeSummaryToDisk(summary: ExecutionTraceSummary): void {
    try {
      const filePath = path.join(this.outputDir, `${summary.executionId}-summary.json`);
      fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch {
      // Ignore disk write errors
    }
  }
}
