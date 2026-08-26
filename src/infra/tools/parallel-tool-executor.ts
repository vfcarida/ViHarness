// Pattern: Concurrency safety classification & parallel tool execution (ref: DeepSeek Harness)
/**
 * Parallel Safe Tool Executor.
 *
 * Executes non-mutating read tools (read_file, list_directory, search) in parallel
 * via Promise.all while guaranteeing strict sequential ordering for mutating actions.
 */
import type { ToolResult, ToolExecutionContext } from '../../core/model/tool-types.js';
import type { ToolRegistry } from '../../core/interfaces/tool-registry.js';
import type { DefaultToolExecutor } from './default-tool-executor.js';

export class ParallelToolExecutor {
  private readonly defaultExecutor: DefaultToolExecutor;
  private readonly registry: ToolRegistry;

  constructor(defaultExecutor: DefaultToolExecutor, registry: ToolRegistry) {
    this.defaultExecutor = defaultExecutor;
    this.registry = registry;
  }

  /**
   * Execute batch of tool calls with safe concurrency optimization.
   */
  async executeBatch(
    calls: ReadonlyArray<{ toolName: string; input: Record<string, unknown> }>,
    context?: Partial<ToolExecutionContext>,
  ): Promise<ReadonlyArray<ToolResult>> {
    // Separate non-mutating (safe) from mutating tool calls
    const safeCalls: {
      call: { toolName: string; input: Record<string, unknown> };
      index: number;
    }[] = [];
    const mutatingCalls: {
      call: { toolName: string; input: Record<string, unknown> };
      index: number;
    }[] = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const tool = this.registry.getTool(call.toolName);
      if (tool && tool.definition && !tool.definition.mutating) {
        safeCalls.push({ call, index: i });
      } else {
        mutatingCalls.push({ call, index: i });
      }
    }

    const results: ToolResult[] = new Array(calls.length);

    // 1. Execute safe calls in parallel via Promise.all
    const safePromises = safeCalls.map(async (item) => {
      const res = await this.defaultExecutor.execute({
        toolName: item.call.toolName,
        input: item.call.input,
        context,
      });
      results[item.index] = res;
    });
    await Promise.all(safePromises);

    // 2. Execute mutating calls sequentially
    for (const item of mutatingCalls) {
      const res = await this.defaultExecutor.execute({
        toolName: item.call.toolName,
        input: item.call.input,
        context,
      });
      results[item.index] = res;
    }

    return results;
  }
}
