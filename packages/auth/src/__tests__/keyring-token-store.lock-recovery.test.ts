/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  computeBackoffDelay,
  KeyringTokenStore,
} from '../keyring-token-store.js';
import {
  buildCurrentProcessOwnerMetadata,
  buildOwnerMetadata,
  getProcessStartTimeMs,
  parseOwnerMetadata,
  probeOwnerLiveness,
  serializeOwnerMetadata,
  type LockOwnerMetadata,
} from '../lock-owner.js';
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

/**
 * Write a versioned lock file at lockPath with the given owner metadata
 * encoded as the current-version payload. Mirrors what the store writes.
 */
async function writeVersionedLock(
  lockPath: string,
  owner: LockOwnerMetadata,
): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
    mode: 0o600,
  });
}

describe('KeyringTokenStore dead-owner lock recovery (issue #2819)', () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-lock-recovery-'));
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

  function refreshLockPath(provider: string, bucket?: string): string {
    const resolved = bucket ?? 'default';
    return resolved === 'default'
      ? path.join(lockDir, `${provider}-refresh.lock`)
      : path.join(lockDir, `${provider}-${resolved}-refresh.lock`);
  }

  function authLockPath(provider: string, bucket?: string): string {
    const resolved = bucket ?? 'default';
    return resolved === 'default'
      ? path.join(lockDir, `${provider}-auth.lock`)
      : path.join(lockDir, `${provider}-${resolved}-auth.lock`);
  }

  describe('dead-owner recovery', () => {
    it('recovers a refresh lock whose owner PID is dead on the current host', async () => {
      const lockFile = refreshLockPath('codex');
      await writeVersionedLock(lockFile, {
        version: 1,
        ownerToken: 'dead-refresh-owner',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const store = createStore();
      const acquired = await store.acquireRefreshLock('codex', {
        waitMs: 1000,
      });
      expect(acquired).toBe(true);
      await store.releaseRefreshLock('codex');
    });

    it('recovers an auth lock whose owner PID is dead on the current host', async () => {
      const lockFile = authLockPath('codex', 'default');
      await writeVersionedLock(lockFile, {
        version: 1,
        ownerToken: 'dead-auth-owner',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const store = createStore();
      const acquired = await store.acquireAuthLock('codex', {
        waitMs: 1000,
      });
      expect(acquired).toBe(true);
      await store.releaseAuthLock('codex');
    });

    it('recovers a per-bucket auth lock with a dead owner', async () => {
      const lockFile = authLockPath('codex', 'work');
      await writeVersionedLock(lockFile, {
        version: 1,
        ownerToken: 'dead-bucket-owner',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const store = createStore();
      const acquired = await store.acquireAuthLock('codex', {
        waitMs: 1000,
        bucket: 'work',
      });
      expect(acquired).toBe(true);
      await store.releaseAuthLock('codex', 'work');
    });
  });

  describe('live-owner safety', () => {
    it('does NOT steal a lock held by a live owner on the current host', async () => {
      const lockFile = refreshLockPath('anthropic');
      const owner = buildOwnerMetadata(getProcessStartTimeMs());
      await writeVersionedLock(lockFile, owner);

      // A different store instance (simulating a different contender) must
      // defer because the PID is alive and the start-time identity matches.
      const store = createStore();
      const acquired = await store.acquireRefreshLock('anthropic', {
        waitMs: 200,
      });
      expect(acquired).toBe(false);
      // Lock left in place for the live owner.
      await expect(fs.stat(lockFile)).resolves.toBeDefined();
    });

    it('does NOT steal an auth lock held by a live owner', async () => {
      const lockFile = authLockPath('codex', 'default');
      const owner = buildOwnerMetadata(getProcessStartTimeMs());
      await writeVersionedLock(lockFile, owner);

      const store = createStore();
      const acquired = await store.acquireAuthLock('codex', {
        waitMs: 200,
      });
      expect(acquired).toBe(false);
    });
  });

  describe.runIf(['darwin', 'linux', 'freebsd'].includes(process.platform))(
    'recycled-PID recovery',
    () => {
      it('recovers when a dead predecessor shared our PID but had a different start time', async () => {
        const lockFile = refreshLockPath('gemini');
        const currentOwner = await buildCurrentProcessOwnerMetadata(500);
        expect(currentOwner.startTimeSource).toBe('canonical');
        await writeVersionedLock(lockFile, {
          ...currentOwner,
          ownerToken: 'predecessor-owner',
          startTimeMs: currentOwner.startTimeMs - 120_000,
        });

        const store = createStore();
        const acquired = await store.acquireRefreshLock('gemini', {
          waitMs: 1000,
        });
        expect(acquired).toBe(true);
        await store.releaseRefreshLock('gemini');
      });
    },
  );

  describe('conservative deferral', () => {
    it('treats a lock owned by a different host as unverifiable and defers', async () => {
      const lockFile = refreshLockPath('openai');
      await writeVersionedLock(lockFile, {
        version: 1,
        ownerToken: 'remote-owner',
        pid: 999999,
        hostname: 'some-other-host-12345',
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const store = createStore();
      const acquired = await store.acquireRefreshLock('openai', {
        waitMs: 200,
      });
      // Different host → cannot prove dead → conservative defer.
      expect(acquired).toBe(false);
    });

    it('defers on a legacy payload with a non-existent PID because its owner is unverifiable', async () => {
      const lockFile = refreshLockPath('legacy');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(
        lockFile,
        JSON.stringify({ pid: 999999, timestamp: Date.now(), token: 'old' }),
        { mode: 0o600 },
      );

      const store = createStore();
      // Legacy records lack hostname/start-time identity, so local ESRCH
      // cannot prove a remote process dead. Auto-reclaim is stopped.
      const acquired = await store.acquireRefreshLock('legacy', {
        waitMs: 300,
      });
      expect(acquired).toBe(false);
    });

    it('defers on a legacy payload whose PID is alive (no hostname/start identity to prove reuse)', async () => {
      const lockFile = refreshLockPath('legacy-live');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
          token: 'old',
        }),
        { mode: 0o600 },
      );

      const store = createStore();
      const acquired = await store.acquireRefreshLock('legacy-live', {
        waitMs: 200,
      });
      expect(acquired).toBe(false);
    });

    it('defers on a malformed payload', async () => {
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

  describe('fenced takeover protocol', () => {
    it('exactly one contender wins when multiple recover a dead-owner lock', async () => {
      const lockFile = refreshLockPath('codex');
      await writeVersionedLock(lockFile, {
        version: 1,
        ownerToken: 'dead-owner-shared',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const storeA = createStore();
      const storeB = createStore();
      const storeC = createStore();

      const results = await Promise.all([
        storeA.acquireRefreshLock('codex', { waitMs: 2000 }),
        storeB.acquireRefreshLock('codex', { waitMs: 2000 }),
        storeC.acquireRefreshLock('codex', { waitMs: 2000 }),
      ]);

      const winners = results.filter((r) => r === true);
      expect(winners).toHaveLength(1);

      await storeA.releaseRefreshLock('codex');
      await storeB.releaseRefreshLock('codex');
      await storeC.releaseRefreshLock('codex');
    });

    it('exactly one contender wins per bucket (different buckets proceed independently)', async () => {
      const lockDefault = authLockPath('codex', 'default');
      const lockWork = authLockPath('codex', 'work');

      await writeVersionedLock(lockDefault, {
        version: 1,
        ownerToken: 'dead-default',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });
      await writeVersionedLock(lockWork, {
        version: 1,
        ownerToken: 'dead-work',
        pid: 999999,
        hostname: os.hostname(),
        startTimeMs: Date.now() - 60_000,
        startTimeSource: 'approximate',
      });

      const store = createStore();
      const [defaultResult, workResult] = await Promise.all([
        store.acquireAuthLock('codex', { waitMs: 1000 }),
        store.acquireAuthLock('codex', { waitMs: 1000, bucket: 'work' }),
      ]);
      expect(defaultResult).toBe(true);
      expect(workResult).toBe(true);

      await store.releaseAuthLock('codex');
      await store.releaseAuthLock('codex', 'work');
    });
  });

  describe('release safety', () => {
    it('release never deletes a foreign lock', async () => {
      const lockFile = refreshLockPath('codex');
      const owner = buildOwnerMetadata(Date.now());
      await writeVersionedLock(lockFile, owner);

      const store = createStore();
      // release without ever acquiring — must NOT unlink the foreign lock.
      await store.releaseRefreshLock('codex');
      await expect(fs.stat(lockFile)).resolves.toBeDefined();
    });
  });
  describe('owner identity and deterministic backoff', () => {
    it('rejects metadata for an unsupported schema version', () => {
      const owner = buildOwnerMetadata(getProcessStartTimeMs());
      const parsed = parseOwnerMetadata(
        JSON.stringify({ ...owner, version: owner.version + 1 }),
      );

      expect(parsed).toBeNull();
    });

    it('proves a recycled live PID is dead by comparing kernel process identity', async () => {
      const kill = vi.fn();
      const liveness = await probeOwnerLiveness(
        {
          version: 1,
          ownerToken: 'old-owner',
          pid: 4242,
          hostname: os.hostname(),
          startTimeMs: 1000,
          startTimeSource: 'canonical',
        },
        {
          currentHostname: os.hostname(),
          currentPid: 9999,
          kill,
          getProcessStartTimeMs: async () => 5000,
        },
      );

      expect(kill).toHaveBeenCalledWith(4242, 0);
      expect(liveness.status).toBe('dead');
    });

    it('computes bounded jittered exponential delays deterministically', () => {
      const delays = [0, 1, 2, 3, 4].map((attempt) =>
        computeBackoffDelay(attempt, 100, 1000, 50, () => 0.5),
      );

      expect(delays).toStrictEqual([125, 225, 425, 825, 975]);
      expect(computeBackoffDelay(16, 100, 1000, 50, () => 0)).toBe(950);
      expect(computeBackoffDelay(16, 100, 1000, 50, () => 0.98)).toBe(999);
    });
  });

  describe('backoff (no synchronized stampede)', () => {
    it('leaves a live owner unchanged after the acquisition deadline', async () => {
      const lockFile = refreshLockPath('anthropic');
      const owner = buildOwnerMetadata(getProcessStartTimeMs());
      await writeVersionedLock(lockFile, owner);

      const store = createStore();
      const acquired = await store.acquireRefreshLock('anthropic', {
        waitMs: 100,
      });

      expect(acquired).toBe(false);
      expect(
        parseOwnerMetadata(await fs.readFile(lockFile, 'utf8')),
      ).toStrictEqual(owner);
    });
  });
});
