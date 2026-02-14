/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test for issue #1159: Token refresh race condition
 *
 * Tests KeyringTokenStore refresh lock behavior.
 * When multiple clients use the same OAuth token and try refreshing concurrently,
 * Anthropic may revoke the token. We need to:
 * 1. Check store for updated token before refreshing
 * 2. Use a lock file to prevent concurrent refreshes
 * 3. Wait for lock if recent, or break if stale
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyringTokenStore } from './keyring-token-store.js';
import { SecureStore } from '../storage/secure-store.js';
import { OAuthToken } from './types.js';
import type { KeyringAdapter } from '../storage/secure-store.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setTimeout as setTimeoutPromise } from 'timers/promises';

function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

describe('KeyringTokenStore - Token Refresh Race Condition (Issue #1159)', () => {
  let tempDir: string;
  let tokenStore: KeyringTokenStore;

  const createToken = (accessToken: string, expiresIn = 3600): OAuthToken => ({
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: 'Bearer',
    scope: null,
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'token-refresh-race-test-'));
    const lockDir = join(tempDir, 'locks');
    const secureStore = new SecureStore('llxprt-code-oauth', {
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      keyringLoader: async () => createMockKeyring(),
    });
    tokenStore = new KeyringTokenStore({ secureStore, lockDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should wait when lock is held and then acquire after release', async () => {
    await tokenStore.acquireRefreshLock('anthropic');

    const startTime = Date.now();

    const clientBPromise = (async () => {
      const acquired = await tokenStore.acquireRefreshLock('anthropic', {
        waitMs: 1500,
      });
      return { acquired, duration: Date.now() - startTime };
    })();

    await setTimeoutPromise(400);
    await tokenStore.releaseRefreshLock('anthropic');

    const result = await clientBPromise;
    expect(result.acquired).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(350);

    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should acquire lock before refreshing token', async () => {
    const originalToken = createToken('original-token');
    await tokenStore.saveToken('anthropic', originalToken);

    const lockAcquired = await tokenStore.acquireRefreshLock('anthropic');
    expect(lockAcquired).toBe(true);

    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should wait for existing recent lock before attempting refresh', async () => {
    await tokenStore.acquireRefreshLock('anthropic');

    const startTime = Date.now();

    const clientBPromise = (async () => {
      const acquired = await tokenStore.acquireRefreshLock('anthropic', {
        waitMs: 2000,
      });
      return { acquired, duration: Date.now() - startTime };
    })();

    await setTimeoutPromise(500);
    await tokenStore.releaseRefreshLock('anthropic');

    const result = await clientBPromise;
    expect(result.acquired).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(400);

    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should break stale lock if older than threshold', async () => {
    // Create a lock file with an old timestamp to simulate a stale lock
    const lockDir = join(tempDir, 'locks');
    await fs.mkdir(lockDir, { recursive: true });
    const lockFile = join(lockDir, 'anthropic-refresh.lock');
    const staleLockInfo = {
      pid: 99999,
      timestamp: Date.now() - 120_000, // 2 minutes ago — well past threshold
    };
    await fs.writeFile(lockFile, JSON.stringify(staleLockInfo), {
      mode: 0o600,
    });

    // Acquire should detect the stale lock and break it
    const acquired = await tokenStore.acquireRefreshLock('anthropic', {
      staleMs: 30_000,
    });
    expect(acquired).toBe(true);

    // Verify our PID now owns the lock
    const content = await fs.readFile(lockFile, 'utf8');
    const lockInfo = JSON.parse(content);
    expect(lockInfo.pid).toBe(process.pid);

    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should prevent concurrent refresh when multiple clients race', async () => {
    const originalToken = createToken('original-token');
    await tokenStore.saveToken('anthropic', originalToken);

    let refreshCallCount = 0;
    const mockRefresh = async (): Promise<OAuthToken> => {
      refreshCallCount++;
      await setTimeoutPromise(100);
      return createToken(`refreshed-token-${refreshCallCount}`);
    };

    const clients = Array.from({ length: 5 }, async (_, i) => {
      try {
        const acquired = await tokenStore.acquireRefreshLock('anthropic', {
          waitMs: 3000,
        });

        if (acquired) {
          const recheckToken = await tokenStore.getToken('anthropic');
          if (recheckToken?.access_token !== originalToken.access_token) {
            await tokenStore.releaseRefreshLock('anthropic');
            return { client: i, refreshed: false, token: recheckToken };
          }

          const newToken = await mockRefresh();
          await tokenStore.saveToken('anthropic', newToken);
          await tokenStore.releaseRefreshLock('anthropic');
          return { client: i, refreshed: true, token: newToken };
        } else {
          const updatedToken = await tokenStore.getToken('anthropic');
          return { client: i, refreshed: false, token: updatedToken };
        }
      } catch (error) {
        return { client: i, error: String(error) };
      }
    });

    const results = await Promise.all(clients);
    const refreshedResults = results.filter(
      (r) => 'refreshed' in r && r.refreshed,
    );

    expect(refreshedResults.length).toBe(1);
    expect(refreshCallCount).toBe(1);

    const allHaveToken = results.every(
      (r) => 'token' in r && r.token?.access_token,
    );
    expect(allHaveToken).toBe(true);
  });

  it('should integrate lock mechanism with existing saveToken/getToken', async () => {
    const oldToken = createToken('old-token');
    await tokenStore.saveToken('anthropic', oldToken);

    const acquired = await tokenStore.acquireRefreshLock('anthropic');
    expect(acquired).toBe(true);

    const tokenAfterLock = await tokenStore.getToken('anthropic');
    expect(tokenAfterLock?.access_token).toBe('old-token');

    const newToken = createToken('new-token');
    await tokenStore.saveToken('anthropic', newToken);
    await tokenStore.releaseRefreshLock('anthropic');

    const finalToken = await tokenStore.getToken('anthropic');
    expect(finalToken?.access_token).toBe('new-token');
  });

  it('should validate bucket names in acquireRefreshLock', async () => {
    const invalidBuckets = [
      'bucket:name',
      'bucket/name',
      'bucket\\name',
      'bucket<name',
      'bucket>name',
      'bucket|name',
      'bucket?name',
      'bucket*name',
    ];

    for (const bucket of invalidBuckets) {
      await expect(
        tokenStore.acquireRefreshLock('anthropic', { bucket }),
      ).rejects.toThrow(/Invalid bucket name/);
    }
  });

  it('should validate bucket names in releaseRefreshLock', async () => {
    const invalidBuckets = [
      'bucket|name',
      'bucket?name',
      'bucket*name',
      'bucket"name',
    ];

    for (const bucket of invalidBuckets) {
      await expect(
        tokenStore.releaseRefreshLock('anthropic', bucket),
      ).rejects.toThrow(/Invalid bucket name/);
    }
  });

  it('should handle bucket-specific lock paths correctly', async () => {
    const bucket1 = 'work-company';
    const bucket2 = 'personal-gmail';

    const lock1Acquired = await tokenStore.acquireRefreshLock('anthropic', {
      bucket: bucket1,
    });
    const lock2Acquired = await tokenStore.acquireRefreshLock('anthropic', {
      bucket: bucket2,
    });

    expect(lock1Acquired).toBe(true);
    expect(lock2Acquired).toBe(true);

    await tokenStore.releaseRefreshLock('anthropic', bucket1);
    await tokenStore.releaseRefreshLock('anthropic', bucket2);
  });
});
