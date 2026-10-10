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

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-001, REQ-RSM-004
 * @pseudocode resume-flow.md lines 50-124
 *
 * Resume session flow. Discovers, resolves, locks, replays, and initializes
 * recording for a previously saved session.
 */

import { type IContent } from '../services/history/IContent.js';
import {
  type ReplayResult,
  type SessionMetadata,
  type SessionSummary,
  type UnreadableRecording,
} from './types.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';
import { RESUME_NO_SESSIONS_FOUND } from './resumeNotFoundMessages.js';
import {
  describeUnreadableRecording,
  matchUnreadableRecordings,
} from './unreadableRecordings.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';

/**
 * Sentinel constant for "resume most recent session".
 */
export const CONTINUE_LATEST = '__CONTINUE_LATEST__' as const;

/**
 * Input to the resume flow.
 *
 * @pseudocode resume-flow.md lines 50-56
 */
export interface ResumeRequest {
  continueRef: string | typeof CONTINUE_LATEST;
  projectHash: string;
  chatsDir: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  mediaStore?: LocalMediaStore;
  maxQueueBytes?: number;
}

/**
 * Successful resume result — contains reconstructed history, metadata,
 * and an initialized recording service for appending new events.
 *
 * @requirement REQ-RSM-004
 */
export interface ResumeResult {
  ok: true;
  history: IContent[];
  metadata: SessionMetadata;
  recording: SessionRecordingService;
  lockHandle: LockHandle;
  warnings: string[];
  /** Recordings in the project that could not be read and were passed over. */
  skippedRecordings: readonly UnreadableRecording[];
}

/** Failed resume result — contains an error message. */
export interface ResumeError {
  ok: false;
  error: string;
  /** Recordings in the project that could not be read and were passed over. */
  skippedRecordings?: readonly UnreadableRecording[];
}

type LockedSession = { targetFilePath: string; lockHandle: LockHandle };

/**
 * Resolve a specific continueRef to a locked session.
 * Returns the locked session info, or a ResumeError if resolution/locking fails.
 * A reference that matches only an unreadable recording reports that
 * recording's reason rather than a bare "not found".
 */
async function resolveAndLockSession(
  request: ResumeRequest,
  sessions: SessionSummary[],
  unreadable: readonly UnreadableRecording[],
): Promise<LockedSession | ResumeError> {
  const resolved = SessionDiscovery.resolveSessionRef(
    request.continueRef,
    sessions,
  );
  if ('error' in resolved) {
    const named = matchUnreadableRecordings(
      request.continueRef,
      resolved.error,
      unreadable,
    );
    if (named.length === 0) return { ok: false, error: resolved.error };
    const details = named
      .map((recording) => `${recording.reason} (${recording.filePath})`)
      .join('; ');
    return { ok: false, error: `Failed to replay session: ${details}` };
  }

  const targetFilePath = resolved.session.filePath;

  try {
    const lockHandle = await SessionLockManager.acquire(
      request.chatsDir,
      resolved.session.sessionId,
    );
    return { targetFilePath, lockHandle };
  } catch (error: unknown) {
    if (error instanceof SessionLockedError) {
      return { ok: false, error: 'Session is in use by another process' };
    }
    throw error;
  }
}

/**
 * Initialize recording for append, record provider/model mismatch if needed,
 * and record the resume event.
 */
function initializeRecordingForResume(
  lockedSession: LockedSession,
  request: ResumeRequest,
  replayResult: { metadata: SessionMetadata; lastSeq: number },
): SessionRecordingService {
  const recording = new SessionRecordingService({
    sessionId: replayResult.metadata.sessionId,
    projectHash: request.projectHash,
    chatsDir: request.chatsDir,
    workspaceDirs: request.workspaceDirs,
    provider: request.currentProvider,
    model: request.currentModel,
    ...(request.mediaStore === undefined
      ? {}
      : { mediaStore: request.mediaStore }),
    ...(request.maxQueueBytes === undefined
      ? {}
      : { maxQueueBytes: request.maxQueueBytes }),
  });
  recording.initializeForResume(
    lockedSession.targetFilePath,
    replayResult.lastSeq,
    replayResult.metadata.title,
  );
  recording.adoptLock(lockedSession.lockHandle);

  if (
    request.currentProvider !== replayResult.metadata.provider ||
    request.currentModel !== replayResult.metadata.model
  ) {
    recording.recordSessionEvent(
      'warning',
      `Provider/model changed from ${replayResult.metadata.provider}/${replayResult.metadata.model} to ${request.currentProvider}/${request.currentModel}`,
    );
    recording.recordProviderSwitch(
      request.currentProvider,
      request.currentModel,
    );
  }

  recording.recordSessionEvent(
    'info',
    `Session resumed (originally started ${replayResult.metadata.startTime})`,
  );

  return recording;
}

type ReplaySuccess = Extract<ReplayResult, { ok: true }>;
type ReplayFailure = { ok: false; reason: string };

function replayFailureError(failure: ReplayFailure): ResumeError {
  return { ok: false, error: `Failed to replay session: ${failure.reason}` };
}

/**
 * Replay a locked session. A session that cannot be replayed releases its lock
 * before the failure is returned, so callers never inherit a lock on a session
 * they are not resuming.
 */
async function replayLockedSession(
  lockedSession: LockedSession,
  request: ResumeRequest,
): Promise<ReplaySuccess | ReplayFailure> {
  const replayResult = await replaySession(
    lockedSession.targetFilePath,
    request.projectHash,
    { mediaStore: request.mediaStore },
  );
  if (!replayResult.ok) {
    await lockedSession.lockHandle.release();
    return { ok: false, reason: replayResult.error };
  }
  if (replayResult.sequenceCorrupt) {
    await lockedSession.lockHandle.release();
    return {
      ok: false,
      reason: 'recording has non-monotonic sequences',
    };
  }
  return replayResult;
}

/**
 * Bare continue: lock and replay the newest unlocked session that is readable.
 * Candidates that fail replay are skipped (their lock already released) and
 * appended to `skipped`; if none is readable the newest candidate's replay
 * error is returned.
 */
async function replayNewestReadableSession(
  request: ResumeRequest,
  sessions: SessionSummary[],
  skipped: UnreadableRecording[],
): Promise<
  { lockedSession: LockedSession; replay: ReplaySuccess } | ResumeError
> {
  let firstFailure: ReplayFailure | null = null;
  for (const session of sessions) {
    const lockedSession = await tryLockSession(request.chatsDir, session);
    if (lockedSession === null) continue;
    const replay = await replayLockedSession(lockedSession, request);
    if (replay.ok) return { lockedSession, replay };
    skipped.push({
      sessionId: session.sessionId,
      filePath: session.filePath,
      reason: replay.reason,
    });
    firstFailure ??= replay;
  }
  return firstFailure === null
    ? { ok: false, error: 'All sessions for this project are in use' }
    : replayFailureError(firstFailure);
}

/** The error for a project whose only recordings have unreadable headers. */
function noReadableSessionsError(
  skipped: readonly UnreadableRecording[],
): string {
  return skipped.length === 0
    ? RESUME_NO_SESSIONS_FOUND
    : `${RESUME_NO_SESSIONS_FOUND}; skipped unreadable recordings: ${skipped.map(describeUnreadableRecording).join('; ')}`;
}

/**
 * Resume a previously recorded session.
 *
 * Discovers sessions, resolves the target, acquires a lock, replays the
 * event log to reconstruct history, and initializes recording for append.
 * Recordings that cannot be read never block the others; they are returned
 * in `skippedRecordings` on success and failure alike.
 *
 * @pseudocode resume-flow.md lines 50-124
 */
export async function resumeSession(
  request: ResumeRequest,
): Promise<ResumeResult | ResumeError> {
  // Step 1: Discover sessions
  const { sessions, unreadableRecordings } =
    await SessionDiscovery.listSessionsDetailed(
      request.chatsDir,
      request.projectHash,
    );
  const skipped: UnreadableRecording[] = [...unreadableRecordings];

  if (sessions.length === 0 && request.continueRef === CONTINUE_LATEST) {
    return {
      ok: false,
      error: noReadableSessionsError(skipped),
      skippedRecordings: skipped,
    };
  }

  // Steps 2-4: Resolve, lock, and replay the session to resume
  let lockedSession: LockedSession;
  let replayResult: ReplaySuccess;
  if (request.continueRef === CONTINUE_LATEST) {
    const newest = await replayNewestReadableSession(
      request,
      sessions,
      skipped,
    );
    if ('error' in newest) return { ...newest, skippedRecordings: skipped };
    ({ lockedSession, replay: replayResult } = newest);
  } else {
    const locked = await resolveAndLockSession(
      request,
      sessions,
      unreadableRecordings,
    );
    if (!('targetFilePath' in locked)) {
      return { ...locked, skippedRecordings: skipped };
    }
    const replay = await replayLockedSession(locked, request);
    if (!replay.ok) {
      return { ...replayFailureError(replay), skippedRecordings: skipped };
    }
    lockedSession = locked;
    replayResult = replay;
  }

  // Steps 5-7: Initialize recording for append
  const recording = initializeRecordingForResume(
    lockedSession,
    request,
    replayResult,
  );

  // Step 8: Return result
  return {
    ok: true,
    history: replayResult.history,
    metadata: replayResult.metadata,
    recording,
    lockHandle: lockedSession.lockHandle,
    warnings: replayResult.warnings,
    skippedRecordings: skipped,
  };
}

/**
 * Acquire a session's lock. Returns null only when another process holds it;
 * any other failure (permissions, I/O) is a real error and propagates.
 */
async function tryAcquireLock(
  chatsDir: string,
  lockId: string,
): Promise<LockHandle | null> {
  try {
    return await SessionLockManager.acquire(chatsDir, lockId);
  } catch (error: unknown) {
    if (error instanceof SessionLockedError) return null;
    throw error;
  }
}

/**
 * Acquire the lock on a session unless another process holds it.
 * Returns the locked session, or null when the session is in use.
 */
async function tryLockSession(
  chatsDir: string,
  session: SessionSummary,
): Promise<LockedSession | null> {
  if (await SessionLockManager.isLocked(chatsDir, session.sessionId)) {
    return null;
  }
  const lockHandle = await tryAcquireLock(chatsDir, session.sessionId);
  return lockHandle === null
    ? null
    : { targetFilePath: session.filePath, lockHandle };
}
