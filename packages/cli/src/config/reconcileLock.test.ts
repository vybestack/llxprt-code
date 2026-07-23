/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  acquireReconcileLock,
  releaseReconcileLock,
  MEMORY_RECONCILE_LOCK_FILE,
  ReconcileLockBusyError,
} from './reconcileLock.js';
import type { MigrationDestinations } from './migrationTypes.js';

describe('reconcileLock advisory lock', () => {
  let root: string;
  let dataDir: string;
  let destinations: MigrationDestinations;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-lock-'));
    dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    destinations = {
      configDir: path.join(root, 'config'),
      dataDir,
      cacheDir: path.join(root, 'cache'),
      logDir: path.join(root, 'log'),
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function lockPath(): string {
    return path.join(dataDir, MEMORY_RECONCILE_LOCK_FILE);
  }

  it('acquires the lock and creates the file in the data dir', () => {
    const token = acquireReconcileLock(destinations);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(fs.statSync(lockPath()).isFile()).toBe(true);
  });

  it('defers (ReconcileLockBusyError) when the lock is already held', () => {
    acquireReconcileLock(destinations);
    expect(() => acquireReconcileLock(destinations)).toThrow(
      ReconcileLockBusyError,
    );
  });

  it('does NOT reclaim a dead-owner lock (no PID reclaim, safety over availability)', () => {
    // No PID-liveness reclaim: any existing lock is treated as busy.
    // Safety over availability — a stale orphan defers to next startup.
    const lockFile = lockPath();
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999999, token: 'dead', created: 'old' }),
    );

    expect(() => acquireReconcileLock(destinations)).toThrow(
      ReconcileLockBusyError,
    );
    // The orphaned lock is left in place.
    expect(fs.statSync(lockFile).isFile()).toBe(true);
  });

  it('defers on a malformed/tokenless lock (no pathname reclaim, Finding #2+#3)', () => {
    // An empty lock carries no verifiable owner identity. Per Finding #2+#3,
    // it is NOT reclaimed via age heuristics — it defers to manual cleanup.
    const lockFile = lockPath();
    fs.writeFileSync(lockFile, '');
    const stale = new Date(Date.now() - 10_000);
    fs.utimesSync(lockFile, stale, stale);

    expect(() => acquireReconcileLock(destinations)).toThrow(
      ReconcileLockBusyError,
    );
    // The orphaned lock is NOT removed.
    expect(fs.statSync(lockFile).isFile()).toBe(true);
  });

  it('defers on an empty/tokenless lock (no mtime reclaim, Finding #2+#3)', () => {
    const lockFile = lockPath();
    fs.writeFileSync(lockFile, '');

    expect(() => acquireReconcileLock(destinations)).toThrow(
      ReconcileLockBusyError,
    );
  });

  it('releases its own lock and removes the file', () => {
    const token = acquireReconcileLock(destinations);
    releaseReconcileLock(destinations, token);
    expect(() => fs.statSync(lockPath())).toThrow('ENOENT');
  });

  it('does not remove a lock it does not own on release', () => {
    const lockFile = lockPath();
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: 1, token: 'foreign', created: 'now' }),
    );

    releaseReconcileLock(destinations, 'my-token');
    expect(fs.statSync(lockFile).isFile()).toBe(true);
  });

  it('propagates unexpected stat errors from lockDir creation', () => {
    const badDest: MigrationDestinations = {
      ...destinations,
      dataDir: path.join(dataDir, 'sub', '\0'),
    };
    expect(() => acquireReconcileLock(badDest)).toThrow(
      /directory|error|ENOENT|path/i,
    );
  });
});
