import { replayOwnerRecording } from './recordedHistoryPersistence.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  replaySession,
  deleteSession as deleteRecordedSession,
  SessionDiscovery,
  type ReplayResult,
  type ContinueTarget,
  type SessionSummary,
  type SessionRecordingService,
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

export function resolveCheckpointTarget(
  ref: string,
  targets: readonly ContinueTarget[],
): Extract<ContinueTarget, { kind: 'checkpoint' }> {
  const exact = targets.filter(
    (target): target is Extract<ContinueTarget, { kind: 'checkpoint' }> =>
      target.kind === 'checkpoint' &&
      (target.checkpointId === ref || target.checkpointName === ref),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1)
    throw new Error(`Ambiguous checkpoint reference '${ref}'`);
  throw new Error(`Checkpoint '${ref}' not found`);
}

export async function currentSessionInfo(
  recording: SessionRecordingService,
  targets: readonly ContinueTarget[],
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<SessionInfo> {
  const target = targets.find(
    (candidate) =>
      candidate.kind === 'session' &&
      candidate.session.sessionId === recording.getSessionId(),
  );
  if (target?.kind === 'session')
    return readSessionInfo(target.session, projectHash, mediaStore);
  const replay = await replayOwnerRecording(
    recording.getFilePath(),
    projectHash,
    mediaStore,
  );
  return sessionInfoFromReplay(
    recording.getSessionId(),
    replay,
    new Date().toISOString(),
  );
}

export async function deleteDiscoveredSession(
  ref: string,
  targets: readonly ContinueTarget[],
  activeSessionId: string | undefined,
  chatsDir: string,
  projectHash: string,
): Promise<void> {
  const resolved = SessionDiscovery.resolveContinueRef(ref, targets);
  if ('error' in resolved) throw new Error(resolved.error);
  if (resolved.target.kind !== 'session') {
    throw new Error(`Continue target '${ref}' is not a session`);
  }
  if (activeSessionId === resolved.target.session.sessionId) {
    throw new Error('Cannot delete the active session');
  }
  const result = await deleteRecordedSession(
    resolved.target.session.sessionId,
    chatsDir,
    projectHash,
  );

  if (!result.ok) throw new Error(result.error);
}

export function readRecordingState(
  recording: SessionRecordingService | null,
  format: 'jsonl',
): SessionRecordingState {
  return recordingStateFromSnapshot(
    recording?.isActive() ?? false,
    recording?.getFilePath() ?? null,
    format,
  );
}
