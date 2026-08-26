// Pattern: Deferred Context Injection & Turn Control (ref: DeepSeek Harness)
/**
 * Deferred Context Injection and Turn Control.
 *
 * Allows tools to schedule advisory messages, reminders, or notifications
 * to be injected into conversation history immediately following tool execution,
 * or explicitly conclude the current agent turn.
 */
export interface ToolRunContext {
  readonly sessionId?: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly metadata?: Record<string, unknown>;

  /** Defer a message or instruction until after this tool's result is recorded. */
  deferContext(message: Record<string, unknown> | string): void;

  /** Mark this step as concluding the current agent turn. */
  concludeTurn(): void;

  /** Get all deferred context entries collected during tool execution. */
  getDeferredContext(): Array<Record<string, unknown> | string>;

  /** Check if the tool execution requested to conclude the current turn. */
  isTurnConcluded(): boolean;
}

export class DefaultToolRunContext implements ToolRunContext {
  readonly sessionId?: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly metadata: Record<string, unknown>;

  private readonly deferredMessages: Array<Record<string, unknown> | string> = [];
  private turnConcluded = false;

  constructor(
    options: {
      sessionId?: string;
      callId?: string;
      toolName?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    this.sessionId = options.sessionId;
    this.callId = options.callId;
    this.toolName = options.toolName;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  deferContext(message: Record<string, unknown> | string): void {
    if (message) {
      this.deferredMessages.push(message);
    }
  }

  concludeTurn(): void {
    this.turnConcluded = true;
  }

  getDeferredContext(): Array<Record<string, unknown> | string> {
    return [...this.deferredMessages];
  }

  isTurnConcluded(): boolean {
    return this.turnConcluded;
  }
}
