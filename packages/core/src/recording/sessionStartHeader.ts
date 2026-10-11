/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one contract a `session_start` payload must satisfy to be a readable
 * recording header. Replay and discovery both validate through this guard so
 * the two can never disagree about what a usable header is.
 */

import type { SessionStartPayload } from './types.js';

/** Replay and discovery error for a header that fails the contract. */
export const INVALID_SESSION_START_MESSAGE =
  'Invalid session_start: missing or malformed required fields';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * `sessionId`, `projectHash` and `startTime` must be non-empty strings.
 * `provider` and `model` must be strings but may be empty: recordings written
 * before the header was bound to the provider in effect carry "unknown"/""
 * and sessions that never had a model are legitimate.
 */
export function isSessionStartHeader(
  payload: unknown,
): payload is SessionStartPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const identity = ['sessionId', 'projectHash', 'startTime'].every((field) =>
    isNonEmptyString(Reflect.get(payload, field)),
  );
  const providerModel = ['provider', 'model'].every(
    (field) => typeof Reflect.get(payload, field) === 'string',
  );
  return identity && providerModel;
}
