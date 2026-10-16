/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rm } from 'node:fs/promises';
import {
  RecordingIntegration,
  resumeSession,
  CONTINUE_LATEST,
  type ResumeResult,
  type LockHandle,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { SessionControlDeps } from './sessionControl.js';
import { warnSkippedRecordings } from './skippedRecordings.js';
import {
  adoptRecordingSessionId,
  cleanupSessionResources,
  captureRollbackFailure,
  restoreConfigSessionId,
} from './sessionControlRollback.js';

export async function adoptSessionResume(
  deps: SessionControlDeps,
  result: ResumeResult,
  prior: {
    integration: RecordingIntegration | null;
    recording: SessionRecordingService | null;
    lock: LockHandle | null;
    sessionId: string;
  },
  publish: (integration: RecordingIntegration) => void,
  owner: object,
  discardOnFailure = false,
): Promise<void> {
  const client = deps.resolveClient();
  const integration = new RecordingIntegration(
    result.recording,
    deps.persistence.forRecording(result.recording.getSessionId()),
  );
  let adoptionAttempted = false;
  try {
    if (client.getHistoryService() === null) await client.resumeChat([]);
    const history = client.getHistoryService();
    if (history === null)
      throw new Error(
        'History service unavailable after resume initialization',
      );
    await history.adoptResumeBoot(result.recording, result.boot, async () => {
      await integration.subscribeToJournal(history, owner);
      adoptRecordingSessionId(
        deps.config,
        deps.sessionIdentityOwnership,
        prior.sessionId,
        result.recording,
        () => {
          adoptionAttempted = true;
        },
      );
      publish(integration);
    });
  } catch (error) {
    const filePath = discardOnFailure ? result.recording.getFilePath() : null;
    const failures = await cleanupSessionResources(
      integration,
      result.recording,
      result.lockHandle,
    );
    await restoreConfigSessionId(
      deps.config,
      deps.sessionIdentityOwnership,
      prior.sessionId,
      adoptionAttempted,
      failures,
    );
    if (filePath !== null)
      await captureRollbackFailure(failures, () =>
        rm(filePath, { force: true }),
      );
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'Session adoption and cleanup failed',
      );
    throw error;
  }
  await client.discardDeferredHistory();
  const failures = await cleanupSessionResources(
    prior.integration,
    prior.recording,
    prior.lock,
  );
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Previous session cleanup failed after adoption',
    );
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
    chatsDir: deps.config.projectChatsDir,
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
