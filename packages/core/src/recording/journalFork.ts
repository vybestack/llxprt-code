/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { VersionEdit } from '../journal/groupEdits.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { sha256KeyHash } from '../journal/idKeys.js';
import {
  checkpointKey,
  parseCheckpointEntry,
} from '../journal/checkpointDescriptor.js';
import { BoundedIdNodeCache } from '../journal/idTrieCache.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { KeyedMapReader } from '../journal/keyedMap.js';
import type { RecordAccess } from '../journal/recordAccess.js';
import { versionOf, type Version } from '../journal/version.js';
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
import {
  JournalResumeBoot,
  resumePointOf,
  type ResumePoint,
} from './journalResume.js';
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
  readonly mediaStore?: LocalMediaStore;
  readonly journal?: JournalSessionOptions;
}

export interface JournalForkResult {
  readonly ok: true;
  readonly recording: JournalRecordingService;
  readonly lockHandle: LockHandle;
  readonly metadata: SessionMetadata;
  /** The version the child was opened at, for the history that adopts it (S10 item 2). */
  readonly resumePoint: ResumePoint;
  readonly boot: JournalResumeBoot;
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

interface SourceRead {
  readonly access: RecordAccess;
  readonly version: Version | undefined;
}

async function cloneIntoChild(
  read: SourceRead,
  request: JournalForkRequest,
  childPath: string,
  allocated: () => void,
): Promise<SessionForkedPayload> {
  const { target } = request;
  if (read.version === undefined) throw new LiveCheckpointError(target);
  const state = new KeyedMapReader(
    read.access,
    new BoundedIdNodeCache(),
    'state',
    sha256KeyHash,
  );
  const stored = await state.get(
    read.version.roots.stateRoot,
    checkpointKey(target.checkpointId),
  );
  const descriptor =
    stored === undefined ? undefined : parseCheckpointEntry(stored);
  if (descriptor === undefined) throw new LiveCheckpointError(target);
  const journal = await resolveJournalDependencies(request.journal?.journal);
  await cloneCheckpoint(
    read.access,
    read.version,
    target.checkpointId,
    childPath,
    {
      journal: {
        ...journal,
        open: async (target, flags) => {
          const handle = await journal.open(target, flags);
          allocated();
          return handle;
        },
      },
      hasher: sha256KeyHash,
    },
  );
  return {
    parentSessionId: target.source.sessionId,
    parentSequence: descriptor.commitSeq,
    checkpointId: target.checkpointId,
    checkpointName: descriptor.name,
  };
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

async function withSourceRead<T>(
  request: JournalForkRequest,
  action: (read: SourceRead) => Promise<T>,
): Promise<T> {
  const { activeSource, target } = request;
  if (activeSource?.getSessionId() === target.source.sessionId) {
    await activeSource.flush();
    const read = await (await activeSource.session()).store.openRead();
    try {
      return await action(read);
    } finally {
      await read.close();
    }
  }
  const reader = await openJournalReadOnly(target.source.filePath);
  try {
    return await action({
      access: reader,
      version:
        reader.trailer === undefined ? undefined : versionOf(reader.trailer),
    });
  } finally {
    await reader.close();
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
  const { chatsDir } = request;
  const childPath = path.join(
    chatsDir,
    journalSessionFileName(metadata.sessionId),
  );
  let lock: LockHandle | undefined;
  let recording: JournalRecordingService | undefined;
  let created = false;
  try {
    lock = await SessionLockManager.acquire(chatsDir, metadata.sessionId);
    const fork = await withSourceRead(request, (read) =>
      cloneIntoChild(read, request, childPath, () => {
        created = true;
      }),
    );
    await describeChild(childPath, metadata, fork, request.journal);
    const config: JournalRecordingConfig = {
      sessionId: metadata.sessionId,
      projectHash: metadata.projectHash,
      chatsDir,
      workspaceDirs: metadata.workspaceDirs,
      provider: metadata.provider,
      model: metadata.model,
      mediaStore: request.mediaStore,
      kind: 'main',
      ...(request.journal === undefined ? {} : { journal: request.journal }),
    };
    recording = await JournalRecordingService.open(config, childPath);
    recording.adoptLock(lock);
    const resumePoint = await resumePointOf(recording);
    return {
      ok: true,
      recording,
      lockHandle: lock,
      metadata,
      resumePoint,
      boot: new JournalResumeBoot(recording, resumePoint),
    };
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
  const child = await createChild(request, {
    sessionId: crypto.randomUUID(),
    projectHash: request.projectHash,
    provider: request.currentProvider,
    model: request.currentModel,
    workspaceDirs: request.workspaceDirs,
    startTime: new Date().toISOString(),
    kind: 'main',
  });
  try {
    await sourceLock?.release();
  } catch (error) {
    if (!child.ok) {
      return {
        ok: false,
        error: `${child.error}; Failed to release source session: ${failureDetail(error)}`,
      };
    }
    const childPath = child.recording.getFilePath();
    return failedChild(error, [
      () => child.recording.dispose(),
      () =>
        childPath === null ? undefined : fs.rm(childPath, { force: true }),
    ]);
  }
  return child;
}
