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
 */

import * as acp from '@agentclientprotocol/sdk';

/**
 * Maps a resume rejection to the closest ACP {@link acp.RequestError}. A
 * not-found-style reason yields {@link acp.RequestError.resourceNotFound}
 * (JSON-RPC -32002) carrying the session id; every other reason (locked,
 * corrupt, replay/hash failure, or an unrecognized message) yields
 * {@link acp.RequestError.internalError} (JSON-RPC -32603) carrying the
 * underlying detail as both the appended message and structured `data`, so the
 * client can surface why the load actually failed.
 */
export function mapResumeError(
  sessionId: string,
  error: unknown,
): acp.RequestError {
  const detail = errorMessage(error);
  if (isNotFoundResumeReason(detail)) {
    return acp.RequestError.resourceNotFound(sessionId);
  }
  return acp.RequestError.internalError({ sessionId, reason: detail }, detail);
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
 * opposed to being locked, corrupt, or otherwise unreadable). Matches the core
 * not-found strings case-insensitively: "No sessions found for this project",
 * "Session not found for this project: <ref>", and an out-of-range index
 * reference. Lock/corrupt/replay reasons deliberately fall through to
 * internalError.
 */
function isNotFoundResumeReason(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('no sessions found') ||
    normalized.includes('out of range')
  );
}
