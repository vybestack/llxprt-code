/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCheckpointService,
  SessionDiscovery,
  SessionLockManager,
  deleteSession,
  type ContinueTarget,
  type UnreadableRecording,
  type LocalMediaStore,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
export type BrowserListing = {
  readonly targets: readonly ContinueTarget[];
  readonly skippedCount: number;
  readonly unreadableRecordings: readonly UnreadableRecording[];
  readonly currentSessionId: string;
};
export type BrowserCatalogReader = () => Promise<BrowserListing>;
export type BrowserTargetDeleter = (target: ContinueTarget) => Promise<void>;
export function bindOwnerBrowserCatalog(
  list: () => Promise<{
    readonly targets: readonly ContinueTarget[];
    readonly unreadableRecordings: readonly UnreadableRecording[];
  }>,
  readRecordingPath: () => string | undefined,
  readFallbackId: () => string,
): BrowserCatalogReader {
  return async () => {
    const result = await list();
    const path = readRecordingPath();
    const current = result.targets.find(
      (target) => target.kind === 'session' && target.session.filePath === path,
    );
    return {
      ...result,
      skippedCount: result.unreadableRecordings.length,
      currentSessionId:
        current?.kind === 'session'
          ? current.session.sessionId
          : readFallbackId(),
    };
  };
}
export function bindRawBrowserCatalog(
  chatsDir: string,
  projectHash: string,
  readCurrentId: () => string,
  mediaStore: LocalMediaStore | undefined,
): BrowserCatalogReader {
  return async () => ({
    ...(await SessionDiscovery.listContinueTargetsDetailed(
      chatsDir,
      projectHash,
      mediaStore,
    )),
    currentSessionId: readCurrentId(),
  });
}
export function bindRawBrowserTargetDelete(
  chatsDir: string,
  projectHash: string,
  readRecording: () => SessionRecordingPort | null,
): BrowserTargetDeleter {
  return async (target) => {
    if (target.kind === 'checkpoint') {
      const recording = readRecording();
      const checkpoints = createCheckpointService();
      if (recording?.getSessionId() === target.source.sessionId) {
        await checkpoints.deleteCheckpoint(
          recording,
          projectHash,
          target.checkpointId,
        );
      } else {
        await checkpoints.deleteCheckpointClosed(
          target.source.filePath,
          projectHash,
          chatsDir,
          target.source.sessionId,
          target.checkpointId,
        );
      }
      return;
    }
    if (await SessionLockManager.isLocked(chatsDir, target.session.sessionId))
      throw new Error('Cannot delete: session is in use');
    const result = await deleteSession(
      target.session.sessionId,
      chatsDir,
      projectHash,
    );
    if (!result.ok) throw new Error(result.error);
  };
}
