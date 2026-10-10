/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SessionDiscovery,
  describeUnreadableRecording,
  exportSessionMediaPackage,
  matchUnreadableRecordings,
  type ContinueTarget,
  type UnreadableRecording,
  type RecordingIntegration,
  type SessionRecordingService,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';

export async function exportRecordedSession(
  ref: string,
  destination: string,
  listing: {
    targets: ContinueTarget[];
    unreadableRecordings: readonly UnreadableRecording[];
  },
  projectHash: string,
  mediaStore: LocalMediaStore,
  recording: SessionRecordingService | null,
  integration: RecordingIntegration | null,
): Promise<void> {
  const resolved = SessionDiscovery.resolveContinueRef(ref, listing.targets);
  if ('error' in resolved) {
    const named = matchUnreadableRecordings(
      ref,
      resolved.error,
      listing.unreadableRecordings,
    );
    throw new Error(
      named.length === 0
        ? resolved.error
        : `${resolved.error} (unreadable recording skipped: ${named.map(describeUnreadableRecording).join('; ')})`,
    );
  }
  const source =
    resolved.target.kind === 'session'
      ? resolved.target.session
      : resolved.target.source;
  if (recording?.getSessionId() === source.sessionId) {
    if (integration !== null) await integration.flushAtTurnBoundary();
    await recording.flush();
  }
  await exportSessionMediaPackage(
    source.filePath,
    projectHash,
    mediaStore,
    destination,
  );
}
