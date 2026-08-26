/**
 * Session Event Map (from DeepSeek Harness & Pi).
 *
 * Defines the typed, merge-extensible event vocabulary for event-sourced sessions.
 * Every model-visible and operational fact in a session is logged as a typed event.
 */
import type { TokenUsage, ToolCall } from '../model/model-io.js';

// ---------------------------------------------------------------------------
// Event-Specific Types
// ---------------------------------------------------------------------------

export type TurnEndReason =
  | { kind: 'complete' }
  | { kind: 'aborted'; cause: string }
  | { kind: 'budget' }
  | { kind: 'interrupted' } // crash recovery synthetic close
  | { kind: 'error'; message: string };

export type RequestHeaderReason = 'initial' | 'resume' | 'change';

export interface EpochHeader {
  readonly epoch: number;
  readonly model?: string;
  readonly provider?: string;
  readonly systemPromptHash?: string;
  readonly timestamp?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UserMessage {
  readonly content: string;
  readonly files?: ReadonlyArray<string>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StreamChunk {
  readonly text?: string;
  readonly toolCallChunk?: {
    readonly id?: string;
    readonly name?: string;
    readonly argumentsDelta?: string;
  };
}

export interface AssistantMessage {
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<ToolCall>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolResultMessage {
  readonly toolCallId: string;
  readonly name: string;
  readonly output: string;
  readonly isError?: boolean;
}

export interface CompactionSummaryData {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly summary: string;
  readonly tokensSaved?: number;
  readonly compactedAt?: number;
}

export interface GoalChangeData {
  readonly goalId: string;
  readonly revision: number;
  readonly phase: string;
  readonly description?: string;
  readonly blockerCode?: string;
}

// ---------------------------------------------------------------------------
// Session Event Map — Typed and extensible via TypeScript declaration merging
// ---------------------------------------------------------------------------

export interface SessionEventMap {
  'turn/start': { readonly turn: number };
  'turn/end': { readonly turn: number; readonly reason: TurnEndReason };
  'step/start': { readonly turn: number; readonly step: number };
  'step/end': { readonly turn: number; readonly step: number };
  'user/message': UserMessage;
  'assistant/chunk': {
    readonly turn: number;
    readonly step: number;
    readonly chunk: StreamChunk;
  };
  'assistant/message': {
    readonly turn: number;
    readonly step: number;
    readonly message: AssistantMessage;
    readonly usage?: TokenUsage;
  };
  'tool/call': {
    readonly turn: number;
    readonly step: number;
    readonly callId: string;
    readonly name: string;
    readonly arguments: string;
  };
  'tool/result': {
    readonly turn: number;
    readonly step: number;
    readonly message: ToolResultMessage;
    readonly error?: { readonly name: string; readonly code: string };
    readonly meta?: unknown;
  };
  'request/header': {
    readonly header: EpochHeader;
    readonly reason: RequestHeaderReason;
  };
  'compaction/start': { readonly turn: number | null };
  'compaction/summary': CompactionSummaryData;
  'compaction/end': { readonly turn: number | null; readonly error?: string };
  'goal/change': GoalChangeData;
  user_message?: UserMessage | { content: string; [key: string]: unknown };
  agent_message?: AssistantMessage | { content: string; [key: string]: unknown };
  custom?: Record<string, unknown>;
  [key: string]: any;
}

export type SessionEventType = keyof SessionEventMap;
