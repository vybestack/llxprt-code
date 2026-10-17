/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { VersionEdit } from '../journal/groupEdits.js';
import { sha256KeyHash } from '../journal/idKeys.js';
import type { JournalStore } from '../journal/journalStore.js';
import { resolveJournalDependencies } from '../journal/journalWriterOpen.js';
import { cloneCheckpoint } from '../journal/versionCopy.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from '../services/history/journalSession.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { journalSessionFileName } from './sessionFileName.js';
import { SESSION_KEYS, encodeSessionFact } from './sessionMetaKeys.js';
import type {
  ContinueTarget,
  SessionForkedPayload,
  SessionMetadata,
} from './types.js';

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;

export interface JournalForkRequest {
  readonly target: CheckpointTarget;
  readonly chatsDir: string;
  readonly projectHash: string;
  readonly currentProvider: string;
  readonly currentModel: string;
  readonly workspaceDirs: string[];
  /** The recorder of the running session, when the checkpoint is in the session that is running. */
  readonly activeSource?: JournalRecordingService | null;
  readonly journal?: JournalSessionOptions;
}

export interface JournalForkResult {
  readonly ok: true;
  readonly recording: JournalRecordingService;
  readonly lockHandle: LockHandle;
  readonly metadata: SessionMetadata;
}

export interface JournalForkError {
  readonly ok: false;
  readonly error: string;
}

function failureDetail(error: unknown): string {
  if (error instanceof AggregateError)
    return error.errors.map(failureDetail).join('; ');
  return error instanceof Error ? error.message : String(error);
}

/** The facts the child file must say about itself in place of the ones the clone took from the source (design 4.8 step 5). */
function childFactEdits(
  metadata: SessionMetadata,
  fork: SessionForkedPayload,
): VersionEdit[] {
  const fact = (key: string, value: unknown): VersionEdit => ({
    kind: 'setState',
    key,
    value: encodeSessionFact(value),
  });
  return [
    fact(SESSION_KEYS.id, metadata.sessionId),
    fact(SESSION_KEYS.start, {
      startTime: metadata.startTime,
      projectHash: metadata.projectHash,
      workspaceDirs: metadata.workspaceDirs,
      kind: metadata.kind,
    }),
    fact(SESSION_KEYS.provider, {
      provider: metadata.provider,
      model: metadata.model,
    }),
    fact(SESSION_KEYS.directories, metadata.workspaceDirs),
    fact(SESSION_KEYS.title, null),
    fact(SESSION_KEYS.name, null),
    fact(SESSION_KEYS.fork, fork),
  ];
}

async function cloneIntoChild(
  source: JournalStore,
  request: JournalForkRequest,
  childPath: string,
): Promise<void> {
  const { target } = request;
  const read = await source.openRead();
  try {
    const descriptor = await source.checkpoint(target.checkpointId);
    if (descriptor === undefined || read.version === undefined) {
      throw new LiveCheckpointError(target);
    }
    const journal = await resolveJournalDependencies(request.journal?.journal);
    await cloneCheckpoint(
      read.access,
      read.version,
      target.checkpointId,
      childPath,
      { journal, hasher: sha256KeyHash },
    );
  } finally {
    read.close();
  }
}

class LiveCheckpointError extends Error {
  constructor(target: CheckpointTarget) {
    super(
      `Checkpoint '${target.checkpointName}' (${target.checkpointId}) is not live`,
    );
    this.name = 'LiveCheckpointError';
  }
}

/** Gives the child its own session facts and checks it has history. */
async function describeChild(
  childPath: string,
  metadata: SessionMetadata,
  fork: SessionForkedPayload,
  options: JournalSessionOptions | undefined,
): Promise<void> {
  const session = await JournalSession.open(childPath, options);
  try {
    if ((session.store.published?.rows ?? 0) === 0) {
      throw new Error('Checkpoint has no conversation history');
    }
    await session.store.commit(childFactEdits(metadata, fork));
  } finally {
    await session.close();
  }
}

async function withSourceStore<T>(
  request: JournalForkRequest,
  action: (store: JournalStore) => Promise<T>,
): Promise<T> {
  const { activeSource, target } = request;
  if (activeSource?.getSessionId() === target.source.sessionId) {
    await activeSource.flush();
    return action((await activeSource.session()).store);
  }
  const session = await JournalSession.open(
    target.source.filePath,
    request.journal,
  );
  try {
    return await action(session.store);
  } finally {
    await session.close();
  }
}

async function acquireSourceLock(
  request: JournalForkRequest,
): Promise<LockHandle | undefined> {
  const { activeSource, target } = request;
  if (
    activeSource?.getSessionId() === target.source.sessionId &&
    activeSource.ownsLockFor(target.source.sessionId)
  ) {
    return undefined;
  }
  return SessionLockManager.acquire(request.chatsDir, target.source.sessionId);
}

async function failedChild(
  error: unknown,
  cleanups: Array<() => Promise<unknown> | undefined>,
): Promise<JournalForkError> {
  const failures = [error];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (failure) {
      failures.push(failure);
    }
  }
  const [first] = failures;
  return {
    ok: false,
    error:
      first instanceof LiveCheckpointError
        ? first.message
        : `Failed to create child session: ${failures.map(failureDetail).join('; ')}`,
  };
}

async function createChild(
  request: JournalForkRequest,
  metadata: SessionMetadata,
): Promise<JournalForkResult | JournalForkError> {
  const { target, chatsDir } = request;
  const childPath = path.join(
    chatsDir,
    journalSessionFileName(metadata.sessionId),
  );
  const fork: SessionForkedPayload = {
    parentSessionId: target.source.sessionId,
    parentSequence: target.sequence,
    checkpointId: target.checkpointId,
    checkpointName: target.checkpointName,
  };
  let lock: LockHandle | undefined;
  let recording: JournalRecordingService | undefined;
  let created = false;
  try {
    lock = await SessionLockManager.acquire(chatsDir, metadata.sessionId);
    created = true;
    await withSourceStore(request, (store) =>
      cloneIntoChild(store, request, childPath),
    );
    await describeChild(childPath, metadata, fork, request.journal);
    const config: JournalRecordingConfig = {
      sessionId: metadata.sessionId,
      projectHash: metadata.projectHash,
      chatsDir,
      workspaceDirs: metadata.workspaceDirs,
      provider: metadata.provider,
      model: metadata.model,
      kind: 'main',
      ...(request.journal === undefined ? {} : { journal: request.journal }),
    };
    recording = await JournalRecordingService.open(config, childPath);
    recording.adoptLock(lock);
    return { ok: true, recording, lockHandle: lock, metadata };
  } catch (error) {
    return failedChild(error, [
      () => recording?.dispose(),
      () => (recording === undefined ? lock?.release() : undefined),
      () => (created ? fs.rm(childPath, { force: true }) : undefined),
    ]);
  }
}

/**
 * A checkpoint restore on the journal (design 4.9): a clone of the saved
 * version into a new child file, with the child's own session facts and the
 * fork ancestry. The file the checkpoint lives in is only read. The child's
 * recorder holds its lock; the caller adopts it.
 */
export async function forkJournalFromCheckpoint(
  request: JournalForkRequest,
): Promise<JournalForkResult | JournalForkError> {
  let sourceLock: LockHandle | undefined;
  try {
    sourceLock = await acquireSourceLock(request);
  } catch (error) {
    return {
      ok: false,
      error: `Source session is in use: ${failureDetail(error)}`,
    };
  }
  try {
    return await createChild(request, {
      sessionId: crypto.randomUUID(),
      projectHash: request.projectHash,
      provider: request.currentProvider,
      model: request.currentModel,
      workspaceDirs: request.workspaceDirs,
      startTime: new Date().toISOString(),
      kind: 'main',
    });
  } finally {
    await sourceLock?.release();
  }
}
