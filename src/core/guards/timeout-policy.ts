// Pattern: Tool-Call Timeout Enforcement Policy (ref: DeepSeek Harness)
/**
 * Cooperative Tool-Call Timeout Policy.
 *
 * Enforces per-tool execution deadlines via cooperative AbortSignals and timer racing.
 */
import type { ToolDefinition, ToolResult } from '../model/tool-types.js';
import type { ToolCallId } from '../types/identifiers.js';

export interface TimeoutPolicy {
  enforce(
    tool: ToolDefinition,
    execute: (signal: AbortSignal) => Promise<ToolResult>,
    parentSignal?: AbortSignal,
  ): Promise<ToolResult>;
}

export class DefaultTimeoutPolicy implements TimeoutPolicy {
  constructor(private readonly defaultTimeoutMs: number = 30000) {}

  async enforce(
    tool: ToolDefinition,
    execute: (signal: AbortSignal) => Promise<ToolResult>,
    parentSignal?: AbortSignal,
  ): Promise<ToolResult> {
    const timeoutMs =
      tool.timeoutMs !== undefined
        ? tool.timeoutMs
        : tool.defaultTimeoutMs !== undefined
          ? tool.defaultTimeoutMs
          : this.defaultTimeoutMs;

    const start = Date.now();

    if (timeoutMs <= 0) {
      const controller = new AbortController();
      if (parentSignal) {
        parentSignal.addEventListener('abort', () => controller.abort());
      }
      return execute(controller.signal);
    }

    const controller = new AbortController();

    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return new Promise<ToolResult>((resolve) => {
      let completed = false;

      const cleanup = (): void => {
        completed = true;
        clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        if (!completed) {
          cleanup();
          controller.abort();
          resolve({
            toolCallId: 'timeout' as ToolCallId,
            name: tool.name,
            success: false,
            output: `Tool timed out after ${timeoutMs}ms`,
            durationMs: Date.now() - start,
          });
        }
      }, timeoutMs);

      execute(controller.signal)
        .then((res) => {
          if (!completed) {
            cleanup();
            resolve(res);
          }
        })
        .catch((err: any) => {
          if (!completed) {
            cleanup();
            resolve({
              toolCallId: 'error' as ToolCallId,
              name: tool.name,
              success: false,
              output: `Tool execution failed: ${err.message}`,
              durationMs: Date.now() - start,
            });
          }
        });
    });
  }
}

export const defaultTimeoutPolicy = new DefaultTimeoutPolicy();
