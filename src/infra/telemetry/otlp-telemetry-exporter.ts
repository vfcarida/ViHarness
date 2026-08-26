/**
 * OpenTelemetry (OTLP) Distributed Telemetry Exporter.
 *
 * Exports agent runtime telemetry (traces, spans, token metrics, tool executions)
 * to OpenTelemetry-compatible collectors (Jaeger, Datadog, Grafana Tempo, Prometheus)
 * via standard OTLP/HTTP JSON protocol (`/v1/traces`, `/v1/metrics`).
 *
 * Features:
 * - Non-blocking asynchronous background batching
 * - Bounded buffer preventing memory leaks during collector outages
 * - Zero vendor SDK dependencies (uses standard Node.js `fetch`)
 */
import type { Span, ModelMetrics, ToolMetrics } from '../../core/model/telemetry-types.js';

export interface OtlpExporterOptions {
  readonly endpoint?: string; // Base OTLP endpoint (e.g. http://localhost:4318)
  readonly headers?: Record<string, string>;
  readonly serviceName?: string;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly maxQueueSize?: number;
  readonly customFetch?: typeof fetch;
}

export class OtlpTelemetryExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly serviceName: string;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly fetchImpl: typeof fetch;

  private spanQueue: Span[] = [];
  private metricQueue: Array<{
    name: string;
    value: number;
    labels?: Record<string, string>;
    timestamp: Date;
  }> = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(options: OtlpExporterOptions = {}) {
    this.endpoint = (
      options.endpoint ??
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
      'http://localhost:4318'
    ).replace(/\/+$/, '');
    this.headers = options.headers ?? {};
    this.serviceName = options.serviceName ?? process.env['OTEL_SERVICE_NAME'] ?? 'vi-harness';
    this.batchSize = options.batchSize ?? 50;
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.fetchImpl = options.customFetch ?? globalThis.fetch;

    const flushInterval = options.flushIntervalMs ?? 5000;
    if (flushInterval > 0 && typeof setInterval !== 'undefined') {
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, flushInterval);
      if (this.flushTimer.unref) {
        this.flushTimer.unref();
      }
    }
  }

  /**
   * Enqueue a trace span for OTLP export.
   */
  exportSpan(span: Span): void {
    if (this.spanQueue.length >= this.maxQueueSize) {
      this.spanQueue.shift();
    }
    this.spanQueue.push(span);

    if (this.spanQueue.length >= this.batchSize) {
      this.flushSpans().catch(() => {});
    }
  }

  /**
   * Enqueue a numeric metric point.
   */
  exportMetric(name: string, value: number, labels?: Record<string, string>): void {
    if (this.metricQueue.length >= this.maxQueueSize) {
      this.metricQueue.shift();
    }
    this.metricQueue.push({ name, value, labels, timestamp: new Date() });

    if (this.metricQueue.length >= this.batchSize) {
      this.flushMetrics().catch(() => {});
    }
  }

  /**
   * Record standard ModelInvocation metrics.
   */
  recordModelMetrics(metrics: ModelMetrics): void {
    this.exportMetric('agent.model.tokens.prompt', metrics.inputTokens, {
      model: metrics.model,
      provider: metrics.provider,
    });
    this.exportMetric('agent.model.tokens.completion', metrics.outputTokens, {
      model: metrics.model,
      provider: metrics.provider,
    });
    this.exportMetric('agent.model.tokens.total', metrics.inputTokens + metrics.outputTokens, {
      model: metrics.model,
      provider: metrics.provider,
    });
    this.exportMetric('agent.model.cost.dollars', metrics.cost, {
      model: metrics.model,
      provider: metrics.provider,
    });
    this.exportMetric('agent.model.latency.ms', metrics.latencyMs, {
      model: metrics.model,
      provider: metrics.provider,
    });
  }

  /**
   * Record tool execution metrics.
   */
  recordToolMetrics(toolName: string, metrics: ToolMetrics): void {
    this.exportMetric('agent.tool.calls.total', metrics.totalCalls, { tool: toolName });
    this.exportMetric('agent.tool.calls.success_rate', metrics.successRate, { tool: toolName });
    this.exportMetric('agent.tool.calls.failure_rate', metrics.failureRate, { tool: toolName });
    this.exportMetric('agent.tool.latency.avg_ms', metrics.executionTimeMs, { tool: toolName });
  }

  /**
   * Flush all buffered spans and metrics immediately.
   */
  async flush(): Promise<void> {
    await Promise.all([this.flushSpans(), this.flushMetrics()]);
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }

  private async flushSpans(): Promise<void> {
    if (this.spanQueue.length === 0) return;
    const batch = this.spanQueue.splice(0, this.batchSize);

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
              { key: 'telemetry.sdk.name', value: { stringValue: 'vi-harness-otlp' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'vi-harness.runtime' },
              spans: batch.map((s) => {
                const startTimeMs = new Date(s.startTime).getTime();
                const endTimeMs = s.endTime ? new Date(s.endTime).getTime() : startTimeMs;
                return {
                  traceId: s.traceId.replace(/-/g, '').padEnd(32, '0').slice(0, 32),
                  spanId: s.id.replace(/-/g, '').padEnd(16, '0').slice(0, 16),
                  parentSpanId: s.parentId
                    ? s.parentId.replace(/-/g, '').padEnd(16, '0').slice(0, 16)
                    : undefined,
                  name: s.name,
                  startTimeUnixNano: String(startTimeMs * 1000000),
                  endTimeUnixNano: String(endTimeMs * 1000000),
                  attributes: Object.entries(s.attributes).map(([k, v]) => ({
                    key: k,
                    value:
                      typeof v === 'number'
                        ? { doubleValue: v }
                        : typeof v === 'boolean'
                          ? { boolValue: v }
                          : { stringValue: String(v) },
                  })),
                  status: { code: s.status === 'OK' ? 1 : 2 },
                };
              }),
            },
          ],
        },
      ],
    };

    try {
      await this.fetchImpl(`${this.endpoint}/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Do not crash the application if the OTLP collector is unavailable
    }
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricQueue.length === 0) return;
    const batch = this.metricQueue.splice(0, this.batchSize);

    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }],
          },
          scopeMetrics: [
            {
              scope: { name: 'vi-harness.metrics' },
              metrics: batch.map((m) => ({
                name: m.name,
                gauge: {
                  dataPoints: [
                    {
                      asDouble: m.value,
                      timeUnixNano: String(m.timestamp.getTime() * 1000000),
                      attributes: Object.entries(m.labels ?? {}).map(([k, v]) => ({
                        key: k,
                        value: { stringValue: v },
                      })),
                    },
                  ],
                },
              })),
            },
          ],
        },
      ],
    };

    try {
      await this.fetchImpl(`${this.endpoint}/v1/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ignore collector network drops
    }
  }
}
