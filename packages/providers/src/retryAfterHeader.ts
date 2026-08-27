/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retry-After header extraction and normalization.
 *
 * Lives apart from retryDelayPolicy so the failure taxonomy (which needs the
 * normalized delay for RetryFailure.retryAfterMs) and the retry policy
 * (which needs the taxonomy for eligibility) can depend on the header
 * helpers without forming an import cycle.
 */

/** Maximum allowable Retry-After delay (5 minutes) to prevent stalling. */
export const MAX_RETRY_AFTER_MS = 300_000;

/**
 * Gets the delay duration for a retry, respecting Retry-After header.
 * The Retry-After value is capped at MAX_RETRY_AFTER_MS to prevent an
 * unbounded sleep from a misbehaving server. An explicit `Retry-After: 0`
 * (or a past date) is honored as an immediate retry; only a missing or
 * unparseable header falls back to the jittered default.
 */
export function getDelayDuration(error: unknown, defaultDelay: number): number {
  const retryAfterMs = getRetryAfterDelayMs(error);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  const jitter = defaultDelay * 0.3 * (Math.random() * 2 - 1);
  return Math.max(0, defaultDelay + jitter);
}

/**
 * Extracts the raw Retry-After value from the header shapes real SDK errors
 * expose. Checks, in order:
 *
 * 1. top-level `error.headers` — Anthropic SDK APIError (Fetch `Headers`)
 * 2. `error.response.headers` — OpenAI SDK APIError (Fetch `Headers` or plain)
 * 3. plain header objects at either position
 *
 * `Headers` instances are read via `get()` (case-insensitive); plain objects
 * are probed case-insensitively for the `retry-after` key.
 */
function readRetryAfterHeader(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    headers?: unknown;
    response?: { headers?: unknown };
  };
  const headerObjects = [candidate.headers, candidate.response?.headers];
  for (const headers of headerObjects) {
    const value = readHeader(headers);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readHeader(headers: unknown): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get('retry-after') ?? undefined;
  }
  const entry = Object.entries(headers as Record<string, unknown>).find(
    ([key]) => key.toLowerCase() === 'retry-after',
  );
  if (entry === undefined) return undefined;
  const value = entry[1];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

/**
 * Extracts Retry-After delay from error headers.
 *
 * @returns The normalized delay in ms (>= 0; `0` for an explicit
 * `Retry-After: 0` or a past date), or `undefined` when no parseable
 * Retry-After header is present. Callers must distinguish `undefined`
 * (absent — use default backoff) from `0` (server said retry now).
 */
export function getRetryAfterDelayMs(error: unknown): number | undefined {
  const retryAfter = readRetryAfterHeader(error);
  if (retryAfter !== undefined && retryAfter !== '') {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }
  }
  return undefined;
}

/**
 * Checks if error has a Retry-After header (including `Retry-After: 0`).
 */
export function hasRetryAfterHeader(error: unknown): boolean {
  return getRetryAfterDelayMs(error) !== undefined;
}
