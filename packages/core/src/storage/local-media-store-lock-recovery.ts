/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { link, lstat, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoreLockOwner } from './local-media-store-types.js';
import {
  hasErrnoCode,
  parseStoreLockOwner,
  wrapError,
} from './local-media-store-validation.js';

interface LockRecoveryInput {
  readonly lockPath: string;
  readonly lockDirectory: string;
  readonly staleLockMs: number;
  readonly operation: string;
  readonly contentId: string | undefined;
  readonly syncDirectory: () => Promise<void>;
}

interface ObservedLock {
  readonly metadata: Awaited<ReturnType<typeof lstat>>;
  readonly owner: StoreLockOwner | undefined;
}

async function readLockOwner(
  path: string,
): Promise<StoreLockOwner | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parseStoreLockOwner(parsed);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) throw error;
    return undefined;
  }
}

async function observeLock(path: string): Promise<ObservedLock> {
  const [metadata, owner] = await Promise.all([
    lstat(path),
    readLockOwner(path),
  ]);
  return { metadata, owner };
}

function ownerMatches(
  observed: StoreLockOwner | undefined,
  claimed: StoreLockOwner | undefined,
  current: StoreLockOwner | undefined,
): boolean {
  if (observed === undefined) {
    return claimed === undefined && current === undefined;
  }
  return claimed?.token === observed.token && current?.token === observed.token;
}

function claimStillOwnsStaleLock(
  observed: ObservedLock,
  claimed: ObservedLock,
  current: ObservedLock,
  staleLockMs: number,
): boolean {
  if (!claimed.metadata.isFile() || !current.metadata.isFile()) return false;
  if (claimed.metadata.dev !== observed.metadata.dev) return false;
  if (claimed.metadata.ino !== observed.metadata.ino) return false;
  if (current.metadata.dev !== claimed.metadata.dev) return false;
  if (current.metadata.ino !== claimed.metadata.ino) return false;
  if (current.metadata.nlink < 2) return false;
  if (Date.now() - Number(claimed.metadata.mtimeMs) < staleLockMs) return false;
  return ownerMatches(observed.owner, claimed.owner, current.owner);
}

function combineFailures(primary: unknown, cleanup: unknown): unknown {
  if (primary === undefined) return cleanup;
  if (cleanup === undefined) return primary;
  return new AggregateError(
    [primary, cleanup],
    'Stale store lock recovery and cleanup failed',
  );
}

async function removeClaim(
  claimPath: string,
  syncDirectory: () => Promise<void>,
): Promise<unknown> {
  try {
    await unlink(claimPath);
    await syncDirectory();
    return undefined;
  } catch (error) {
    return hasErrnoCode(error, 'ENOENT') ? undefined : error;
  }
}

export async function recoverStaleStoreLock(
  input: LockRecoveryInput,
): Promise<boolean> {
  let observed: ObservedLock;
  try {
    observed = await observeLock(input.lockPath);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return true;
    throw wrapError(
      `inspect store lock for ${input.operation}`,
      input.contentId,
      error,
    );
  }
  if (Date.now() - Number(observed.metadata.mtimeMs) < input.staleLockMs) {
    return false;
  }
  const claimPath = join(
    input.lockDirectory,
    `store.lock.${randomUUID()}.takeover`,
  );
  try {
    await link(input.lockPath, claimPath);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return true;
    throw wrapError(
      `claim stale store lock for ${input.operation}`,
      input.contentId,
      error,
    );
  }
  let recovered = false;
  let failure: unknown;
  try {
    const [claimed, current] = await Promise.all([
      observeLock(claimPath),
      observeLock(input.lockPath),
    ]);
    if (
      claimStillOwnsStaleLock(observed, claimed, current, input.staleLockMs)
    ) {
      await unlink(input.lockPath);
      recovered = true;
    }
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) failure = error;
  }
  failure = combineFailures(
    failure,
    await removeClaim(claimPath, input.syncDirectory),
  );
  if (failure !== undefined) {
    throw wrapError(
      `recover stale store lock for ${input.operation}`,
      input.contentId,
      failure,
    );
  }
  return recovered;
}
