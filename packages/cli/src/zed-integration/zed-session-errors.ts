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
import {
  DebugLogger,
  RESUME_NO_SESSIONS_FOUND,
  RESUME_SESSION_NOT_FOUND_PREFIX,
  RESUME_SESSION_INDEX_OUT_OF_RANGE_RE,
  SESSION_FILE_ID_PREFIX_LENGTH,
} from '@vybestack/llxprt-code-core';

/** JSON-RPC code ACP assigns to resourceNotFound. */
const RESOURCE_NOT_FOUND_CODE = -32002;

/**
 * Module logger (mirroring the zedIntegration.ts / sessionControl.ts precedent
 * of a namespaced core DebugLogger) used to surface the otherwise-silent
 * corrupt-vs-missing probe failure (FINDING F6) so a swallowed readdir error is
 * diagnosable. Debug-level only: it never changes the fallback behavior.
 */
const logger = new DebugLogger('llxprt:zed-integration:session-errors');

// The EXACT not-found sentences the core resume flow emits, matched verbatim so
// an unrelated message that merely CONTAINS the words "not found" (e.g. "Replay
// failed: session content not found in cache") is NOT misclassified as a missing
// session (FINDING F1). Imported from core's resumeNotFoundMessages.ts — the
// same constants the emitting sites (resumeSession.ts / SessionDiscovery.ts)
// use — so a core rewording can never silently desynchronize this classifier.
// Each sentence is carried inside the `Failed to resume session: <detail>`
// envelope SessionControl.resume adds, so substring matching is used.

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
 * entry matches (including an absent chats directory), the genuine
 * resourceNotFound is returned. A non-ENOENT probe failure makes existence
 * indeterminate and therefore becomes internalError with the probe detail.
 * Non-not-found mappings and already-constructed RequestErrors are returned
 * without probing.
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
  const outcome = await probeMatchingSessionFile(sessionId, probe);
  if (outcome.kind === 'match') {
    const detail = `session file exists but could not be read/replayed (corrupt or incompatible): ${outcome.file}`;
    return acp.RequestError.internalError(
      { sessionId, reason: detail, file: outcome.file },
      detail,
    );
  }
  if (outcome.kind === 'probe-error') {
    // FINDING B2: a NON-ENOENT probe failure (EACCES, disk error, ...) means we
    // genuinely could not determine whether the session exists on disk, so
    // reporting resourceNotFound would be MISLEADING (the session may well
    // exist). Surface an internalError carrying the probe failure as cause
    // detail so the client sees the real, actionable reason instead of a
    // spurious "not found". ENOENT (chats dir absent) is NOT a probe-error — it
    // means genuinely missing and keeps the resourceNotFound path below.
    const detail = `could not determine whether the session exists on disk (session-file probe failed): ${outcome.message}`;
    return acp.RequestError.internalError(
      { sessionId, reason: detail, probeError: outcome.message },
      detail,
    );
  }
  // outcome.kind === 'no-match' (including ENOENT chats dir): genuinely missing.
  return mapped;
}

/**
 * The three distinguishable outcomes of the corrupt-vs-missing session-file
 * probe (FINDING B2): a matching file was found (corrupt-but-present), no file
 * matched (genuinely missing — includes an ENOENT chats dir), or the probe
 * itself failed for a NON-ENOENT reason (EACCES/disk error) so existence is
 * indeterminate and must surface as an internalError rather than a misleading
 * resourceNotFound.
 */
type ProbeOutcome =
  | { readonly kind: 'match'; readonly file: string }
  | { readonly kind: 'no-match' }
  | { readonly kind: 'probe-error'; readonly message: string };

/**
 * Probes the on-disk chats-dir namespace for a recorded file matching
 * `sessionId`, returning a {@link ProbeOutcome}. A successful listing yields
 * `match` (with the filename) or `no-match`. A probe rejection is classified by
 * errno: an ENOENT (the chats dir does not exist yet) is treated as `no-match`
 * (genuinely missing, keep the resourceNotFound path); any other rejection
 * (EACCES, EIO, ...) yields `probe-error` (existence indeterminate → the caller
 * surfaces internalError, FINDING B2) and is logged at debug (FINDING F6) so the
 * underlying directory-read error stays diagnosable.
 */
async function probeMatchingSessionFile(
  sessionId: string,
  probe: () => Promise<readonly string[]>,
): Promise<ProbeOutcome> {
  let entries: readonly string[];
  try {
    entries = await probe();
  } catch (error) {
    const message = errorMessage(error);
    if (isEnoent(error)) {
      // The chats dir does not exist yet: the session is genuinely missing, not
      // a probe failure. Keep the plain not-found mapping.
      logger.debug(
        () =>
          `probeMatchingSessionFile: chats dir absent (ENOENT) for ${sessionId}; ` +
          `treating as genuinely missing: ${message}`,
      );
      return { kind: 'no-match' };
    }
    // A NON-ENOENT probe failure (EACCES/disk error) means existence is
    // indeterminate; the caller surfaces internalError instead of a misleading
    // resourceNotFound (FINDING B2). Log at debug (FINDING F6) so it stays
    // diagnosable.
    logger.debug(
      () =>
        `probeMatchingSessionFile: session-file probe failed for ${sessionId}; ` +
        `reporting indeterminate existence: ${message}`,
    );
    return { kind: 'probe-error', message };
  }
  if (
    !Array.isArray(entries) ||
    entries.some((entry) => typeof entry !== 'string')
  ) {
    return {
      kind: 'probe-error',
      message: `session-file probe returned a non-string-array result: ${summarizeProbeValue(entries)}`,
    };
  }
  const file = findMatchingSessionFile(sessionId, entries);
  return file === null ? { kind: 'no-match' } : { kind: 'match', file };
}

/**
 * True when `error` is a Node ENOENT (no-such-file/directory) rejection — used
 * to distinguish a genuinely-absent chats dir (missing session) from a real
 * probe failure such as EACCES (FINDING B2). Exported so the loadSession
 * re-attach probe (zed-session-loader.ts) classifies its probe failures with
 * the exact same rule instead of keeping a duplicate.
 */
function summarizeProbeValue(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value).slice(0, 200);
  }
}

export function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Pure matcher: returns the first entry naming a recorded session file for
 * `sessionId`, or null when none match. SessionRecordingService.materialize
 * names files `session-<timestamp>-<first-12-of-id>.jsonl`, so a matching file
 * both starts with `session-` and ends with `-<first-12-of-id>.jsonl`. Exported
 * so the loadSession re-attach probe (zed-session-loader.ts) decides "does an
 * on-disk recording exist for this id?" against the EXACT same naming rule the
 * corrupt-vs-missing resume probe uses, keeping the two in lockstep.
 *
 * Known limitation: because the file name embeds ONLY the first 12 characters
 * of the id, two ids sharing that 12-char prefix are indistinguishable at the
 * file-name level — the matcher inherits the recording service's naming
 * granularity and cannot be stricter than it. Session ids are UUIDs, so a
 * 12-hex-char prefix collision is not a practical concern; resolving it would
 * require the recording service to embed the full id in the file name.
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
  return `-${sessionId.substring(0, SESSION_FILE_ID_PREFIX_LENGTH)}.jsonl`;
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
    detail.includes(RESUME_NO_SESSIONS_FOUND) ||
    detail.includes(RESUME_SESSION_NOT_FOUND_PREFIX) ||
    RESUME_SESSION_INDEX_OUT_OF_RANGE_RE.test(detail)
  );
}
