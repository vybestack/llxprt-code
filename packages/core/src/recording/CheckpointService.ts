/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { replaySession } from './ReplayEngine.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';
import { type SessionRecordingService } from './SessionRecordingService.js';
import {
  type CheckpointMetadataView,
  type ContinueTarget,
  type RecordingCheckpointInfo,
  type SessionRecordLine,
} from './types.js';

export class CheckpointLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointLockError';
  }
}

type SessionTarget = Extract<ContinueTarget, { kind: 'session' }>;

type NamedOperation =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; checkpointId: string; name: string }
  | { kind: 'session'; sessionId: string; name: string };

type NamedOperationAction<T> = (name: string) => Promise<T>;

type FileSnapshot = {
  readonly filePath: string;
  readonly content: Buffer;
};

function targetFilePath(target: ContinueTarget): string {
  return target.kind === 'session'
    ? target.session.filePath
    : target.source.filePath;
}

async function captureFiles(
  targets: readonly ContinueTarget[],
): Promise<FileSnapshot[]> {
  const filePaths = [...new Set(targets.map(targetFilePath))];
  return Promise.all(
    filePaths.map(async (filePath) => ({
      filePath,
      content: await fs.readFile(filePath),
    })),
  );
}

async function runWithFileRollback<T>(
  snapshots: readonly FileSnapshot[],
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    const failures: unknown[] = [error];
    for (const snapshot of snapshots) {
      try {
        await fs.writeFile(snapshot.filePath, snapshot.content);
      } catch (rollbackError: unknown) {
        failures.push(rollbackError);
      }
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Checkpoint overwrite rollback failed',
      );
    }
    throw error;
  }
}

function targetSessionId(target: ContinueTarget): string {
  return target.kind === 'session'
    ? target.session.sessionId
    : target.source.sessionId;
}

function targetName(target: ContinueTarget): string | null {
  return target.kind === 'session'
    ? (target.session.name ?? null)
    : target.checkpointName;
}

function isSameReference(
  target: ContinueTarget,
  operation: NamedOperation,
): boolean {
  if (operation.kind === 'rename' && target.kind === 'checkpoint') {
    return target.checkpointId === operation.checkpointId;
  }
  return (
    operation.kind === 'session' &&
    target.kind === 'session' &&
    target.session.sessionId === operation.sessionId
  );
}

async function appendEvent(
  filePath: string,
  projectHash: string,
  type: SessionRecordLine['type'],
  payload: unknown,
): Promise<void> {
  const replay = await replaySession(filePath, projectHash);
  if (!replay.ok) throw new Error(replay.error);
  if (replay.sequenceCorrupt) {
    throw new Error('Cannot append metadata to a sequence-corrupt recording');
  }
  const event: SessionRecordLine = {
    v: 1,
    seq: replay.lastSeq + 1,
    ts: new Date().toISOString(),
    type,
    payload,
  };
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
}

export class CheckpointService {
  async listCheckpoints(
    filePath: string,
    projectHash: string,
  ): Promise<readonly CheckpointMetadataView[]> {
    const result = await replaySession(filePath, projectHash);
    if (!result.ok) return [];
    return (result.checkpoints ?? []).filter(
      (checkpoint) => !checkpoint.deleted,
    );
  }

  async getDeletionBlockers(
    filePath: string,
    projectHash: string,
  ): Promise<readonly CheckpointMetadataView[]> {
    const result = await replaySession(filePath, projectHash);
    if (!result.ok) {
      throw new Error(`Cannot verify checkpoint blockers: ${result.error}`);
    }
    return (result.checkpoints ?? []).filter(
      (checkpoint) => !checkpoint.deleted,
    );
  }

  async createCheckpoint(
    recording: SessionRecordingService,
    projectHash: string,
    name: string,
    overwrite = false,
  ): Promise<RecordingCheckpointInfo> {
    return this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'create', name },
      overwrite,
      (resolved) => recording.createCheckpoint(resolved),
    );
  }

  async renameCheckpoint(
    recording: SessionRecordingService,
    projectHash: string,
    checkpointId: string,
    name: string,
    overwrite = false,
  ): Promise<void> {
    await this.requireActiveCheckpoint(recording, projectHash, checkpointId);
    await this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'rename', checkpointId, name },
      overwrite,
      (resolved) => recording.renameCheckpoint(checkpointId, resolved),
    );
  }

  async deleteCheckpoint(
    recording: SessionRecordingService,
    projectHash: string,
    checkpointId: string,
  ): Promise<void> {
    await this.requireActiveCheckpoint(recording, projectHash, checkpointId);
    await recording.deleteCheckpoint(checkpointId);
  }

  async setSessionName(
    recording: SessionRecordingService,
    projectHash: string,
    name: string,
    overwrite = false,
  ): Promise<void> {
    await this.runNamedOperation(
      recording,
      projectHash,
      { kind: 'session', sessionId: recording.getSessionId(), name },
      overwrite,
      (resolved) => recording.setSessionName(resolved),
    );
  }

  async deleteCheckpointClosed(
    filePath: string,
    projectHash: string,
    chatsDir: string,
    sourceSessionId: string,
    checkpointId: string,
  ): Promise<void> {
    const lock = await this.acquireLock(chatsDir, sourceSessionId);
    try {
      await this.requireLiveCheckpoint(filePath, projectHash, checkpointId);
      await appendEvent(filePath, projectHash, 'checkpoint_deleted', {
        checkpointId,
      });
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
    const trimmed = this.requireName(newName);
    const namespaceLock = await this.acquireLock(
      chatsDir,
      `checkpoint-namespace-${projectHash}`,
    );
    try {
      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        projectHash,
      );
      const reservedIdentity = targets.find((target) =>
        target.kind === 'session'
          ? target.session.sessionId === trimmed
          : target.checkpointId === trimmed,
      );
      if (reservedIdentity !== undefined) {
        throw new Error(`Name '${trimmed}' already exists`);
      }
      const operation: NamedOperation = {
        kind: 'rename',
        checkpointId,
        name: trimmed,
      };
      const collisions = targets.filter(
        (target) =>
          targetName(target) === trimmed && !isSameReference(target, operation),
      );
      if (collisions.length > 0 && !overwrite) {
        throw new Error(`Name '${trimmed}' already exists`);
      }
      const sessionIds = [
        ...new Set([sourceSessionId, ...collisions.map(targetSessionId)]),
      ].sort((left, right) => left.localeCompare(right));
      const locks = await this.acquireSessionLocks(chatsDir, sessionIds);
      try {
        const refreshedCollisions = (
          await SessionDiscovery.listContinueTargets(chatsDir, projectHash)
        ).filter(
          (target) =>
            targetName(target) === trimmed &&
            !isSameReference(target, operation),
        );
        const lockedIds = new Set(sessionIds);
        if (
          refreshedCollisions.some(
            (target) => !lockedIds.has(targetSessionId(target)),
          )
        ) {
          throw new Error(`Name '${trimmed}' changed while acquiring locks`);
        }
        await this.requireLiveCheckpoint(filePath, projectHash, checkpointId);
        const snapshots = await captureFiles(refreshedCollisions);
        await runWithFileRollback(snapshots, async () => {
          for (const collision of refreshedCollisions) {
            await this.tombstoneClosedCollision(collision, projectHash);
          }
          await appendEvent(filePath, projectHash, 'checkpoint_renamed', {
            checkpointId,
            name: trimmed,
          });
        });
      } finally {
        for (const lock of [...locks].reverse()) {
          await lock.release().catch(() => undefined);
        }
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
    const trimmed = this.requireName(name);
    const namespaceLock = await this.acquireLock(
      chatsDir,
      `checkpoint-namespace-${projectHash}`,
    );
    try {
      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        projectHash,
      );
      const collision = targets.find(
        (target) =>
          targetName(target) === trimmed ||
          (target.kind === 'session'
            ? target.session.sessionId === trimmed
            : target.checkpointId === trimmed),
      );
      if (collision !== undefined) {
        throw new Error(`Name '${trimmed}' already exists`);
      }
      const lock = await this.acquireLock(chatsDir, sourceSessionId);
      try {
        const replay = await replaySession(filePath, projectHash);
        if (!replay.ok) throw new Error(replay.error);
        if (replay.sequenceCorrupt) {
          throw new Error(
            'Cannot append metadata to a sequence-corrupt recording',
          );
        }
        if (replay.history.length === 0) {
          throw new Error(
            'Cannot create checkpoint: conversation has no content yet',
          );
        }
        const checkpointId = randomUUID();
        const sequence = replay.lastSeq + 1;
        const event: SessionRecordLine = {
          v: 1,
          seq: sequence,
          ts: new Date().toISOString(),
          type: 'checkpoint_created',
          payload: { checkpointId, name: trimmed },
        };
        await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
        return { checkpointId, name: trimmed, sequence };
      } finally {
        await lock.release().catch(() => undefined);
      }
    } finally {
      await namespaceLock.release().catch(() => undefined);
    }
  }

  private async runNamedOperation<T>(
    recording: SessionRecordingService,
    projectHash: string,
    operation: NamedOperation,
    overwrite: boolean,
    action: NamedOperationAction<T>,
  ): Promise<T> {
    this.requireActiveRecording(recording);
    const name = this.requireName(operation.name);
    const chatsDir = recording.getChatsDir();
    const namespaceLock = await this.acquireLock(
      chatsDir,
      `checkpoint-namespace-${projectHash}`,
    );
    try {
      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        projectHash,
      );
      const reservedIdentity = targets.find((target) =>
        target.kind === 'session'
          ? target.session.sessionId === name
          : target.checkpointId === name,
      );
      if (reservedIdentity !== undefined) {
        throw new Error(`Name '${name}' already exists`);
      }
      const collisions = targets.filter(
        (target) =>
          targetName(target) === name && !isSameReference(target, operation),
      );
      if (collisions.length > 0 && !overwrite) {
        throw new Error(`Name '${name}' already exists`);
      }
      const locks = await this.acquireCollisionLocks(
        collisions,
        recording,
        chatsDir,
      );
      try {
        const refreshedCollisions = await this.refreshLockedCollisions(
          collisions,
          recording,
          chatsDir,
          projectHash,
          operation,
          name,
        );
        const snapshots = await captureFiles(refreshedCollisions);
        return await runWithFileRollback(snapshots, async () => {
          for (const collision of refreshedCollisions) {
            await this.tombstoneCollision(collision, recording, projectHash);
          }
          return action(name);
        });
      } finally {
        for (const lock of [...locks].reverse()) {
          await lock.release().catch(() => undefined);
        }
      }
    } finally {
      await namespaceLock.release().catch(() => undefined);
    }
  }

  private async acquireSessionLocks(
    chatsDir: string,
    sessionIds: readonly string[],
  ): Promise<LockHandle[]> {
    const acquired: LockHandle[] = [];
    try {
      for (const sessionId of sessionIds) {
        acquired.push(await this.acquireLock(chatsDir, sessionId));
      }
      return acquired;
    } catch (error: unknown) {
      for (const lock of [...acquired].reverse()) {
        await lock.release().catch(() => undefined);
      }
      throw error;
    }
  }

  private async tombstoneClosedCollision(
    collision: ContinueTarget,
    projectHash: string,
  ): Promise<void> {
    if (collision.kind === 'checkpoint') {
      await this.requireLiveCheckpoint(
        collision.source.filePath,
        projectHash,
        collision.checkpointId,
      );
      await appendEvent(
        collision.source.filePath,
        projectHash,
        'checkpoint_deleted',
        { checkpointId: collision.checkpointId },
      );
      return;
    }
    await appendEvent(
      collision.session.filePath,
      projectHash,
      'session_named',
      {
        name: null,
      },
    );
  }

  private async acquireCollisionLocks(
    collisions: readonly ContinueTarget[],
    recording: SessionRecordingService,
    chatsDir: string,
  ): Promise<LockHandle[]> {
    const sessionIds = [...new Set(collisions.map(targetSessionId))]
      .filter((sessionId) => !recording.ownsLockFor(sessionId))
      .sort((left, right) => left.localeCompare(right));
    const acquired: LockHandle[] = [];
    try {
      for (const sessionId of sessionIds) {
        acquired.push(await this.acquireLock(chatsDir, sessionId));
      }
      return acquired;
    } catch (error: unknown) {
      for (const lock of [...acquired].reverse()) {
        await lock.release().catch(() => undefined);
      }
      throw error;
    }
  }

  private async refreshLockedCollisions(
    lockedCollisions: readonly ContinueTarget[],
    recording: SessionRecordingService,
    chatsDir: string,
    projectHash: string,
    operation: NamedOperation,
    name: string,
  ): Promise<ContinueTarget[]> {
    const refreshed = await SessionDiscovery.listContinueTargets(
      chatsDir,
      projectHash,
    );
    const collisions = refreshed.filter(
      (target) =>
        targetName(target) === name && !isSameReference(target, operation),
    );
    const lockedIds = new Set(lockedCollisions.map(targetSessionId));
    const unlockedCollision = collisions.find((target) => {
      const sessionId = targetSessionId(target);
      return !recording.ownsLockFor(sessionId) && !lockedIds.has(sessionId);
    });
    if (unlockedCollision !== undefined) {
      throw new Error(`Name '${name}' changed while acquiring locks`);
    }
    return collisions;
  }

  private async tombstoneCollision(
    collision: ContinueTarget,
    recording: SessionRecordingService,
    projectHash: string,
  ): Promise<void> {
    if (collision.kind === 'checkpoint') {
      if (recording.ownsLockFor(collision.source.sessionId)) {
        await recording.deleteCheckpoint(collision.checkpointId);
        return;
      }
      await this.requireLiveCheckpoint(
        collision.source.filePath,
        projectHash,
        collision.checkpointId,
      );
      await appendEvent(
        collision.source.filePath,
        projectHash,
        'checkpoint_deleted',
        { checkpointId: collision.checkpointId },
      );
      return;
    }
    await this.clearSessionName(collision, recording, projectHash);
  }

  private async clearSessionName(
    collision: SessionTarget,
    recording: SessionRecordingService,
    projectHash: string,
  ): Promise<void> {
    if (recording.ownsLockFor(collision.session.sessionId)) {
      await recording.setSessionName(null);
      return;
    }
    await appendEvent(
      collision.session.filePath,
      projectHash,
      'session_named',
      { name: null },
    );
  }

  private requireName(name: string): string {
    return SessionDiscovery.validateName(name);
  }

  private requireActiveRecording(recording: SessionRecordingService): void {
    if (
      !recording.isActive() ||
      !recording.ownsLockFor(recording.getSessionId())
    ) {
      throw new Error('Active recording does not own its live session lock');
    }
  }

  private async requireActiveCheckpoint(
    recording: SessionRecordingService,
    projectHash: string,
    checkpointId: string,
  ): Promise<CheckpointMetadataView> {
    this.requireActiveRecording(recording);
    const filePath = recording.getFilePath();
    if (filePath === null) {
      throw new Error('Active recording is not materialized');
    }
    return this.requireLiveCheckpoint(filePath, projectHash, checkpointId);
  }

  private async requireLiveCheckpoint(
    filePath: string,
    projectHash: string,
    checkpointId: string,
  ): Promise<CheckpointMetadataView> {
    const result = await replaySession(filePath, projectHash);
    if (!result.ok) throw new Error(result.error);
    const checkpoint = result.checkpoints?.find(
      (candidate) => candidate.checkpointId === checkpointId,
    );
    if (checkpoint === undefined || checkpoint.deleted) {
      throw new Error(`Checkpoint ${checkpointId} not found or deleted`);
    }
    return checkpoint;
  }

  private async acquireLock(
    chatsDir: string,
    sessionId: string,
  ): Promise<LockHandle> {
    try {
      return await SessionLockManager.acquire(chatsDir, sessionId);
    } catch (error: unknown) {
      if (error instanceof SessionLockedError) {
        throw new CheckpointLockError(
          `Session ${sessionId} is in use by another process`,
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new CheckpointLockError(
        `Failed to acquire lock for session ${sessionId}: ${detail}`,
      );
    }
  }
}
