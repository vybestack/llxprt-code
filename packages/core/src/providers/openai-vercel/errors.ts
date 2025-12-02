/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P14
 * @requirement REQ-OAV-009 - Error Handling
 */

/**
 * Base error class for all provider-related errors
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly statusCode?: number;
  readonly originalError?: unknown;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    provider: string,
    statusCode?: number,
    isRetryable: boolean = false,
    originalError?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.originalError = originalError;

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Rate limit error with retry-after support
 */
export class RateLimitError extends ProviderError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    provider: string,
    retryAfter?: number,
    statusCode?: number,
    originalError?: unknown,
  ) {
    // Rate limit errors are retryable
    super(message, provider, statusCode, true, originalError);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends ProviderError {
  constructor(
    message: string,
    provider: string,
    statusCode?: number,
    originalError?: unknown,
  ) {
    // Auth errors are not retryable
    super(message, provider, statusCode, false, originalError);
    this.name = 'AuthenticationError';
  }
}

/**
 * Wraps raw errors into appropriate typed error classes
 */
export function wrapError(error: unknown, provider: string): ProviderError {
  // If already a ProviderError, return as-is
  if (error instanceof ProviderError) {
    return error;
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorAny = error as any;

    // Check for status code - support both 'statusCode' and 'status'
    const statusCode: number | undefined =
      errorAny.statusCode ?? errorAny.status;

    // Check for rate limit (429)
    if (statusCode === 429) {
      // Check for retry-after in multiple locations
      let retryAfter =
        errorAny.retryAfter || errorAny.retry_after || errorAny['retry-after'];

      // Also check responseHeaders if present
      if (!retryAfter && errorAny.responseHeaders) {
        const retryAfterHeader = errorAny.responseHeaders['retry-after'];
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10);
        }
      }

      return new RateLimitError(
        error.message,
        provider,
        retryAfter,
        statusCode,
        error,
      );
    }

    // Check for authentication errors (401, 403)
    if (statusCode === 401 || statusCode === 403) {
      return new AuthenticationError(
        error.message,
        provider,
        statusCode,
        error,
      );
    }

    // Check for server errors (5xx) - these are retryable
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      return new ProviderError(
        error.message,
        provider,
        statusCode,
        true,
        error,
      );
    }

    // For other errors with status codes, wrap as generic ProviderError (not retryable)
    if (statusCode) {
      return new ProviderError(
        error.message,
        provider,
        statusCode,
        false,
        error,
      );
    }

    // For errors without status codes, wrap as generic ProviderError (not retryable)
    return new ProviderError(error.message, provider, undefined, false, error);
  }

  // Handle non-Error objects (strings, etc.)
  return new ProviderError(String(error), provider);
}
