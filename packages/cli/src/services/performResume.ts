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
  SessionTransitionService,
  resumeSession,
  RecordingIntegration,
  type ContinueTarget,
  type IContent,
  type SessionRecordingService,
  type LockHandle,
  type SessionMetadata,
  type SessionSummary,
  type HistoryService,
} from '@vybestack/llxprt-code-core';
import { type DebugLogger } from '@vybestack/llxprt-code-telemetry';

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
  historyService?: HistoryService | null;
  adoptSessionId?: (sessionId: string) => void;
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
 * Checks whether a session can be resumed, preserving the original short-circuit order.
 */
async function isResumableSession(
  session: SessionSummary,
  chatsDir: string,
  currentSessionId: string,
): Promise<boolean> {
  if (session.sessionId === currentSessionId) {
    return false;
  }

  const isLocked = await SessionLockManager.isLocked(
    chatsDir,
    session.sessionId,
  );
  if (isLocked) {
    return false;
  }

  return SessionDiscovery.hasContentEvents(session.filePath);
}

/**
 * Finds the first resumable session (non-locked, non-current, non-empty).
 * Extracted to reduce break statements in loop.
 */
async function findResumableSession(
  sessions: SessionSummary[],
  chatsDir: string,
  currentSessionId: string,
): Promise<SessionSummary | undefined> {
  for (const session of sessions) {
    if (await isResumableSession(session, chatsDir, currentSessionId)) {
      return session;
    }
  }
  return undefined;
}

async function resumeCheckpointTarget(
  target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
  context: ResumeContext,
): Promise<PerformResumeResult> {
  const { chatsDir, projectHash, recordingCallbacks } = context;
  const currentRecording = recordingCallbacks.getCurrentRecording();
  if (currentRecording?.getSessionId() === target.source.sessionId) {
    await currentRecording.flush();
  }
  const fork = await new SessionTransitionService().forkFromCheckpoint(
    target,
    chatsDir,
    projectHash,
    context.currentProvider,
    context.currentModel,
    context.workspaceDirs,
    currentRecording,
  );
  if (!fork.ok) return fork;
  const committed = await commitPreparedTransition(
    fork.recording,
    fork.lockHandle,
    fork.metadata,
    fork.history,
    context,
    true,
  );
  if (!committed.ok) return committed;
  return {
    ok: true,
    history: fork.history,
    metadata: fork.metadata,
    warnings: [],
  };
}

async function resumeLivingSession(
  target: Extract<ContinueTarget, { kind: 'session' }>,
  context: ResumeContext,
): Promise<PerformResumeResult> {
  const { chatsDir, projectHash, currentSessionId } = context;
  if (target.session.sessionId === currentSessionId) {
    return { ok: false, error: 'That session is already active.' };
  }
  if (await SessionLockManager.isLocked(chatsDir, target.session.sessionId)) {
    return {
      ok: false,
      error: `Session ${target.session.sessionId} is in use by another process.`,
    };
  }
  const result = await resumeSession({
    continueRef: target.session.sessionId,
    projectHash,
    chatsDir,
    currentProvider: context.currentProvider,
    currentModel: context.currentModel,
    workspaceDirs: context.workspaceDirs,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const committed = await commitPreparedTransition(
    result.recording,
    result.lockHandle,
    result.metadata,
    result.history,
    context,
    false,
  );
  if (!committed.ok) return committed;
  return {
    ok: true,
    history: result.history,
    metadata: result.metadata,
    warnings: result.warnings,
  };
}

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
  const { chatsDir, projectHash, currentSessionId } = context;

  const targets = await SessionDiscovery.listContinueTargets(
    chatsDir,
    projectHash,
  );
  const target = await resolveTarget(
    sessionRef,
    targets,
    chatsDir,
    currentSessionId,
  );
  if (!target) {
    return {
      ok: false,
      error: 'No resumable sessions found (all locked, empty, or current).',
    };
  }
  if (target instanceof Error) {
    return { ok: false, error: target.message };
  }

  return target.kind === 'checkpoint'
    ? resumeCheckpointTarget(target, context)
    : resumeLivingSession(target, context);
}

async function resolveTarget(
  sessionRef: string,
  targets: ContinueTarget[],
  chatsDir: string,
  currentSessionId: string,
): Promise<ContinueTarget | Error | null> {
  const sessions = targets
    .filter(
      (target): target is Extract<ContinueTarget, { kind: 'session' }> =>
        target.kind === 'session',
    )
    .map((target) => target.session);
  if (sessionRef === 'latest') {
    const session = await findResumableSession(
      sessions,
      chatsDir,
      currentSessionId,
    );
    return session ? { kind: 'session', session } : null;
  }
  const resolved = SessionDiscovery.resolveContinueRef(sessionRef, targets);
  if ('error' in resolved) {
    return new Error(resolved.error);
  }

  return resolved.target;
}

function restorePreviousHistory(
  historyService: HistoryService,
  previousHistory: IContent[] | null,
): void {
  if (previousHistory === null) return;
  try {
    historyService.clear();
    historyService.addAll(previousHistory);
  } catch {
    void 0;
  }
}

async function commitPreparedTransition(
  recording: SessionRecordingService,
  lockHandle: LockHandle,
  metadata: SessionMetadata,
  history: IContent[],
  context: ResumeContext,
  discardOnFailure: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const callbacks = context.recordingCallbacks;
  const oldRecording = callbacks.getCurrentRecording();
  const oldIntegration = callbacks.getCurrentIntegration();
  const oldLock = callbacks.getCurrentLockHandle();
  const historyService = context.historyService ?? null;
  const previousHistory =
    historyService === null ? null : [...historyService.getAll()];
  const integration = new RecordingIntegration(recording);
  oldIntegration?.unsubscribeFromHistory();
  try {
    if (historyService !== null) {
      historyService.clear();
      historyService.addAll(history);
      integration.subscribeToHistory(historyService);
    }
    context.adoptSessionId?.(metadata.sessionId);
    callbacks.setRecording(recording, integration, lockHandle, metadata);
  } catch (error: unknown) {
    integration.dispose();
    if (historyService !== null) {
      restorePreviousHistory(historyService, previousHistory);
      try {
        oldIntegration?.subscribeToHistory(historyService);
      } catch {
        void 0;
      }
    }
    context.adoptSessionId?.(context.currentSessionId);
    const filePath = discardOnFailure ? recording.getFilePath() : null;
    await recording.dispose().catch(() => undefined);
    await lockHandle.release().catch(() => undefined);
    if (filePath !== null) {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath).catch(() => undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Failed to commit session transition: ${detail}`,
    };
  }
  await disposeInfrastructure(
    oldIntegration,
    oldRecording,
    oldLock,
    context.logger,
  );
  return { ok: true };
}

async function disposeInfrastructure(
  oldIntegration: RecordingIntegration | null,
  oldRecording: SessionRecordingService | null,
  oldLock: LockHandle | null,
  logger?: DebugLogger,
): Promise<void> {
  if (oldIntegration) {
    try {
      oldIntegration.dispose();
    } catch (e) {
      logger?.warn(
        `Failed to dispose old recording integration (continuing): ${e}`,
      );
    }
  }
  if (oldRecording) {
    try {
      await oldRecording.dispose();
    } catch (e) {
      logger?.warn(
        `Failed to dispose old recording service (continuing): ${e}`,
      );
    }
  }
  if (oldLock) {
    try {
      await oldLock.release();
    } catch (e) {
      logger?.warn(`Failed to release old session lock (continuing): ${e}`);
    }
  }
}
