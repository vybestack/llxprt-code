/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rm } from 'node:fs/promises';
import {
  RecordingIntegration,
  resumeSession,
  CONTINUE_LATEST,
  type ResumeResult,
  type LockHandle,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentSessionControl } from '../agent.js';
import type { SessionControlDeps } from './sessionControl.js';
import { warnSkippedRecordings } from './skippedRecordings.js';
import {
  adoptRecordingSessionId,
  cleanupSessionResources,
  cleanupPreviousSession,
  captureRollbackFailure,
  restoreConfigSessionId,
} from './sessionControlRollback.js';

async function rollbackAdoptedSession(
  deps: SessionControlDeps,
  result: ResumeResult,
  integration: RecordingIntegration,
  priorSessionId: string,
  adoptionAttempted: boolean,
  discardOnFailure: boolean,
): Promise<unknown[]> {
  const filePath = discardOnFailure ? result.recording.getFilePath() : null;
  const failures = await cleanupSessionResources(
    integration,
    result.recording,
    result.lockHandle,
  );
  await restoreConfigSessionId(
    deps.readOwnedSessionId,
    deps.adoptOwnedSessionId,
    deps.sessionIdentityOwnership,
    priorSessionId,
    adoptionAttempted,
    failures,
  );
  if (filePath !== null)
    await captureRollbackFailure(failures, () => rm(filePath, { force: true }));
  return failures;
}

export async function adoptSessionResume(
  deps: SessionControlDeps,
  result: ResumeResult,
  prior: {
    integration: RecordingIntegration | null;
    recording: SessionRecordingPort | null;
    lock: LockHandle | null;
    sessionId: string;
  },
  publish: (integration: RecordingIntegration) => () => void,
  owner: object,
  discardOnFailure = false,
  options?: Parameters<AgentSessionControl['resume']>[1],
): Promise<void> {
  const client = deps.nativeHistory;
  const integration = new RecordingIntegration(result.recording);
  let adoptionAttempted = false;
  const replacement = { attempted: false, completed: false };
  let restorePublication: (() => void) | undefined;
  try {
    if (client.getHistoryService() === null) await client.resumeChat([]);
    const history = client.getHistoryService();
    if (history === null)
      throw new Error(
        'History service unavailable after resume initialization',
      );
    replacement.attempted = true;
    await history.adoptResumeBoot(result.recording, result.boot, async () => {
      replacement.completed = true;
      await integration.subscribeToJournal(history, owner);
      adoptRecordingSessionId(
        deps.readOwnedSessionId,
        deps.adoptOwnedSessionId,
        deps.sessionIdentityOwnership,
        prior.sessionId,
        result.recording,
        () => {
          adoptionAttempted = true;
        },
      );
      restorePublication = publish(integration);
    });
  } catch (error) {
    restorePublication?.();
    const failures = await rollbackAdoptedSession(
      deps,
      result,
      integration,
      prior.sessionId,
      adoptionAttempted,
      discardOnFailure,
    );
    if (
      options?.startup === true &&
      replacement.attempted &&
      !replacement.completed &&
      failures.length === 0
    ) {
      options.onStartupRestoreFailure?.(
        result.recording.getSessionId(),
        error instanceof Error ? error.message : String(error),
      );
    }
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'Session adoption and cleanup failed',
      );
    throw error;
  }
  await client.discardDeferredHistory();
  await cleanupPreviousSession(prior.integration, prior.recording, prior.lock);
}

export async function openSessionResume(
  deps: SessionControlDeps,
  target: string,
  projectHash: string,
  logger: DebugLogger,
): Promise<ResumeResult> {
  const result = await resumeSession({
    continueRef: target === 'latest' ? CONTINUE_LATEST : target,
    projectHash,
    chatsDir: deps.paths.projectChatsDir,
    currentProvider: deps.getProvider(),
    currentModel: deps.getModel(),
    workspaceDirs: [...deps.directories()],
    mediaStore: deps.mediaStore,
    maxQueueBytes: deps.readRecordingQueueLimit(),
  });
  warnSkippedRecordings(logger, result.skippedRecordings ?? []);
  if (!result.ok) throw new Error(`Failed to resume session: ${result.error}`);
  return result;
}
