/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createKeyringTokenStore } from './auth-factories.js';

const ENV_KEYS = [
  'LLXPRT_LOG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CONFIG_HOME',
  'HOME',
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

/**
 * Structural code assertion that a path does not exist on the filesystem.
 * Resolves true when the path is absent (ENOENT), and rejects for any other
 * access error so an unexpected I/O failure stays observable. Replaces
 * `rejects.toThrow('ENOENT')` string-fragment assertions with a behavioral
 * assertion on the actual contract (the path is gone).
 */
async function pathDoesNotExist(p: string): Promise<boolean> {
  try {
    await fs.access(p);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return true;
    }
    throw error;
  }
  return false;
}

describe('createKeyringTokenStore lock/fallback path resolution (P8/P7)', () => {
  let root: string;
  let logHome: string;
  let dataHome: string;
  let fakeHome: string;

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-auth-factory-'));
    logHome = path.join(root, 'log');
    dataHome = path.join(root, 'data');
    fakeHome = path.join(root, 'fake-home');
    await fs.mkdir(logHome, { recursive: true });
    await fs.mkdir(dataHome, { recursive: true });
    await fs.mkdir(fakeHome, { recursive: true });
    process.env['LLXPRT_LOG_HOME'] = logHome;
    process.env['LLXPRT_DATA_HOME'] = dataHome;
    process.env['HOME'] = fakeHome;
  });

  afterEach(async () => {
    restoreEnv();
    // Remove the single parent root so no temp dir leaks.
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates OAuth advisory locks under LLXPRT_LOG_HOME/oauth/locks and removes them on release', async () => {
    const tokenStore = createKeyringTokenStore();
    const acquired = await tokenStore.acquireRefreshLock('codex', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);

    const lockFile = path.join(logHome, 'oauth', 'locks', 'codex-refresh.lock');
    await expect
      .poll(
        () =>
          fs
            .stat(lockFile)
            .then((s) => s.isFile())
            .catch(() => false),
        { timeout: 1000, intervals: [20, 40] },
      )
      .toBe(true);

    await tokenStore.releaseRefreshLock('codex');

    // The lock file must be removed after release so it does not block future
    // operations or leak as a stale lock. Structural assertion on the absence
    // of the path, not on an error message string.
    await expect(pathDoesNotExist(lockFile)).resolves.toBe(true);
  });

  it('serializes concurrent acquire attempts for the same provider (edge case)', async () => {
    const tokenStore = createKeyringTokenStore();
    const first = await tokenStore.acquireRefreshLock('openai', {
      waitMs: 1000,
    });
    expect(first).toBe(true);

    // A second acquire for the same provider while the first is held must fail
    // (the lock is already held), proving mutual exclusion.
    const second = await tokenStore.acquireRefreshLock('openai', {
      waitMs: 200,
    });
    expect(second).toBe(false);

    await tokenStore.releaseRefreshLock('openai');
    const lockFile = path.join(
      logHome,
      'oauth',
      'locks',
      'openai-refresh.lock',
    );
    // Structural assertion: the released lock path no longer exists.
    await expect(pathDoesNotExist(lockFile)).resolves.toBe(true);
  });

  it('does not create any files under the legacy ~/.llxprt/oauth path', async () => {
    const tokenStore = createKeyringTokenStore();
    await tokenStore.acquireRefreshLock('gemini', { waitMs: 1000 });
    await tokenStore.releaseRefreshLock('gemini');

    const legacyOauthDir = path.join(fakeHome, '.llxprt', 'oauth');
    // Structural assertion: no legacy oauth directory was created.
    await expect(pathDoesNotExist(legacyOauthDir)).resolves.toBe(true);
  });
});
