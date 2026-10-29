/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalSessionOptions } from '../services/history/journalSession.js';
import { requireJournalRecorder } from '../services/history/recorderBackend.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import type { LockHandle } from './SessionLockManager.js';
import type { JournalReadCounters } from './journalCounters.js';
import { forkJournalFromCheckpoint } from './journalFork.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { ResumeBootHandle } from './resumeSession.js';
import type { ContinueTarget, SessionMetadata } from './types.js';

export type { ContinueTarget } from './types.js';

export interface ForkResult {
  ok: true;
  recording: SessionRecordingPort;
  lockHandle: LockHandle;
  boot: ResumeBootHandle;
  metadata: SessionMetadata;
}

export interface ForkError {
  ok: false;
  error: string;
}

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;

export interface SessionTransitionServiceOptions {
  readonly mediaStore?: LocalMediaStore;
  readonly maxQueueBytes?: number;
  readonly counters?: JournalReadCounters;
  readonly journal?: JournalSessionOptions;
}

export class SessionTransitionService {
  constructor(private readonly options: SessionTransitionServiceOptions = {}) {}

  async forkFromCheckpoint(
    target: CheckpointTarget,
    chatsDir: string,
    projectHash: string,
    currentProvider: string,
    currentModel: string,
    workspaceDirs: string[],
    activeSource?: SessionRecordingPort | null,
  ): Promise<ForkResult | ForkError> {
    return forkJournalFromCheckpoint({
      mediaStore: this.options.mediaStore,
      target,
      chatsDir,
      projectHash,
      currentProvider,
      currentModel,
      workspaceDirs,
      ...(activeSource
        ? { activeSource: requireJournalRecorder(activeSource) }
        : {}),
      ...(this.options.journal ? { journal: this.options.journal } : {}),
    });
  }
}
