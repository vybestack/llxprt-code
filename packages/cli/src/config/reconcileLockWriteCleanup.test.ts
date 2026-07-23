/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// vi.mock hoists before imports; we need the real fs for test setup/teardown.
// The mock wraps real fs functions and overrides only writeSync/fsyncSync
// when a test-specific failure is injected via the mutable flags below.
let writeSyncError: Error | null = null;
let fsyncSyncError: Error | null = null;
let unlinkSyncError: Error | null = null;
let closeSyncError: Error | null = null;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: vi.fn((...args: Parameters<typeof fs.writeSync>) => {
      if (writeSyncError) throw writeSyncError;
      return actual.writeSync(...args);
    }),
    fsyncSync: vi.fn((...args: Parameters<typeof fs.fsyncSync>) => {
      if (fsyncSyncError) throw fsyncSyncError;
      return actual.fsyncSync(...args);
    }),
    unlinkSync: vi.fn((...args: Parameters<typeof fs.unlinkSync>) => {
      if (unlinkSyncError) throw unlinkSyncError;
      return actual.unlinkSync(...args);
    }),
    closeSync: vi.fn((...args: Parameters<typeof fs.closeSync>) => {
      if (closeSyncError) throw closeSyncError;
      return actual.closeSync(...args);
    }),
  };
});

// Import AFTER the mock is set up.
const {
  acquireReconcileLock,
  releaseReconcileLock,
  MEMORY_RECONCILE_LOCK_FILE,
} = await import('./reconcileLock.js');
import type { MigrationDestinations } from './migrationTypes.js';

describe('reconcileLock write-failure cleanup', () => {
  let root: string;
  let dataDir: string;
  let destinations: MigrationDestinations;

  beforeEach(() => {
    writeSyncError = null;
    fsyncSyncError = null;
    unlinkSyncError = null;
    closeSyncError = null;

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-lock-cleanup-'));
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

  function captureAcquireError(): unknown {
    try {
      acquireReconcileLock(destinations);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it('removes the orphaned lock and surfaces the error when writeSync fails after open', () => {
    writeSyncError = Object.assign(new Error('simulated disk full'), {
      code: 'ENOSPC',
    });

    expect(() => acquireReconcileLock(destinations)).toThrow(
      /simulated disk full/,
    );

    // The orphaned lock file must NOT remain — it would permanently block
    // every subsequent acquireReconcileLock call (which has no PID reclaim).
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('succeeds on subsequent acquire after a write-failure cleanup (no permanent orphan)', () => {
    writeSyncError = Object.assign(new Error('simulated disk full'), {
      code: 'ENOSPC',
    });
    expect(() => acquireReconcileLock(destinations)).toThrow(
      /simulated disk full/,
    );

    writeSyncError = null;
    const token = acquireReconcileLock(destinations);
    expect(typeof token).toBe('string');
    releaseReconcileLock(destinations, token);
  });

  it('surfaces both the write error and a cleanup error when both fail', () => {
    writeSyncError = Object.assign(new Error('simulated disk full'), {
      code: 'ENOSPC',
    });
    unlinkSyncError = Object.assign(new Error('simulated cleanup I/O'), {
      code: 'EIO',
    });

    const error = captureAcquireError();
    expect(error).toBeInstanceOf(AggregateError);
    const errors =
      error instanceof AggregateError ? error.errors.map(String) : [];
    expect(errors).toStrictEqual([
      'Error: simulated disk full',
      'Error: simulated cleanup I/O',
    ]);
  });

  it('removes the orphaned lock and surfaces the error when fsyncSync fails', () => {
    fsyncSyncError = Object.assign(new Error('simulated fsync I/O'), {
      code: 'EIO',
    });

    expect(() => acquireReconcileLock(destinations)).toThrow(
      /simulated fsync I\/O/,
    );
    expect(fs.existsSync(lockPath())).toBe(false);
  });
});
