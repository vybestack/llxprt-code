/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { KeyringTokenStore } from '../keyring-token-store.js';
import {
  serializeOwnerMetadata,
  buildCurrentProcessOwnerMetadata,
} from '../lock-owner.js';
import { hostname as nodeHostname } from 'node:os';
import type { OAuthToken } from '../types.js';
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

const validToken: OAuthToken = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'Bearer',
};

describe('KeyringTokenStore lock inspection API (issue #2819)', () => {
  let tempDir: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-lock-inspection-'));
    lockDir = path.join(tempDir, 'locks');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStore(
    secureStore: ISecureStore = createInMemorySecureStore(),
  ): KeyringTokenStore {
    return new KeyringTokenStore({
      secureStore,
      lockDir,
      logger: createNoOpLogger(),
    });
  }

  function authLockPath(provider: string, bucket?: string): string {
    const resolved = bucket ?? 'default';
    return resolved === 'default'
      ? path.join(lockDir, `${provider}-auth.lock`)
      : path.join(lockDir, `${provider}-${resolved}-auth.lock`);
  }

  it('reports absent lock status', async () => {
    const store = createStore();
    const status = await store.inspectAuthLock('codex', 'default');
    expect(status.exists).toBe(false);
    expect(status.classification).toBe('absent');
  });

  it.runIf(['darwin', 'linux', 'freebsd'].includes(process.platform))(
    'reports current-schema lock with canonical owner identity',
    async () => {
      const store = createStore();
      const owner = await buildCurrentProcessOwnerMetadata(500);
      expect(owner.startTimeSource).toBe('canonical');
      const lockPath = authLockPath('codex', 'default');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
        mode: 0o600,
      });

      const status = await store.inspectAuthLock('codex', 'default');
      expect(status.exists).toBe(true);
      expect(status.classification).toBe('versioned');
      expect(status.canonicalPath).toBe(lockPath);
      expect(status.ownerPid).toBe(process.pid);
      expect(status.ownerStartTimeSource).toBe('canonical');
      expect(status.liveness.status).toBe('live');
      expect(status.tokenVisibility.status).toBe('invalid');
    },
  );

  it('reports legacy lock classification as unverifiable', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, timestamp: Date.now(), token: 'old' }),
      { mode: 0o600 },
    );

    const status = await store.inspectAuthLock('codex', 'default');
    expect(status.exists).toBe(true);
    expect(status.classification).toBe('legacy');
    expect(status.ownerPid).toBe(999999);
    expect(status.ownerStartTimeSource).toBe('unavailable');
    // Legacy records lack hostname so liveness is unverifiable, not dead.
    expect(status.liveness.status).toBe('unverifiable');
  });

  it('reports malformed lock classification', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockPath, 'not valid json', { mode: 0o600 });

    const status = await store.inspectAuthLock('codex', 'default');
    expect(status.exists).toBe(true);
    expect(status.classification).toBe('malformed');
    expect(status.liveness.status).toBe('unverifiable');
  });

  it('reports tokenVisibility when a token exists for the bucket', async () => {
    const store = createStore();
    await store.saveToken('codex', validToken, 'default');

    const owner = await buildCurrentProcessOwnerMetadata(500);
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
      mode: 0o600,
    });

    const status = await store.inspectAuthLock('codex', 'default');
    expect(status.tokenVisibility.status).toBe('valid');
  });
  it('reports unknown token visibility promptly when the keychain does not respond', async () => {
    const hangingStore: ISecureStore = {
      get: async () => new Promise<string | null>(() => {}),
      set: async () => {},
      delete: async () => {},
      list: async () => [],
      has: async () => false,
    };
    const status = await createStore(hangingStore).inspectAuthLock(
      'codex',
      'default',
    );

    expect(status.tokenVisibility).toStrictEqual({
      status: 'unknown',
      diagnostic: 'Token store did not respond within 500ms',
    });
  });

  it('preserves a keychain error as the unknown token diagnostic', async () => {
    const failingStore: ISecureStore = {
      get: async () => {
        throw new Error('keychain is locked');
      },
      set: async () => {},
      delete: async () => {},
      list: async () => [],
      has: async () => false,
    };
    const status = await createStore(failingStore).inspectAuthLock(
      'codex',
      'default',
    );

    expect(status.tokenVisibility).toStrictEqual({
      status: 'unknown',
      diagnostic: 'keychain is locked',
    });
  });

  it('never exposes owner tokens or credentials in status', async () => {
    const store = createStore();
    const owner = await buildCurrentProcessOwnerMetadata(500);
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
      mode: 0o600,
    });

    const status = await store.inspectAuthLock('codex', 'default');
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(owner.ownerToken);
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
  });

  it('recoverAuthLock removes only a proven-dead lock, never tokens', async () => {
    const store = createStore();
    await store.saveToken('codex', validToken, 'default');

    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    // Write a dead-owner versioned lock (PID 999999 with canonical start time
    // on this host → liveness is dead).
    const deadOwner = {
      version: 1,
      ownerToken: 'dead-owner-token',
      pid: 999999,
      hostname: nodeHostname(),
      startTimeMs: Date.now() - 100_000,
      startTimeSource: 'canonical' as const,
    };
    await fs.writeFile(lockPath, serializeOwnerMetadata(deadOwner), {
      mode: 0o600,
    });

    const result = await store.recoverAuthLock('codex', 'default');
    expect(result.recovered).toBe(true);

    await expect(fs.stat(lockPath)).rejects.toThrow('ENOENT');
    const token = await store.getToken('codex', 'default');
    expect(token).not.toBeNull();
    expect(token?.access_token).toBe('test-access-token');
  });

  it.runIf(['darwin', 'linux', 'freebsd'].includes(process.platform))(
    'recoverAuthLock refuses a verified-live owner',
    async () => {
      const store = createStore();
      const owner = await buildCurrentProcessOwnerMetadata(500);
      expect(owner.startTimeSource).toBe('canonical');
      const lockPath = authLockPath('codex', 'default');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
        mode: 0o600,
      });

      const result = await store.recoverAuthLock('codex', 'default');
      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('live');
      await expect(fs.stat(lockPath)).resolves.toBeDefined();
    },
  );

  it('recoverAuthLock directs legacy lock recovery to the force path', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, timestamp: Date.now(), token: 'old' }),
      { mode: 0o600 },
    );

    const result = await store.recoverAuthLock('codex', 'default');
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe(
      'Lock is legacy; use force recovery to remove it',
    );
    await expect(fs.stat(lockPath)).resolves.toBeDefined();
  });

  it('forceRecoverAuthLock removes a legacy lock with ack after fingerprint match', async () => {
    const store = createStore();
    await store.saveToken('codex', validToken, 'default');

    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, timestamp: Date.now(), token: 'old' }),
      { mode: 0o600 },
    );

    const result = await store.forceRecoverAuthLock('codex', 'default', {
      acknowledgeAllStopped: true,
    });
    expect(result.recovered).toBe(true);
    await expect(fs.stat(lockPath)).rejects.toThrow('ENOENT');

    const token = await store.getToken('codex', 'default');
    expect(token).not.toBeNull();
  });

  it.runIf(['darwin', 'linux', 'freebsd'].includes(process.platform))(
    'forceRecoverAuthLock refuses a verified-live owner even with acknowledgment',
    async () => {
      const store = createStore();
      const owner = await buildCurrentProcessOwnerMetadata(500);
      expect(owner.startTimeSource).toBe('canonical');
      const lockPath = authLockPath('codex', 'default');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(lockPath, serializeOwnerMetadata(owner), {
        mode: 0o600,
      });

      const result = await store.forceRecoverAuthLock('codex', 'default', {
        acknowledgeAllStopped: true,
      });
      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('live');
      await expect(fs.stat(lockPath)).resolves.toBeDefined();
    },
  );

  it('forceRecoverAuthLock requires explicit acknowledgment for legacy residue', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockPath, 'not valid json', { mode: 0o600 });

    const resultWithoutAck = await store.forceRecoverAuthLock(
      'codex',
      'default',
    );
    expect(resultWithoutAck.recovered).toBe(false);
    expect(resultWithoutAck.reason).toContain('acknowledge');

    const resultWithAck = await store.forceRecoverAuthLock('codex', 'default', {
      acknowledgeAllStopped: true,
    });
    expect(resultWithAck.recovered).toBe(true);
    await expect(fs.stat(lockPath)).rejects.toThrow('ENOENT');
  });

  it('forceRecoverAuthLock preserves a successor that appears after inspection and fence acquisition', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    const fencePath = `${lockPath}.fence`;
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, timestamp: Date.now(), token: 'old' }),
      { mode: 0o600 },
    );
    const successor = {
      ...(await buildCurrentProcessOwnerMetadata(500)),
      ownerToken: 'live-successor-after-inspection',
    };
    const originalLink = fs.link.bind(fs);
    const linkSpy = vi
      .spyOn(fs, 'link')
      .mockImplementation(async (existingPath, newPath) => {
        await originalLink(existingPath, newPath);
        if (String(newPath) === fencePath) {
          await fs.writeFile(lockPath, serializeOwnerMetadata(successor), {
            mode: 0o600,
          });
        }
      });

    try {
      const result = await store.forceRecoverAuthLock('codex', 'default', {
        acknowledgeAllStopped: true,
      });

      expect(result).toMatchObject({
        recovered: false,
        reason:
          'Lock content or owner changed since inspection — refusing to delete a potential successor',
      });
      expect(await fs.readFile(lockPath, 'utf8')).toBe(
        serializeOwnerMetadata(successor),
      );
    } finally {
      linkSpy.mockRestore();
    }
  });

  it('forceRecoverAuthLock leaves the lock untouched when another contender owns the fence', async () => {
    const store = createStore();
    const lockPath = authLockPath('codex', 'default');
    const fencePath = `${lockPath}.fence`;
    const legacyContent = JSON.stringify({
      pid: 999999,
      timestamp: Date.now(),
      token: 'old',
    });
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(lockPath, legacyContent, { mode: 0o600 });
    await fs.writeFile(
      fencePath,
      serializeOwnerMetadata(await buildCurrentProcessOwnerMetadata(500)),
      { mode: 0o600 },
    );

    const result = await store.forceRecoverAuthLock('codex', 'default', {
      acknowledgeAllStopped: true,
    });

    expect(result).toMatchObject({
      recovered: false,
      reason: 'Another contender holds the recovery fence',
    });
    expect(await fs.readFile(lockPath, 'utf8')).toBe(legacyContent);
  });
});
