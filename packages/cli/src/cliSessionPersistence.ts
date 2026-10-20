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
  SessionPersistenceService,
  CheckpointService,
  SessionDiscovery,
  SessionLockManager,
  deleteSession,
  getProjectHash,
  importSessionMediaPackage,
  type ContinueTarget,
  type SessionRecordingService,
  type SessionPersistenceServiceOptions,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';

export interface CliSessionPersistencePort {
  forRecording(sessionId: string): SessionPersistenceService;
  listBrowserTargetsDetailed: CliSessionPersistence['listBrowserTargetsDetailed'];
  resumeRecording: CliSessionPersistence['resumeRecording'];
  createCheckpoint: CliSessionPersistence['createCheckpoint'];
  deleteBrowserTarget: CliSessionPersistence['deleteBrowserTarget'];
  renameCheckpoint: CliSessionPersistence['renameCheckpoint'];
  nameSession: CliSessionPersistence['nameSession'];
}

export class CliSessionPersistence implements CliSessionPersistencePort {
  private readonly journals = new Map<string, SessionPersistenceService>();
  private closed = false;

  constructor(
    private readonly paths: {
      readonly projectRoot: string;
      readonly chatsDir: string;
    },
    private readonly options: SessionPersistenceServiceOptions,
  ) {}

  get mediaStore(): LocalMediaStore | undefined {
    if (this.closed) throw new Error('CLI session persistence is closed');
    return this.options.mediaStore;
  }

  forRecording(sessionId: string): SessionPersistenceService {
    if (this.closed) throw new Error('CLI session persistence is closed');
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

  readonly resumeRecording = async (
    action: PerformResumeActionReturn,
    context: Omit<ResumeContext, 'mediaStore' | 'persistenceFactory'>,
    resume: typeof performResume = performResume,
  ): Promise<PerformResumeResult> => {
    this.assertOpen();
    const mediaStore = this.options.mediaStore;
    if (!mediaStore) throw new Error('CLI session media store is unavailable');
    const ownedContext: ResumeContext = {
      ...context,
      mediaStore,
      persistenceFactory: (id) => this.forRecording(id),
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
    recording: SessionRecordingService,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    await new CheckpointService(this.options.mediaStore).createCheckpoint(
      recording,
      recording.getProjectHash(),
      name,
      overwrite,
    );
  };

  readonly deleteBrowserTarget = async (
    target: ContinueTarget,
    recording: SessionRecordingService | null,
  ): Promise<void> => {
    this.assertOpen();
    if (target.kind === 'checkpoint') {
      const checkpoints = new CheckpointService(this.options.mediaStore);
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
    recording: SessionRecordingService | null,
    target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    const checkpoints = new CheckpointService(this.options.mediaStore);
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
    recording: SessionRecordingService,
    name: string,
    overwrite: boolean,
  ): Promise<void> => {
    this.assertOpen();
    await new CheckpointService(this.options.mediaStore).setSessionName(
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
    this.journals.clear();
  }
}
