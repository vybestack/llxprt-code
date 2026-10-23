/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SessionLockManager,
  SessionPersistenceService,
  createLockedSessionRecorder,
  type LocalMediaStore,
  type SessionPersistenceServiceOptions,
  type SessionRecordingPort,
  type SessionRecordingServiceConfig,
} from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isJsonlRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';

export function requireActiveRecording(
  recording: SessionRecordingPort | null,
): SessionRecordingPort {
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
export async function persistSemanticMediaPurge(
  recording: SessionRecordingPort,
  candidate: SemanticPurgeRowSource,
  frontier: SemanticMediaPurgeFrontier,
): Promise<void> {
  if (isJsonlRecorder(recording)) {
    await recording.recordSemanticMediaPurgeRows(
      candidate.streamRows(),
      frontier,
      { requireLiveFold: true },
    );
  }
  await recording.flush();
  if (!recording.isActive()) {
    throw new Error('Semantic media purge recording did not remain active');
  }
}

export async function restoreRecordedHistory(
  recording: SessionRecordingPort,
  removedHistory: readonly IContent[],
): Promise<void> {
  if (isJsonlRecorder(recording)) {
    for (const content of removedHistory) recording.recordContent(content);
  }
  await recording.flush();
  if (!recording.isActive()) {
    throw new Error('Recording failed during history rollback');
  }
}

export async function restartRecording(
  config: SessionRecordingServiceConfig,
  filePath: string | null,
): Promise<SessionRecordingPort> {
  if (filePath !== null) {
    const lock = await SessionLockManager.acquire(
      config.chatsDir,
      config.sessionId,
    );
    try {
      const recording = await JournalRecordingService.open(config, filePath);
      recording.adoptLock(lock);
      return recording;
    } catch (error) {
      await lock.release();
      throw error;
    }
  }
  return createLockedSessionRecorder(config);
}
