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

// Hoisted mock for ProfileManager that returns controlled profiles
const mockLoadProfile = vi.fn();

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
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
import type { OAuthToken, TokenStore } from './types.js';
import { LoadedSettings } from '../config/settings.js';
import type { Settings } from '../config/settings.js';

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
  });

  afterEach(() => {
    tokenStore.clear();
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

      expect(buckets).toEqual(['gmail', 'work']);
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

      expect(buckets).toEqual([]);
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

      expect(buckets).toEqual([]);
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

      expect(buckets).toEqual([]);
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

      expect(buckets).toEqual([]);
    });
  });
});
