import { describe, it, expect } from 'vitest';
import {
  ParallelToolExecutor,
  type ParallelConfig,
} from '../../../src/core/tools/parallel-executor.js';
import type { ToolDefinition, ToolCall, ToolRegistry } from '../../../src/core/index.js';

describe('Parallel Tool Executor — P018', () => {
  const createMockRegistry = (tools: ToolDefinition[]): ToolRegistry => {
    const map = new Map<string, ToolDefinition>();
    for (const t of tools) map.set(t.name, t);
    return {
      registerTool: (t) => map.set(t.name, t),
      getTool: (name) => map.get(name),
      listTools: () => Array.from(map.values()),
      hasTool: (name) => map.has(name),
    };
  };

  it('1. Concurrency: Safe tools run concurrently and exhibit parallel execution speedup', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const readTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
        await new Promise((resolve) => setTimeout(resolve, 50));
        currentConcurrent--;
        return { success: true, output: 'file-content' };
      },
    };

    const registry = createMockRegistry([readTool]);
    const executor = new ParallelToolExecutor(registry);

    const calls: ToolCall[] = [
      { id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } },
      { id: 'c2', name: 'read_file', arguments: { path: 'b.txt' } },
      { id: 'c3', name: 'read_file', arguments: { path: 'c.txt' } },
    ];

    const start = Date.now();
    const results = await executor.execute(calls);
    const elapsed = Date.now() - start;

    expect(results.length).toBe(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(140);
  });

  it('2. Exclusive barrier: State-mutating tools form barriers and execute sequentially', async () => {
    const executionLog: string[] = [];

    const readTool: ToolDefinition = {
      name: 'read_file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async (args: any) => {
        executionLog.push(`start-read-${args.path}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionLog.push(`end-read-${args.path}`);
        return { success: true, output: 'data' };
      },
    };

    const writeTool: ToolDefinition = {
      name: 'write_file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => false, // Exclusive barrier
      execute: async (args: any) => {
        executionLog.push(`start-write-${args.path}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionLog.push(`end-write-${args.path}`);
        return { success: true, output: 'written' };
      },
    };

    const registry = createMockRegistry([readTool, writeTool]);
    const executor = new ParallelToolExecutor(registry);

    const calls: ToolCall[] = [
      { id: 'c1', name: 'read_file', arguments: { path: '1' } },
      { id: 'c2', name: 'write_file', arguments: { path: '2' } },
      { id: 'c3', name: 'read_file', arguments: { path: '3' } },
    ];

    const results = await executor.execute(calls);
    expect(results.length).toBe(3);

    const endRead1 = executionLog.indexOf('end-read-1');
    const startWrite2 = executionLog.indexOf('start-write-2');
    const endWrite2 = executionLog.indexOf('end-write-2');
    const startRead3 = executionLog.indexOf('start-read-3');

    expect(endRead1).toBeLessThan(startWrite2);
    expect(endWrite2).toBeLessThan(startRead3);
  });

  it('3. Mixed batch grouping: Correctly chunks parallel -> exclusive -> parallel groups', () => {
    const readTool: ToolDefinition = {
      name: 'read_file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => ({ success: true, output: '' }),
    };

    const writeTool: ToolDefinition = {
      name: 'write_file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => false,
      execute: async () => ({ success: true, output: '' }),
    };

    const registry = createMockRegistry([readTool, writeTool]);
    const executor = new ParallelToolExecutor(registry);

    const calls: ToolCall[] = [
      { id: '1', name: 'read_file', arguments: {} },
      { id: '2', name: 'read_file', arguments: {} },
      { id: '3', name: 'write_file', arguments: {} },
      { id: '4', name: 'read_file', arguments: {} },
    ];

    const groups = executor.classifyAndGroup(calls);
    expect(groups.length).toBe(3);
    expect(groups[0]?.mode).toBe('parallel');
    expect(groups[0]?.calls.length).toBe(2);
    expect(groups[1]?.mode).toBe('exclusive');
    expect(groups[1]?.calls.length).toBe(1);
    expect(groups[2]?.mode).toBe('parallel');
    expect(groups[2]?.calls.length).toBe(1);
  });

  it('4. Concurrency limits: Respects maxParallelToolCalls bound per parallel group', () => {
    const readTool: ToolDefinition = {
      name: 'read_file',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => ({ success: true, output: '' }),
    };

    const registry = createMockRegistry([readTool]);
    const executor = new ParallelToolExecutor(registry, {
      config: { maxParallelToolCalls: 2, enabled: true },
    });

    const calls: ToolCall[] = [
      { id: '1', name: 'read_file', arguments: {} },
      { id: '2', name: 'read_file', arguments: {} },
      { id: '3', name: 'read_file', arguments: {} },
      { id: '4', name: 'read_file', arguments: {} },
      { id: '5', name: 'read_file', arguments: {} },
    ];

    const groups = executor.classifyAndGroup(calls);
    expect(groups.length).toBe(3);
    expect(groups[0]?.calls.length).toBe(2);
    expect(groups[1]?.calls.length).toBe(2);
    expect(groups[2]?.calls.length).toBe(1);
  });

  it('5. Error isolation: A failing tool in a parallel group does not cancel or reject siblings', async () => {
    const okTool: ToolDefinition = {
      name: 'ok_tool',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => ({ success: true, output: 'success-data' }),
    };

    const failTool: ToolDefinition = {
      name: 'fail_tool',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      execute: async () => {
        throw new Error('Disk read fault');
      },
    };

    const registry = createMockRegistry([okTool, failTool]);
    const executor = new ParallelToolExecutor(registry);

    const calls: ToolCall[] = [
      { id: 'c1', name: 'ok_tool', arguments: {} },
      { id: 'c2', name: 'fail_tool', arguments: {} },
      { id: 'c3', name: 'ok_tool', arguments: {} },
    ];

    const results = await executor.execute(calls);
    expect(results.length).toBe(3);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.output).toBe('success-data');

    expect(results[1]?.success).toBe(false);
    expect(results[1]?.output).toContain('Disk read fault');

    expect(results[2]?.success).toBe(true);
    expect(results[2]?.output).toBe('success-data');
  });

  it('6. Unregistered tool call returns failure without crashing executor', async () => {
    const registry = createMockRegistry([]);
    const executor = new ParallelToolExecutor(registry);

    const results = await executor.execute([
      { id: 'missing-call', name: 'non_existent_tool', arguments: {} },
    ]);

    expect(results.length).toBe(1);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.output).toContain('Tool [non_existent_tool] is not registered');
  });

  it('7. Per-tool timeout handling returns timeout error', async () => {
    const slowTool: ToolDefinition = {
      name: 'slow_tool',
      parameters: { type: 'object' },
      isConcurrencySafe: () => true,
      timeoutMs: 30,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { success: true, output: 'slow-result' };
      },
    };

    const registry = createMockRegistry([slowTool]);
    const executor = new ParallelToolExecutor(registry);

    const results = await executor.execute([{ id: 'slow-call', name: 'slow_tool', arguments: {} }]);

    expect(results.length).toBe(1);
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.output).toContain('timed out after 30ms');
  });

  it('8. Preserves original index order even if second tool finishes faster', async () => {
    const fastTool: ToolDefinition = {
      name: 'fast',
      parameters: {},
      isConcurrencySafe: () => true,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { success: true, output: 'fast-result' };
      },
    };

    const slowTool: ToolDefinition = {
      name: 'slow',
      parameters: {},
      isConcurrencySafe: () => true,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true, output: 'slow-result' };
      },
    };

    const registry = createMockRegistry([fastTool, slowTool]);
    const executor = new ParallelToolExecutor(registry);

    const results = await executor.execute([
      { id: '1', name: 'slow', arguments: {} },
      { id: '2', name: 'fast', arguments: {} },
    ]);

    expect(results[0]?.output).toBe('slow-result');
    expect(results[1]?.output).toBe('fast-result');
  });

  it('9. Empty tool calls array returns empty result array immediately', async () => {
    const registry = createMockRegistry([]);
    const executor = new ParallelToolExecutor(registry);

    const results = await executor.execute([]);
    expect(results).toEqual([]);
  });

  it('10. Exception in isConcurrencySafe defaults safely to exclusive mode', () => {
    const buggyClassifierTool: ToolDefinition = {
      name: 'buggy_tool',
      parameters: {},
      isConcurrencySafe: () => {
        throw new Error('Classifier crash');
      },
      execute: async () => ({ success: true, output: '' }),
    };

    const registry = createMockRegistry([buggyClassifierTool]);
    const executor = new ParallelToolExecutor(registry);

    const groups = executor.classifyAndGroup([{ id: '1', name: 'buggy_tool', arguments: {} }]);

    expect(groups.length).toBe(1);
    expect(groups[0]?.mode).toBe('exclusive');
  });
});
