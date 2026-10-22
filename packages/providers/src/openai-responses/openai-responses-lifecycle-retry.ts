/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStreamInterruptionError } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  isWebSocketConnectionLimitError,
  WEBSOCKET_CONNECTION_LIMIT_CODE,
} from './openai-responses-websocket-lifetime.js';

/**
 * Per-request lifecycle state shared between {@link streamResponse} and its
 * single attempt helper so the #2771 retry decision sees what has already
 * been yielded and whether the one allowed retry was spent.
 */
export interface LifecycleAttemptState {
  completed: boolean;
  retryUsed: boolean;
  contentYielded: boolean;
  // The error that triggered the pending retry, so the caller can carry it as
  // the cause of a follow-on verdict (#3446).
  lifecycleError: unknown;
}

type LifecycleRetryOutcome =
  | { readonly retry: true }
  | { readonly retry: false; readonly error: unknown };

/**
 * #2771 retry policy: the connection-limit verdict is scoped to the
 * connection, not the request, so the same request may be retried exactly
 * once on a brand-new connection. Aborts always surface unchanged, any other
 * error surfaces unchanged once IContent has been yielded (the turn is no
 * longer safely replayable), and a second lifecycle-limit rejection fails
 * the turn with a terminal StreamInterruptionError instead of looping.
 */
export function decideLifecycleRetry(
  error: unknown,
  state: LifecycleAttemptState,
): LifecycleRetryOutcome {
  if (error instanceof Error && error.name === 'AbortError') {
    return { retry: false, error };
  }
  if (!isWebSocketConnectionLimitError(error)) {
    return { retry: false, error };
  }
  const details: unknown =
    typeof error === 'object' && error !== null
      ? Reflect.get(error, 'details')
      : undefined;
  if (state.contentYielded) {
    return {
      retry: false,
      error: createStreamInterruptionError(
        'Codex Responses WebSocket connection limit reached after output was published',
        typeof details === 'object' && details !== null
          ? { ...details }
          : undefined,
        error,
      ),
    };
  }
  if (state.retryUsed) {
    const providerError: unknown =
      typeof details === 'object' && details !== null
        ? Reflect.get(details, 'providerError')
        : undefined;
    return {
      retry: false,
      error: createStreamInterruptionError(
        'Codex Responses WebSocket reached the connection lifecycle ' +
          `limit (${WEBSOCKET_CONNECTION_LIMIT_CODE}) and the single ` +
          'retry was also rejected',
        providerError !== undefined ? { providerError } : undefined,
        error,
      ),
    };
  }
  // Thread the lifecycle error through so a follow-on verdict can carry it
  // as its cause (#3446).
  state.lifecycleError = error;
  return { retry: true };
}
