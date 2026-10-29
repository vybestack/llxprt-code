import {
  performResume,
  type ResumeContext,
  type PerformResumeResult,
} from './services/performResume.js';
import type { PerformResumeActionReturn } from './ui/commands/types.js';
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
  getProjectHash,
  importSessionMediaPackage,
  type ContinueTarget,
  type SessionRecordingPort,
  type JournalReadCounters,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';

export interface CliSessionPersistencePort {
  listBrowserTargetsDetailed: CliSessionPersistence['listBrowserTargetsDetailed'];
  resumeRecording: CliSessionPersistence['resumeRecording'];
  createCheckpoint: CliSessionPersistence['createCheckpoint'];
  deleteBrowserTarget: CliSessionPersistence['deleteBrowserTarget'];
  renameCheckpoint: CliSessionPersistence['renameCheckpoint'];
  nameSession: CliSessionPersistence['nameSession'];
}

export class CliSessionPersistence implements CliSessionPersistencePort {
  private closed = false;

  constructor(
    private readonly paths: {
      readonly projectRoot: string;
      readonly chatsDir: string;
    },
    private readonly options: {
      readonly mediaStore?: LocalMediaStore;
      readonly maxQueueBytes?: number;
      readonly counters?: JournalReadCounters;
    },
  ) {}

  get mediaStore(): LocalMediaStore | undefined {
    if (this.closed) throw new Error('CLI session persistence is closed');
    return this.options.mediaStore;
  }

  readonly resumeRecording = async (
    action: PerformResumeActionReturn,
    context: Omit<ResumeContext, 'mediaStore'>,
    resume: typeof performResume = performResume,
  ): Promise<PerformResumeResult> => {
    this.assertOpen();
    const mediaStore = this.options.mediaStore;
    if (!mediaStore) throw new Error('CLI session media store is unavailable');
    const ownedContext: ResumeContext = {
      ...context,
      mediaStore,
      maxQueueBytes: this.options.maxQueueBytes,
      counters: this.options.counters,
    };
    if (action.sessionPackage === undefined)
      return resume(action.sessionRef, ownedContext);
    return importSessionMediaPackage(
      action.sessionPackage,
      context.chatsDir,
      context.projectHash,
      mediaStore,
      async (imported) => {
        const result = await resume(imported.sessionId, ownedContext);
        if (!result.ok) throw new Error(result.error);
        return result;
      },
    );
  };

  readonly listBrowserTargetsDetailed = () => {
    this.assertOpen();
    return SessionDiscovery.listContinueTargetsDetailed(
      this.paths.chatsDir,
      getProjectHash(this.paths.projectRoot),
      this.options.mediaStore,
    );
  };

  readonly createCheckpoint = async (
    recording: SessionRecordingPort,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    await createCheckpointService().createCheckpoint(
      recording,
      recording.getProjectHash(),
      name,
      overwrite,
    );
  };

  readonly deleteBrowserTarget = async (
    target: ContinueTarget,
    recording: SessionRecordingPort | null,
  ): Promise<void> => {
    this.assertOpen();
    if (target.kind === 'checkpoint') {
      const checkpoints = createCheckpointService();
      if (recording?.getSessionId() === target.source.sessionId) {
        await checkpoints.deleteCheckpoint(
          recording,
          target.source.projectHash,
          target.checkpointId,
        );
      } else {
        await checkpoints.deleteCheckpointClosed(
          target.source.filePath,
          target.source.projectHash,
          this.paths.chatsDir,
          target.source.sessionId,
          target.checkpointId,
        );
      }
      return;
    }
    if (
      await SessionLockManager.isLocked(
        this.paths.chatsDir,
        target.session.sessionId,
      )
    )
      throw new Error('Cannot delete: session is in use');
    const result = await deleteSession(
      target.session.sessionId,
      this.paths.chatsDir,
      getProjectHash(this.paths.projectRoot),
    );
    if (!result.ok) throw new Error(result.error);
  };

  readonly renameCheckpoint = async (
    recording: SessionRecordingPort | null,
    target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    const checkpoints = createCheckpointService();
    if (recording?.getSessionId() === target.source.sessionId) {
      await checkpoints.renameCheckpoint(
        recording,
        target.source.projectHash,
        target.checkpointId,
        name,
        overwrite,
      );
    } else {
      await checkpoints.renameCheckpointClosed(
        target.source.filePath,
        target.source.projectHash,
        this.paths.chatsDir,
        target.source.sessionId,
        target.checkpointId,
        name,
        overwrite,
      );
    }
  };

  readonly nameSession = async (
    recording: SessionRecordingPort,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    await createCheckpointService().setSessionName(
      recording,
      recording.getProjectHash(),
      name,
      overwrite,
    );
  };

  private assertOpen(): void {
    if (this.closed) throw new Error('CLI session persistence is closed');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
  }
}
