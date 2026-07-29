/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KeyringTokenStore } from '../keyring-token-store.js';
import type { IDebugLogger, ISecureStore } from '../interfaces/index.js';

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

async function writeLegacyLock(
  lockPath: string,
  pid: number,
  token = 'legacy-token',
): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    JSON.stringify({ pid, timestamp: Date.now(), token }),
    { mode: 0o600 },
  );
}

describe('Legacy v0.10 lock handling (issue #2819 — unverifiable, no auto-reclaim)', () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'auth-legacy-lock-recovery-'),
    );
    lockDir = path.join(tempDir, 'locks');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStore(): KeyringTokenStore {
    return new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir,
      logger: createNoOpLogger(),
    });
  }

  function refreshLockPath(provider: string): string {
    return path.join(lockDir, `${provider}-refresh.lock`);
  }

  function authLockPath(provider: string, bucket?: string): string {
    const resolved = bucket ?? 'default';
    return resolved === 'default'
      ? path.join(lockDir, `${provider}-auth.lock`)
      : path.join(lockDir, `${provider}-${resolved}-auth.lock`);
  }

  it('does NOT auto-reclaim a legacy lock with a non-existent PID because its owner is unverifiable', async () => {
    const lockFile = refreshLockPath('codex');
    await writeLegacyLock(lockFile, 999999);

    const store = createStore();
    // Legacy records lack hostname/start-time identity, so local ESRCH
    // cannot prove a remote process dead. Automatic reclaim is stopped.
    const acquired = await store.acquireRefreshLock('codex', { waitMs: 300 });
    expect(acquired).toBe(false);
    await expect(fs.stat(lockFile)).resolves.toBeDefined();
  });

  it('does NOT auto-reclaim a legacy lock when the PID is alive (our own process)', async () => {
    const lockFile = authLockPath('codex', 'default');
    await writeLegacyLock(lockFile, process.pid);

    const store = createStore();
    const acquired = await store.acquireAuthLock('codex', { waitMs: 200 });
    expect(acquired).toBe(false);
    await expect(fs.stat(lockFile)).resolves.toBeDefined();
  });

  it('does NOT auto-reclaim a legacy lock when the PID is unverifiable (permission denied)', async () => {
    const lockFile = refreshLockPath('codex');
    // PID 1 is always alive but legacy data lacks hostname/start identity
    // to prove it's the same process — must defer conservatively.
    await writeLegacyLock(lockFile, 1);

    const store = createStore();
    const acquired = await store.acquireRefreshLock('codex', { waitMs: 200 });
    expect(acquired).toBe(false);
  });

  it('classifies legacy locks as unverifiable in inspectAuthLock', async () => {
    const lockFile = authLockPath('codex', 'default');
    await writeLegacyLock(lockFile, 999999);

    const store = createStore();
    const status = await store.inspectAuthLock('codex', 'default');
    expect(status.exists).toBe(true);
    expect(status.classification).toBe('legacy');
    expect(status.liveness.status).toBe('unverifiable');
  });

  it('forceRecoverAuthLock removes a legacy lock with explicit acknowledgment', async () => {
    const lockFile = authLockPath('codex', 'default');
    await writeLegacyLock(lockFile, 999999);

    const store = createStore();

    // Without ack → refuses
    const resultWithoutAck = await store.forceRecoverAuthLock(
      'codex',
      'default',
    );
    expect(resultWithoutAck.recovered).toBe(false);
    expect(resultWithoutAck.reason).toContain('acknowledge');

    // With ack → removes (content unchanged since inspection)
    const resultWithAck = await store.forceRecoverAuthLock('codex', 'default', {
      acknowledgeAllStopped: true,
    });
    expect(resultWithAck.recovered).toBe(true);
    await expect(fs.stat(lockFile)).rejects.toThrow('ENOENT');
  });

  it('does not recover a malformed legacy payload', async () => {
    const lockFile = refreshLockPath('malformed');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockFile, 'not valid json', { mode: 0o600 });

    const store = createStore();
    const acquired = await store.acquireRefreshLock('malformed', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
  });
});
