/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #1468: Quota display shows Anthropic buckets under Codex
 *
 * getAllCodexUsageInfo() must skip any token stored under the 'codex' provider
 * key that is actually an Anthropic OAuth token (access_token starts with
 * 'sk-ant-'). Without this guard, Anthropic tokens accidentally stored under
 * codex bucket keys (e.g. codex:gmail, codex:vybestack) appear in the Codex
 * Quota section.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { fetchCodexUsageMock } = vi.hoisted(() => ({
  fetchCodexUsageMock: vi.fn().mockResolvedValue({ plan_type: 'pro' }),
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    fetchCodexUsage: fetchCodexUsageMock,
  };
});

vi.mock('../runtime/runtimeSettings.js', async () => {
  const actual = await vi.importActual<
    typeof import('../runtime/runtimeSettings.js')
  >('../runtime/runtimeSettings.js');
  return {
    ...actual,
    getCliRuntimeServices: vi.fn(() => ({
      settingsService: {
        getCurrentProfileName: vi.fn(() => null),
        get: vi.fn(() => null),
      },
    })),
  };
});

import { OAuthManager } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from './types.js';
import { LoadedSettings } from '../config/settings.js';
import type { Settings } from '../config/settings.js';
import {
  resetSettingsService,
  registerSettingsService,
  SettingsService,
} from '@vybestack/llxprt-code-core';

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
    // Use Set to avoid duplicates (CodeRabbit feedback)
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

function makeCodexToken(bucket: string): OAuthToken {
  return {
    access_token: `chatgpt-token-${bucket}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: null,
    account_id: `account-${bucket}`,
  } as OAuthToken;
}

function makeAnthropicOAuthToken(bucket: string): OAuthToken {
  return {
    access_token: `sk-ant-oat01-token-${bucket}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: null,
    account_id: `account-${bucket}`,
  } as OAuthToken;
}

/**
 * Factory for Anthropic API-key-style tokens (sk-ant-api03-...)
 * These should also be filtered by the sk-ant- prefix guard
 * (CodeRabbit feedback: test API-key-style tokens too)
 */
function makeAnthropicApiKeyToken(bucket: string): OAuthToken {
  return {
    access_token: `sk-ant-api03-key-${bucket}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: null,
    account_id: `account-${bucket}`,
  } as OAuthToken;
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

describe('Issue #1468: getAllCodexUsageInfo filters Anthropic tokens stored under codex provider', () => {
  let tokenStore: MockTokenStore;
  let manager: OAuthManager;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    const settings = createLoadedSettings();
    manager = new OAuthManager(tokenStore, settings);
    fetchCodexUsageMock.mockResolvedValue({ plan_type: 'pro' });

    const mockSettingsService = new SettingsService();
    registerSettingsService(mockSettingsService);
  });

  afterEach(() => {
    tokenStore.clear();
    try {
      resetSettingsService();
    } catch {
      // may not be registered
    }
    vi.clearAllMocks();
  });

  describe('when codex buckets contain only genuine Codex tokens', () => {
    /**
     * @requirement Issue #1468
     * @scenario Only the default bucket exists with a real Codex token
     * @given 'codex:default' has a genuine Codex token (no sk-ant- prefix, has account_id)
     * @when getAllCodexUsageInfo() is called
     * @then The default bucket is included in the result
     */
    it('should include a bucket that holds a genuine Codex token', async () => {
      await tokenStore.saveToken('codex', makeCodexToken('default'), 'default');

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('default')).toBe(true);
    });
  });

  describe('when Anthropic OAuth tokens (sk-ant-oat01-) are stored under codex provider keys', () => {
    /**
     * @requirement Issue #1468
     * @scenario An Anthropic OAuth token is stored under 'codex:gmail'
     * @given 'codex:gmail' has an Anthropic OAuth token (starts with 'sk-ant-oat01-')
     * @when getAllCodexUsageInfo() is called
     * @then The gmail bucket is excluded from the result
     */
    it('should skip a bucket whose token starts with sk-ant-oat01- (OAuth token)', async () => {
      await tokenStore.saveToken(
        'codex',
        makeAnthropicOAuthToken('gmail'),
        'gmail',
      );

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('gmail')).toBe(false);
      expect(result.size).toBe(0);
    });

    /**
     * @requirement Issue #1468
     * @scenario Mixed buckets: genuine Codex token in 'default', Anthropic OAuth tokens in others
     * @given 'codex:default' has a real Codex token
     * @and 'codex:gmail' has an Anthropic OAuth token
     * @and 'codex:vybestack' has an Anthropic OAuth token
     * @when getAllCodexUsageInfo() is called
     * @then Only 'default' appears in the result
     */
    it('should only include genuine Codex buckets when mixed with Anthropic OAuth tokens', async () => {
      await tokenStore.saveToken('codex', makeCodexToken('default'), 'default');
      await tokenStore.saveToken(
        'codex',
        makeAnthropicOAuthToken('gmail'),
        'gmail',
      );
      await tokenStore.saveToken(
        'codex',
        makeAnthropicOAuthToken('vybestack'),
        'vybestack',
      );

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('default')).toBe(true);
      expect(result.has('gmail')).toBe(false);
      expect(result.has('vybestack')).toBe(false);
      expect(result.size).toBe(1);
    });

    /**
     * @requirement Issue #1468
     * @scenario All codex buckets contain Anthropic OAuth tokens
     * @given 'codex:default', 'codex:gmail', 'codex:vybestack' all have Anthropic OAuth tokens
     * @when getAllCodexUsageInfo() is called
     * @then The result is empty
     */
    it('should return an empty map when all codex buckets have Anthropic OAuth tokens', async () => {
      for (const bucket of ['default', 'gmail', 'vybestack']) {
        await tokenStore.saveToken(
          'codex',
          makeAnthropicOAuthToken(bucket),
          bucket,
        );
      }

      const result = await manager.getAllCodexUsageInfo();

      expect(result.size).toBe(0);
    });
  });

  describe('when Anthropic API-key-style tokens (sk-ant-api03-) are stored under codex provider keys', () => {
    /**
     * @requirement Issue #1468
     * @scenario An Anthropic API-key-style token is stored under 'codex:work'
     * @given 'codex:work' has an Anthropic API key token (starts with 'sk-ant-api03-')
     * @when getAllCodexUsageInfo() is called
     * @then The work bucket is excluded from the result
     * (CodeRabbit feedback: ensure API-key-style tokens are also filtered)
     */
    it('should skip a bucket whose token starts with sk-ant-api03- (API key token)', async () => {
      await tokenStore.saveToken(
        'codex',
        makeAnthropicApiKeyToken('work'),
        'work',
      );

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('work')).toBe(false);
      expect(result.size).toBe(0);
    });

    /**
     * @requirement Issue #1468
     * @scenario Mixed tokens: genuine Codex, Anthropic OAuth, and Anthropic API key
     * @given 'codex:default' has a real Codex token
     * @and 'codex:oauth-bucket' has an Anthropic OAuth token (sk-ant-oat01-)
     * @and 'codex:apikey-bucket' has an Anthropic API key token (sk-ant-api03-)
     * @when getAllCodexUsageInfo() is called
     * @then Only 'default' appears in the result
     */
    it('should filter both OAuth and API-key-style Anthropic tokens', async () => {
      await tokenStore.saveToken('codex', makeCodexToken('default'), 'default');
      await tokenStore.saveToken(
        'codex',
        makeAnthropicOAuthToken('oauth-bucket'),
        'oauth-bucket',
      );
      await tokenStore.saveToken(
        'codex',
        makeAnthropicApiKeyToken('apikey-bucket'),
        'apikey-bucket',
      );

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('default')).toBe(true);
      expect(result.has('oauth-bucket')).toBe(false);
      expect(result.has('apikey-bucket')).toBe(false);
      expect(result.size).toBe(1);
    });
  });

  describe('when codex tokens lack account_id', () => {
    /**
     * @requirement Issue #1468
     * @scenario Token stored under codex provider lacks account_id (not a valid Codex token)
     * @given 'codex:default' has a token that doesn't have account_id
     * @when getAllCodexUsageInfo() is called
     * @then The bucket is excluded from the result
     */
    it('should skip a bucket whose token has no account_id', async () => {
      const bareToken: OAuthToken = {
        access_token: 'some-other-token-without-account-id',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: null,
      };
      await tokenStore.saveToken('codex', bareToken, 'default');

      const result = await manager.getAllCodexUsageInfo();

      expect(result.has('default')).toBe(false);
      expect(result.size).toBe(0);
    });
  });
});
