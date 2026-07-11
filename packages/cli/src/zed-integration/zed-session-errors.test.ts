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
import {
  classifyResumeFailure,
  mapResumeError,
  wrapReplayFailure,
} from './zed-session-errors.js';

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

  it('passes an already-constructed RequestError through UNCHANGED (no double-wrap, FINDING E guard)', () => {
    const original = RequestError.resourceNotFound(SESSION_ID);
    const mapped = mapResumeError(SESSION_ID, original);
    // Same instance, not re-wrapped into a generic internalError.
    expect(mapped).toBe(original);
    expect(mapped.code).toBe(-32002);
  });
});

// A recorded session file for `sessionId` is named
// `session-<timestamp>-<first-12-of-id>.jsonl` (SessionRecordingService), so a
// matching entry both starts with `session-` and ends with `-<first12>.jsonl`.
function matchingFileName(sessionId: string): string {
  return `session-2026-07-11T10-00-00-${sessionId.substring(0, 12)}.jsonl`;
}

describe('classifyResumeFailure (issue #1604 FINDING B: corrupt vs missing)', () => {
  const CORRUPT_ID = 'corrupt-abcdef123456';

  it('reports internalError (with the filename) when a not-found resume has a MATCHING session file on disk (corrupt-but-present)', async () => {
    const fileName = matchingFileName(CORRUPT_ID);
    const error = await classifyResumeFailure(
      CORRUPT_ID,
      resumeError(`Session not found for this project: ${CORRUPT_ID}`),
      async () => [fileName, 'session-unrelated-000000000000.jsonl'],
    );
    expect(error).toBeInstanceOf(RequestError);
    // Present-but-unreadable is NOT missing: surface as internal error so the
    // client knows the session exists but could not be loaded.
    expect(error.code).toBe(-32603);
    expect(error.message).toContain('could not be read/replayed');
    expect(error.message).toContain(fileName);
    expect(error.data).toMatchObject({ sessionId: CORRUPT_ID, file: fileName });
  });

  it('reports genuine resourceNotFound when NO session file matches the id', async () => {
    const error = await classifyResumeFailure(
      CORRUPT_ID,
      resumeError('No sessions found for this project'),
      async () => ['session-something-else-999999999999.jsonl'],
    );
    expect(error.code).toBe(-32002);
    expect(error.message).toContain(CORRUPT_ID);
  });

  it('falls back to the plain not-found mapping when the probe itself REJECTS (never masks the original error)', async () => {
    const error = await classifyResumeFailure(
      CORRUPT_ID,
      resumeError(`Session not found for this project: ${CORRUPT_ID}`),
      async () => {
        throw new Error('EACCES: permission denied, scandir chats');
      },
    );
    // A directory-read failure must not become the surfaced error: the original
    // not-found classification stands.
    expect(error.code).toBe(-32002);
    expect(error.message).toContain(CORRUPT_ID);
  });

  it('does NOT probe (and returns internalError) for a non-not-found reason even if a file would match', async () => {
    let probed = false;
    const error = await classifyResumeFailure(
      CORRUPT_ID,
      resumeError('Session is in use by another process'),
      async () => {
        probed = true;
        return [matchingFileName(CORRUPT_ID)];
      },
    );
    expect(probed).toBe(false);
    expect(error.code).toBe(-32603);
    expect(error.message).toContain('in use');
  });

  it('passes an already-constructed RequestError through unchanged without probing', async () => {
    let probed = false;
    const original = RequestError.resourceNotFound(CORRUPT_ID);
    const error = await classifyResumeFailure(
      CORRUPT_ID,
      original,
      async () => {
        probed = true;
        return [matchingFileName(CORRUPT_ID)];
      },
    );
    expect(error).toBe(original);
    expect(probed).toBe(false);
  });
});

describe('wrapReplayFailure (issue #1604 FINDING A: strict replay delivery)', () => {
  it('wraps a transport failure into internalError carrying the detail and a replay phase marker', () => {
    const error = wrapReplayFailure(
      SESSION_ID,
      new Error('socket hang up mid-replay'),
    );
    expect(error).toBeInstanceOf(RequestError);
    expect(error.code).toBe(-32603);
    expect(error.message).toContain('socket hang up mid-replay');
    expect(error.data).toMatchObject({
      sessionId: SESSION_ID,
      phase: 'replay',
    });
    expect((error.data as { reason: string }).reason).toContain(
      'socket hang up mid-replay',
    );
  });

  it('passes an already-constructed RequestError through unchanged (no double-wrap)', () => {
    const original = RequestError.internalError({ x: 1 }, 'inner');
    expect(wrapReplayFailure(SESSION_ID, original)).toBe(original);
  });
});
