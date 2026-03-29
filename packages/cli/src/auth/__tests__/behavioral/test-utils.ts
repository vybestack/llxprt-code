/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthManager } from '../../oauth-manager.js';
import { BucketFailoverHandlerImpl } from '../../BucketFailoverHandlerImpl.js';
import type { OAuthProvider, OAuthToken, TokenStore } from '../../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

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
    const providers = new Set<string>();
    for (const key of this.tokens.keys()) {
      providers.add(key.split(':')[0]);
    }
    return Array.from(providers);
  }

  async listBuckets(provider: string): Promise<string[]> {
    const prefix = `${provider}:`;
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        buckets.push(key.slice(prefix.length));
      }
    }
    return buckets;
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {}

  async acquireAuthLock(): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(): Promise<void> {}
}

export interface MakeTokenOptions {
  expiresInSec?: number;
  refreshToken?: string;
  scope?: string;
}

export function makeToken(
  accessToken: string,
  options?: MakeTokenOptions,
): OAuthToken {
  const expiresInSec = options?.expiresInSec ?? 3600;
  return {
    access_token: accessToken,
    refresh_token: options?.refreshToken ?? `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiresInSec,
    token_type: 'Bearer',
    scope: options?.scope ?? '',
  };
}

export function makeExpiredToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) - 3600,
    token_type: 'Bearer',
    scope: '',
  };
}

export interface CreateTestProviderOptions {
  initiateAuthResult?: OAuthToken;
  refreshTokenResult?: OAuthToken | null;
  getTokenResult?: OAuthToken | null;
}

export function createTestProvider(
  name: string,
  options?: CreateTestProviderOptions,
): OAuthProvider {
  const defaultToken: OAuthToken = {
    access_token: `initiated-${name}`,
    refresh_token: `refresh-initiated-${name}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: '',
  };

  return {
    name,
    initiateAuth: async () => options?.initiateAuthResult ?? defaultToken,
    getToken: async () => options?.getTokenResult ?? null,
    refreshToken: async () => options?.refreshTokenResult ?? null,
  };
}

export interface CreateTestOAuthManagerOptions {
  providers?: OAuthProvider[];
}

export function createTestOAuthManager(
  tokenStore: TokenStore,
  options?: CreateTestOAuthManagerOptions,
): OAuthManager {
  const manager = new OAuthManager(tokenStore);
  if (options?.providers) {
    for (const provider of options.providers) {
      manager.registerProvider(provider);
    }
  }
  return manager;
}

export function createBucketFailoverHandler(
  buckets: string[],
  provider: string,
  oauthManager: OAuthManager,
  metadata?: OAuthTokenRequestMetadata,
): BucketFailoverHandlerImpl {
  return new BucketFailoverHandlerImpl(
    buckets,
    provider,
    oauthManager,
    metadata,
  );
}
