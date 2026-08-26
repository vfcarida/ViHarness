/**
 * Tool Result Caching & Performance Optimization Suite (Prompt 13).
 *
 * Tests:
 * 1. Read-only idempotent tool executions are cached.
 * 2. Mutating tools invalidate cache to preserve correctness.
 * 3. PerformanceProfiler verifies reliability invariant (zero drop in success rate).
 */
import { describe, it, expect } from 'vitest';
import {
  DefaultToolExecutor,
  DefaultToolRegistry,
  PerformanceProfiler,
  TelemetryCategory,
  UuidV7IdFactory,
} from '../../../src/infra/index.js';
import {
  ToolCategory,
  ToolRiskLevel,
  type Tool,
  type ToolDefinition,
  type ToolInput,
  type ToolResult,
} from '../../../src/core/index.js';

describe('Tool Result Caching & Performance Optimization (Prompt 13)', () => {
  const idFactory = new UuidV7IdFactory();

  it('1. Caches idempotent read-only tool results on subsequent identical calls', async () => {
    let rawExecutionCount = 0;

    const readTool: Tool = {
      definition: {
        name: 'mock_read_file',
        version: '1.0.0',
        description: 'Read file mock',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 1000,
        requiredPermissions: ['fs:read'],
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
      async execute(input: ToolInput): Promise<ToolResult> {
        rawExecutionCount++;
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'mock_read_file',
          output: `Content of ${input['path']}`,
          success: true,
          durationMs: 5,
        };
      },
    };

    const registry = new DefaultToolRegistry();
    registry.register(readTool);

    const executor = new DefaultToolExecutor({
      registry,
      idFactory,
      enableCache: true,
    });

    // 1st call: executes tool
    const res1 = await executor.execute({
      toolName: 'mock_read_file',
      input: { path: 'file1.ts' },
    });
    expect(res1.success).toBe(true);
    expect(res1.output).toBe('Content of file1.ts');
    expect(res1.metadata?.['fromCache']).toBeUndefined();
    expect(rawExecutionCount).toBe(1);

    // 2nd call with identical input: served from cache!
    const res2 = await executor.execute({
      toolName: 'mock_read_file',
      input: { path: 'file1.ts' },
    });
    expect(res2.success).toBe(true);
    expect(res2.output).toBe('Content of file1.ts');
    expect(res2.metadata?.['fromCache']).toBe(true);
    expect(rawExecutionCount).toBe(1); // No new execution!
  });

  it('2. Mutating tools invalidate the read cache to prevent stale data', async () => {
    let fileContent = 'version 1';
    let readCount = 0;

    const readTool: Tool = {
      definition: {
        name: 'read_doc',
        version: '1.0.0',
        description: 'Read doc',
        category: ToolCategory.READ,
        riskLevel: ToolRiskLevel.LOW,
        mutating: false,
        idempotent: true,
        defaultTimeoutMs: 1000,
        requiredPermissions: ['fs:read'],
        inputSchema: { type: 'object', properties: { doc: { type: 'string' } } },
      },
      async execute(): Promise<ToolResult> {
        readCount++;
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'read_doc',
          output: fileContent,
          success: true,
          durationMs: 2,
        };
      },
    };

    const writeTool: Tool = {
      definition: {
        name: 'write_doc',
        version: '1.0.0',
        description: 'Write doc',
        category: ToolCategory.WRITE,
        riskLevel: ToolRiskLevel.MEDIUM,
        mutating: true, // Mutating tool
        idempotent: false,
        defaultTimeoutMs: 1000,
        requiredPermissions: ['fs:write'],
        inputSchema: {
          type: 'object',
          properties: { doc: { type: 'string' }, content: { type: 'string' } },
        },
      },
      async execute(input: ToolInput): Promise<ToolResult> {
        fileContent = String(input['content']);
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_doc',
          output: 'File updated',
          success: true,
          durationMs: 5,
        };
      },
    };

    const registry = new DefaultToolRegistry();
    registry.register(readTool);
    registry.register(writeTool);

    const executor = new DefaultToolExecutor({
      registry,
      idFactory,
      enableCache: true,
    });

    // Read 1
    const r1 = await executor.execute({ toolName: 'read_doc', input: { doc: 'a' } });
    expect(r1.output).toBe('version 1');
    expect(readCount).toBe(1);

    // Read 2 (cached)
    const r2 = await executor.execute({ toolName: 'read_doc', input: { doc: 'a' } });
    expect(r2.metadata?.['fromCache']).toBe(true);
    expect(readCount).toBe(1);

    // Write mutating action -> invalidates cache
    await executor.execute({ toolName: 'write_doc', input: { doc: 'a', content: 'version 2' } });

    // Read 3 -> cache invalidated, fetches updated content!
    const r3 = await executor.execute({ toolName: 'read_doc', input: { doc: 'a' } });
    expect(r3.output).toBe('version 2');
    expect(r3.metadata?.['fromCache']).toBeUndefined();
    expect(readCount).toBe(2);
  });

  it('3. Performance Profiler ensures reliability policy (zero regression in correctness)', () => {
    const profiler = new PerformanceProfiler();
    profiler.record(TelemetryCategory.MODEL_CALLS, 10, 'count');
    profiler.record(TelemetryCategory.TOKEN_USAGE, 15000, 'tokens');

    const before = {
      totalTokens: 100000,
      totalCostUSD: 1.5,
      totalLatencyMs: 8000,
      successRate: 0.95,
      regressionRate: 0.02,
    };

    const afterOptimized = {
      totalTokens: 30000,
      totalCostUSD: 0.45,
      totalLatencyMs: 3500,
      successRate: 0.96, // Success rate maintained / improved!
      regressionRate: 0.01,
    };

    const comparison = PerformanceProfiler.compare(before, afterOptimized);
    expect(comparison.costReductionPercent).toBeGreaterThan(60);
    expect(comparison.tokenReductionPercent).toBeGreaterThan(60);
    expect(comparison.satisfiesReliabilityPolicy).toBe(true);
  });
});
