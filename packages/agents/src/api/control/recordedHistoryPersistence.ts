/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SessionPersistenceService,
  replaySession,
  type ReplayResult,
  type LocalMediaStore,
  type SessionPersistenceServiceOptions,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';

export function requireActiveRecording(
  recording: SessionRecordingService | null,
): SessionRecordingService {
  if (recording?.isActive() !== true) throw new Error('No active recording');
  return recording;
}

export function createAgentSessionPersistence(
  projectRoot: string,
  chatsDir: string,
  mediaStore: LocalMediaStore,
  maxQueueBytes: number,
): AgentSessionPersistence {
  return new AgentSessionPersistence(
    { projectRoot, chatsDir },
    { mediaStore, maxQueueBytes },
  );
}

export class AgentSessionPersistence {
  private readonly journals = new Map<string, SessionPersistenceService>();
  private closed = false;

  constructor(
    private readonly paths: {
      readonly projectRoot: string;
      readonly chatsDir: string;
    },
    private readonly options: SessionPersistenceServiceOptions,
  ) {}

  forRecording(sessionId: string): SessionPersistenceService {
    if (this.closed) throw new Error('Agent session persistence is closed');
    let journal = this.journals.get(sessionId);
    if (journal === undefined) {
      journal = new SessionPersistenceService(
        this.paths,
        sessionId,
        this.options,
      );
      this.journals.set(sessionId, journal);
    }
    return journal;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.journals.clear();
  }
}
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
export async function persistSemanticMediaPurge(
  recording: SessionRecordingService,
  candidate: SemanticPurgeRowSource,
  frontier: SemanticMediaPurgeFrontier,
): Promise<void> {
  await recording.recordSemanticMediaPurgeRows(
    candidate.streamRows(),
    frontier,
    { requireLiveFold: true },
  );
  await recording.flush();
  if (!recording.isActive()) {
    throw new Error('Semantic media purge recording did not remain active');
  }
}

export async function restoreRecordedHistory(
  recording: SessionRecordingService,
  removedHistory: readonly IContent[],
): Promise<void> {
  for (const content of removedHistory) recording.recordContent(content);
  await recording.flush();
  if (!recording.isActive()) {
    throw new Error('Recording failed during history rollback');
  }
}

export async function replayOwnerRecording(
  filePath: string | null,
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<Extract<ReplayResult, { ok: true }>> {
  if (filePath === null) throw new Error('Recording is not materialized');
  const replay = await replaySession(filePath, projectHash, { mediaStore });
  if (!replay.ok) throw new Error(replay.error);
  return replay;
}

export async function restartRecording(
  recording: SessionRecordingService,
  filePath: string | null,
  mediaStore: LocalMediaStore,
): Promise<void> {
  if (filePath === null) return;
  const replay = await replayOwnerRecording(
    filePath,
    recording.getProjectHash(),
    mediaStore,
  );
  if (replay.sequenceCorrupt) {
    throw new Error('Cannot restart recording: non-monotonic sequences');
  }
  recording.initializeForResume(
    filePath,
    replay.lastSeq,
    replay.metadata.title,
  );
  recording.recordRewind(replay.history.length);
}
