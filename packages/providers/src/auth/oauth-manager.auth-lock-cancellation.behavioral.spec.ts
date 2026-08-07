/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyringTokenStore } from '@vybestack/llxprt-code-core';
import type { ISecureStore } from '@vybestack/llxprt-code-auth';
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

describe('OAuthManager auth-lock cancellation behavior', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir !== undefined) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('relinquishes the real auth lock when authentication is cancelled', async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'oauth-auth-cancel-'));
    const lockDir = join(tempDir, 'locks');
    const secureStore = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({ secureStore, lockDir });
    const oauthManager = new OAuthManager(tokenStore);
    const cancellation = new DOMException(
      'Authentication cancelled',
      'AbortError',
    );
    const provider: OAuthProvider = {
      name: 'codex',
      initiateAuth: async () => {
        throw cancellation;
      },
      getToken: async () => null,
      refreshToken: async () => null,
    };
    oauthManager.registerProvider(provider);

    await expect(oauthManager.authenticate('codex', 'work')).rejects.toBe(
      cancellation,
    );

    const contender = new KeyringTokenStore({ secureStore, lockDir });
    expect(
      await contender.acquireAuthLock('codex', {
        bucket: 'work',
        waitMs: 100,
      }),
    ).toBe(true);
    await contender.releaseAuthLock('codex', 'work');
  });
});
