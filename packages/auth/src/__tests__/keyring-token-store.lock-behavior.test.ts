/**
 * @license
 * Copyright 2025 Vybestack LLC
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

describe('KeyringTokenStore advisory lock behavior', () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-lock-behavior-'));
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

  it('requires lockDir in the injected directory', () => {
    expect(
      () =>
        new KeyringTokenStore({
          secureStore: createInMemorySecureStore(),
          logger: createNoOpLogger(),
        } as never),
    ).toThrow(/createKeyringTokenStore/);
  });

  it('creates the lock file inside the injected lockDir', async () => {
    const store = createStore();
    const acquired = await store.acquireRefreshLock('codex', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);

    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);

    await store.releaseRefreshLock('codex');
  });

  it('serializes two live contenders across separate instances', async () => {
    const storeA = createStore();
    const storeB = createStore();

    expect(await storeA.acquireRefreshLock('anthropic', { waitMs: 1000 })).toBe(
      true,
    );

    const bPromise = storeB.acquireRefreshLock('anthropic', { waitMs: 2000 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(
      fs.stat(path.join(lockDir, 'anthropic-refresh.lock')),
    ).resolves.toBeDefined();

    await storeA.releaseRefreshLock('anthropic');
    const bAcquired = await bPromise;
    expect(bAcquired).toBe(true);

    await storeB.releaseRefreshLock('anthropic');
  });

  it('does not reclaim a dead-owner lock (safety over availability)', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    const stalePayload = {
      pid: 999999,
      timestamp: Date.now(),
      token: 'dead-owner',
    };
    await fs.writeFile(lockFile, JSON.stringify(stalePayload), {
      mode: 0o600,
    });

    const store = createStore();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 300,
    });
    // No PID-liveness reclaim: a stale orphan is treated as busy and deferred.
    // The caller must restart or remove the orphan manually.
    expect(acquired).toBe(false);
    // The orphaned lock is left in place for manual cleanup.
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);
  });

  it('defers on a malformed/tokenless lock (no mtime reclaim)', async () => {
    const lockFile = path.join(lockDir, 'gemini-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockFile, 'not valid json', { mode: 0o600 });

    const store = createStore();
    const acquired = await store.acquireRefreshLock('gemini', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
    // The malformed lock is left in place for manual cleanup.
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);
  });

  it('removes own lock on release', async () => {
    const store = createStore();
    await store.acquireRefreshLock('gemini', { waitMs: 500 });
    const lockFile = path.join(lockDir, 'gemini-refresh.lock');
    await expect(fs.stat(lockFile)).resolves.toBeDefined();

    await store.releaseRefreshLock('gemini');
    await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove a lock it does not own on release', async () => {
    const store = createStore();
    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({ pid: 1, timestamp: Date.now(), token: 'foreign' }),
      { mode: 0o600 },
    );

    await store.releaseRefreshLock('codex');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);
  });

  it('does not steal a live lock held by another process', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        token: 'live-owner',
      }),
      { mode: 0o600 },
    );

    const store = createStore();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
  });

  it('propagates unexpected write errors from lockDir creation', async () => {
    const store = new KeyringTokenStore({
      secureStore: createInMemorySecureStore(),
      lockDir: path.join(lockDir, 'subdir', '\0'),
      logger: createNoOpLogger(),
    });
    await expect(
      store.acquireRefreshLock('codex', { waitMs: 100 }),
    ).rejects.toThrow(/lock|directory|error/i);
  });

  it('respects the wait timeout when the lock stays busy', async () => {
    const lockFile = path.join(lockDir, 'anthropic-refresh.lock');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockFile,
      JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        token: 'perpetual',
      }),
      { mode: 0o600 },
    );

    const store = createStore();
    const start = Date.now();
    const acquired = await store.acquireRefreshLock('anthropic', {
      waitMs: 200,
    });
    expect(acquired).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });
});
