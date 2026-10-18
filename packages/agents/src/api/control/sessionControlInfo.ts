/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  replaySession,
  type ReplayResult,
  type SessionSummary,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';
import type {
  CheckpointInfo,
  SessionInfo,
  SessionRecordingState,
} from '../agent.js';

export function sessionInfoFromReplay(
  id: string,
  replay: Extract<ReplayResult, { ok: true }>,
  modifiedAt: string,
): SessionInfo {
  return {
    id,
    name: replay.sessionName ?? null,
    title: replay.metadata.title,
    createdAt: replay.metadata.startTime,
    modifiedAt,
    ...(replay.ancestry === undefined
      ? {}
      : {
          parentSessionId: replay.ancestry.parentSessionId,
          parentSequence: replay.ancestry.parentSequence,
          checkpointId: replay.ancestry.checkpointId,
          checkpointName: replay.ancestry.checkpointName,
        }),
  };
}

export async function readSessionInfo(
  summary: SessionSummary,
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<SessionInfo> {
  const replay = await replaySession(summary.filePath, projectHash, {
    mediaStore,
  });
  if (!replay.ok) throw new Error(replay.error);
  return sessionInfoFromReplay(
    summary.sessionId,
    replay,
    summary.lastModified.toISOString(),
  );
}

export function checkpointInfoFromReplay(
  replay: Extract<ReplayResult, { ok: true }>,
  checkpointId: string,
  sessionId: string,
): CheckpointInfo {
  const checkpoint = replay.checkpoints?.find(
    (candidate) => candidate.checkpointId === checkpointId,
  );
  if (checkpoint === undefined)
    throw new Error('Created checkpoint was not durable');
  return {
    checkpointId: checkpoint.checkpointId,
    name: checkpoint.name,
    sessionId,
    sequence: checkpoint.sequence,
    createdAt: checkpoint.createdAt,
  };
}

export function recordingStateFromSnapshot(
  enabled: boolean,
  path: string | null,
  format: string,
): SessionRecordingState {
  return { enabled, format, ...(path !== null ? { path } : {}) };
}
