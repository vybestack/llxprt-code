/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resume-failure -> ACP RequestError mapping for ACP session/load (loadSession)
 * (issue #1604).
 *
 * `agent.session.resume` (SessionControl.resume) rejects with a single
 * `Error('Failed to resume session: <detail>')` whose <detail> is the core
 * resume flow's distinguishable reason (see resumeSession.ts / SessionDiscovery
 * / ReplayEngine): a missing session ("No sessions found for this project",
 * "Session not found for this project: <ref>", "... out of range ...") versus an
 * in-use lock, a project-hash mismatch, an empty/corrupt file, or a replay
 * error. Collapsing every one of these into resourceNotFound (as the first cut
 * did) misleads the client into thinking the session does not exist when it may
 * simply be locked or corrupt. This pure mapper distinguishes the not-found
 * family (-> resourceNotFound(sessionId)) from everything else (-> internalError
 * carrying the underlying detail in both the message and structured data) so the
 * Zed client receives an actionable error.
 *
 * Corrupt-vs-missing disambiguation (FINDING B): the core discovery layer
 * silently SKIPS a session file whose header/first line is unreadable, so a
 * corrupt-but-present session surfaces the SAME "not found" reason as a session
 * that genuinely does not exist. `classifyResumeFailure` closes that gap in the
 * zed layer WITHOUT touching core discovery: when the plain mapping would be
 * resourceNotFound, it probes the on-disk session-file namespace (a readdir of
 * the chats dir, injected for testability) and — if a file matching this
 * session's `session-*-<first-12-of-id>.jsonl` name EXISTS — reports
 * internalError ("session file exists but could not be read/replayed") instead,
 * so a corrupt session is never misreported as missing.
 */

import * as acp from '@agentclientprotocol/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core';

/** JSON-RPC code ACP assigns to resourceNotFound (-32002). */
const RESOURCE_NOT_FOUND_CODE = acp.RequestError.resourceNotFound('').code;

/**
 * Module logger (mirroring the zedIntegration.ts / sessionControl.ts precedent
 * of a namespaced core DebugLogger) used to surface the otherwise-silent
 * corrupt-vs-missing probe failure (FINDING F6) so a swallowed readdir error is
 * diagnosable. Debug-level only: it never changes the fallback behavior.
 */
const logger = new DebugLogger('llxprt:zed-integration:session-errors');

/**
 * The EXACT not-found sentences the core resume flow emits, matched verbatim so
 * an unrelated message that merely CONTAINS the words "not found" (e.g. "Replay
 * failed: session content not found in cache") is NOT misclassified as a missing
 * session (FINDING F1). Sourced from:
 *  - resumeSession.ts: `No sessions found for this project`
 *  - SessionDiscovery.resolveSessionRef: `Session not found for this project: <ref>`
 *  - SessionDiscovery.resolveSessionRef: `Session index <n> out of range (1-<m>)`
 * Each is carried inside the `Failed to resume session: <detail>` envelope that
 * SessionControl.resume adds, so a substring match against that envelope is used.
 */
const NO_SESSIONS_FOUND = 'No sessions found for this project';
const SESSION_NOT_FOUND_PREFIX = 'Session not found for this project:';
const SESSION_INDEX_OUT_OF_RANGE = /Session index \d+ out of range/;

/**
 * Maps a resume rejection to the closest ACP {@link acp.RequestError}. A
 * not-found-style reason yields {@link acp.RequestError.resourceNotFound}
 * (JSON-RPC -32002) carrying the session id; every other reason (locked,
 * corrupt, replay/hash failure, or an unrecognized message) yields
 * {@link acp.RequestError.internalError} (JSON-RPC -32603) carrying the
 * underlying detail as both the appended message and structured `data`, so the
 * client can surface why the load actually failed.
 *
 * Passthrough guard: an `error` that is ALREADY an {@link acp.RequestError}
 * (e.g. a precise error thrown by a lower layer) is returned unchanged so it is
 * never double-wrapped into a generic internalError.
 */
export function mapResumeError(
  sessionId: string,
  error: unknown,
): acp.RequestError {
  if (error instanceof acp.RequestError) {
    return error;
  }
  const detail = errorMessage(error);
  if (isNotFoundResumeReason(detail)) {
    return acp.RequestError.resourceNotFound(sessionId);
  }
  return acp.RequestError.internalError({ sessionId, reason: detail }, detail);
}

/**
 * Like {@link mapResumeError}, but disambiguates a not-found classification
 * against the on-disk session-file namespace (FINDING B). When the plain mapping
 * is resourceNotFound, `probe` is invoked to list the chats-dir entries; if any
 * entry matches this session's recorded filename
 * (`session-<timestamp>-<first-12-of-id>.jsonl`), the session exists but could
 * not be read/replayed (corrupt or incompatible) and an internalError carrying
 * the filename is returned instead of the misleading resourceNotFound. When no
 * entry matches, the genuine resourceNotFound is returned. When `probe` itself
 * rejects (e.g. a readdir error), the plain mapping is returned unchanged so the
 * original resume failure is never masked. Non-not-found mappings (and
 * already-constructed RequestErrors, via the {@link mapResumeError} passthrough)
 * are returned without probing.
 */
export async function classifyResumeFailure(
  sessionId: string,
  error: unknown,
  probe: () => Promise<readonly string[]>,
): Promise<acp.RequestError> {
  // An already-constructed RequestError from a lower layer is authoritative:
  // pass it through unchanged WITHOUT probing/re-wrapping (FINDING E guard), even
  // when it is a resourceNotFound — re-classifying it would double-wrap a precise
  // error and could spuriously flip it based on unrelated on-disk files.
  if (error instanceof acp.RequestError) {
    return error;
  }
  const mapped = mapResumeError(sessionId, error);
  if (mapped.code !== RESOURCE_NOT_FOUND_CODE) {
    return mapped;
  }
  const matchingFile = await probeMatchingSessionFile(sessionId, probe);
  if (matchingFile === null) {
    return mapped;
  }
  const detail = `session file exists but could not be read/replayed (corrupt or incompatible): ${matchingFile}`;
  return acp.RequestError.internalError(
    { sessionId, reason: detail, file: matchingFile },
    detail,
  );
}

/**
 * Returns the first chats-dir entry that matches this session's recorded
 * filename, or null when none match or the probe fails. A probe rejection is
 * swallowed (returns null) so the caller falls back to the plain mapping and the
 * original resume failure is never masked by a directory-read error.
 */
async function probeMatchingSessionFile(
  sessionId: string,
  probe: () => Promise<readonly string[]>,
): Promise<string | null> {
  let entries: readonly string[];
  try {
    entries = await probe();
  } catch (error) {
    // A probe (readdir) failure must NOT mask the original resume failure, so
    // the caller falls back to the plain not-found mapping. Log at debug level
    // (FINDING F6) so the swallowed directory-read error stays diagnosable
    // instead of vanishing silently.
    logger.debug(
      () =>
        `probeMatchingSessionFile: session-file probe failed for ${sessionId}; ` +
        `falling back to plain mapping: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
  return findMatchingSessionFile(sessionId, entries);
}

/**
 * Pure matcher: returns the first entry naming a recorded session file for
 * `sessionId`, or null when none match. SessionRecordingService.materialize
 * names files `session-<timestamp>-<first-12-of-id>.jsonl`, so a matching file
 * both starts with `session-` and ends with `-<first-12-of-id>.jsonl`. Exported
 * so the loadSession re-attach probe (zed-session-loader.ts) decides "does an
 * on-disk recording exist for this id?" against the EXACT same naming rule the
 * corrupt-vs-missing resume probe uses, keeping the two in lockstep.
 */
export function findMatchingSessionFile(
  sessionId: string,
  entries: readonly string[],
): string | null {
  const suffix = sessionFileSuffix(sessionId);
  return (
    entries.find(
      (name) => name.startsWith('session-') && name.endsWith(suffix),
    ) ?? null
  );
}

/**
 * The trailing `-<first-12-of-id>.jsonl` a recorded session file for `sessionId`
 * ends with. SessionRecordingService.materialize names files
 * `session-<timestamp>-<first-12-of-id>.jsonl`, so a matching file both starts
 * with `session-` and ends with this suffix.
 */
function sessionFileSuffix(sessionId: string): string {
  return `-${sessionId.substring(0, 12)}.jsonl`;
}

/**
 * Wraps a history-REPLAY failure (a rejected `session/update` during
 * streamHistory, FINDING A) into an ACP {@link acp.RequestError}. A dead/failing
 * transport that loses the transcript must surface as an error rather than a
 * silent success, so this yields {@link acp.RequestError.internalError} carrying
 * the underlying detail (and a `phase: 'replay'` marker) in both the message and
 * structured `data`. An `error` that is ALREADY a RequestError is returned
 * unchanged (passthrough guard) so it is never double-wrapped.
 */
export function wrapReplayFailure(
  sessionId: string,
  error: unknown,
): acp.RequestError {
  if (error instanceof acp.RequestError) {
    return error;
  }
  const detail = errorMessage(error);
  return acp.RequestError.internalError(
    { sessionId, reason: detail, phase: 'replay' },
    `Failed to replay session history: ${detail}`,
  );
}

/**
 * Extracts a human-readable message from an unknown thrown value (Error.message
 * when available, else its String() form) so the mapper can classify it.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when the resume detail indicates the session could not be found (as
 * opposed to being locked, corrupt, or otherwise unreadable). Matches ONLY the
 * EXACT core not-found vocabulary (FINDING F1) — the three sentences the core
 * discovery/resume layer emits — rather than any message that merely contains
 * the substring "not found" or "out of range":
 *   - "No sessions found for this project"        (resumeSession.ts)
 *   - "Session not found for this project: <ref>" (SessionDiscovery)
 *   - "Session index <n> out of range (1-<m>)"    (SessionDiscovery)
 * A corrupt/replay message such as "Failed to replay session: ... content not
 * found in cache" therefore falls through to internalError instead of being
 * misreported as a missing session. Lock/corrupt/replay/hash reasons all fall
 * through to internalError.
 */
function isNotFoundResumeReason(detail: string): boolean {
  return (
    detail.includes(NO_SESSIONS_FOUND) ||
    detail.includes(SESSION_NOT_FOUND_PREFIX) ||
    SESSION_INDEX_OUT_OF_RANGE.test(detail)
  );
}
