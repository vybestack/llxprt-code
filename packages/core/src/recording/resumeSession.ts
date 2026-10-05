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

import { stat, open, appendFile } from 'node:fs/promises';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
export { ResumeCursorBoot } from './resumeCursorBoot.js';
import { type SessionMetadata, type SessionSummary } from './types.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { scanResumeMetadata } from './resumeMetadata.js';
import { RESUME_NO_SESSIONS_FOUND } from './resumeNotFoundMessages.js';
import type { JournalReadCounters } from './journalCounters.js';
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
  /** Injectable read counters (issue #854 P05d); absent = uninstrumented. */
  counters?: JournalReadCounters;
}

/**
 * Successful resume result — contains reconstructed history, metadata,
 * and an initialized recording service for appending new events.
 *
 * @requirement REQ-RSM-004
 */
export interface ResumeResult {
  ok: true;
  boot: ResumeCursorBoot;
  metadata: SessionMetadata;
  recording: SessionRecordingService;
  lockHandle: LockHandle;
  warnings: string[];
}

/** Failed resume result — contains an error message. */
export interface ResumeError {
  ok: false;
  error: string;
}

type LockedSession = { targetFilePath: string; lockHandle: LockHandle };

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

  try {
    const lockHandle = await SessionLockManager.acquire(
      request.chatsDir,
      resolved.session.sessionId,
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
    return { ok: false, error: RESUME_NO_SESSIONS_FOUND };
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

  return bootLockedSession(lockedSession, request);
}

async function bootLockedSession(
  lockedSession: LockedSession,
  request: ResumeRequest,
): Promise<ResumeResult | ResumeError> {
  let boot: ResumeCursorBoot | undefined;
  try {
    const size = (await stat(lockedSession.targetFilePath)).size;
    const { replay: replayResult, watermark: scannedWatermark } =
      await scanResumeMetadata(
        lockedSession.targetFilePath,
        request.projectHash,
        size,
        request.counters,
      );
    if (!replayResult.ok) throw new Error(replayResult.error);
    if (replayResult.sequenceCorrupt)
      throw new Error('recording has non-monotonic sequences');
    const watermark = await finishResumePrefix(
      lockedSession.targetFilePath,
      size,
      scannedWatermark,
    );
    boot = await ResumeCursorBoot.open(
      lockedSession.targetFilePath,
      replayResult.lastSeq,
      watermark,
      request.counters,
      request.mediaStore,
    );
    const ownedBoot = boot;
    const lockHandle = {
      ...lockedSession.lockHandle,
      async release(): Promise<void> {
        try {
          await ownedBoot.close();
        } finally {
          await lockedSession.lockHandle.release();
        }
      },
    };
    const recording = initializeRecordingForResume(
      { ...lockedSession, lockHandle },
      request,
      replayResult,
    );
    return {
      ok: true,
      boot,
      metadata: replayResult.metadata,
      recording,
      lockHandle,
      warnings: replayResult.warnings,
    };
  } catch (error) {
    try {
      await boot?.close();
    } finally {
      await lockedSession.lockHandle.release();
    }
    return {
      ok: false,
      error: `Failed to replay session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
    const locked = await SessionLockManager.isLocked(
      chatsDir,
      session.sessionId,
    );
    if (locked) continue;

    const result = await tryAcquireLock(chatsDir, session.sessionId);
    if (result !== null) {
      return { targetFilePath: session.filePath, lockHandle: result };
    }
  }
  return null;
}

async function finishResumePrefix(
  filePath: string,
  size: number,
  watermark: number,
): Promise<number> {
  if (size === 0) return watermark;
  const handle = await open(filePath, 'r');
  const last = Buffer.alloc(1);
  try {
    await handle.read(last, 0, 1, size - 1);
  } finally {
    await handle.close();
  }
  if (last[0] === 10) return watermark;
  await appendFile(filePath, '\n');
  return watermark === size ? watermark + 1 : watermark;
}
