// Pattern: Parallel Tool Execution with Barrier Groups (ref: DeepSeek Harness)
/**
 * Parallel Tool Executor with Concurrency Classification & Barriers.
 *
 * Classifies tool calls into concurrency-safe parallel batches and exclusive barriers,
 * executing consecutive safe tools concurrently up to `maxParallelToolCalls` while
 * enforcing strict sequential ordering for state-mutating tools.
 */
import type {
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolExecutionContext,
} from '../model/tool-types.js';
import type { ToolRegistry } from '../interfaces/tool-registry.js';
import type { ToolCallId } from '../types/identifiers.js';
import {
  type SpillStore,
  type SpillPolicy,
  DEFAULT_SPILL_POLICY,
  defaultSpillStore,
  createSpillPreview,
} from './spill/index.js';
import { DefaultToolRunContext } from './deferred-context.js';

export interface ParallelConfig {
  readonly maxParallelToolCalls: number; // default: 4
  readonly enabled: boolean; // default: true
}

export const DEFAULT_PARALLEL_CONFIG: ParallelConfig = {
  maxParallelToolCalls: 4,
  enabled: true,
};

export type ToolExecutionMode = 'parallel' | 'exclusive';

export interface ToolExecutionGroup {
  readonly mode: ToolExecutionMode;
  readonly calls: ReadonlyArray<{ call: ToolCall; originalIndex: number }>;
}

export interface ParallelExecutionOptions {
  readonly config?: ParallelConfig;
  readonly spillPolicy?: SpillPolicy;
  readonly spillStore?: SpillStore;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
}

export class ParallelToolExecutor {
  private readonly config: ParallelConfig;
  private readonly spillPolicy: SpillPolicy;
  private readonly spillStore: SpillStore;
  private readonly registry: ToolRegistry;
  private readonly defaultExecutor?: any;

  constructor(registryOrDefaultExecutor: any, optionsOrRegistry?: any) {
    if (optionsOrRegistry && typeof optionsOrRegistry.getTool === 'function') {
      // Called as: new ParallelToolExecutor(defaultExecutor, registry)
      this.defaultExecutor = registryOrDefaultExecutor;
      this.registry = optionsOrRegistry;
      this.config = DEFAULT_PARALLEL_CONFIG;
      this.spillPolicy = DEFAULT_SPILL_POLICY;
      this.spillStore = defaultSpillStore;
    } else {
      // Called as: new ParallelToolExecutor(registry, options)
      this.registry = registryOrDefaultExecutor;
      this.config = optionsOrRegistry?.config || DEFAULT_PARALLEL_CONFIG;
      this.spillPolicy = optionsOrRegistry?.spillPolicy || DEFAULT_SPILL_POLICY;
      this.spillStore = optionsOrRegistry?.spillStore || defaultSpillStore;
    }
  }

  /**
   * Classify tool calls into execution groups (parallel batches and exclusive barriers).
   */
  classifyAndGroup(calls: ReadonlyArray<ToolCall>): ToolExecutionGroup[] {
    const groups: ToolExecutionGroup[] = [];
    let currentParallel: Array<{ call: ToolCall; originalIndex: number }> = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]!;
      const mode = this.classifyCall(call);

      if (!this.config.enabled || mode === 'exclusive') {
        // Close pending parallel group if any
        if (currentParallel.length > 0) {
          groups.push({ mode: 'parallel', calls: currentParallel });
          currentParallel = [];
        }
        // Add exclusive barrier group
        groups.push({ mode: 'exclusive', calls: [{ call, originalIndex: i }] });
      } else {
        // Parallel mode
        currentParallel.push({ call, originalIndex: i });
        if (currentParallel.length >= this.config.maxParallelToolCalls) {
          groups.push({ mode: 'parallel', calls: currentParallel });
          currentParallel = [];
        }
      }
    }

    if (currentParallel.length > 0) {
      groups.push({ mode: 'parallel', calls: currentParallel });
    }

    return groups;
  }

  /**
   * Execute a batch of tool calls with parallel grouping, timeout policies, and output spilling.
   */
  async execute(
    calls: ReadonlyArray<ToolCall>,
    options: ParallelExecutionOptions = {},
  ): Promise<ToolResult[]> {
    if (calls.length === 0) return [];

    const sessionId = options.sessionId || 'default-session';
    const spillPolicy = options.spillPolicy || this.spillPolicy;
    const spillStore = options.spillStore || this.spillStore;
    const results: ToolResult[] = new Array(calls.length);

    const groups = this.classifyAndGroup(calls);

    for (const group of groups) {
      if (group.mode === 'parallel') {
        // Execute all calls in parallel concurrently
        await Promise.all(
          group.calls.map(async ({ call, originalIndex }) => {
            const res = await this.executeSingleCall(
              call,
              sessionId,
              spillPolicy,
              spillStore,
              options.signal,
            );
            results[originalIndex] = res;
          }),
        );
      } else {
        // Exclusive barrier: run sequentially
        const item = group.calls[0]!;
        const res = await this.executeSingleCall(
          item.call,
          sessionId,
          spillPolicy,
          spillStore,
          options.signal,
        );
        results[item.originalIndex] = res;
      }
    }

    return results;
  }

  /**
   * Universal batch execution adapter for infra-level batch calls.
   */
  async executeBatch(
    calls: ReadonlyArray<{ toolName: string; input: Record<string, unknown> }>,
    context?: Partial<ToolExecutionContext>,
  ): Promise<ReadonlyArray<ToolResult>> {
    if (this.defaultExecutor && typeof this.defaultExecutor.execute === 'function') {
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
        const def = (tool as any)?.definition || tool;
        if (def && !def.mutating) {
          safeCalls.push({ call, index: i });
        } else {
          mutatingCalls.push({ call, index: i });
        }
      }

      const results: ToolResult[] = new Array(calls.length);

      const safePromises = safeCalls.map(async (item) => {
        const res = await this.defaultExecutor.execute({
          toolName: item.call.toolName,
          input: item.call.input,
          context,
        });
        results[item.index] = res;
      });
      await Promise.all(safePromises);

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

    const toolCalls: ToolCall[] = calls.map((c, idx) => ({
      id: `call-${idx}` as ToolCallId,
      name: c.toolName,
      input: c.input,
    }));

    return this.execute(toolCalls, { signal: context?.signal });
  }

  private classifyCall(call: ToolCall): ToolExecutionMode {
    const rawTool = this.registry.getTool(call.name);
    if (!rawTool) return 'exclusive';

    const toolDef: ToolDefinition | undefined = (rawTool as any).definition || rawTool;
    if (!toolDef) return 'exclusive';

    const args = (call as any).arguments !== undefined ? (call as any).arguments : call.input;

    try {
      if (typeof toolDef.isConcurrencySafe === 'function') {
        return toolDef.isConcurrencySafe(args) === true ? 'parallel' : 'exclusive';
      }
      if (toolDef.mutating === false) {
        return 'parallel';
      }
    } catch {
      return 'exclusive';
    }

    return 'exclusive';
  }

  private async executeSingleCall(
    call: ToolCall,
    sessionId: string,
    spillPolicy: SpillPolicy,
    spillStore: SpillStore,
    parentSignal?: AbortSignal,
  ): Promise<ToolResult> {
    const start = Date.now();
    const rawTool = this.registry.getTool(call.name);
    if (!rawTool) {
      return {
        toolCallId: call.id,
        name: call.name,
        success: false,
        output: `Error: Tool [${call.name}] is not registered.`,
        durationMs: Date.now() - start,
      };
    }

    const toolDef: ToolDefinition | undefined = (rawTool as any).definition || rawTool;
    const args = (call as any).arguments !== undefined ? (call as any).arguments : call.input;

    const runContext = new DefaultToolRunContext({
      sessionId,
      callId: call.id,
      toolName: call.name,
    });

    const executionContext = {
      correlationId: call.id,
      signal: parentSignal,
      workingDirectory: process.cwd(),
      runContext,
    };

    try {
      const timeoutMs =
        toolDef?.timeoutMs !== undefined
          ? toolDef.timeoutMs
          : toolDef?.defaultTimeoutMs !== undefined
            ? toolDef.defaultTimeoutMs
            : 0;

      let executePromise: Promise<ToolResult>;
      if (timeoutMs > 0) {
        executePromise = new Promise<ToolResult>((resolve) => {
          const abortTimer = (): void => {
            if (timer) clearTimeout(timer);
          };

          const timer = setTimeout(() => {
            resolve({
              toolCallId: call.id,
              name: call.name,
              success: false,
              output: `Tool timed out after ${timeoutMs}ms`,
              durationMs: Date.now() - start,
            });
          }, timeoutMs);

          Promise.resolve(
            typeof (rawTool as any).execute === 'function'
              ? (rawTool as any).execute(args, executionContext)
              : typeof toolDef?.execute === 'function'
                ? toolDef.execute(args, executionContext)
                : Promise.reject(new Error('Tool has no execute function')),
          )
            .then((res: any) => {
              abortTimer();
              resolve(this.normalizeResult(res, call, start));
            })
            .catch((err: any) => {
              abortTimer();
              resolve({
                toolCallId: call.id,
                name: call.name,
                success: false,
                output: `Tool execution failed: ${err.message}`,
                durationMs: Date.now() - start,
              });
            });
        });
      } else {
        const rawRes = await Promise.resolve(
          typeof (rawTool as any).execute === 'function'
            ? (rawTool as any).execute(args, executionContext)
            : typeof toolDef?.execute === 'function'
              ? toolDef.execute(args, executionContext)
              : Promise.reject(new Error('Tool has no execute function')),
        );
        executePromise = Promise.resolve(this.normalizeResult(rawRes, call, start));
      }

      const result = await executePromise;

      // Check if output needs disk spilling
      if (
        result.output &&
        typeof result.output === 'string' &&
        result.output.length > spillPolicy.maxInlineChars
      ) {
        const locator = spillStore.save(sessionId, call.id, result.output);
        const preview = createSpillPreview(result.output, locator, spillPolicy);
        return {
          ...result,
          output: preview,
        };
      }

      return result;
    } catch (err: any) {
      return {
        toolCallId: call.id,
        name: call.name,
        success: false,
        output: `Tool execution failed: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private normalizeResult(raw: any, call: ToolCall, start: number): ToolResult {
    if (raw && typeof raw === 'object' && 'success' in raw) {
      return {
        toolCallId: call.id,
        name: call.name,
        output: typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output ?? raw),
        success: Boolean(raw.success),
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : Date.now() - start,
        error: raw.error,
        metadata: raw.metadata,
      };
    }

    return {
      toolCallId: call.id,
      name: call.name,
      output: typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}),
      success: true,
      durationMs: Date.now() - start,
    };
  }
}
