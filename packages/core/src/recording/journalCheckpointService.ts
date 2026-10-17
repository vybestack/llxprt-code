/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../journal/groupEdits.js';
import type { JournalStore } from '../journal/journalStore.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from '../services/history/journalSession.js';
import {
  acquireSessionLock,
  acquireSessionLocks,
  isReservedIdentity,
  isSameReference,
  releaseSessionLocks,
  targetName,
  targetSessionId,
  type NamedOperation,
} from './checkpointNaming.js';
import type { JournalRecordingService } from './journalRecordingService.js';
import {
  readJournalCheckpoints,
  type JournalCheckpointFact,
} from './journalSessionListing.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  createCheckpointEdit,
  deleteCheckpointEdit,
  renameCheckpointEdit,
  sessionFactEdit,
} from './sessionEdits.js';
import { SESSION_KEYS } from './sessionMetaKeys.js';
import type {
  CheckpointMetadataView,
  ContinueTarget,
  RecordingCheckpointInfo,
} from './types.js';

/** What a named operation did, and how to take it back if a later step fails. */
interface NamedAction<T> {
  readonly result: T;
  readonly undo: () => Promise<void>;
}

function viewOf(fact: JournalCheckpointFact): CheckpointMetadataView {
  return {
    checkpointId: fact.checkpointId,
    name: fact.name,
    sequence: fact.sequence,
    deleted: false,
    createdAt: new Date(fact.createdAtMs).toISOString(),
  };
}

function namespaceLockName(projectHash: string): string {
  return `checkpoint-namespace-${projectHash}`;
}

/** Throws `error`, or both it and the failure of the step that was to take the work back. */
async function failAfterUndo(
  error: unknown,
  undo: () => Promise<void>,
): Promise<never> {
  try {
    await undo();
  } catch (undoError: unknown) {
    throw new AggregateError(
      [error, undoError],
      'Checkpoint overwrite rollback failed',
    );
  }
  throw error;
}

/** Removes the names the action replaced; a failure takes the action back. */
async function removeNames(
  collisions: readonly ContinueTarget[],
  remove: (collision: ContinueTarget) => Promise<void>,
  undo: () => Promise<void>,
): Promise<void> {
  try {
    for (const collision of collisions) await remove(collision);
  } catch (error: unknown) {
    await failAfterUndo(error, undo);
  }
}

/**
 * Checkpoint lifecycle and the project-wide name rules on journal files
 * (design 4.9). An open session goes through its recorder; a closed file is
 * opened under the session lock, gets one group, and is closed again.
 *
 * Names are taken in this order: the project namespace lock, the locks of
 * every other session whose name is replaced, then the action, then the
 * removal of the names it replaced. A journal cannot bring a deleted
 * checkpoint back, so the action goes first and a failed removal takes the
 * action back; removals that already succeeded stay, which is what the
 * confirmed overwrite asked for.
 */
export class JournalCheckpointService {
  constructor(private readonly journal?: JournalSessionOptions) {}

  async listCheckpoints(
    filePath: string,
  ): Promise<readonly CheckpointMetadataView[]> {
    return (await readJournalCheckpoints(filePath)).map(viewOf);
  }

  /** Live checkpoints are what stop a session being deleted. */
  getDeletionBlockers(
    filePath: string,
  ): Promise<readonly CheckpointMetadataView[]> {
    return this.listCheckpoints(filePath);
  }

  createCheckpoint(
    recording: JournalRecordingService,
    projectHash: string,
    name: string,
    overwrite = false,
  ): Promise<RecordingCheckpointInfo> {
    return this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'create', name },
      overwrite,
      async (resolved) => {
        const info = await recording.createCheckpoint(resolved);
        return {
          result: info,
          undo: () => recording.deleteCheckpoint(info.checkpointId),
        };
      },
    );
  }

  async renameCheckpoint(
    recording: JournalRecordingService,
    projectHash: string,
    checkpointId: string,
    name: string,
    overwrite = false,
  ): Promise<void> {
    await this.requireActiveCheckpoint(recording, checkpointId);
    await this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'rename', checkpointId, name },
      overwrite,
      async (resolved) => {
        const previous = await this.requireActiveCheckpoint(
          recording,
          checkpointId,
        );
        await recording.renameCheckpoint(checkpointId, resolved);
        return {
          result: undefined,
          undo: () => recording.renameCheckpoint(checkpointId, previous),
        };
      },
    );
  }

  async deleteCheckpoint(
    recording: JournalRecordingService,
    _projectHash: string,
    checkpointId: string,
  ): Promise<void> {
    await this.requireActiveCheckpoint(recording, checkpointId);
    await recording.deleteCheckpoint(checkpointId);
  }

  async setSessionName(
    recording: JournalRecordingService,
    projectHash: string,
    name: string,
    overwrite = false,
  ): Promise<void> {
    const sessionId = recording.getSessionId();
    await this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'session', sessionId, name },
      overwrite,
      async (resolved) => {
        const previous = await this.sessionNameOf(recording, projectHash);
        await recording.setSessionName(resolved);
        return {
          result: undefined,
          undo: () => recording.setSessionName(previous),
        };
      },
    );
  }

  async deleteCheckpointClosed(
    filePath: string,
    _projectHash: string,
    chatsDir: string,
    sourceSessionId: string,
    checkpointId: string,
  ): Promise<void> {
    const lock = await acquireSessionLock(chatsDir, sourceSessionId);
    try {
      await this.deleteClosed(filePath, checkpointId);
    } finally {
      await lock.release().catch(() => undefined);
    }
  }

  async renameCheckpointClosed(
    filePath: string,
    projectHash: string,
    chatsDir: string,
    sourceSessionId: string,
    checkpointId: string,
    newName: string,
    overwrite = false,
  ): Promise<void> {
    const name = SessionDiscovery.validateName(newName);
    const operation: NamedOperation = {
      kind: 'rename',
      checkpointId,
      name,
    };
    const namespaceLock = await acquireSessionLock(
      chatsDir,
      namespaceLockName(projectHash),
    );
    try {
      const collisions = await this.collisionsOf(
        chatsDir,
        projectHash,
        operation,
        overwrite,
      );
      const sessionIds = [
        ...new Set([sourceSessionId, ...collisions.map(targetSessionId)]),
      ].sort((left, right) => left.localeCompare(right));
      const locks = await acquireSessionLocks(chatsDir, sessionIds);
      try {
        const refreshed = await this.refreshCollisions(
          chatsDir,
          projectHash,
          operation,
          new Set(sessionIds),
        );
        const previous = await this.renameClosed(filePath, checkpointId, name);
        await removeNames(
          refreshed,
          (collision) => this.tombstoneClosed(collision),
          async () => {
            await this.renameClosed(filePath, checkpointId, previous);
          },
        );
      } finally {
        await releaseSessionLocks(locks);
      }
    } finally {
      await namespaceLock.release().catch(() => undefined);
    }
  }

  async createCheckpointClosed(
    filePath: string,
    projectHash: string,
    chatsDir: string,
    sourceSessionId: string,
    name: string,
  ): Promise<RecordingCheckpointInfo> {
    const trimmed = SessionDiscovery.validateName(name);
    const namespaceLock = await acquireSessionLock(
      chatsDir,
      namespaceLockName(projectHash),
    );
    try {
      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        projectHash,
      );
      if (
        targets.some(
          (target) =>
            targetName(target) === trimmed ||
            isReservedIdentity(target, trimmed),
        )
      ) {
        throw new Error(`Name '${trimmed}' already exists`);
      }
      const lock = await acquireSessionLock(chatsDir, sourceSessionId);
      try {
        return await this.createClosed(filePath, trimmed);
      } finally {
        await lock.release().catch(() => undefined);
      }
    } finally {
      await namespaceLock.release().catch(() => undefined);
    }
  }

  // Named operations on the open session.

  private async runNamedOperation<T>(
    recording: JournalRecordingService,
    projectHash: string,
    operation: NamedOperation,
    overwrite: boolean,
    act: (name: string) => Promise<NamedAction<T>>,
  ): Promise<T> {
    this.requireActiveRecording(recording);
    const name = SessionDiscovery.validateName(operation.name);
    await recording.flush();
    const chatsDir = recording.getChatsDir();
    const namespaceLock = await acquireSessionLock(
      chatsDir,
      namespaceLockName(projectHash),
    );
    try {
      const collisions = await this.collisionsOf(
        chatsDir,
        projectHash,
        { ...operation, name },
        overwrite,
      );
      const foreign = [...new Set(collisions.map(targetSessionId))]
        .filter((sessionId) => !recording.ownsLockFor(sessionId))
        .sort((left, right) => left.localeCompare(right));
      const locks = await acquireSessionLocks(chatsDir, foreign);
      try {
        const refreshed = await this.refreshCollisions(
          chatsDir,
          projectHash,
          { ...operation, name },
          new Set([...foreign, recording.getSessionId()]),
        );
        const action = await act(name);
        await removeNames(
          refreshed,
          (collision) => this.tombstone(collision, recording),
          action.undo,
        );
        return action.result;
      } finally {
        await releaseSessionLocks(locks);
      }
    } finally {
      await namespaceLock.release().catch(() => undefined);
    }
  }

  /** The targets that hold the name; refuses a reserved name, and a held name without `overwrite`. */
  private async collisionsOf(
    chatsDir: string,
    projectHash: string,
    operation: NamedOperation,
    overwrite: boolean,
  ): Promise<ContinueTarget[]> {
    const { name } = operation;
    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      projectHash,
    );
    if (targets.some((target) => isReservedIdentity(target, name))) {
      throw new Error(`Name '${name}' already exists`);
    }
    const collisions = targets.filter(
      (target) =>
        targetName(target) === name && !isSameReference(target, operation),
    );
    if (collisions.length > 0 && !overwrite) {
      throw new Error(`Name '${name}' already exists`);
    }
    return collisions;
  }

  /** The collisions once their sessions are locked; a holder that appeared meanwhile is refused. */
  private async refreshCollisions(
    chatsDir: string,
    projectHash: string,
    operation: NamedOperation,
    lockedSessionIds: ReadonlySet<string>,
  ): Promise<ContinueTarget[]> {
    const refreshed = (
      await SessionDiscovery.listContinueTargets(chatsDir, projectHash)
    ).filter(
      (target) =>
        targetName(target) === operation.name &&
        !isSameReference(target, operation),
    );
    if (
      refreshed.some((target) => !lockedSessionIds.has(targetSessionId(target)))
    ) {
      throw new Error(`Name '${operation.name}' changed while acquiring locks`);
    }
    return refreshed;
  }

  private async tombstone(
    collision: ContinueTarget,
    recording: JournalRecordingService,
  ): Promise<void> {
    if (!recording.ownsLockFor(targetSessionId(collision))) {
      await this.tombstoneClosed(collision);
    } else if (collision.kind === 'checkpoint') {
      await recording.deleteCheckpoint(collision.checkpointId);
    } else {
      await recording.setSessionName(null);
    }
  }

  private async tombstoneClosed(collision: ContinueTarget): Promise<void> {
    if (collision.kind === 'checkpoint') {
      await this.deleteClosed(
        collision.source.filePath,
        collision.checkpointId,
      );
      return;
    }
    await this.withClosedStore(collision.session.filePath, (store) =>
      store.commit([sessionFactEdit(SESSION_KEYS.name, null)]),
    );
  }

  private async sessionNameOf(
    recording: JournalRecordingService,
    projectHash: string,
  ): Promise<string | null> {
    const targets = await SessionDiscovery.listContinueTargets(
      recording.getChatsDir(),
      projectHash,
    );
    const own = targets.find(
      (target) =>
        target.kind === 'session' &&
        target.session.sessionId === recording.getSessionId(),
    );
    return (own?.kind === 'session' ? own.session.name : undefined) ?? null;
  }

  private requireActiveRecording(recording: JournalRecordingService): void {
    if (
      !recording.isActive() ||
      !recording.ownsLockFor(recording.getSessionId())
    ) {
      throw new Error('Active recording does not own its live session lock');
    }
  }

  /** The name of a live checkpoint of the open session; refuses a missing or deleted one. */
  private async requireActiveCheckpoint(
    recording: JournalRecordingService,
    checkpointId: string,
  ): Promise<string> {
    this.requireActiveRecording(recording);
    const store = (await recording.session()).store;
    const descriptor = await store.checkpoint(checkpointId);
    if (descriptor === undefined) {
      throw new Error(`Checkpoint ${checkpointId} not found or deleted`);
    }
    return descriptor.name;
  }

  // Closed files.

  private async withClosedStore<T>(
    filePath: string,
    work: (store: JournalStore) => Promise<T>,
  ): Promise<T> {
    const session = await JournalSession.open(filePath, this.journal);
    try {
      return await work(session.store);
    } finally {
      await session.close();
    }
  }

  private async requireLive(
    store: JournalStore,
    checkpointId: string,
  ): Promise<NonNullable<Awaited<ReturnType<JournalStore['checkpoint']>>>> {
    const descriptor = await store.checkpoint(checkpointId);
    if (descriptor === undefined) {
      throw new Error(`Checkpoint ${checkpointId} not found or deleted`);
    }
    return descriptor;
  }

  private deleteClosed(filePath: string, checkpointId: string): Promise<void> {
    return this.withClosedStore(filePath, async (store) => {
      await this.requireLive(store, checkpointId);
      await store.commit([deleteCheckpointEdit(checkpointId)]);
    });
  }

  /** Renames a checkpoint of a closed file; returns the name it had. */
  private renameClosed(
    filePath: string,
    checkpointId: string,
    name: string,
  ): Promise<string> {
    return this.withClosedStore(filePath, async (store) => {
      const descriptor = await this.requireLive(store, checkpointId);
      await store.commit([
        renameCheckpointEdit(checkpointId, descriptor, name),
      ]);
      return descriptor.name;
    });
  }

  private createClosed(
    filePath: string,
    name: string,
  ): Promise<RecordingCheckpointInfo> {
    return this.withClosedStore(filePath, async (store) => {
      if ((store.published?.rows ?? 0) === 0) {
        throw new Error(
          'Cannot create checkpoint: conversation has no content yet',
        );
      }
      const checkpointId = crypto.randomUUID();
      const edit: VersionEdit = createCheckpointEdit(checkpointId, name);
      await store.commit([edit]);
      const descriptor = await this.requireLive(store, checkpointId);
      return { checkpointId, name, sequence: descriptor.commitSeq };
    });
  }
}
