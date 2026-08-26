// Pattern: Tree-structured session JSONL persistence (ref: Pi)
/**
 * JSONL Session Persistence (from DeepSeek Harness & Pi).
 *
 * Persists sessions as append-only, human-readable JSON Lines files:
 * Line 0: Header metadata entry (`{"type":"header","data":{...}}`)
 * Line 1..N: Chronological session events (`{"type":"...","data":{...},"seq":N,"time":T}`)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Session } from './session.js';
import { DefaultSession } from './session.js';
import type { SessionHeader } from './session-header.js';
import type { SessionEvent } from './session-event.js';
import type { IdFactory } from '../types/identifiers.js';
import type { Clock } from '../interfaces/clock.js';
import { recoverInterruptedSession } from './crash-recovery.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export interface DeserializeSessionOptions {
  readonly idFactory?: IdFactory;
  readonly clock?: Clock;
  readonly autoRecoverCrash?: boolean;
}

export class SessionJsonlPersistence {
  /**
   * Serializes a Session to JSONL text.
   */
  static serializeSession(session: Session): string {
    const lines: string[] = [];

    // Header record
    const headerRecord = {
      type: 'header',
      data: session.header,
    };
    lines.push(JSON.stringify(headerRecord));

    // Event records
    for (const ev of session.log) {
      lines.push(JSON.stringify(ev));
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Deserializes JSONL text into a Session, automatically repairing crashed turns if enabled.
   */
  static deserializeSession(jsonlContent: string, options?: DeserializeSessionOptions): Session {
    const rawLines = jsonlContent.split('\n').filter((l) => l.trim().length > 0);

    if (rawLines.length === 0) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: 'Cannot deserialize empty session JSONL file',
      });
    }

    // Line 0 must be the session header
    let header: SessionHeader;
    try {
      const parsedHeaderLine = JSON.parse(rawLines[0]!);
      if (parsedHeaderLine.type === 'header' && parsedHeaderLine.data) {
        header = parsedHeaderLine.data as SessionHeader;
      } else if (parsedHeaderLine.id && parsedHeaderLine.version) {
        // Flat header format fallback
        header = parsedHeaderLine as SessionHeader;
      } else {
        throw new Error('Missing session header signature');
      }
    } catch (err) {
      throw new HarnessError({
        code: ErrorCode.STATE_CORRUPTED,
        category: ErrorCategory.STATE,
        message: `Failed to parse session header: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Subsequent lines are events
    const events: SessionEvent[] = [];
    for (let i = 1; i < rawLines.length; i++) {
      try {
        const parsedEvent = JSON.parse(rawLines[i]!) as SessionEvent;
        events.push(parsedEvent);
      } catch (err) {
        throw new HarnessError({
          code: ErrorCode.STATE_CORRUPTED,
          category: ErrorCategory.STATE,
          message: `Corrupted event at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Apply crash recovery if enabled (default true)
    const autoRecover = options?.autoRecoverCrash ?? true;
    let finalEvents = events;
    if (autoRecover) {
      const recoveryResult = recoverInterruptedSession(events, options?.clock?.now().getTime());
      finalEvents = [...recoveryResult.recoveredLog];
    }

    return new DefaultSession({
      header,
      initialLog: finalEvents,
      idFactory: options?.idFactory,
      clock: options?.clock,
    });
  }

  /**
   * Writes a complete session to a JSONL file on disk (sync).
   */
  static writeSessionToFileSync(session: Session, filePath: string): void {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const content = this.serializeSession(session);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Writes a complete session to a JSONL file on disk (async).
   */
  static async writeSessionToFile(session: Session, filePath: string): Promise<void> {
    this.writeSessionToFileSync(session, filePath);
  }

  /**
   * Appends a single event to an existing session JSONL file (sync).
   */
  static appendEventToFileSync(filePath: string, event: SessionEvent): void {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  /**
   * Appends a single event to an existing session JSONL file (async).
   */
  static async appendEventToFile(filePath: string, event: SessionEvent): Promise<void> {
    this.appendEventToFileSync(filePath, event);
  }

  /**
   * Reads and parses a session JSONL file from disk (sync).
   */
  static readSessionFromFileSync(filePath: string, options?: DeserializeSessionOptions): Session {
    if (!fs.existsSync(filePath)) {
      throw new HarnessError({
        code: ErrorCode.STATE_NOT_FOUND,
        category: ErrorCategory.STATE,
        message: `Session file not found: ${filePath}`,
      });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return this.deserializeSession(content, options);
  }

  /**
   * Reads and parses a session JSONL file from disk (async).
   */
  static async readSessionFromFile(
    filePath: string,
    options?: DeserializeSessionOptions,
  ): Promise<Session> {
    return this.readSessionFromFileSync(filePath, options);
  }
}
