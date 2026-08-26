/**
 * Resilient Execution Helper for Model Providers.
 *
 * Implements:
 * - Exponential backoff retries with jitter
 * - Rate limit (429) & transient error detection
 * - Timeout enforcement
 * - Cancellation via AbortSignal
 * - Fallback provider chain
 * - Standardized HarnessError mapping
 */
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import type { ModelRequest, ModelResponse, RetryMetadata } from '../../core/model/model-io.js';
import type { ModelProvider } from '../../core/interfaces/model-provider.js';

export interface ResilientExecutionOptions {
  readonly maxRetries?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly defaultTimeoutMs?: number;
  readonly fallbacks?: ReadonlyArray<ModelProvider>;
}

export const DEFAULT_RESILIENCE_OPTIONS: Required<Omit<ResilientExecutionOptions, 'fallbacks'>> = {
  maxRetries: 3,
  initialBackoffMs: 200,
  maxBackoffMs: 3000,
  defaultTimeoutMs: 30000,
};

export async function executeResiliently(
  primaryProvider: ModelProvider,
  request: ModelRequest,
  options: ResilientExecutionOptions = {},
): Promise<ModelResponse> {
  const providers = [primaryProvider, ...(options.fallbacks ?? [])];
  let lastError: Error | undefined;

  for (const provider of providers) {
    try {
      return await executeWithRetry(provider, request, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If error is unrecoverable or AbortSignal triggered, do not fallback
      if (request.signal?.aborted) {
        throw mapProviderError(lastError, provider.providerId);
      }
    }
  }

  throw mapProviderError(
    lastError ?? new Error('All providers failed'),
    primaryProvider.providerId,
  );
}

async function executeWithRetry(
  provider: ModelProvider,
  request: ModelRequest,
  options: ResilientExecutionOptions,
): Promise<ModelResponse> {
  const maxRetries = options.maxRetries ?? DEFAULT_RESILIENCE_OPTIONS.maxRetries;
  const initialBackoff = options.initialBackoffMs ?? DEFAULT_RESILIENCE_OPTIONS.initialBackoffMs;
  const maxBackoff = options.maxBackoffMs ?? DEFAULT_RESILIENCE_OPTIONS.maxBackoffMs;
  const timeoutMs =
    request.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_RESILIENCE_OPTIONS.defaultTimeoutMs;

  let attempt = 0;
  let totalBackoffMs = 0;
  let lastErrorMsg: string | undefined;

  while (attempt <= maxRetries) {
    attempt++;
    if (request.signal?.aborted) {
      throw new HarnessError({
        code: ErrorCode.MODEL_UNAVAILABLE,
        category: ErrorCategory.MODEL,
        message: 'Request was cancelled',
        context: { providerId: provider.providerId, aborted: true },
      });
    }

    try {
      const response = await executeWithTimeout(
        () => provider.complete(request),
        timeoutMs,
        request.signal,
      );

      // Attach retry metadata if retries occurred
      if (attempt > 1) {
        const retryMeta: RetryMetadata = {
          attemptCount: attempt,
          totalBackoffMs,
          lastError: lastErrorMsg,
        };
        return {
          ...response,
          retryMetadata: retryMeta,
        };
      }

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastErrorMsg = error.message;

      const isRetryable = checkIsRetryable(error);
      if (!isRetryable || attempt > maxRetries || request.signal?.aborted) {
        throw mapProviderError(error, provider.providerId);
      }

      // Calculate exponential backoff with full jitter
      const backoff = Math.min(maxBackoff, initialBackoff * Math.pow(2, attempt - 1));
      const jitteredBackoff = Math.floor(backoff * (0.5 + Math.random() * 0.5));
      totalBackoffMs += jitteredBackoff;

      await sleep(jitteredBackoff, request.signal);
    }
  }

  throw mapProviderError(new Error('Max retries exceeded'), provider.providerId);
}

async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new HarnessError({
          code: ErrorCode.MODEL_TIMEOUT,
          category: ErrorCategory.MODEL,
          message: `Model request timed out after ${timeoutMs}ms`,
          context: { timeoutMs },
        }),
      );
    }, timeoutMs);
  });

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal) {
      if (signal.aborted) {
        reject(
          new HarnessError({
            code: ErrorCode.MODEL_UNAVAILABLE,
            category: ErrorCategory.MODEL,
            message: 'Request was cancelled',
          }),
        );
      } else {
        signal.addEventListener('abort', () => {
          reject(
            new HarnessError({
              code: ErrorCode.MODEL_UNAVAILABLE,
              category: ErrorCategory.MODEL,
              message: 'Request was cancelled',
            }),
          );
        });
      }
    }
  });

  try {
    return await Promise.race([fn(), timeoutPromise, abortPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function checkIsRetryable(error: Error): boolean {
  if (error instanceof HarnessError) {
    return (
      error.code === ErrorCode.MODEL_RATE_LIMITED ||
      error.code === ErrorCode.MODEL_TIMEOUT ||
      error.code === ErrorCode.MODEL_UNAVAILABLE
    );
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('econnreset')
  );
}

export function mapProviderError(error: Error, providerId: string): HarnessError {
  if (error instanceof HarnessError) {
    return error;
  }

  const msg = error.message.toLowerCase();
  let code = ErrorCode.MODEL_INVALID_RESPONSE;

  if (msg.includes('429') || msg.includes('rate limit')) {
    code = ErrorCode.MODEL_RATE_LIMITED;
  } else if (msg.includes('timeout')) {
    code = ErrorCode.MODEL_TIMEOUT;
  } else if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('econnrefused')
  ) {
    code = ErrorCode.MODEL_UNAVAILABLE;
  }

  return new HarnessError({
    code,
    category: ErrorCategory.MODEL,
    message: `[${providerId}] ${error.message}`,
    context: { providerId },
    cause: error,
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(
        new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: 'Request cancelled during backoff',
        }),
      );
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(
        new HarnessError({
          code: ErrorCode.MODEL_UNAVAILABLE,
          category: ErrorCategory.MODEL,
          message: 'Request cancelled during backoff',
        }),
      );
    });
  });
}
