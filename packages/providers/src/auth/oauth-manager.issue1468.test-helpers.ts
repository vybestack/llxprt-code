/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type { OAuthToken, TokenStore } from './types.js';
import { OAuthManager } from './oauth-manager.js';
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

export const mockLoadProfile = vi.fn();
export const mockFetchAnthropicUsage = vi.fn();
export const mockGetCurrentProfileName = vi.fn();
export const mockSettingsGet = vi.fn();

export class MockTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(bucket ? `${provider}:${bucket}` : provider, token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(bucket ? `${provider}:${bucket}` : provider) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(bucket ? `${provider}:${bucket}` : provider);
  }

  async listProviders(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.tokens.keys(), (key) => key.split(':')[0])),
    ).sort();
  }

  async listBuckets(provider: string): Promise<string[]> {
    const prefix = `${provider}:`;
    const buckets = new Set(
      Array.from(this.tokens.keys())
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    );
    if (this.tokens.has(provider)) {
      buckets.add('default');
    }
    return Array.from(buckets).sort();
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

  clear(): void {
    this.tokens.clear();
  }
}

export function createFakeOAuthSettings(): IOAuthSettingsProvider {
  const providers: Record<string, boolean> = {};
  return {
    isOAuthEnabled: (provider) => providers[provider] ?? false,
    getProviderApiKey: () => undefined,
    getProviderKeyfile: () => undefined,
    getProviderBaseUrl: () => undefined,
    getOAuthEnabledProviders: () => providers,
    setOAuthEnabled: (provider, enabled) => {
      providers[provider] = enabled;
    },
  };
}

export function createIssue1468Fixture(): {
  tokenStore: MockTokenStore;
  manager: OAuthManager;
} {
  oauthRuntimeBridge.setAccessors({
    getEphemeralSetting: () => undefined,
    getProviderManager: () => undefined,
    getRuntimeContext: () => undefined,
    getCurrentProfileName: () =>
      mockGetCurrentProfileName() ?? mockSettingsGet() ?? null,
  });

  vi.clearAllMocks();
  const tokenStore = new MockTokenStore();
  const manager = new OAuthManager(
    tokenStore,
    createFakeOAuthSettings(),
    undefined,
    { loadProfile: mockLoadProfile },
    mockFetchAnthropicUsage,
  );
  return { tokenStore, manager };
}

export function clearIssue1468Fixture(tokenStore: MockTokenStore): void {
  tokenStore.clear();
  oauthRuntimeBridge.setAccessors(undefined);
}
