// Pattern: Waterfall Events & Middleware Interception (ref: DeepSeek Harness, Cordis)
/**
 * Waterfall Event Interception Engine.
 *
 * Allows plugins to intercept, modify, transform, or short-circuit pipeline execution:
 * 1. 'agent/pre-step': Inspect/rewrite message history before turn iteration starts
 * 2. 'agent/request': Modify LLM request parameters/messages before transmission
 * 3. 'tools/pre-execute': Inspect/authorize/sanitize tool call before execution
 * 4. 'tools/post-execute': Transform/redact/truncate tool output before inclusion in context
 */
import type { PreStepDecision } from '../model/pre-step.js';
import type { ModelRequest } from '../model/model-io.js';
import type { ToolResult } from '../model/tool-types.js';

export interface ToolExecutionRecord {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
}

export interface ToolPreExecuteDecision {
  readonly allow: boolean;
  readonly reason?: string;
  readonly modifiedInput?: Record<string, unknown>;
}

export interface WaterfallMap {
  'agent/pre-step': {
    args: [messages: any[], turn: number, step: number];
    return: PreStepDecision;
  };
  'agent/request': {
    args: [request: ModelRequest];
    return: ModelRequest;
  };
  'tools/pre-execute': {
    args: [execution: ToolExecutionRecord];
    return: ToolPreExecuteDecision;
  };
  'tools/post-execute': {
    args: [execution: ToolExecutionRecord, result: ToolResult];
    return: ToolResult;
  };
}

export type WaterfallArgs<K extends keyof WaterfallMap> = WaterfallMap[K]['args'];
export type WaterfallReturn<K extends keyof WaterfallMap> = WaterfallMap[K]['return'];

export type WaterfallNext<K extends keyof WaterfallMap> = (
  ...overrideArgs: any[]
) => Promise<WaterfallReturn<K>> | WaterfallReturn<K>;

export type WaterfallHandler<K extends keyof WaterfallMap> = (
  ...args: any[]
) => Promise<WaterfallReturn<K>> | WaterfallReturn<K>;

export class WaterfallEngine {
  private readonly handlers = new Map<keyof WaterfallMap, Array<WaterfallHandler<any>>>();

  /**
   * Register a waterfall interceptor for a specific lifecycle point.
   * Returns a disposer function that removes this interceptor.
   */
  register<K extends keyof WaterfallMap>(event: K, handler: WaterfallHandler<K>): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);

    return () => {
      const current = this.handlers.get(event);
      if (current) {
        const idx = current.indexOf(handler);
        if (idx !== -1) current.splice(idx, 1);
      }
    };
  }

  /**
   * Execute the waterfall chain through all registered handlers in registration order.
   */
  async execute<K extends keyof WaterfallMap>(
    event: K,
    ...initialArgs: WaterfallArgs<K>
  ): Promise<WaterfallReturn<K>> {
    const list = (this.handlers.get(event) ?? []) as Array<WaterfallHandler<K>>;
    let index = 0;

    const dispatch = async (currentArgs: any[]): Promise<WaterfallReturn<K>> => {
      if (index >= list.length) {
        return this.defaultReturn(event, currentArgs as WaterfallArgs<K>);
      }

      const handler = list[index++]!;
      const next: WaterfallNext<K> = async (...overrideArgs: any[]) => {
        const mergedArgs = currentArgs.map((arg, i) =>
          overrideArgs[i] !== undefined ? overrideArgs[i] : arg,
        );
        return dispatch(mergedArgs);
      };

      return Promise.resolve(handler(...currentArgs, next));
    };

    return dispatch(initialArgs);
  }

  /**
   * Compute default terminal return when no middleware short-circuits.
   */
  private defaultReturn<K extends keyof WaterfallMap>(
    event: K,
    args: WaterfallArgs<K>,
  ): WaterfallReturn<K> {
    switch (event) {
      case 'agent/pre-step': {
        return {
          decision: 'ALLOW',
          reason: 'Default waterfall pass-through: no listeners rejected',
        } as unknown as WaterfallReturn<K>;
      }
      case 'agent/request': {
        return args[0] as unknown as WaterfallReturn<K>;
      }
      case 'tools/pre-execute': {
        return {
          allow: true,
          reason: 'Default waterfall pass-through: execution permitted',
        } as unknown as WaterfallReturn<K>;
      }
      case 'tools/post-execute': {
        return args[1] as unknown as WaterfallReturn<K>;
      }
      default: {
        return undefined as unknown as WaterfallReturn<K>;
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
