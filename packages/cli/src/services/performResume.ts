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
 * Performs session resume - resolves session reference and swaps recording infrastructure.
 * Used by both browser-based resume and direct /continue command.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P11
 * @plan PLAN-20260214-SESSIONBROWSER.P09
 * @requirement REQ-PR-001, REQ-PR-002, REQ-SW-001, REQ-PR-005
 * @pseudocode perform-resume.md lines 10-170
 */

import {
  SessionDiscovery,
  SessionLockManager,
  resumeSession,
  RecordingIntegration,
  type IContent,
  type SessionRecordingService,
  type LockHandle,
  type SessionMetadata,
  type DebugLogger,
  type SessionSummary,
} from '@vybestack/llxprt-code-core';

/**
 * Callbacks for swapping recording infrastructure during resume.
 * Uses callback pattern instead of mutable fields for thread safety.
 */
export interface RecordingSwapCallbacks {
  getCurrentRecording: () => SessionRecordingService | null;
  getCurrentIntegration: () => RecordingIntegration | null;
  getCurrentLockHandle: () => LockHandle | null;
  setRecording: (
    recording: SessionRecordingService,
    integration: RecordingIntegration,
    lock: LockHandle | null,
    metadata: SessionMetadata,
  ) => void;
}

/**
 * Context required for performing a session resume.
 */
export interface ResumeContext {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  recordingCallbacks: RecordingSwapCallbacks;
  logger?: DebugLogger;
}

/**
 * Discriminated union result for performResume.
 * Success returns history and metadata; failure returns error string.
 */
export type PerformResumeResult =
  | {
      ok: true;
      history: IContent[];
      metadata: SessionMetadata;
      warnings: string[];
    }
  | { ok: false; error: string };

/**
 * Performs session resume with all side effects.
 *
 * Resolves the session reference (ID, prefix, index, or "latest"),
 * acquires the target session, swaps recording infrastructure,
 * and returns the result.
 *
 * @param sessionRef - Session reference (ID, prefix, index number, or "latest")
 * @param context - Resume context with chatsDir, projectHash, and recording callbacks
 * @returns Promise resolving to success with history/metadata or failure with error
 */
export async function performResume(
  sessionRef: string,
  context: ResumeContext,
): Promise<PerformResumeResult> {
  const {
    chatsDir,
    projectHash,
    currentSessionId,
    recordingCallbacks,
    logger,
  } = context;

  // 1. List all sessions
  const sessions = await SessionDiscovery.listSessions(chatsDir, projectHash);

  // 2. Resolve session reference
  let targetSession: SessionSummary | undefined;

  if (sessionRef === 'latest') {
    // Find newest non-locked, non-current, non-empty session
    for (const session of sessions) {
      if (session.sessionId === currentSessionId) continue;
      if (await SessionLockManager.isLocked(chatsDir, session.sessionId))
        continue;
      if (!(await SessionDiscovery.hasContentEvents(session.filePath)))
        continue;
      targetSession = session;
      break;
    }
    if (!targetSession) {
      return {
        ok: false,
        error: 'No resumable sessions found (all locked, empty, or current).',
      };
    }
  } else {
    // Resolve by ID, prefix, or index
    const resolved = SessionDiscovery.resolveSessionRef(sessionRef, sessions);
    if ('error' in resolved) {
      return { ok: false, error: resolved.error };
    }
    targetSession = resolved.session;
  }

  // 3. Check same-session
  if (targetSession.sessionId === currentSessionId) {
    return { ok: false, error: 'That session is already active.' };
  }

  // 4. Check locked
  if (await SessionLockManager.isLocked(chatsDir, targetSession.sessionId)) {
    return {
      ok: false,
      error: `Session ${targetSession.sessionId} is in use by another process.`,
    };
  }

  // 5. Phase 1: Acquire new session (before disposing old)
  const resumeResult = await resumeSession({
    continueRef: targetSession.sessionId,
    projectHash,
    chatsDir,
    currentProvider: context.currentProvider,
    currentModel: context.currentModel,
    workspaceDirs: context.workspaceDirs,
  });

  if (resumeResult.ok === false) {
    return { ok: false, error: resumeResult.error };
  }

  // 6. Phase 2: Dispose old infrastructure (ordered)
  const oldIntegration = recordingCallbacks.getCurrentIntegration();
  const oldRecording = recordingCallbacks.getCurrentRecording();
  const oldLock = recordingCallbacks.getCurrentLockHandle();

  // Dispose in order: integration -> recording -> lock
  if (oldIntegration) {
    oldIntegration.dispose();
  }
  if (oldRecording) {
    await oldRecording.dispose();
  }
  if (oldLock) {
    try {
      await oldLock.release();
    } catch (e) {
      logger?.warn(`Failed to release old session lock (continuing): ${e}`);
    }
  }

  // 7. Create new integration and metadata
  const newRecording = resumeResult.recording;
  const newLock = resumeResult.lockHandle;
  const newIntegration = new RecordingIntegration(newRecording);

  // 8. Install new infrastructure
  recordingCallbacks.setRecording(
    newRecording,
    newIntegration,
    newLock,
    resumeResult.metadata,
  );

  // 9. Return success
  return {
    ok: true,
    history: resumeResult.history,
    metadata: resumeResult.metadata,
    warnings: resumeResult.warnings ?? [],
  };
}
