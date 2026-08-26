// Pattern: Event-sourced session history derivation (ref: DeepSeek Harness)
/**
 * Derived History Projection (from DeepSeek Harness & Pi).
 *
 * "The session IS the event log."
 * Projects model-visible messages from the append-only event log on demand.
 * Model history is never stored separately from the log.
 */
import type { SessionEvent } from './session-event.js';
import type { CompactionSummaryData } from './event-map.js';
import { type ModelMessage, MessageRole, type ToolCall } from '../model/model-io.js';

export interface DeriveMessagesOptions {
  /** If true, includes shadowed events instead of compaction replacements. */
  readonly includeCompacted?: boolean;
}

/**
 * Projects model-visible messages from the session event log.
 */
export function deriveMessages(
  log: ReadonlyArray<SessionEvent>,
  options?: DeriveMessagesOptions,
): ModelMessage[] {
  const includeCompacted = options?.includeCompacted ?? false;

  // 1. Identify shadowed sequence ranges from compaction summaries
  const shadowedSeqs = new Set<number>();
  const compactions: CompactionSummaryData[] = [];

  if (!includeCompacted) {
    for (const event of log) {
      if (event.type === 'compaction/summary') {
        const summary = event.data as CompactionSummaryData;
        compactions.push(summary);
        for (let s = summary.fromSeq; s <= summary.toSeq; s++) {
          shadowedSeqs.add(s);
        }
      }
    }
  }

  const messages: ModelMessage[] = [];

  interface ProjectableItem {
    readonly event: SessionEvent;
    readonly effectiveSeq: number;
  }

  const items: ProjectableItem[] = [];

  if (!includeCompacted) {
    for (const event of log) {
      if (event.type === 'compaction/summary') {
        const summary = event.data as CompactionSummaryData;
        items.push({ event, effectiveSeq: summary.fromSeq });
      } else if (!shadowedSeqs.has(event.seq)) {
        items.push({ event, effectiveSeq: event.seq });
      }
    }
    items.sort((a, b) => a.effectiveSeq - b.effectiveSeq);
  } else {
    for (const event of log) {
      items.push({ event, effectiveSeq: event.seq });
    }
  }

  for (const item of items) {
    const event = item.event;

    switch (event.type) {
      case 'user/message': {
        const data = event.data as {
          content: string;
          files?: ReadonlyArray<string>;
          metadata?: Readonly<Record<string, unknown>>;
        };
        messages.push({
          role: MessageRole.USER,
          content: data.content,
          metadata: data.metadata,
        });
        break;
      }

      case 'compaction/summary': {
        const data = event.data as CompactionSummaryData;
        messages.push({
          role: MessageRole.SYSTEM,
          content: `[Conversation history before turn summarized]: ${data.summary}`,
          metadata: {
            isCompactedSummary: true,
            fromSeq: data.fromSeq,
            toSeq: data.toSeq,
          },
        });
        break;
      }

      case 'assistant/message': {
        const data = event.data as {
          turn: number;
          step: number;
          message: {
            content: string;
            toolCalls?: ReadonlyArray<ToolCall>;
            metadata?: Readonly<Record<string, unknown>>;
          };
          usage?: unknown;
        };

        messages.push({
          role: MessageRole.ASSISTANT,
          content: data.message.content,
          toolCalls:
            data.message.toolCalls && data.message.toolCalls.length > 0
              ? data.message.toolCalls
              : undefined,
          metadata: data.message.metadata,
        });
        break;
      }

      case 'tool/call': {
        const data = event.data as {
          turn: number;
          step: number;
          callId: string;
          name: string;
          arguments: string;
        };

        let parsedInput: Record<string, unknown> = {};
        try {
          if (data.arguments && typeof data.arguments === 'string') {
            parsedInput = JSON.parse(data.arguments);
          } else if (typeof data.arguments === 'object' && data.arguments !== null) {
            parsedInput = data.arguments as Record<string, unknown>;
          }
        } catch {
          parsedInput = { raw: data.arguments };
        }

        const toolCall: ToolCall = {
          id: data.callId,
          name: data.name,
          input: parsedInput,
        };

        // If the last message is an ASSISTANT message, attach this tool call
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === MessageRole.ASSISTANT) {
          const existingCalls = lastMsg.toolCalls ?? [];
          // Avoid duplicate tool call ID
          if (!existingCalls.some((c) => c.id === toolCall.id)) {
            messages[messages.length - 1] = {
              ...lastMsg,
              toolCalls: [...existingCalls, toolCall],
            };
          }
        } else {
          // Create a new assistant message with the tool call
          messages.push({
            role: MessageRole.ASSISTANT,
            content: '',
            toolCalls: [toolCall],
          });
        }
        break;
      }

      case 'tool/result': {
        const data = event.data as {
          turn: number;
          step: number;
          message: {
            toolCallId: string;
            name: string;
            output: string;
            isError?: boolean;
          };
          error?: { name: string; code: string };
          meta?: unknown;
        };

        const isError = Boolean(data.message.isError || data.error);
        messages.push({
          role: MessageRole.TOOL,
          content: data.message.output,
          toolCallId: data.message.toolCallId,
          name: data.message.name,
          toolResult: {
            toolCallId: data.message.toolCallId,
            name: data.message.name,
            output: data.message.output,
            isError,
          },
          metadata: data.meta ? { meta: data.meta } : undefined,
        });
        break;
      }

      // Operational and lifecycle events are not model-visible messages
      case 'turn/start':
      case 'turn/end':
      case 'step/start':
      case 'step/end':
      case 'assistant/chunk':
      case 'request/header':
      case 'compaction/start':
      case 'compaction/end':
      case 'goal/change':
      default:
        break;
    }
  }

  return messages;
}
