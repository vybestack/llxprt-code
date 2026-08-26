/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyringTokenStore } from '@vybestack/llxprt-code-core';
import type { ISecureStore, OAuthToken } from '@vybestack/llxprt-code-auth';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider } from './types.js';

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

function resolveCurrentBucket(bucket: string | undefined): string {
  return bucket ?? 'default';
}

const testToken: OAuthToken = {
  access_token: 'codex-test-token',
  refresh_token: 'codex-test-refresh',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'Bearer',
};

/**
 * Finding 6: same-process duplicate OAuthManager.authenticate calls must
 * join the in-flight flow rather than failing on the heldTokens lock
 * check and timing out.
 *
 * Uses a real filesystem-backed KeyringTokenStore so the lock behavior
 * is exercised. A fake provider counts initiateAuth invocations — only
 * one underlying auth flow should occur even with two concurrent calls.
 */
describe('OAuthManager same-process single-flight (issue #2819, Finding 6)', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    tempDir = undefined;
  });

  it('two concurrent authenticate() calls share one auth flow and both complete', async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'oauth-single-flight-'));
    const lockDir = join(tempDir, 'locks');
    const secureStore = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({ secureStore, lockDir });

    let initiateAuthCallCount = 0;

    const provider: OAuthProvider = {
      name: 'codex',
      initiateAuth: async () => {
        initiateAuthCallCount++;
        // Simulate a real auth flow taking some time.
        await new Promise((resolve) => setTimeout(resolve, 100));
        return testToken;
      },
      getToken: async () => null,
      refreshToken: async () => null,
    };

    const oauthManager = new OAuthManager(tokenStore);
    oauthManager.registerProvider(provider);

    // Two concurrent authenticate calls for the same provider+bucket.
    const [result1, result2] = await Promise.allSettled([
      oauthManager.authenticate('codex'),
      oauthManager.authenticate('codex', 'default'),
    ]);

    // Both must complete (no timeout).
    expect(result1.status).toBe('fulfilled');
    expect(result2.status).toBe('fulfilled');

    // Only ONE underlying auth flow should have run.
    expect(initiateAuthCallCount).toBe(1);

    // The token must be saved correctly.
    const savedToken = await tokenStore.getToken('codex', 'default');
    expect(savedToken).not.toBeNull();
    expect(savedToken?.access_token).toBe('codex-test-token');
  });

  it('concurrent authenticate() calls for different buckets run independently', async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'oauth-multi-bucket-'));
    const lockDir = join(tempDir, 'locks');
    const secureStore = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({ secureStore, lockDir });

    const bucketsAuthed: string[] = [];
    let currentBucket: string | undefined;

    const provider: OAuthProvider = {
      name: 'codex',
      setAuthContext: (ctx) => {
        currentBucket = ctx.bucket;
      },
      initiateAuth: async () => {
        const bucket = resolveCurrentBucket(currentBucket);
        bucketsAuthed.push(bucket);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ...testToken, access_token: `token-${bucket}` };
      },
      getToken: async () => null,
      refreshToken: async () => null,
    };

    const oauthManager = new OAuthManager(tokenStore);
    oauthManager.registerProvider(provider);

    await Promise.all([
      oauthManager.authenticate('codex', 'work'),
      oauthManager.authenticate('codex', 'personal'),
    ]);

    expect(bucketsAuthed.sort()).toStrictEqual(['personal', 'work']);

    const workToken = await tokenStore.getToken('codex', 'work');
    const personalToken = await tokenStore.getToken('codex', 'personal');
    expect(workToken?.access_token).toBe('token-work');
    expect(personalToken?.access_token).toBe('token-personal');
  });
});
