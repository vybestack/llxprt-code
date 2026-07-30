/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { hostname as nodeHostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IDebugLogger, ISecureStore } from '../interfaces/index.js';
import { KeyringTokenStore } from '../keyring-token-store.js';
import {
  buildCurrentProcessOwnerMetadata,
  parseOwnerMetadata,
  serializeOwnerMetadata,
  type LockOwnerMetadata,
} from '../lock-owner.js';
import {
  forceRecoverAuthLock,
  recoverAuthLock,
  type LockRecoveryDeps,
} from '../lock-inspection-ops.js';

function createInMemorySecureStore(): ISecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

function createNoOpLogger(): IDebugLogger {
  return {
    debug: () => {},
    error: () => {},
    warn: () => {},
    log: () => {},
  };
}

function deadOwner(): LockOwnerMetadata {
  return {
    version: 1,
    ownerToken: 'dead-owner-A-token',
    pid: 2_147_483_647,
    hostname: nodeHostname(),
    startTimeMs: Date.now() - 100_000,
    startTimeSource: 'canonical',
  };
}

async function liveSuccessor(): Promise<LockOwnerMetadata> {
  return {
    ...(await buildCurrentProcessOwnerMetadata(500)),
    ownerToken: 'live-successor-B-token',
  };
}

describe('auth lock recovery successor races', () => {
  let tempDir: string;
  let lockDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'auth-successor-race-'));
    lockDir = join(tempDir, 'locks');
    lockPath = join(lockDir, 'codex-auth.lock');
    await fs.mkdir(lockDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function isEnoent(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }

  async function ignoreEnoent(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
    }
  }

  async function removeOwnedFile(
    filePath: string,
    ownerToken: string,
  ): Promise<void> {
    await ignoreEnoent(async () => {
      const owner = parseOwnerMetadata(await fs.readFile(filePath, 'utf8'));
      if (owner?.ownerToken === ownerToken) {
        await fs.unlink(filePath);
      }
    });
  }

  async function removeFileIfExists(filePath: string): Promise<void> {
    await ignoreEnoent(() => fs.unlink(filePath));
  }

  function recoveryDeps(
    tryWinFence: LockRecoveryDeps['tryWinFence'],
  ): LockRecoveryDeps {
    return {
      authLockFilePath: () => lockPath,
      getToken: async () => {
        throw new Error('recovery must not read the token store');
      },
      readRawOwnerContent: (filePath) => fs.readFile(filePath, 'utf8'),
      tryWinFence,
      removeOwnedFile,
      removeFileIfExists,
    };
  }

  async function writeOwner(owner: LockOwnerMetadata): Promise<void> {
    await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
      mode: 0o600,
    });
  }

  it('safe recovery preserves live successor B that replaces dead A after inspection', async () => {
    await writeOwner(deadOwner());
    const successor = await liveSuccessor();
    const deps = recoveryDeps(async () => {
      await writeOwner(successor);
      return 'won';
    });

    const result = await recoverAuthLock(deps, 'codex', undefined, 'default');

    expect(result.recovered).toBe(false);
    expect(
      parseOwnerMetadata(await fs.readFile(lockPath, 'utf8')),
    ).toStrictEqual(successor);
  });

  it('forced recovery preserves live successor B that replaces dead A after inspection', async () => {
    await writeOwner(deadOwner());
    const successor = await liveSuccessor();
    const deps = recoveryDeps(async () => {
      await writeOwner(successor);
      return 'won';
    });

    const result = await forceRecoverAuthLock(
      deps,
      'codex',
      undefined,
      'default',
      { acknowledgeAllStopped: true },
    );

    expect(result.recovered).toBe(false);
    expect(
      parseOwnerMetadata(await fs.readFile(lockPath, 'utf8')),
    ).toStrictEqual(successor);
  });

  it('safe recovery succeeds when the lock disappears after winning the fence', async () => {
    await writeOwner(deadOwner());
    const deps = recoveryDeps(async () => {
      await fs.unlink(lockPath);
      return 'won';
    });

    const result = await recoverAuthLock(deps, 'codex', undefined, 'default');

    expect(result).toMatchObject({
      recovered: true,
      reason: 'Lock was already absent after fenced takeover',
    });
  });

  it('forced recovery succeeds when the lock disappears after winning the fence', async () => {
    await writeOwner(deadOwner());
    const deps = recoveryDeps(async () => {
      await fs.unlink(lockPath);
      return 'won';
    });

    const result = await forceRecoverAuthLock(
      deps,
      'codex',
      undefined,
      'default',
      { acknowledgeAllStopped: true },
    );

    expect(result).toMatchObject({
      recovered: true,
      reason: 'Lock was already absent after fenced takeover',
    });
  });

  it('forced recovery leaves dead A untouched after losing the fence', async () => {
    const owner = deadOwner();
    await writeOwner(owner);

    const result = await forceRecoverAuthLock(
      recoveryDeps(async () => 'lost'),
      'codex',
      undefined,
      'default',
      { acknowledgeAllStopped: true },
    );

    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('Another contender holds the recovery fence');
    expect(
      parseOwnerMetadata(await fs.readFile(lockPath, 'utf8')),
    ).toStrictEqual(owner);
  });

  it('cleans an owned fence when fence acquisition throws', async () => {
    await writeOwner(deadOwner());
    const fencePath = `${lockPath}.fence`;
    const deps = recoveryDeps(async (filePath, owner) => {
      await fs.writeFile(filePath, serializeOwnerMetadata(owner), {
        mode: 0o600,
      });
      throw new Error('fence publication failed after ownership');
    });

    await expect(
      recoverAuthLock(deps, 'codex', undefined, 'default'),
    ).rejects.toThrow('fence publication failed after ownership');
    await expect(fs.stat(fencePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('safe recovery removes stable dead A after re-probing it under the fence', async () => {
    await writeOwner(deadOwner());

    const result = await recoverAuthLock(
      recoveryDeps(async () => 'won'),
      'codex',
      undefined,
      'default',
    );

    expect(result.recovered).toBe(true);
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('safe recovery reports fence cleanup failure without masking successful recovery', async () => {
    await writeOwner(deadOwner());
    const deps: LockRecoveryDeps = {
      ...recoveryDeps(async () => 'won'),
      removeOwnedFile: async () => {
        throw new Error('fence cleanup denied');
      },
    };

    const result = await recoverAuthLock(deps, 'codex', undefined, 'default');

    expect(result).toMatchObject({
      recovered: true,
      cleanupDiagnostic: 'Recovery fence cleanup failed: fence cleanup denied',
    });
  });

  it('forced recovery reports fence cleanup failure without masking its primary result', async () => {
    await writeOwner(deadOwner());
    const deps: LockRecoveryDeps = {
      ...recoveryDeps(async () => 'won'),
      removeOwnedFile: async () => {
        throw new Error('force fence cleanup denied');
      },
    };

    const result = await forceRecoverAuthLock(
      deps,
      'codex',
      undefined,
      'default',
      { acknowledgeAllStopped: true },
    );

    expect(result).toMatchObject({
      recovered: true,
      cleanupDiagnostic:
        'Recovery fence cleanup failed: force fence cleanup denied',
    });
  });

  it('real store can reacquire after public recovery without poisoned ownership', async () => {
    const store = new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir,
      logger: createNoOpLogger(),
    });
    await writeOwner(deadOwner());

    const recovered = await store.recoverAuthLock('codex', 'default');
    let acquired = false;
    try {
      acquired = await store.acquireAuthLock('codex', {
        bucket: 'default',
        waitMs: 2_000,
      });

      expect({ recovered: recovered.recovered, acquired }).toStrictEqual({
        recovered: true,
        acquired: true,
      });
    } finally {
      if (acquired) {
        await store.releaseAuthLock('codex', 'default');
      }
    }
  });
});
