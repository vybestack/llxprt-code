/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider } from './types.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  private toKey(provider: string, bucket?: string): string {
    return `${provider}:${bucket ?? 'default'}`;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.toKey(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.toKey(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.toKey(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    return [];
  }

  async listBuckets(): Promise<string[]> {
    return [];
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    // No-op
  }

  async acquireAuthLock(): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(): Promise<void> {
    // No-op
  }
}

export function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: '',
  };
}

export function createBucketFailoverFixture(): {
  tokenStore: MemoryTokenStore;
  oauthManager: OAuthManager;
} {
  const tokenStore = new MemoryTokenStore();
  const oauthManager = new OAuthManager(tokenStore);

  const provider: OAuthProvider = {
    name: 'anthropic',
    initiateAuth: vi.fn(async () => ({
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    })),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
  };

  oauthManager.registerProvider(provider);

  return { tokenStore, oauthManager };
}
