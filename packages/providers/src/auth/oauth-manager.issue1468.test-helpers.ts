/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #1468: getProfileBuckets must validate provider matches
 *
 * Root cause: getProfileBuckets(providerName) was returning buckets from the
 * currently loaded profile WITHOUT checking if profile.provider === providerName.
 * This could cause tokens to be stored under the wrong provider keys when:
 * 1. User has Anthropic profile loaded (provider: "anthropic", buckets: ["gmail"])
 * 2. Something calls getOAuthToken("codex")
 * 3. getProfileBuckets("codex") would return ["gmail"] from the Anthropic profile
 * 4. Token operations would use those buckets with the "codex" provider
 *
 * Fix: getProfileBuckets now verifies profile.provider === providerName before
 * returning buckets, returning [] if they don't match.
 */

import { vi } from 'vitest';
import type * as Core from '@vybestack/llxprt-code-core';
import type * as SettingsPackage from '@vybestack/llxprt-code-settings';
import type * as Providers from '@vybestack/llxprt-code-providers';

// Hoisted mocks used by module factories
const { mockLoadProfile, mockFetchAnthropicUsage } = vi.hoisted(() => ({
  mockLoadProfile: vi.fn(),
  mockFetchAnthropicUsage: vi.fn(),
}));

export { mockFetchAnthropicUsage, mockLoadProfile };

vi.mock('@vybestack/llxprt-code-providers', async () => {
  const actual = await vi.importActual<typeof Providers>(
    '@vybestack/llxprt-code-providers',
  );
  return {
    ...actual,
    fetchAnthropicUsage: mockFetchAnthropicUsage,
  };
});

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<typeof Core>(
    '@vybestack/llxprt-code-core',
  );
  return {
    ...actual,
  };
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const actual = await vi.importActual<typeof SettingsPackage>(
    '@vybestack/llxprt-code-settings',
  );
  return {
    ...actual,
    ProfileManager: class MockProfileManager {
      async loadProfile(name: string) {
        return mockLoadProfile(name);
      }
    },
  };
});

// Mock the current profile name via the bridge
export const mockGetCurrentProfileName = vi.fn();
export const mockSettingsGet = vi.fn();

import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

import { OAuthManager } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from './types.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';

export class MockTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    this.tokens.set(key, token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    return this.tokens.get(key) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = bucket ? `${provider}:${bucket}` : provider;
    this.tokens.delete(key);
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const key of this.tokens.keys()) {
      const [provider] = key.split(':');
      providers.add(provider);
    }
    return Array.from(providers).sort();
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets = new Set<string>();
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${provider}:`)) {
        const bucket = key.slice(`${provider}:`.length);
        buckets.add(bucket);
      }
    }
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

  async releaseRefreshLock(): Promise<void> {
    // no-op
  }

  async acquireAuthLock(): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(): Promise<void> {
    // no-op
  }

  clear(): void {
    this.tokens.clear();
  }
}

export function createFakeOAuthSettings(): IOAuthSettingsProvider {
  const providers: Record<string, boolean> = {};
  return {
    isOAuthEnabled: (provider: string) => providers[provider] ?? false,
    getProviderApiKey: () => undefined,
    getProviderKeyfile: () => undefined,
    getProviderBaseUrl: () => undefined,
    getOAuthEnabledProviders: () => providers,
    setOAuthEnabled: (provider: string, enabled: boolean) => {
      providers[provider] = enabled;
    },
  };
}

export function createIssue1468Fixture(): {
  tokenStore: MockTokenStore;
  manager: OAuthManager;
} {
  // Register runtime accessors for profile name resolution (no mock theater).
  // This mirrors the old vi.mock that was active for all importing tests.
  // Registering here (rather than at module load) scopes the accessors to the
  // fixture lifecycle, so suites that import this helper do not leak shared
  // bridge state into unrelated tests via import order.
  oauthRuntimeBridge.setAccessors({
    getEphemeralSetting: () => undefined,
    getProviderManager: () => undefined,
    getRuntimeContext: () => undefined,
    getCurrentProfileName: () =>
      (mockGetCurrentProfileName() ?? mockSettingsGet() ?? null) as
        | string
        | null,
  });

  const tokenStore = new MockTokenStore();
  const settings = createFakeOAuthSettings();
  const manager = new OAuthManager(tokenStore, settings);
  vi.clearAllMocks();
  mockFetchAnthropicUsage.mockReset();

  return { tokenStore, manager };
}

export function clearIssue1468Fixture(tokenStore: MockTokenStore): void {
  tokenStore.clear();
  // Clear the bridge accessors registered in createIssue1468Fixture so this
  // helper does not leave shared global state behind for other suites.
  oauthRuntimeBridge.setAccessors(undefined);
}
