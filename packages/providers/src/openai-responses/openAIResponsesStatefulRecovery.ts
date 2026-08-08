/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recovery helpers for Codex Responses statefulness (#3134).
 *
 * Codex continuation state lives on the WebSocket connection, not in durable
 * server-side storage — the backend rejects `store: true` outright
 * (400 `{"detail":"Store must be set to false"}`). A parent id can therefore
 * become unusable in ways the client cannot predict (a reconnect, a demotion
 * to HTTP), so these helpers cover the two external failure modes:
 *
 *  - detecting the API's "previous response not found" rejection, and
 *  - re-deriving the same turn with statefulness suppressed.
 */

import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';

/**
 * Detect an API rejection caused by an unresolvable `previous_response_id`.
 *
 * The Responses API answers HTTP 400 (or 404) with a body naming
 * `previous_response_id`, or the phrase `Previous response with id`, when the
 * referenced parent cannot be resolved. This is the one sanctioned recovery
 * trigger: a genuinely external, unpredictable API response.
 */
export function isPreviousResponseNotFoundError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== 400 && status !== 404) return false;
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes('previous_response_id') ||
    message.includes('previous response with id')
  );
}
