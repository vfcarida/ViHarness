import { describe, it, expect } from 'vitest';
import { DefaultToolExecutor } from '../../../src/infra/tools/default-tool-executor.js';
import { DefaultToolRegistry } from '../../../src/infra/tools/default-tool-registry.js';
import { ParallelToolExecutor } from '../../../src/infra/tools/parallel-tool-executor.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { ToolCategory, ToolRiskLevel, ErrorCode } from '../../../src/core/index.js';
import type { Tool } from '../../../src/core/interfaces/tool.js';

describe('Tool System Hardening Suite', () => {
  const idFactory = new UuidV7IdFactory();

  const readTool: Tool = {
    definition: {
      name: 'read_file',
      version: '1.0.0',
      description: 'Reads file content',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: true,
      defaultTimeoutMs: 1000,
      requiredPermissions: ['fs:read'],
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    execute: async (input) => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'read_file',
      output: `Content of ${input['path']}`,
      success: true,
      durationMs: 10,
    }),
  };

  const writeTool: Tool = {
    definition: {
      name: 'write_file',
      version: '1.0.0',
      description: 'Writes file content',
      category: ToolCategory.WRITE,
      riskLevel: ToolRiskLevel.MEDIUM,
      mutating: true,
      idempotent: true,
      defaultTimeoutMs: 1000,
      requiredPermissions: ['fs:write'],
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    execute: async (input) => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'write_file',
      output: `Wrote ${input['path']}`,
      success: true,
      durationMs: 15,
    }),
  };

  const timeoutTool: Tool = {
    definition: {
      name: 'slow_tool',
      version: '1.0.0',
      description: 'Slow operation',
      category: ToolCategory.EXECUTE,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: false,
      defaultTimeoutMs: 50,
      requiredPermissions: [],
      inputSchema: { type: 'object' },
    },
    execute: async () => {
      await new Promise((r) => setTimeout(r, 200));
      return {
        toolCallId: idFactory.create<'ToolCall'>(),
        name: 'slow_tool',
        output: 'done',
        success: true,
        durationMs: 200,
      };
    },
  };

  const failingTool: Tool = {
    definition: {
      name: 'failing_tool',
      version: '1.0.0',
      description: 'Always fails',
      category: ToolCategory.EXECUTE,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: true,
      defaultTimeoutMs: 1000,
      requiredPermissions: [],
      inputSchema: { type: 'object' },
    },
    execute: async () => ({
      toolCallId: idFactory.create<'ToolCall'>(),
      name: 'failing_tool',
      output: '',
      success: false,
      durationMs: 5,
      error: 'Disk full error',
    }),
  };

  function createExecutor() {
    const registry = new DefaultToolRegistry();
    registry.register(readTool);
    registry.register(writeTool);
    registry.register(timeoutTool);
    registry.register(failingTool);
    const executor = new DefaultToolExecutor({ registry, idFactory });
    return { executor, registry };
  }

  it('1. Unknown Tool: Throws TOOL_NOT_FOUND error on unregistered tool', async () => {
    const { executor } = createExecutor();
    await expect(
      executor.execute({ toolName: 'non_existent_tool', input: {} }),
    ).rejects.toMatchObject({
      code: ErrorCode.TOOL_NOT_FOUND,
    });
  });

  it('2. Invalid Input: Throws TOOL_INVALID_INPUT when schema parameters fail validation', async () => {
    const { executor } = createExecutor();
    await expect(
      executor.execute({ toolName: 'read_file', input: {} }), // Missing required 'path'
    ).rejects.toMatchObject({
      code: ErrorCode.TOOL_INVALID_INPUT,
    });
  });

  it('3. Multiple Tools: Successfully executes batch tool requests', async () => {
    const { executor, registry } = createExecutor();
    const parallelExecutor = new ParallelToolExecutor(executor, registry);

    const results = await parallelExecutor.executeBatch([
      { toolName: 'read_file', input: { path: 'a.txt' } },
      { toolName: 'read_file', input: { path: 'b.txt' } },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.output).toBe('Content of a.txt');
    expect(results[1]?.output).toBe('Content of b.txt');
  });

  it('4. Tool Timeout: Enforces execution timeout and throws TOOL_TIMEOUT', async () => {
    const { executor } = createExecutor();
    await expect(
      executor.execute({
        toolName: 'slow_tool',
        input: {},
        context: { timeoutMs: 30 },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.TOOL_TIMEOUT,
    });
  });

  it('5. Tool Cancellation: Aborts execution when AbortSignal triggers', async () => {
    const { executor } = createExecutor();
    const controller = new AbortController();
    controller.abort();

    const result = await executor.execute({
      toolName: 'read_file',
      input: { path: 'test.txt' },
      context: { signal: controller.signal },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled via AbortSignal');
  });

  it('6. Tool Failure: Captures tool execution error cleanly', async () => {
    const { executor } = createExecutor();
    const result = await executor.execute({
      toolName: 'failing_tool',
      input: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Disk full error');
  });

  it('7. Read-Only Parallel Execution: Runs non-mutating tools concurrently', async () => {
    const { executor, registry } = createExecutor();
    const parallelExecutor = new ParallelToolExecutor(executor, registry);

    const start = Date.now();
    const results = await parallelExecutor.executeBatch([
      { toolName: 'read_file', input: { path: '1.txt' } },
      { toolName: 'read_file', input: { path: '2.txt' } },
      { toolName: 'read_file', input: { path: '3.txt' } },
    ]);

    const duration = Date.now() - start;
    expect(results).toHaveLength(3);
    expect(duration).toBeLessThan(100);
  });

  it('8. Mutating Serial Execution: Guarantees sequential ordering for mutating tools', async () => {
    const executionOrder: string[] = [];

    const orderTool1: Tool = {
      definition: { ...writeTool.definition, name: 'write_1' },
      execute: async () => {
        executionOrder.push('start_1');
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push('end_1');
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_1',
          output: 'ok',
          success: true,
          durationMs: 40,
        };
      },
    };

    const orderTool2: Tool = {
      definition: { ...writeTool.definition, name: 'write_2' },
      execute: async () => {
        executionOrder.push('start_2');
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('end_2');
        return {
          toolCallId: idFactory.create<'ToolCall'>(),
          name: 'write_2',
          output: 'ok',
          success: true,
          durationMs: 10,
        };
      },
    };

    const registry = new DefaultToolRegistry();
    registry.register(orderTool1);
    registry.register(orderTool2);
    const executor = new DefaultToolExecutor({ registry, idFactory });
    const parallelExecutor = new ParallelToolExecutor(executor, registry);

    await parallelExecutor.executeBatch([
      { toolName: 'write_1', input: { path: '1.txt', content: 'c1' } },
      { toolName: 'write_2', input: { path: '2.txt', content: 'c2' } },
    ]);

    expect(executionOrder).toEqual(['start_1', 'end_1', 'start_2', 'end_2']);
  });
});
