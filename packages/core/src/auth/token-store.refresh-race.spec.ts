/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test for issue #1159: Token refresh race condition
 *
 * When multiple clients use the same OAuth token and try refreshing concurrently,
 * Anthropic may revoke the token. We need to:
 * 1. Check disk for updated token before refreshing
 * 2. Use a lock file to prevent concurrent refreshes
 * 3. Wait for lock if recent, or break if stale
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MultiProviderTokenStore } from './token-store.js';
import { OAuthToken } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setTimeout as setTimeoutPromise } from 'timers/promises';

describe('MultiProviderTokenStore - Token Refresh Race Condition (Issue #1159)', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;

  const createToken = (accessToken: string, expiresIn = 3600): OAuthToken => ({
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: 'Bearer',
    scope: null,
  });

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'token-refresh-race-test-'));
    tokenStore = new MultiProviderTokenStore(tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should wait when createLock fails due to EEXIST race condition', async () => {
    // Given: Client A acquires the lock
    await tokenStore.acquireRefreshLock('anthropic');

    const startTime = Date.now();

    // When: Client B tries to acquire lock and encounters EEXIST on createLock attempt
    // (This simulates the race where lock file exists before read check)
    const clientBPromise = (async () => {
      const acquired = await tokenStore.acquireRefreshLock('anthropic', {
        waitMs: 1500,
      });
      return { acquired, duration: Date.now() - startTime };
    })();

    // And: Client A releases lock after 400ms
    await setTimeoutPromise(400);
    await tokenStore.releaseRefreshLock('anthropic');

    // Then: Client B should keep waiting after EEXIST and eventually acquire lock
    const result = await clientBPromise;
    expect(result.acquired).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(350); // ~400ms wait

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should acquire lock before refreshing token', async () => {
    // Given: A token that needs refresh
    const originalToken = createToken('original-token');
    await tokenStore.saveToken('anthropic', originalToken);

    // When: Client A tries to refresh
    // Then: It should create a lock file
    const lockAcquired = await tokenStore.acquireRefreshLock('anthropic');
    expect(lockAcquired).toBe(true);

    // And: Lock file should exist
    const lockPath = join(tempDir, 'anthropic-refresh.lock');
    const lockExists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(lockExists).toBe(true);

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should wait for existing recent lock before attempting refresh', async () => {
    // Given: Client A acquires the lock
    await tokenStore.acquireRefreshLock('anthropic');

    const startTime = Date.now();

    // When: Client B tries to acquire lock (in parallel)
    const clientBPromise = (async () => {
      const acquired = await tokenStore.acquireRefreshLock('anthropic', {
        waitMs: 2000,
      });
      return { acquired, duration: Date.now() - startTime };
    })();

    // And: Client A releases lock after 500ms
    await setTimeoutPromise(500);
    await tokenStore.releaseRefreshLock('anthropic');

    // Then: Client B should have waited and acquired the lock
    const result = await clientBPromise;
    expect(result.acquired).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(400); // ~500ms wait

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should break stale lock if older than threshold', async () => {
    // Given: A stale lock file (simulate by creating old lock)
    const lockPath = join(tempDir, 'anthropic-refresh.lock');
    const staleLockContent = JSON.stringify({
      pid: 99999,
      timestamp: Date.now() - 60000, // 60 seconds old
    });
    await fs.writeFile(lockPath, staleLockContent);

    // When: Client tries to acquire lock with 30s stale threshold
    const acquired = await tokenStore.acquireRefreshLock('anthropic', {
      staleMs: 30000,
    });

    // Then: Lock should be broken and acquired
    expect(acquired).toBe(true);

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should handle corrupted lock contents by breaking and recreating', async () => {
    // Given: A lock file with corrupted JSON content
    const lockPath = join(tempDir, 'anthropic-refresh.lock');
    await fs.writeFile(lockPath, '{ corrupted json content');

    // When: Client tries to acquire lock
    const acquired = await tokenStore.acquireRefreshLock('anthropic', {
      waitMs: 1000,
    });

    // Then: Lock should be broken and acquired despite corruption
    expect(acquired).toBe(true);

    // And: Lock file should now contain valid JSON
    const lockContent = await fs.readFile(lockPath, 'utf8');
    expect(() => JSON.parse(lockContent)).not.toThrow();

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic');
  });

  it('should prevent concurrent refresh when multiple clients race', async () => {
    // Given: Multiple clients with same cached token
    const originalToken = createToken('original-token');
    await tokenStore.saveToken('anthropic', originalToken);

    let refreshCallCount = 0;
    const mockRefresh = async (): Promise<OAuthToken> => {
      refreshCallCount++;
      // Simulate network delay
      await setTimeoutPromise(100);
      return createToken(`refreshed-token-${refreshCallCount}`);
    };

    // When: 5 clients simultaneously try to refresh
    const clients = Array.from({ length: 5 }, async (_, i) => {
      try {
        // Try to acquire lock
        const acquired = await tokenStore.acquireRefreshLock('anthropic', {
          waitMs: 3000,
        });

        if (acquired) {
          // Re-check disk after acquiring lock
          const recheckToken = await tokenStore.getToken('anthropic');
          if (recheckToken?.access_token !== originalToken.access_token) {
            // Token was already refreshed
            await tokenStore.releaseRefreshLock('anthropic');
            return { client: i, refreshed: false, token: recheckToken };
          }

          // Perform refresh
          const newToken = await mockRefresh();
          await tokenStore.saveToken('anthropic', newToken);
          await tokenStore.releaseRefreshLock('anthropic');
          return { client: i, refreshed: true, token: newToken };
        } else {
          // Failed to acquire lock, use disk token
          const updatedToken = await tokenStore.getToken('anthropic');
          return { client: i, refreshed: false, token: updatedToken };
        }
      } catch (error) {
        return { client: i, error: String(error) };
      }
    });

    // Then: Only one client should perform actual refresh
    const results = await Promise.all(clients);
    const refreshedResults = results.filter(
      (r) => 'refreshed' in r && r.refreshed,
    );

    expect(refreshedResults.length).toBe(1); // Only one client refreshed
    expect(refreshCallCount).toBe(1); // Refresh was called only once

    // And: All clients should have valid token (either refreshed or from disk)
    const allHaveToken = results.every(
      (r) => 'token' in r && r.token?.access_token,
    );
    expect(allHaveToken).toBe(true);
  });

  it('should integrate lock mechanism with existing saveToken/getToken', async () => {
    // Given: A token ready for refresh
    const oldToken = createToken('old-token');
    await tokenStore.saveToken('anthropic', oldToken);

    // When: We use the lock-aware refresh pattern
    const acquired = await tokenStore.acquireRefreshLock('anthropic');
    expect(acquired).toBe(true);

    // Re-check disk after lock
    const tokenAfterLock = await tokenStore.getToken('anthropic');
    expect(tokenAfterLock?.access_token).toBe('old-token');

    // Perform refresh and save
    const newToken = createToken('new-token');
    await tokenStore.saveToken('anthropic', newToken);
    await tokenStore.releaseRefreshLock('anthropic');

    // Then: Token should be persisted
    const finalToken = await tokenStore.getToken('anthropic');
    expect(finalToken?.access_token).toBe('new-token');
  });

  it('should validate bucket names in acquireRefreshLock', async () => {
    // Given: Invalid bucket names with filesystem-unsafe characters
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

    // When: Attempting to acquire lock with invalid bucket names
    // Then: Should throw validation errors
    for (const bucket of invalidBuckets) {
      await expect(
        tokenStore.acquireRefreshLock('anthropic', { bucket }),
      ).rejects.toThrow(/Invalid bucket name/);
    }
  });

  it('should validate bucket names in releaseRefreshLock', async () => {
    // Given: Invalid bucket names
    const invalidBuckets = [
      'bucket|name',
      'bucket?name',
      'bucket*name',
      'bucket"name',
    ];

    // When: Attempting to release lock with invalid bucket names
    // Then: Should throw validation errors
    for (const bucket of invalidBuckets) {
      await expect(
        tokenStore.releaseRefreshLock('anthropic', bucket),
      ).rejects.toThrow(/Invalid bucket name/);
    }
  });

  it('should handle bucket-specific lock paths correctly', async () => {
    // Given: Multiple buckets for the same provider
    const bucket1 = 'work@company.com';
    const bucket2 = 'personal@gmail.com';

    // When: Acquiring locks for different buckets
    const lock1Acquired = await tokenStore.acquireRefreshLock('anthropic', {
      bucket: bucket1,
    });
    const lock2Acquired = await tokenStore.acquireRefreshLock('anthropic', {
      bucket: bucket2,
    });

    // Then: Both locks should be acquired independently
    expect(lock1Acquired).toBe(true);
    expect(lock2Acquired).toBe(true);

    // And: Lock files should exist with correct bucket-specific names
    const lock1Path = join(tempDir, 'anthropic-work@company.com-refresh.lock');
    const lock2Path = join(
      tempDir,
      'anthropic-personal@gmail.com-refresh.lock',
    );

    const lock1Exists = await fs
      .access(lock1Path)
      .then(() => true)
      .catch(() => false);
    const lock2Exists = await fs
      .access(lock2Path)
      .then(() => true)
      .catch(() => false);

    expect(lock1Exists).toBe(true);
    expect(lock2Exists).toBe(true);

    // Cleanup
    await tokenStore.releaseRefreshLock('anthropic', bucket1);
    await tokenStore.releaseRefreshLock('anthropic', bucket2);
  });
});
