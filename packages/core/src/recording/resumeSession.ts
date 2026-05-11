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

import * as path from 'node:path';
import { type IContent } from '../services/history/IContent.js';
import { type SessionMetadata, type SessionSummary } from './types.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';

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
}

/**
 * Failed resume result — contains an error message.
 */
export interface ResumeError {
  ok: false;
  error: string;
}

type LockedSession = { targetFilePath: string; lockHandle: LockHandle };

/**
 * Extract the lock identifier from a session file path.
 * For `session-<id>.jsonl`, returns `<id>`.
 */
function extractLockId(filePath: string): string {
  const basename = path.basename(filePath);
  const match = basename.match(/^session-(.+)\.jsonl$/);
  if (!match) {
    throw new Error(`Cannot extract session ID from path: ${filePath}`);
  }
  return match[1];
}

/**
 * Resolve a specific continueRef to a locked session.
 * Returns the locked session info, or a ResumeError if resolution/locking fails.
 */
async function resolveAndLockSession(
  request: ResumeRequest,
  sessions: SessionSummary[],
): Promise<LockedSession | ResumeError> {
  const resolved = SessionDiscovery.resolveSessionRef(
    request.continueRef,
    sessions,
  );
  if ('error' in resolved) {
    return { ok: false, error: resolved.error };
  }

  const targetFilePath = resolved.session.filePath;
  const lockId = extractLockId(targetFilePath);

  try {
    const lockHandle = await SessionLockManager.acquire(
      request.chatsDir,
      lockId,
    );
    return { targetFilePath, lockHandle };
  } catch {
    return { ok: false, error: 'Session is in use by another process' };
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
  });
  recording.initializeForResume(
    lockedSession.targetFilePath,
    replayResult.lastSeq,
  );

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

/**
 * Resume a previously recorded session.
 *
 * Discovers sessions, resolves the target, acquires a lock, replays the
 * event log to reconstruct history, and initializes recording for append.
 *
 * @pseudocode resume-flow.md lines 50-124
 */
export async function resumeSession(
  request: ResumeRequest,
): Promise<ResumeResult | ResumeError> {
  // Step 1: Discover sessions
  const sessions = await SessionDiscovery.listSessions(
    request.chatsDir,
    request.projectHash,
  );

  if (sessions.length === 0) {
    return { ok: false, error: 'No sessions found for this project' };
  }

  // Step 2: Resolve which session to resume
  let lockedSession: LockedSession | null = null;

  if (request.continueRef === CONTINUE_LATEST) {
    lockedSession = await findFirstUnlockedSession(request.chatsDir, sessions);

    if (!lockedSession) {
      return {
        ok: false,
        error: 'All sessions for this project are in use',
      };
    }
  } else {
    const result = await resolveAndLockSession(request, sessions);
    if (!('targetFilePath' in result)) return result;
    lockedSession = result;
  }

  // Step 4: Replay session
  const replayResult = await replaySession(
    lockedSession.targetFilePath,
    request.projectHash,
  );
  if (!replayResult.ok) {
    await lockedSession.lockHandle.release();
    return {
      ok: false,
      error: `Failed to replay session: ${replayResult.error}`,
    };
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
  };
}

/**
 * Helper function to try acquiring a lock.
 * Returns the lock handle on success, null on failure.
 */
async function tryAcquireLock(
  chatsDir: string,
  lockId: string,
): Promise<LockHandle | null> {
  try {
    return await SessionLockManager.acquire(chatsDir, lockId);
  } catch {
    return null;
  }
}

/**
 * Find the first unlocked session and acquire its lock.
 * Returns the locked session info, or null if all sessions are locked.
 */
async function findFirstUnlockedSession(
  chatsDir: string,
  sessions: SessionSummary[],
): Promise<{ targetFilePath: string; lockHandle: LockHandle } | null> {
  for (const session of sessions) {
    const lockId = extractLockId(session.filePath);
    const locked = await SessionLockManager.isLocked(chatsDir, lockId);
    if (locked) continue;

    const result = await tryAcquireLock(chatsDir, lockId);
    if (result !== null) {
      return { targetFilePath: session.filePath, lockHandle: result };
    }
  }
  return null;
}
