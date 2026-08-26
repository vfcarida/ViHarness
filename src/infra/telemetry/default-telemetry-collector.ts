/**
 * Default Telemetry Collector.
 *
 * Pluggable, vendor-agnostic operational telemetry collector:
 * - Traces & Spans
 * - AgentMetrics
 * - ModelMetrics
 * - ContextMetrics
 * - ToolMetrics
 * - VerificationMetrics
 * - AggregatedTelemetry
 */
import type { TaskId, TraceId, IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type {
  Trace,
  Span,
  AgentMetrics,
  ModelMetrics,
  ContextMetrics,
  ToolMetrics,
  VerificationMetrics,
  AggregatedTelemetry,
} from '../../core/model/telemetry-types.js';

export interface DefaultTelemetryCollectorOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class DefaultTelemetryCollector {
  private readonly traces = new Map<TraceId, Trace>();
  private readonly modelMetricsList: ModelMetrics[] = [];
  private readonly contextMetricsList: ContextMetrics[] = [];
  private readonly toolCallsList: Array<{ executionTimeMs: number; success: boolean }> = [];
  private readonly verificationsList: Array<{
    pass: boolean;
    regression: boolean;
    flaky: boolean;
  }> = [];
  private readonly taskResults: Array<{
    success: boolean;
    iterations: number;
    terminationReason: string;
  }> = [];

  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(options: DefaultTelemetryCollectorOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  startTrace(taskId: TaskId): TraceId {
    const traceId = this.idFactory.create<'Trace'>();
    const now = this.clock.now();

    const trace: Trace = {
      id: traceId,
      taskId,
      spans: [],
      startTime: now,
      status: 'OK',
    };

    this.traces.set(traceId, trace);
    return traceId;
  }

  recordSpan(traceId: TraceId, span: Omit<Span, 'traceId'>): void {
    const trace = this.traces.get(traceId);
    if (trace) {
      const fullSpan: Span = {
        ...span,
        traceId,
      };
      (trace.spans as Span[]).push(fullSpan);
    }
  }

  recordAgentTask(success: boolean, iterations: number, terminationReason: string): void {
    this.taskResults.push({ success, iterations, terminationReason });
  }

  recordModelInvocation(metrics: ModelMetrics): void {
    this.modelMetricsList.push(metrics);
  }

  recordContextCompilation(metrics: ContextMetrics): void {
    this.contextMetricsList.push(metrics);
  }

  recordToolExecution(executionTimeMs: number, success: boolean): void {
    this.toolCallsList.push({ executionTimeMs, success });
  }

  recordVerificationOutcome(
    pass: boolean,
    regression: boolean = false,
    flaky: boolean = false,
  ): void {
    this.verificationsList.push({ pass, regression, flaky });
  }

  getAggregatedTelemetry(): AggregatedTelemetry {
    // 1. Agent Metrics
    const taskCount = this.taskResults.length;
    const successCount = this.taskResults.filter((t) => t.success).length;
    const failureCount = taskCount - successCount;
    const successRate = taskCount > 0 ? successCount / taskCount : 1.0;
    const failureRate = taskCount > 0 ? failureCount / taskCount : 0.0;
    const totalIterations = this.taskResults.reduce((acc, t) => acc + t.iterations, 0);
    const averageIterations = taskCount > 0 ? totalIterations / taskCount : 0;

    const terminationReasons: Record<string, number> = {};
    for (const t of this.taskResults) {
      terminationReasons[t.terminationReason] = (terminationReasons[t.terminationReason] ?? 0) + 1;
    }

    const agent: AgentMetrics = {
      taskCount,
      successRate,
      failureRate,
      averageIterations,
      terminationReasons,
    };

    // 2. Model Metrics & Total Cost
    let totalCostUSD = 0;
    for (const m of this.modelMetricsList) {
      totalCostUSD += m.cost;
    }

    // 3. Context Metrics Aggregation
    const contextCount = this.contextMetricsList.length;
    const avgContextSize =
      contextCount > 0
        ? this.contextMetricsList.reduce((acc, c) => acc + c.contextSize, 0) / contextCount
        : 0;
    const avgCompressedSize =
      contextCount > 0
        ? this.contextMetricsList.reduce((acc, c) => acc + c.compressedSize, 0) / contextCount
        : 0;
    const compressionRatio = avgContextSize > 0 ? avgCompressedSize / avgContextSize : 1.0;
    const totalRetrievals = this.contextMetricsList.reduce((acc, c) => acc + c.retrievalCount, 0);
    const totalOmitted = this.contextMetricsList.reduce((acc, c) => acc + c.omittedObjects, 0);
    const avgCompilerLatency =
      contextCount > 0
        ? this.contextMetricsList.reduce((acc, c) => acc + c.compilerLatencyMs, 0) / contextCount
        : 0;

    const context: ContextMetrics = {
      contextSize: avgContextSize,
      compressedSize: avgCompressedSize,
      compressionRatio,
      retrievalCount: totalRetrievals,
      omittedObjects: totalOmitted,
      compilerLatencyMs: avgCompilerLatency,
    };

    // 4. Tool Metrics Aggregation
    const toolCallCount = this.toolCallsList.length;
    const toolSuccesses = this.toolCallsList.filter((t) => t.success).length;
    const toolFailures = toolCallCount - toolSuccesses;
    const totalToolTime = this.toolCallsList.reduce((acc, t) => acc + t.executionTimeMs, 0);

    const tool: ToolMetrics = {
      totalCalls: toolCallCount,
      executionTimeMs: toolCallCount > 0 ? totalToolTime / toolCallCount : 0,
      successRate: toolCallCount > 0 ? toolSuccesses / toolCallCount : 1.0,
      failureRate: toolCallCount > 0 ? toolFailures / toolCallCount : 0.0,
    };

    // 5. Verification Metrics Aggregation
    const totalVerifications = this.verificationsList.length;
    const passCount = this.verificationsList.filter((v) => v.pass).length;
    const regressionCount = this.verificationsList.filter((v) => v.regression).length;
    const flakyCount = this.verificationsList.filter((v) => v.flaky).length;

    const verification: VerificationMetrics = {
      totalVerifications,
      passRate: totalVerifications > 0 ? passCount / totalVerifications : 1.0,
      regressionRate: totalVerifications > 0 ? regressionCount / totalVerifications : 0.0,
      flakyRate: totalVerifications > 0 ? flakyCount / totalVerifications : 0.0,
    };

    return {
      agent,
      models: this.modelMetricsList,
      context,
      tool,
      verification,
      totalCostUSD,
    };
  }
}
