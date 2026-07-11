/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the resume-failure -> ACP RequestError mapping used by
 * ACP session/load (issue #1604, FINDING 4). These feed the EXACT error strings
 * the core resume flow produces (see packages/core/src/recording/resumeSession.ts,
 * SessionDiscovery.ts, ReplayEngine.ts) — wrapped in the
 * `Failed to resume session: <detail>` envelope that SessionControl.resume adds —
 * and assert the resulting JSON-RPC error code + carried detail. This guards the
 * not-found vs everything-else classification against the real core vocabulary,
 * so a wording drift on either side is caught. No mocks: pure inputs -> real
 * RequestError.
 */

import { describe, expect, it } from 'vitest';
import { RequestError } from '@agentclientprotocol/sdk';
import { mapResumeError } from './zed-session-errors.js';

const SESSION_ID = 'sess-xyz';

/** Wraps a core resume detail in the envelope SessionControl.resume throws. */
function resumeError(detail: string): Error {
  return new Error(`Failed to resume session: ${detail}`);
}

describe('mapResumeError (issue #1604 FINDING 4)', () => {
  it.each([
    'No sessions found for this project',
    `Session not found for this project: ${SESSION_ID}`,
    'Session index 5 out of range (1-3)',
  ])(
    'maps the not-found core reason %j to resourceNotFound (-32002) carrying the session id',
    (detail) => {
      const error = mapResumeError(SESSION_ID, resumeError(detail));
      expect(error).toBeInstanceOf(RequestError);
      expect(error.code).toBe(-32002);
      expect(error.message).toContain(SESSION_ID);
    },
  );

  it.each([
    'Session is in use by another process',
    'All sessions for this project are in use',
    'Failed to replay session: Missing or corrupt session_start event',
    'Failed to replay session: Empty file',
    'Failed to replay session: Project hash mismatch: expected a got b',
    "Ambiguous session prefix 'ab' matches: abc, abd",
  ])(
    'maps the non-not-found core reason %j to internalError (-32603) carrying the underlying detail',
    (detail) => {
      const error = mapResumeError(SESSION_ID, resumeError(detail));
      expect(error).toBeInstanceOf(RequestError);
      expect(error.code).toBe(-32603);
      // The underlying detail is surfaced in BOTH the message and structured
      // data so the client can show why the load actually failed.
      expect(error.message).toContain(detail);
      expect(error.data).toMatchObject({ sessionId: SESSION_ID });
      expect((error.data as { reason: string }).reason).toContain(detail);
    },
  );

  it('handles a non-Error thrown value by stringifying it (still internalError with detail)', () => {
    const error = mapResumeError(SESSION_ID, 'raw string failure');
    expect(error.code).toBe(-32603);
    expect(error.message).toContain('raw string failure');
    expect((error.data as { reason: string }).reason).toBe(
      'raw string failure',
    );
  });
});
