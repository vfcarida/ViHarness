import { describe, it, expect, vi } from 'vitest';
import { OtlpTelemetryExporter } from '../../../src/infra/telemetry/otlp-telemetry-exporter.js';
import type { Span, ModelMetrics, ToolMetrics } from '../../../src/core/model/telemetry-types.js';

describe('OtlpTelemetryExporter', () => {
  it('batches and exports spans to OTLP endpoint', async () => {
    let capturedTracesUrl = '';
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/traces')) {
        capturedTracesUrl = url;
        capturedBody = JSON.parse(init?.body as string);
      }
      return { ok: true, status: 200 } as unknown as Response;
    });

    const exporter = new OtlpTelemetryExporter({
      endpoint: 'http://localhost:4318',
      serviceName: 'vi-harness-test',
      batchSize: 2,
      flushIntervalMs: 0, // manual flush for test
      customFetch: mockFetch,
    });

    const span1: Span = {
      id: 'span-001',
      traceId: 'trace-001',
      name: 'iteration_observe',
      startTime: new Date('2026-08-21T00:00:00Z'),
      endTime: new Date('2026-08-21T00:00:01Z'),
      attributes: { phase: 'OBSERVE', success: true },
      status: 'OK',
    };

    const span2: Span = {
      id: 'span-002',
      traceId: 'trace-001',
      name: 'iteration_context',
      startTime: new Date('2026-08-21T00:00:01Z'),
      endTime: new Date('2026-08-21T00:00:02Z'),
      attributes: { tokens: 1200 },
      status: 'OK',
    };

    exporter.exportSpan(span1);
    exporter.exportSpan(span2);

    await exporter.flush();

    expect(capturedTracesUrl).toBe('http://localhost:4318/v1/traces');
    expect(capturedBody.resourceSpans[0].resource.attributes[0].value.stringValue).toBe(
      'vi-harness-test',
    );
    expect(capturedBody.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(capturedBody.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('iteration_observe');
  });

  it('batches and exports model and tool metrics', async () => {
    let capturedMetricsUrl = '';
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/metrics')) {
        capturedMetricsUrl = url;
        capturedBody = JSON.parse(init?.body as string);
      }
      return { ok: true, status: 200 } as unknown as Response;
    });

    const exporter = new OtlpTelemetryExporter({
      endpoint: 'http://localhost:4318',
      serviceName: 'vi-harness-test',
      batchSize: 10,
      flushIntervalMs: 0,
      customFetch: mockFetch,
    });

    const metrics: ModelMetrics = {
      model: 'claude-3-7-sonnet',
      provider: 'anthropic-primary',
      inputTokens: 2500,
      outputTokens: 300,
      cost: 0.012,
      latencyMs: 1200,
      retries: 0,
      failures: 0,
    };

    const toolMetrics: ToolMetrics = {
      totalCalls: 5,
      executionTimeMs: 120,
      successRate: 1.0,
      failureRate: 0.0,
    };

    exporter.recordModelMetrics(metrics);
    exporter.recordToolMetrics('write_to_file', toolMetrics);
    await exporter.flush();

    expect(capturedMetricsUrl).toBe('http://localhost:4318/v1/metrics');
    const metricPoints = capturedBody.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(metricPoints.some((m: any) => m.name === 'agent.model.tokens.prompt')).toBe(true);
    expect(metricPoints.some((m: any) => m.name === 'agent.model.cost.dollars')).toBe(true);
    expect(metricPoints.some((m: any) => m.name === 'agent.tool.calls.total')).toBe(true);
  });
});
