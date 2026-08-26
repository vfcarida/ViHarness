/**
 * Provider Message Adapter.
 *
 * Translates between Vi-Harness vendor-neutral ModelMessage protocol
 * and specific provider formats (OpenAI Chat Completions, Anthropic Messages API).
 */
import type { ModelMessage, ModelRequest, ToolCall } from '../../core/model/model-io.js';
import { MessageRole } from '../../core/model/model-io.js';

export interface AnthropicToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content:
    string | ReadonlyArray<AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock>;
}

export interface AnthropicPayload {
  readonly system?: string;
  readonly messages: ReadonlyArray<AnthropicMessage>;
}

export class ProviderMessageAdapter {
  /**
   * Convert vendor-neutral ModelRequest messages to OpenAI Chat Completions message format.
   */
  static toOpenAIMessages(request: ModelRequest): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    for (const m of request.messages) {
      switch (m.role) {
        case MessageRole.SYSTEM: {
          messages.push({ role: 'system', content: m.content });
          break;
        }

        case MessageRole.USER: {
          messages.push({ role: 'user', content: m.content });
          break;
        }

        case MessageRole.ASSISTANT: {
          const msgObj: Record<string, unknown> = {
            role: 'assistant',
            content: m.content || null,
          };
          if (m.toolCalls && m.toolCalls.length > 0) {
            msgObj['tool_calls'] = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {}),
              },
            }));
          }
          messages.push(msgObj);
          break;
        }

        case MessageRole.TOOL_CALL: {
          const toolCalls =
            m.toolCalls && m.toolCalls.length > 0
              ? m.toolCalls
              : m.name
                ? [{ id: m.toolCallId ?? 'call_auto', name: m.name, input: {} }]
                : [];

          messages.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {}),
              },
            })),
          });
          break;
        }

        case MessageRole.TOOL_RESULT:
        case MessageRole.TOOL: {
          const toolCallId = m.toolResult?.toolCallId ?? m.toolCallId ?? 'call_unknown';
          const name = m.toolResult?.name ?? m.name;
          const content = m.toolResult?.output ?? m.content ?? '';

          const toolMsg: Record<string, unknown> = {
            role: 'tool',
            tool_call_id: toolCallId,
            content,
          };
          if (name) {
            toolMsg['name'] = name;
          }
          messages.push(toolMsg);
          break;
        }

        default: {
          messages.push({ role: 'user', content: m.content });
          break;
        }
      }
    }

    return messages;
  }

  /**
   * Convert vendor-neutral ModelRequest messages to Anthropic Claude Messages API format.
   */
  static toAnthropicMessages(request: ModelRequest): AnthropicPayload {
    const systemParts: string[] = [];
    if (request.systemPrompt) {
      systemParts.push(request.systemPrompt);
    }

    const messages: AnthropicMessage[] = [];

    for (const m of request.messages) {
      if (m.role === MessageRole.SYSTEM) {
        if (m.content) {
          systemParts.push(m.content);
        }
        continue;
      }

      switch (m.role) {
        case MessageRole.USER: {
          messages.push({
            role: 'user',
            content: m.content,
          });
          break;
        }

        case MessageRole.ASSISTANT: {
          if (m.toolCalls && m.toolCalls.length > 0) {
            const blocks: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
            if (m.content) {
              blocks.push({ type: 'text', text: m.content });
            }
            for (const tc of m.toolCalls) {
              blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: (tc.input as Record<string, unknown>) ?? {},
              });
            }
            messages.push({ role: 'assistant', content: blocks });
          } else {
            messages.push({ role: 'assistant', content: m.content });
          }
          break;
        }

        case MessageRole.TOOL_CALL: {
          const blocks: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];
          if (m.content) {
            blocks.push({ type: 'text', text: m.content });
          }
          const toolCalls =
            m.toolCalls ??
            (m.name ? [{ id: m.toolCallId ?? 'call_1', name: m.name, input: {} }] : []);
          for (const tc of toolCalls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: (tc.input as Record<string, unknown>) ?? {},
            });
          }
          messages.push({ role: 'assistant', content: blocks });
          break;
        }

        case MessageRole.TOOL_RESULT:
        case MessageRole.TOOL: {
          const toolUseId = m.toolResult?.toolCallId ?? m.toolCallId ?? 'call_unknown';
          const content = m.toolResult?.output ?? m.content ?? '';
          const isError = m.toolResult?.isError ?? false;

          const block: AnthropicToolResultBlock = {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content,
            is_error: isError,
          };

          // In Anthropic API, tool results are placed inside a 'user' message block
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
            (lastMsg.content as Array<AnthropicToolResultBlock>).push(block);
          } else {
            messages.push({
              role: 'user',
              content: [block],
            });
          }
          break;
        }

        default: {
          messages.push({ role: 'user', content: m.content });
          break;
        }
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      messages,
    };
  }

  /**
   * Helper to format a Canonical Tool Result message.
   */
  static createToolResultMessage(params: {
    toolCallId: string;
    name: string;
    output: string;
    isError?: boolean;
  }): ModelMessage {
    return {
      role: MessageRole.TOOL_RESULT,
      content: params.output,
      toolCallId: params.toolCallId,
      name: params.name,
      toolResult: {
        toolCallId: params.toolCallId,
        name: params.name,
        output: params.output,
        isError: params.isError ?? false,
      },
    };
  }

  /**
   * Helper to format an Assistant Tool Call message.
   */
  static createToolCallMessage(
    toolCalls: ReadonlyArray<ToolCall>,
    thoughtContent?: string,
  ): ModelMessage {
    return {
      role: MessageRole.ASSISTANT,
      content: thoughtContent ?? '',
      toolCalls,
    };
  }
}
