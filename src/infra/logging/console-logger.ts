/**
 * Structured console logger.
 *
 * Implements the Logger interface with JSON-structured output to stdout/stderr.
 * Supports child loggers with inherited context for request-scoped logging.
 *
 * This is the bootstrap logger. Production deployments may replace it
 * with a more sophisticated implementation (e.g. Pino, Winston).
 */
import type { Logger } from '../../core/interfaces/logger.js';
import { LogLevel } from '../../core/interfaces/logger.js';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.FATAL]: 4,
};

export class ConsoleLogger implements Logger {
  private readonly context: Record<string, unknown>;
  private readonly minLevel: LogLevel;

  constructor(context: Record<string, unknown> = {}, minLevel: LogLevel = LogLevel.DEBUG) {
    this.context = context;
    this.minLevel = minLevel;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, message, context);
  }

  child(context: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.context, ...context }, this.minLevel);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...context,
    };

    const output = JSON.stringify(entry);

    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LogLevel.ERROR]) {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}
