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

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks used by module factories
const { mockLoadProfile, mockFetchAnthropicUsage } = vi.hoisted(() => ({
  mockLoadProfile: vi.fn(),
  mockFetchAnthropicUsage: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    fetchAnthropicUsage: mockFetchAnthropicUsage,
    ProfileManager: class MockProfileManager {
      async loadProfile(name: string) {
        return mockLoadProfile(name);
      }
    },
  };
});

// Mock runtime settings to control the current profile name
const mockGetCurrentProfileName = vi.fn();
const mockSettingsGet = vi.fn();

vi.mock('../runtime/runtimeSettings.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
    settingsService: {
      getCurrentProfileName: mockGetCurrentProfileName,
      get: mockSettingsGet,
    },
  })),
}));

import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider, OAuthToken, TokenStore } from './types.js';
import { LoadedSettings } from '../config/settings.js';
import type { Settings } from '../config/settings.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

class MockTokenStore implements TokenStore {
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

function createLoadedSettings(): LoadedSettings {
  const empty = {} as Settings;
  return new LoadedSettings(
    { path: '', settings: empty },
    { path: '', settings: empty },
    { path: '', settings: empty },
    { path: '', settings: empty },
    true,
  );
}

describe('Issue #1468: getProfileBuckets validates provider matches profile', () => {
  let tokenStore: MockTokenStore;
  let manager: OAuthManager;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    const settings = createLoadedSettings();
    manager = new OAuthManager(tokenStore, settings);
    vi.clearAllMocks();
    mockFetchAnthropicUsage.mockReset();
  });

  afterEach(() => {
    tokenStore.clear();
  });

  it('uses request profile metadata to resolve bucketed tokens for subagent runtimes', async () => {
    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      if (profileName === 'opusthinkingbucketed') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['bucket-a', 'bucket-b', 'bucket-c'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-a-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-a',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    const token = await manager.getOAuthToken('anthropic', metadata);

    expect(token?.access_token).toBe('bucket-a-token');
  });

  it('does not inherit a foreground session bucket when request metadata targets a different profile', async () => {
    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      if (profileName === 'opusthinkingbucketed') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['bucket-a', 'bucket-b', 'bucket-c'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-a-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-a',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    const token = await manager.getOAuthToken('anthropic', metadata);

    expect(token?.access_token).toBe('bucket-a-token');
  });

  it('preserves request-scoped session state when getToken peeks a later bucket', async () => {
    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      if (profileName === 'opusthinkingbucketed') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['bucket-a', 'bucket-b', 'bucket-c'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    const token = await manager.getToken('anthropic', metadata);

    expect(token).toBe('bucket-b-token');
    expect(manager.getSessionBucket('anthropic', metadata)).toBe('bucket-b');
  });

  it('does not fall back to foreground buckets when an explicit request profile cannot be loaded', async () => {
    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'missing-profile',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    await expect(manager.getOAuthToken('anthropic', metadata)).rejects.toThrow(
      'Unexpected profile lookup: missing-profile',
    );
  });

  it('establishes a request-scoped default session bucket for single-bucket profiles', async () => {
    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      if (profileName === 'subagent-single') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['subagent-bucket'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'subagent-single',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    const token = await manager.getOAuthToken('anthropic', metadata);

    expect(token).toBeNull();
    expect(manager.getSessionBucket('anthropic')).toBe('foreground-bucket');
    expect(manager.getSessionBucket('anthropic', metadata)).toBe(
      'subagent-bucket',
    );
  });

  it('uses the current profile scoped session bucket for logout when no bucket is provided', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b', {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
    });

    await manager.logout('anthropic');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('anthropic', 'bucket-b'),
    ).resolves.toBeNull();
  });

  it('falls back to the unscoped foreground session bucket for logout when no scoped bucket exists', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b');

    await manager.logout('anthropic');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('anthropic', 'bucket-b'),
    ).resolves.toBeNull();
  });

  it('marks the current profile scoped session bucket as active in auth status', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-a-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-a',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b', {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
    });

    const statuses = await manager.getAuthStatusWithBuckets('anthropic');

    expect(
      statuses.find((status) => status.bucket === 'bucket-a')?.isSessionBucket,
    ).toBe(false);
    expect(
      statuses.find((status) => status.bucket === 'bucket-b')?.isSessionBucket,
    ).toBe(true);
  });

  it('falls back to the unscoped foreground session bucket in auth status when no scoped bucket exists', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-a-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-a',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b');

    const statuses = await manager.getAuthStatusWithBuckets('anthropic');

    expect(
      statuses.find((status) => status.bucket === 'bucket-a')?.isSessionBucket,
    ).toBe(false);
    expect(
      statuses.find((status) => status.bucket === 'bucket-b')?.isSessionBucket,
    ).toBe(true);
  });

  it('uses the current profile scoped session bucket for anthropic usage lookups', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b', {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
    });
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'bucket-b' });

    const usage = await manager.getAnthropicUsageInfo();

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('bucket-b-token');
    expect(usage).toStrictEqual({ bucket: 'bucket-b' });
  });

  it('falls back to the unscoped foreground session bucket for anthropic usage lookups when no scoped bucket exists', async () => {
    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b');
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'bucket-b' });

    const usage = await manager.getAnthropicUsageInfo();

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('bucket-b-token');
    expect(usage).toStrictEqual({ bucket: 'bucket-b' });
  });

  it('uses the only configured profile bucket for logout, auth status, and anthropic usage after a fresh restart', async () => {
    mockGetCurrentProfileName.mockReturnValue('single-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['named-bucket'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'named-bucket-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'named-bucket',
    );
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'named-bucket' });

    const statusesBeforeLogout =
      await manager.getAuthStatusWithBuckets('anthropic');
    expect(
      statusesBeforeLogout.find((status) => status.bucket === 'named-bucket')
        ?.isSessionBucket,
    ).toBe(true);

    const usage = await manager.getAnthropicUsageInfo();
    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('named-bucket-token');
    expect(usage).toStrictEqual({ bucket: 'named-bucket' });

    await manager.logout('anthropic');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('anthropic', 'named-bucket'),
    ).resolves.toBeNull();
  });

  it('prefers the current profile only bucket over a stale unscoped session bucket', async () => {
    mockGetCurrentProfileName.mockReturnValue('single-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['named-bucket'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'named-bucket-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'named-bucket',
    );
    manager.setSessionBucket('anthropic', 'foreground-bucket');
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'named-bucket' });

    const statuses = await manager.getAuthStatusWithBuckets('anthropic');
    expect(
      statuses.find((status) => status.bucket === 'named-bucket')
        ?.isSessionBucket,
    ).toBe(true);
    expect(
      statuses.find((status) => status.bucket === 'foreground-bucket')
        ?.isSessionBucket,
    ).toBe(false);

    const usage = await manager.getAnthropicUsageInfo();
    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('named-bucket-token');
    expect(usage).toStrictEqual({ bucket: 'named-bucket' });

    await manager.logout('anthropic');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('anthropic', 'named-bucket'),
    ).resolves.toBeNull();
    await expect(
      tokenStore.getToken('anthropic', 'foreground-bucket'),
    ).resolves.not.toBeNull();
  });

  describe('when requesting buckets for a provider that matches the loaded profile', () => {
    /**
     * @requirement Issue #1468
     * @scenario Profile provider matches requested provider
     * @given Current profile is 'my-anthropic-profile' with provider='anthropic' and buckets=['gmail','work']
     * @when getProfileBuckets('anthropic') is called internally
     * @then The buckets ['gmail','work'] should be used
     */
    it('should use profile buckets when provider matches', async () => {
      // Setup: Anthropic profile loaded
      mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
      mockLoadProfile.mockResolvedValue({
        provider: 'anthropic',
        auth: {
          type: 'oauth',
          buckets: ['gmail', 'work'],
        },
      });

      // Access getProfileBuckets via the manager's private method
      const managerInternal = manager as unknown as {
        getProfileBuckets: (provider: string) => Promise<string[]>;
      };

      const buckets = await managerInternal.getProfileBuckets('anthropic');

      expect(buckets).toStrictEqual(['gmail', 'work']);
    });
  });

  describe('when requesting buckets for a provider that does NOT match the loaded profile', () => {
    /**
     * @requirement Issue #1468
     * @scenario Profile provider does NOT match requested provider
     * @given Current profile is 'my-anthropic-profile' with provider='anthropic' and buckets=['gmail','vybestack']
     * @when getProfileBuckets('codex') is called internally
     * @then Empty array should be returned (NOT the anthropic buckets)
     */
    it('should return empty array when provider does not match profile', async () => {
      // Setup: Anthropic profile loaded, but we request codex buckets
      mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
      mockLoadProfile.mockResolvedValue({
        provider: 'anthropic',
        auth: {
          type: 'oauth',
          buckets: ['gmail', 'vybestack'],
        },
      });

      const managerInternal = manager as unknown as {
        getProfileBuckets: (provider: string) => Promise<string[]>;
      };

      // This is the bug fix: requesting 'codex' buckets while anthropic profile is loaded
      // SHOULD return [] because the providers don't match
      const buckets = await managerInternal.getProfileBuckets('codex');

      expect(buckets).toStrictEqual([]);
    });

    /**
     * @requirement Issue #1468
     * @scenario Codex profile loaded, but requesting Anthropic buckets
     * @given Current profile is 'my-codex-profile' with provider='codex' and buckets=['default']
     * @when getProfileBuckets('anthropic') is called internally
     * @then Empty array should be returned
     */
    it('should return empty array when codex profile loaded but anthropic requested', async () => {
      mockGetCurrentProfileName.mockReturnValue('my-codex-profile');
      mockLoadProfile.mockResolvedValue({
        provider: 'codex',
        auth: {
          type: 'oauth',
          buckets: ['default'],
        },
      });

      const managerInternal = manager as unknown as {
        getProfileBuckets: (provider: string) => Promise<string[]>;
      };

      const buckets = await managerInternal.getProfileBuckets('anthropic');

      expect(buckets).toStrictEqual([]);
    });
  });

  describe('when no profile is loaded', () => {
    /**
     * @requirement Issue #1468
     * @scenario No current profile
     * @given No profile is currently loaded (getCurrentProfileName returns null)
     * @when getProfileBuckets('anthropic') is called
     * @then Empty array should be returned
     */
    it('should return empty array when no profile is loaded', async () => {
      mockGetCurrentProfileName.mockReturnValue(null);

      const managerInternal = manager as unknown as {
        getProfileBuckets: (provider: string) => Promise<string[]>;
      };

      const buckets = await managerInternal.getProfileBuckets('anthropic');

      expect(buckets).toStrictEqual([]);
    });
  });

  describe('when profile has no auth.buckets', () => {
    /**
     * @requirement Issue #1468
     * @scenario Profile has no buckets configured
     * @given Current profile has provider='anthropic' but no auth.buckets
     * @when getProfileBuckets('anthropic') is called
     * @then Empty array should be returned
     */
    it('should return empty array when profile has no buckets', async () => {
      mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
      mockLoadProfile.mockResolvedValue({
        provider: 'anthropic',
        // No auth section
      });

      const managerInternal = manager as unknown as {
        getProfileBuckets: (provider: string) => Promise<string[]>;
      };

      const buckets = await managerInternal.getProfileBuckets('anthropic');

      expect(buckets).toStrictEqual([]);
    });
  });
});
