/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';
import type { ContinueTarget } from './types.js';

/**
 * The name rules of checkpoints and session names, shared by the checkpoint
 * service of each backend: one project-wide namespace of session ids,
 * checkpoint ids, session names and checkpoint names.
 */

export class CheckpointLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointLockError';
  }
}

export type NamedOperation =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; checkpointId: string; name: string }
  | { kind: 'session'; sessionId: string; name: string };

export function targetSessionId(target: ContinueTarget): string {
  return target.kind === 'session'
    ? target.session.sessionId
    : target.source.sessionId;
}

export function targetName(target: ContinueTarget): string | null {
  return target.kind === 'session'
    ? (target.session.name ?? null)
    : target.checkpointName;
}

/** True when the target is the thing the operation names, so it does not collide with itself. */
export function isSameReference(
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

/** A session id or checkpoint id may not be taken as a name. */
export function isReservedIdentity(
  target: ContinueTarget,
  name: string,
): boolean {
  return target.kind === 'session'
    ? target.session.sessionId === name
    : target.checkpointId === name;
}

export async function acquireSessionLock(
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

/** Acquires the locks in the order given; on a failure releases the ones taken. */
export async function acquireSessionLocks(
  chatsDir: string,
  sessionIds: readonly string[],
): Promise<LockHandle[]> {
  const acquired: LockHandle[] = [];
  try {
    for (const sessionId of sessionIds) {
      acquired.push(await acquireSessionLock(chatsDir, sessionId));
    }
    return acquired;
  } catch (error: unknown) {
    await releaseSessionLocks(acquired);
    throw error;
  }
}

export async function releaseSessionLocks(
  locks: readonly LockHandle[],
): Promise<void> {
  for (const lock of [...locks].reverse()) {
    await lock.release().catch(() => undefined);
  }
}
