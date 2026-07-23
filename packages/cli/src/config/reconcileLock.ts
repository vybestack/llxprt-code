/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { MigrationDestinations } from './migrationTypes.js';
import { hasErrnoCode, fsyncDirSync } from './localFsHelpers.js';

export const MEMORY_RECONCILE_LOCK_FILE = '.memory-reconcile.lock';

export class ReconcileLockBusyError extends Error {
  constructor(lockPath: string) {
    super(`Memory reconciliation lock is busy at ${lockPath}.`);
    this.name = 'ReconcileLockBusyError';
  }
}

function reconcileLockPath(destinations: MigrationDestinations): string {
  return path.join(destinations.dataDir, MEMORY_RECONCILE_LOCK_FILE);
}

/**
 * Acquires an advisory O_EXCL lock. On EEXIST (lock already exists), the lock
 * is treated as busy and the call throws {@link ReconcileLockBusyError}.
 *
 * No PID-liveness reclaim: a stale orphan, a malformed lock, and a lock held
 * by a live process are all treated identically as busy. This is startup
 * safety-over-availability — a busy lock defers reconciliation to the next
 * startup. An orphan requires process restart or manual cleanup.
 *
 * Safety over availability: unexpected stat/read/unlink errors propagate
 * rather than triggering an unsafe fallback.
 */
export function acquireReconcileLock(
  destinations: MigrationDestinations,
): string {
  fs.mkdirSync(destinations.dataDir, { recursive: true });
  const lockPath = reconcileLockPath(destinations);

  const token = tryCreateLock(lockPath);
  if (token !== null) {
    return token;
  }

  throw new ReconcileLockBusyError(lockPath);
}

/**
 * Releases the lock if it still carries our token. A token mismatch (another
 * process replaced the lock) is a benign no-op. ENOENT is benign. Unexpected
 * read/unlink errors are returned so the caller can surface them without
 * masking a body error.
 */
export function releaseReconcileLock(
  destinations: MigrationDestinations,
  ownerToken: string,
): Error | undefined {
  const lockPath = reconcileLockPath(destinations);
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const payload = parseLockPayload(raw);
    if (payload !== null && payload.token === ownerToken) {
      fs.unlinkSync(lockPath);
      fsyncDirSync(path.dirname(lockPath));
    }
    return undefined;
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return undefined;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function closeAfterFailedInitialization(fd: number): unknown[] {
  try {
    fs.closeSync(fd);
    return [];
  } catch (error) {
    return [error];
  }
}

function unlinkAfterFailedInitialization(lockPath: string): unknown[] {
  try {
    fs.unlinkSync(lockPath);
    return [];
  } catch (error) {
    return hasErrnoCode(error, 'ENOENT') ? [] : [error];
  }
}

function tryCreateLock(lockPath: string): string | null {
  const token = crypto.randomUUID();
  const payload = JSON.stringify({
    pid: process.pid,
    token,
    created: new Date().toISOString(),
  });
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    let closed = false;
    try {
      fs.writeSync(fd, payload, 0, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      closed = true;
    } catch (writeError) {
      const closeErrors = closed ? [] : closeAfterFailedInitialization(fd);
      const cleanupErrors = [
        ...closeErrors,
        ...unlinkAfterFailedInitialization(lockPath),
      ];
      if (cleanupErrors.length === 0) {
        throw writeError;
      }
      throw new AggregateError(
        [writeError, ...cleanupErrors],
        `Failed to initialize reconciliation lock at ${lockPath}`,
      );
    }
    return token;
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
      return null;
    }
    throw error;
  }
}

interface LockPayload {
  readonly pid: number;
  readonly token: string;
  readonly created?: string;
}

function parseLockPayload(raw: string): LockPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['pid'] !== 'number' || typeof obj['token'] !== 'string') {
    return null;
  }
  return {
    pid: obj['pid'],
    token: obj['token'],
    created: typeof obj['created'] === 'string' ? obj['created'] : undefined,
  };
}
