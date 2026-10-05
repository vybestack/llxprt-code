/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { scanResumeMetadata } from './resumeMetadata.js';
import { copyCheckpointRange } from './checkpointJournalTransfer.js';
import { JournalResolver } from './journalResolver.js';
import type { JournalReadCounters } from './journalCounters.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import type {
  CheckpointMetadataView,
  ContinueTarget,
  SessionMetadata,
} from './types.js';

export type { ContinueTarget } from './types.js';

export interface ForkResult {
  ok: true;
  recording: SessionRecordingService;
  lockHandle: LockHandle;
  boot: ResumeCursorBoot;
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
}

function failureDetail(error: unknown): string {
  if (error instanceof AggregateError)
    return error.errors.map(failureDetail).join('; ');
  return error instanceof Error ? error.message : String(error);
}

async function requireHistory(
  filePath: string,
  counters?: JournalReadCounters,
): Promise<void> {
  const resolver = await JournalResolver.open(filePath, { counters });
  try {
    if ((await resolver.countRows()) === 0)
      throw new Error('Checkpoint has no conversation history');
  } finally {
    await resolver.close();
  }
}

async function failedChild(
  error: unknown,
  cleanups: Array<() => Promise<unknown> | undefined>,
): Promise<ForkError> {
  const failures = [error];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (failure) {
      failures.push(failure);
    }
  }
  return {
    ok: false,
    error: `Failed to create child session: ${failures.map(failureDetail).join('; ')}`,
  };
}

async function releaseSource(
  sourceLock: LockHandle | undefined,
  result: ForkResult | ForkError,
): Promise<ForkResult | ForkError> {
  try {
    await sourceLock?.release();
    return result;
  } catch (error) {
    return failedChild(
      error,
      result.ok
        ? [
            () => result.recording.dispose(),
            () => result.lockHandle.release(),
            () => fs.rm(result.boot.filePath, { force: true }),
          ]
        : [],
    );
  }
}

async function prepareChild(
  target: CheckpointTarget,
  checkpoint: CheckpointMetadataView,
  watermark: number,
  chatsDir: string,
  metadata: SessionMetadata,
  options: SessionTransitionServiceOptions,
): Promise<ForkResult | ForkError> {
  const timestamp = metadata.startTime.slice(0, 19).replace(/:/g, '-');
  const filePath = join(
    chatsDir,
    `session-${timestamp}-${metadata.sessionId}.jsonl`,
  );
  let recording: SessionRecordingService | undefined;
  let lock: LockHandle | undefined;
  let boot: ResumeCursorBoot | undefined;
  let created = false;
  try {
    lock = await SessionLockManager.acquire(chatsDir, metadata.sessionId);
    const file = await fs.open(filePath, 'wx');
    created = true;
    try {
      await file.writeFile(
        `${JSON.stringify({ v: 1, seq: 0, ts: metadata.startTime, type: 'session_start', payload: metadata })}\n`,
      );
    } finally {
      await file.close();
    }
    await copyCheckpointRange(
      target.source.filePath,
      filePath,
      watermark,
      checkpoint.sequence,
      options.counters,
    );
    await requireHistory(filePath, options.counters);
    recording = new SessionRecordingService({
      ...metadata,
      chatsDir,
      ...options,
    });
    recording.initializeForResume(filePath, checkpoint.sequence);
    const childLock = lock;
    const lockHandle: LockHandle = {
      ...childLock,
      async release(): Promise<void> {
        try {
          await boot?.close();
        } finally {
          await childLock.release();
        }
      },
    };
    recording.adoptLock(lockHandle);
    recording.recordSessionFork({
      parentSessionId: target.source.sessionId,
      parentSequence: checkpoint.sequence,
      checkpointId: checkpoint.checkpointId,
      checkpointName: checkpoint.name,
    });
    await recording.flush();
    if (!recording.isActive())
      throw new Error('Child recording failed during flush');
    boot = await ResumeCursorBoot.open(
      filePath,
      checkpoint.sequence + 1,
      (await fs.stat(filePath)).size,
      options.counters,
      options.mediaStore,
    );
    return { ok: true, recording, lockHandle, boot, metadata };
  } catch (error) {
    return failedChild(error, [
      () => boot?.close(),
      () => recording?.dispose(),
      () => lock?.release(),
      () => (created ? fs.rm(filePath, { force: true }) : undefined),
    ]);
  }
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
    activeSource?: SessionRecordingService | null,
  ): Promise<ForkResult | ForkError> {
    let sourceLock: LockHandle | undefined;
    if (
      activeSource?.getSessionId() !== target.source.sessionId ||
      !activeSource.ownsLockFor(target.source.sessionId)
    ) {
      try {
        sourceLock = await SessionLockManager.acquire(
          chatsDir,
          target.source.sessionId,
        );
      } catch (error) {
        return {
          ok: false,
          error: `Source session is in use: ${failureDetail(error)}`,
        };
      }
    }
    try {
      if (sourceLock === undefined) await activeSource?.flush();
      const { replay, watermark } = await scanResumeMetadata(
        target.source.filePath,
        projectHash,
        (await fs.stat(target.source.filePath)).size,
        this.options.counters,
      );
      if (!replay.ok)
        return {
          ok: false,
          error: `Failed to replay source session: ${replay.error}`,
        };
      if (replay.sequenceCorrupt)
        return {
          ok: false,
          error: 'Failed to replay source session: non-monotonic sequences',
        };
      const checkpoint = replay.checkpoints?.find(
        (candidate) =>
          candidate.checkpointId === target.checkpointId && !candidate.deleted,
      );
      if (checkpoint === undefined)
        return {
          ok: false,
          error: `Checkpoint '${target.checkpointName}' (${target.checkpointId}) is not live`,
        };
      const result = await prepareChild(
        target,
        checkpoint,
        watermark,
        chatsDir,
        {
          sessionId: crypto.randomUUID(),
          projectHash,
          provider: currentProvider,
          model: currentModel,
          workspaceDirs,
          startTime: new Date().toISOString(),
          kind: 'main',
        },
        this.options,
      );
      const ownedSource = sourceLock;
      sourceLock = undefined;
      return await releaseSource(ownedSource, result);
    } finally {
      await sourceLock?.release();
    }
  }
}
