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
import type { SessionControlDeps } from './sessionControl.js';
import {
  cleanupSessionResources,
  captureRollbackFailure,
} from './sessionControlRollback.js';

export async function adoptSessionResume(
  deps: SessionControlDeps,
  result: ResumeResult,
  prior: {
    integration: RecordingIntegration | null;
    recording: SessionRecordingService | null;
    lock: LockHandle | null;
  },
  publish: (integration: RecordingIntegration) => void,
  discardOnFailure = false,
): Promise<void> {
  const client = deps.resolveClient();
  const priorRecording = deps.config.getSessionRecordingService();
  const integration = new RecordingIntegration(
    result.recording,
    deps.config.createSessionPersistenceService(
      result.recording.getSessionId(),
    ),
  );
  try {
    if (client.getHistoryService() === null) await client.resumeChat([]);
    const history = client.getHistoryService();
    if (history === null)
      throw new Error(
        'History service unavailable after resume initialization',
      );
    await history.adoptResumeBoot(result.recording, result.boot, async () => {
      await integration.subscribeToJournal(history);
      deps.config.setSessionRecordingService(result.recording);
      publish(integration);
    });
  } catch (error) {
    const filePath = discardOnFailure ? result.recording.getFilePath() : null;
    const failures = await cleanupSessionResources(
      integration,
      result.recording,
      result.lockHandle,
    );
    await captureRollbackFailure(failures, () =>
      deps.config.setSessionRecordingService(priorRecording),
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
): Promise<ResumeResult> {
  const result = await resumeSession({
    continueRef: target === 'latest' ? CONTINUE_LATEST : target,
    projectHash,
    chatsDir: deps.config.storage.getProjectChatsDir(),
    currentProvider: deps.getProvider(),
    currentModel: deps.getModel(),
    workspaceDirs: [...deps.config.getWorkspaceContext().getDirectories()],
    mediaStore: deps.config.getLocalMediaStore(),
    maxQueueBytes: deps.config.getSessionRecordingQueueByteLimit(),
  });
  if (!result.ok) throw new Error(`Failed to resume session: ${result.error}`);
  return result;
}
