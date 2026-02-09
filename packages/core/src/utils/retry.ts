/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import type { GenerateContentResponse } from '@google/genai';
import { ApiError } from '@google/genai';
import { DebugLogger } from '../debug/index.js';
import { delay, createAbortError } from './delay.js';

export interface HttpError extends Error {
  status?: number;
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetryOnError: (error: Error) => boolean;
  shouldRetryOnContent?: (content: GenerateContentResponse) => boolean;
  onPersistent429?: (error?: unknown) => Promise<string | boolean | null>;
  trackThrottleWaitTime?: (waitTimeMs: number) => void;
  retryFetchErrors?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,
  maxDelayMs: 30000, // 30 seconds
  shouldRetryOnError: defaultShouldRetry,
};

export const STREAM_INTERRUPTED_ERROR_CODE = 'LLXPRT_STREAM_INTERRUPTED';

const TRANSIENT_ERROR_PHRASES = [
  'connection error',
  'connection terminated',
  'terminated',
  'connection reset',
  'socket hang up',
  'socket hung up',
  'socket closed',
  'socket timeout',
  'network timeout',
  'network error',
  'fetch failed',
  'request aborted',
  'request timeout',
  'stream closed',
  'stream prematurely closed',
  'read econnreset',
  'write econnreset',
];

const TRANSIENT_ERROR_REGEXES = [
  /econn(reset|refused|aborted)/i,
  /etimedout/i,
  /und_err_(socket|connect|headers_timeout|body_timeout)/i,
  /tcp connection.*(reset|closed)/i,
];

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  STREAM_INTERRUPTED_ERROR_CODE,
]);

function collectErrorDetails(error: unknown): {
  messages: string[];
  codes: string[];
} {
  const messages: string[] = [];
  const codes: string[] = [];
  const stack: unknown[] = [error];
  const visited = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) {
      continue;
    }

    if (typeof current === 'string') {
      messages.push(current);
      continue;
    }

    if (typeof current !== 'object') {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const errorObject = current as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
      originalError?: unknown;
      error?: unknown;
    };

    if ('message' in errorObject && typeof errorObject.message === 'string') {
      messages.push(errorObject.message);
    }
    if ('code' in errorObject && typeof errorObject.code === 'string') {
      codes.push(errorObject.code);
    }

    const possibleNestedErrors = [
      errorObject.cause,
      errorObject.originalError,
      errorObject.error,
    ];
    for (const nested of possibleNestedErrors) {
      if (nested && nested !== current) {
        stack.push(nested);
      }
    }
  }

  return { messages, codes };
}

export function createStreamInterruptionError(
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): Error {
  const error = new Error(message);
  error.name = 'StreamInterruptionError';
  (error as { code?: string }).code = STREAM_INTERRUPTED_ERROR_CODE;
  if (details) {
    (error as { details?: Record<string, unknown> }).details = details;
  }
  if (cause && !(error as { cause?: unknown }).cause) {
    (error as { cause?: unknown }).cause = cause;
  }
  return error;
}

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    if (
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code;
    }

    if (
      'error' in error &&
      typeof (error as { error?: unknown }).error === 'object' &&
      (error as { error?: unknown }).error !== null &&
      'code' in (error as { error?: { code?: unknown } }).error! &&
      typeof (
        (error as { error?: { code?: unknown } }).error as {
          code?: unknown;
        }
      ).code === 'string'
    ) {
      return (
        (error as { error?: { code?: unknown } }).error as {
          code?: string;
        }
      ).code;
    }
  }

  return undefined;
}

export function isNetworkTransientError(error: unknown): boolean {
  const { messages, codes } = collectErrorDetails(error);

  const lowerMessages = messages.map((msg) => msg.toLowerCase());
  if (
    lowerMessages.some((msg) =>
      TRANSIENT_ERROR_PHRASES.some((phrase) => msg.includes(phrase)),
    )
  ) {
    return true;
  }

  if (
    messages.some((msg) =>
      TRANSIENT_ERROR_REGEXES.some((regex) => regex.test(msg)),
    )
  ) {
    return true;
  }

  if (
    codes
      .map((code) => code.toUpperCase())
      .some((code) => TRANSIENT_ERROR_CODES.has(code))
  ) {
    return true;
  }

  return false;
}

/**
 * Default predicate function to determine if a retry should be attempted.
 * Retries on 429 (Too Many Requests) and 5xx server errors.
 * @param error The error object.
 * @returns True if the error is a transient error, false otherwise.
 */
function defaultShouldRetry(error: Error | unknown): boolean {
  // Priority check for ApiError
  if (error instanceof ApiError) {
    // Explicitly do not retry 400 (Bad Request)
    if (error.status === 400) return false;
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }

  // Check for status using helper (handles other error shapes)
  const status = getErrorStatus(error);
  if (status !== undefined) {
    return status === 429 || (status >= 500 && status < 600);
  }

  if (isNetworkTransientError(error)) {
    return true;
  }

  return false;
}

/**
 * Retries a function with exponential backoff and jitter.
 * @param fn The asynchronous function to retry.
 * @param options Optional retry configuration.
 * @returns A promise that resolves with the result of the function if successful.
 * @throws The last error encountered if all attempts fail.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  if (options?.signal?.aborted) {
    throw createAbortError();
  }

  if (options?.maxAttempts !== undefined && options.maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive number.');
  }

  const cleanOptions = options
    ? Object.fromEntries(Object.entries(options).filter(([_, v]) => v != null))
    : {};

  const {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    shouldRetryOnError,
    shouldRetryOnContent,
    retryFetchErrors: _retryFetchErrors,
    signal,
  } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...cleanOptions,
  };

  // retryFetchErrors reserved for upstream API compatibility (Google-specific)
  void _retryFetchErrors;

  const logger = new DebugLogger('llxprt:retry');
  let attempt = 0;
  let currentDelay = initialDelayMs;
  let consecutive429s = 0;
  let consecutiveAuthErrors = 0;
  const failoverThreshold = 1; // Attempt bucket failover after this many consecutive 429s

  while (attempt < maxAttempts) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    attempt++;
    try {
      const result = await fn();

      // Reset error counters on success
      consecutive429s = 0;
      consecutiveAuthErrors = 0;

      if (
        shouldRetryOnContent &&
        shouldRetryOnContent(result as GenerateContentResponse)
      ) {
        const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1);
        const delayWithJitter = Math.max(0, currentDelay + jitter);
        await delay(delayWithJitter, signal);
        currentDelay = Math.min(maxDelayMs, currentDelay * 2);
        continue;
      }

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      const errorStatus = getErrorStatus(error);
      const isOverload = isOverloadError(error);
      const is429 = errorStatus === 429 || isOverload;
      const is402 = errorStatus === 402;
      const isAuthError = errorStatus === 401 || errorStatus === 403;

      // Track consecutive 429 errors for bucket failover
      if (is429) {
        consecutive429s++;
        logger.debug(
          () =>
            `429 error detected, consecutive count: ${consecutive429s}/${failoverThreshold}`,
        );
      } else {
        consecutive429s = 0;
      }

      if (isAuthError) {
        consecutiveAuthErrors++;
      } else {
        consecutiveAuthErrors = 0;
      }

      // Retry once to allow OAuth refresh or onPersistent429 to refresh before failover.
      // This retry relies on either automatic OAuth refresh during the next request
      // or refresh logic inside onPersistent429 before failover executes.
      const shouldAttemptRefreshRetry =
        isAuthError && options?.onPersistent429 && consecutiveAuthErrors === 1;

      if (shouldAttemptRefreshRetry) {
        logger.debug(
          () =>
            `401/403 error detected, retrying once to allow refresh before bucket failover`,
        );
      }

      const canAttemptFailover = Boolean(options?.onPersistent429);
      const shouldAttemptFailover =
        canAttemptFailover &&
        ((is429 && consecutive429s >= failoverThreshold) ||
          is402 ||
          (isAuthError && consecutiveAuthErrors > 1));

      // @fix issue1029 - Enhanced debug logging for failover decision
      logger.debug(
        () =>
          `[issue1029] Failover decision: errorStatus=${errorStatus}, is429=${is429}, is402=${is402}, isAuthError=${isAuthError}, ` +
          `consecutive429s=${consecutive429s}, consecutiveAuthErrors=${consecutiveAuthErrors}, ` +
          `canAttemptFailover=${canAttemptFailover}, shouldAttemptFailover=${shouldAttemptFailover}`,
      );

      // Attempt bucket failover after threshold consecutive 429 errors
      // @plan PLAN-20251213issue490 Bucket failover integration
      if (shouldAttemptFailover && options?.onPersistent429) {
        const failoverReason = is429
          ? `${consecutive429s} consecutive 429 errors`
          : `status ${errorStatus}`;
        logger.debug(
          () => `Attempting bucket failover after ${failoverReason}`,
        );
        const failoverResult = await options.onPersistent429(error);

        logger.debug(
          () =>
            `[issue1029] onPersistent429 callback returned: ${failoverResult === null ? 'null (no handler)' : failoverResult}`,
        );

        if (failoverResult === true || typeof failoverResult === 'string') {
          // Bucket switch succeeded - reset counters and retry immediately
          logger.debug(
            () => `Bucket failover successful, resetting retry state`,
          );
          consecutive429s = 0;
          consecutiveAuthErrors = 0;
          currentDelay = initialDelayMs;
          // Don't increment attempt counter - this is a fresh start with new bucket
          attempt--;
          continue;
        } else if (failoverResult === false) {
          // No more buckets available - stop retrying
          logger.debug(
            () => `No more buckets available for failover, stopping retry`,
          );
          throw error;
        }
        // failoverResult === null means continue with normal retry (no failover handler configured)
        logger.debug(
          () =>
            `[issue1029] Failover returned null - no failover handler configured, continuing with normal retry`,
        );
      } else if (is429 && !canAttemptFailover) {
        // @fix issue1029 - Log when we hit 429 but can't attempt failover
        logger.debug(
          () =>
            `[issue1029] Got 429 error but canAttemptFailover=false (no onPersistent429 callback). ` +
            `This means bucket failover is not wired for this request.`,
        );
      }

      const shouldRetry = shouldRetryOnError(error as Error);

      if (!shouldRetry && !shouldAttemptRefreshRetry) {
        throw error;
      }

      if (attempt >= maxAttempts && !shouldAttemptRefreshRetry) {
        throw error;
      }

      if (attempt >= maxAttempts && shouldAttemptRefreshRetry) {
        attempt--;
      }

      const { delayDurationMs, errorStatus: delayErrorStatus } =
        getDelayDurationAndStatus(error);

      if (delayDurationMs > 0) {
        // Respect Retry-After header if present and parsed
        logger.debug(
          () =>
            `Attempt ${attempt} failed with status ${delayErrorStatus ?? 'unknown'}. Retrying after explicit delay of ${delayDurationMs}ms... Error: ${error}`,
        );
        await delay(delayDurationMs, signal);
        // Track throttling wait time when explicitly delaying
        if (options?.trackThrottleWaitTime) {
          logger.debug(
            () =>
              `Tracking throttle wait time from Retry-After header: ${delayDurationMs}ms`,
          );
          options.trackThrottleWaitTime(delayDurationMs);
        }
        // Reset currentDelay for next potential non-429 error, or if Retry-After is not present next time
        currentDelay = initialDelayMs;
      } else {
        // Fall back to exponential backoff with jitter
        logRetryAttempt(attempt, error, errorStatus);
        // Add jitter: +/- 30% of currentDelay
        const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1);
        const delayWithJitter = Math.max(0, currentDelay + jitter);
        await delay(delayWithJitter, signal);
        // Track throttling wait time for exponential backoff
        if (options?.trackThrottleWaitTime) {
          logger.debug(
            () =>
              `Tracking throttle wait time from exponential backoff: ${delayWithJitter}ms`,
          );
          options.trackThrottleWaitTime(delayWithJitter);
        }
        currentDelay = Math.min(maxDelayMs, currentDelay * 2);
      }
    }
  }
  // This line should theoretically be unreachable due to the throw in the catch block.
  // Added for type safety and to satisfy the compiler that a promise is always returned.
  throw new Error('Retry attempts exhausted');
}

/**
 * Determines if an error is an Anthropic overloaded_error.
 * Anthropic returns overloaded_error as an error type (not HTTP status):
 * {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}
 * @param error The error object.
 * @returns True if the error is an overloaded_error, false otherwise.
 */
export function isOverloadError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const errorObj = error as {
      error?: { type?: string; message?: string };
      type?: string;
    };
    const errorType = errorObj.error?.type || errorObj.type;
    return errorType === 'overloaded_error';
  }
  return false;
}

/**
 * Extracts the HTTP status code from an error object.
 * @param error The error object.
 * @returns The HTTP status code, or undefined if not found.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }
    // Check for error.response.status (common in axios errors)
    if (
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object' &&
      (error as { response?: unknown }).response !== null
    ) {
      const response = (
        error as { response: { status?: unknown; headers?: unknown } }
      ).response;
      if ('status' in response && typeof response.status === 'number') {
        return response.status;
      }
    }
  }
  return undefined;
}

/**
 * Extracts the Retry-After delay from an error object's headers.
 * @param error The error object.
 * @returns The delay in milliseconds, or 0 if not found or invalid.
 */
function getRetryAfterDelayMs(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    // Check for error.response.headers (common in axios errors)
    if (
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object' &&
      (error as { response?: unknown }).response !== null
    ) {
      const response = (error as { response: { headers?: unknown } }).response;
      if (
        'headers' in response &&
        typeof response.headers === 'object' &&
        response.headers !== null
      ) {
        const headers = response.headers as { 'retry-after'?: unknown };
        const retryAfterHeader = headers['retry-after'];
        if (typeof retryAfterHeader === 'string') {
          const retryAfterSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfterSeconds)) {
            return retryAfterSeconds * 1000;
          }
          // It might be an HTTP date
          const retryAfterDate = new Date(retryAfterHeader);
          if (!isNaN(retryAfterDate.getTime())) {
            return Math.max(0, retryAfterDate.getTime() - Date.now());
          }
        }
      }
    }
  }
  return 0;
}

/**
 * Determines the delay duration based on the error, prioritizing Retry-After header.
 * @param error The error object.
 * @returns An object containing the delay duration in milliseconds and the error status.
 */
function getDelayDurationAndStatus(error: unknown): {
  delayDurationMs: number;
  errorStatus: number | undefined;
} {
  const errorStatus = getErrorStatus(error);
  const isOverload = isOverloadError(error);
  let delayDurationMs = 0;

  if (errorStatus === 429 || isOverload) {
    delayDurationMs = getRetryAfterDelayMs(error);
  }
  return { delayDurationMs, errorStatus };
}

/**
 * Logs a message for a retry attempt when using exponential backoff.
 * @param attempt The current attempt number.
 * @param error The error that caused the retry.
 * @param errorStatus The HTTP status code of the error, if available.
 */
function logRetryAttempt(
  attempt: number,
  error: unknown,
  errorStatus?: number,
): void {
  const logger = new DebugLogger('llxprt:retry');
  let message = `Attempt ${attempt} failed. Retrying with backoff...`;
  if (errorStatus) {
    message = `Attempt ${attempt} failed with status ${errorStatus}. Retrying with backoff...`;
  }

  if (errorStatus === 429) {
    logger.debug(() => `${message} Error: ${error}`);
  } else if (errorStatus && errorStatus >= 500 && errorStatus < 600) {
    logger.error(() => `${message} Error: ${error}`);
  } else if (error instanceof Error) {
    // Fallback for errors that might not have a status but have a message
    if (error.message.includes('429')) {
      logger.debug(
        () =>
          `Attempt ${attempt} failed with 429 error (no Retry-After header). Retrying with backoff... Error: ${error}`,
      );
    } else if (error.message.match(/5\d{2}/)) {
      logger.error(
        () =>
          `Attempt ${attempt} failed with 5xx error. Retrying with backoff... Error: ${error}`,
      );
    } else {
      logger.debug(() => `${message} Error: ${error}`); // Default to debug for other errors
    }
  } else {
    logger.debug(() => `${message} Error: ${error}`); // Default to debug if error type is unknown
  }
}

// @plan marker: PLAN-20250909-TOKTRACK.P05

/**
 * Error indicating a model was not found (HTTP 404).
 * Used by googleQuotaErrors to classify 404 responses.
 */
export class ModelNotFoundError extends Error {
  code: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'ModelNotFoundError';
    this.code = code ?? 404;
  }
}
