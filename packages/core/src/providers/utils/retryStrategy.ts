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

import type { DebugLogger } from '../../debug/index.js';

export interface RetryOptions {
  logger?: DebugLogger;
  checkNetworkTransient?: (err: unknown) => boolean;
}

/**
 * Determine whether an API error should be retried based on HTTP status codes.
 *
 * Retries on 429 (rate limit) and 5xx (server errors). Skips 200 status
 * errors (streaming wrappers). Optionally checks for transient network
 * errors via the provided callback.
 */
export function shouldRetryOnStatus(
  error: unknown,
  options?: RetryOptions,
): boolean {
  const logger = options?.logger;

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: number }).status === 200
  ) {
    return false;
  }

  let status: number | undefined;

  if (error && typeof error === 'object' && 'status' in error) {
    status = (error as { status?: number }).status;
  }

  if (!status && error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (response && typeof response === 'object' && 'status' in response) {
      status = response.status;
    }
  }

  if (!status && error instanceof Error) {
    if (error.message.includes('429')) {
      status = 429;
    }
  }

  logger?.debug(() => `shouldRetryOnStatus checking error:`, {
    hasError: !!error,
    errorType: error?.constructor?.name,
    status,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
    errorData:
      error && typeof error === 'object' && 'error' in error
        ? (error as { error?: unknown }).error
        : undefined,
  });

  const shouldRetry = Boolean(
    status === 429 || (status !== undefined && status >= 500 && status < 600),
  );

  if (!shouldRetry && options?.checkNetworkTransient?.(error)) {
    logger?.debug(
      () =>
        `Will retry request due to network transient error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return true;
  }

  if (shouldRetry) {
    logger?.debug(() => `Will retry request due to status ${status}`);
  }

  return shouldRetry;
}
