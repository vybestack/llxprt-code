/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetryOnError: (error: Error, retryFetchErrors?: boolean) => boolean;
  retryFetchErrors?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,
  maxDelayMs: 30000,
  shouldRetryOnError: isRetryableError,
};

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
  'request aborted',
  'request timeout',
  'stream closed',
  'stream prematurely closed',
  'read econnreset',
  'write econnreset',
  'fetch failed',
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
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Extracts messages, codes, and nested errors from an error-like object. */
function collectFromErrorObject(
  errorObject: Record<string, unknown>,
  visited: Set<unknown>,
  messages: string[],
  codes: string[],
  stack: unknown[],
  current: unknown,
): void {
  visited.add(errorObject);
  if (typeof errorObject.message === 'string') {
    messages.push(errorObject.message);
  }
  if (typeof errorObject.code === 'string') {
    codes.push(errorObject.code);
  }
  for (const nested of [
    errorObject.cause,
    errorObject.originalError,
    errorObject.error,
  ]) {
    if (nested !== undefined && nested !== null && nested !== current) {
      stack.push(nested);
    }
  }
}

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
    if (typeof current === 'string') {
      messages.push(current);
    } else if (
      current !== null &&
      current !== undefined &&
      typeof current === 'object' &&
      !visited.has(current)
    ) {
      collectFromErrorObject(
        current as Record<string, unknown>,
        visited,
        messages,
        codes,
        stack,
        current,
      );
    }
  }

  return { messages, codes };
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

  return codes
    .map((code) => code.toUpperCase())
    .some((code) => TRANSIENT_ERROR_CODES.has(code));
}

export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }
    if (
      'response' in error &&
      typeof (error as { response?: unknown }).response === 'object' &&
      (error as { response?: unknown }).response !== null
    ) {
      const response = (error as { response: { status?: unknown } }).response;
      if (typeof response.status === 'number') {
        return response.status;
      }
    }
  }
  return undefined;
}

/** Checks whether an HTTP status code indicates a retryable error. */
function isRetryableStatus(status: number | undefined): boolean {
  const RETRYABLE_STATUSES = new Set([401, 403, 429]);
  return (
    RETRYABLE_STATUSES.has(status ?? -1) ||
    (status !== undefined && status >= 500 && status < 600)
  );
}

export function isRetryableError(
  error: Error | unknown,
  _retryFetchErrors?: boolean,
): boolean {
  if (isNetworkTransientError(error)) {
    return true;
  }

  const status = getErrorStatus(error);
  return isRetryableStatus(status);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  if (options?.signal?.aborted === true) {
    throw createAbortError();
  }

  const {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    shouldRetryOnError,
    retryFetchErrors,
    signal,
  } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let currentDelay = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted === true) {
      throw createAbortError();
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      if (
        attempt >= maxAttempts ||
        !shouldRetryOnError(error as Error, retryFetchErrors)
      ) {
        throw error;
      }
      await delay(currentDelay, signal);
      currentDelay = Math.min(maxDelayMs, currentDelay * 2);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Retry attempts exhausted');
}
