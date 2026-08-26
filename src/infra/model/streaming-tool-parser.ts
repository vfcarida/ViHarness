/**
 * Streaming Tool Call Parser & Speculative Pre-Flight Validator.
 *
 * Incrementally accumulates and parses tool call fragments emitted during LLM streaming.
 * Enables pre-flight policy evaluation and tool argument validation before completion terminates.
 */
import type { ToolCall } from '../../core/model/model-io.js';

export interface IncrementalToolState {
  readonly id: string;
  readonly name: string;
  readonly partialInputText: string;
  readonly parsedInput?: Record<string, unknown>;
  readonly isComplete: boolean;
}

export class StreamingToolParser {
  private buffer = '';
  private currentToolId = '';
  private currentToolName = '';
  private completedTools: ToolCall[] = [];

  /**
   * Feed a new text chunk from the model stream.
   */
  feed(chunkText: string): ReadonlyArray<IncrementalToolState> {
    this.buffer += chunkText;
    const states: IncrementalToolState[] = [];

    // Check for tool call JSON patterns in buffer: {"name": "...", "arguments": ...} or XML <tool_call>
    // Standard OpenAI/Claude-style JSON streaming detection
    const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(this.buffer);
    if (nameMatch && nameMatch[1]) {
      this.currentToolName = nameMatch[1];
      if (!this.currentToolId) {
        this.currentToolId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      }
    }

    // Try to locate argument/input boundaries
    const inputKeywordIdx = this.buffer.search(/"(?:arguments|input)"\s*:\s*\{/);
    if (inputKeywordIdx !== -1) {
      const colonIdx = this.buffer.indexOf(':', inputKeywordIdx);
      const afterColon = this.buffer.slice(colonIdx + 1).trim();
      const extracted = this.extractBalancedJson(afterColon);

      if (extracted.isComplete && extracted.parsed) {
        const completeCall: ToolCall = {
          id: this.currentToolId,
          name: this.currentToolName,
          input: extracted.parsed,
        };
        this.completedTools.push(completeCall);
        states.push({
          id: this.currentToolId,
          name: this.currentToolName,
          partialInputText: extracted.raw ?? '',
          parsedInput: extracted.parsed,
          isComplete: true,
        });
      } else {
        states.push({
          id: this.currentToolId,
          name: this.currentToolName,
          partialInputText: extracted.raw ?? afterColon,
          isComplete: false,
        });
      }
    } else if (this.currentToolName) {
      states.push({
        id: this.currentToolId,
        name: this.currentToolName,
        partialInputText: '',
        isComplete: false,
      });
    }

    return states;
  }

  private extractBalancedJson(str: string): {
    parsed?: Record<string, unknown>;
    raw?: string;
    isComplete: boolean;
  } {
    const start = str.indexOf('{');
    if (start === -1) return { isComplete: false };

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < str.length; i++) {
      const char = str[i]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            const raw = str.slice(start, i + 1);
            try {
              const parsed = JSON.parse(raw);
              return { parsed, raw, isComplete: true };
            } catch {
              return { raw, isComplete: false };
            }
          }
        }
      }
    }

    return { raw: str.slice(start), isComplete: false };
  }

  getCompletedToolCalls(): ReadonlyArray<ToolCall> {
    return this.completedTools;
  }

  reset(): void {
    this.buffer = '';
    this.currentToolId = '';
    this.currentToolName = '';
    this.completedTools = [];
  }
}
