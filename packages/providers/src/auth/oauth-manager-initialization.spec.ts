/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import { KeyringTokenStore } from './types.js';
import type { ISecureStore } from '@vybestack/llxprt-code-auth';
import { CodexOAuthProvider } from './codex-oauth-provider.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import { promises as fs } from 'node:fs';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { createFakeOAuthSettings } from './test-oauth-settings.js';

/** Minimal in-memory ISecureStore for tests that don't exercise storage. */
function createStubSecureStore(): ISecureStore {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => store.delete(key),
    list: async () => [...store.keys()],
    has: async (key) => store.has(key),
  };
}

// Mock the file system to simulate missing OAuth credentials
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      unlink: vi.fn(),
    },
  };
});

function createLoadedSettings(
  overrides: {
    oauthEnabledProviders?: Record<string, boolean>;
    providerApiKeys?: Record<string, string>;
    providerKeyfiles?: Record<string, string>;
    providerBaseUrls?: Record<string, string>;
  } = {},
): IOAuthSettingsProvider {
  return createFakeOAuthSettings(overrides);
}

const mockFs = vi.mocked(fs);

describe('OAuth Provider Premature Initialization', () => {
  let tokenStore: KeyringTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tokenStore = new KeyringTokenStore({
      secureStore: createStubSecureStore(),
      lockDir: join(tmpdir(), 'llxprt-providers-init-locks'),
    });
    oauthManager = new OAuthManager(tokenStore);

    // Mock the OAuth credentials file to not exist
    mockFs.readFile.mockRejectedValue(
      new Error(
        "ENOENT: no such file or directory, open '/.llxprt/oauth_creds.json'",
      ),
    );

    // Default to explicitly disabled OAuth in these initialization tests.
    // These tests verify "no premature OAuth usage" behavior when OAuth is off.
    const settings = createLoadedSettings({
      oauthEnabledProviders: {
        codex: false,
        anthropic: false,
      },
    });
    oauthManager = new OAuthManager(tokenStore, settings);
  });

  describe('OAuth Provider Registration Should Not Trigger Initialization', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario Register Codex OAuth provider without credentials file
     * @given Codex OAuth credentials file does not exist
     * @when CodexOAuthProvider is registered with OAuthManager
     * @then Should not attempt to read OAuth credentials file
     * @and Should not throw initialization errors
     */
    it('should not initialize Codex OAuth when registering provider', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);

      // This should not trigger any file reads or initialization
      expect(() => {
        oauthManager.registerProvider(codexProvider);
      }).not.toThrow();

      // Verify no file access was attempted during registration
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario Multiple OAuth providers registration without credentials
     * @given OAuth credentials file does not exist for any provider
     * @when All OAuth providers are registered
     * @then Should not attempt to read any credentials files
     * @and Should complete registration without errors
     */
    it('should not initialize any OAuth providers when registering multiple providers', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      // Register all providers - should not trigger initialization
      expect(() => {
        oauthManager.registerProvider(codexProvider);
        oauthManager.registerProvider(anthropicProvider);
      }).not.toThrow();

      // Verify no file access was attempted during registration
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Verify all providers are registered
      const providers = oauthManager.getSupportedProviders();
      expect(providers).toContain('codex');
      expect(providers).toContain('anthropic');
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario MCP operations should not trigger OAuth initialization
     * @given OAuth providers are registered
     * @when MCP-related operations are performed (no provider usage)
     * @then Should not trigger any OAuth initialization
     * @and Should not attempt to read OAuth credentials
     */
    it('should not initialize OAuth during MCP operations', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      oauthManager.registerProvider(codexProvider);
      oauthManager.registerProvider(anthropicProvider);

      // Simulate MCP operations that might access provider manager
      // These operations should not trigger any OAuth initialization
      const providers = oauthManager.getSupportedProviders();
      const statuses = await oauthManager.getAuthStatus();

      // Verify MCP operations completed successfully
      expect(providers).toContain('codex');
      expect(providers).toContain('anthropic');
      expect(statuses).toHaveLength(2);

      // Verify no OAuth initialization was triggered
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Verify providers remain unauthenticated (no OAuth triggered)
      const codexStatus = statuses.find((s) => s.provider === 'codex');
      const anthropicStatus = statuses.find((s) => s.provider === 'anthropic');

      expect(codexStatus?.authenticated).toBe(false);
      expect(anthropicStatus?.authenticated).toBe(false);
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario Profile loading without Codex should not trigger OAuth
     * @given Profile is loaded without specifying Codex provider
     * @when OAuth providers are accessed for provider status
     * @then Should not trigger Codex OAuth initialization
     * @and Should not attempt to read credentials file
     */
    it('should not initialize OAuth when loading profile without Codex provider', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      oauthManager.registerProvider(codexProvider);
      oauthManager.registerProvider(anthropicProvider);

      // Simulate profile loading operations that check provider status
      // but don't actually use Codex
      const statuses = await oauthManager.getAuthStatus();
      const availableProviders = oauthManager.getSupportedProviders();

      // Verify operations completed
      expect(statuses).toHaveLength(2);
      expect(availableProviders).toContain('codex');
      expect(availableProviders).toContain('anthropic');

      // Verify no OAuth initialization was triggered
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('OAuth Should Only Initialize When Actually Used', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario OAuth should not be accessed without explicit enablement
     * @given Codex OAuth provider is registered but not enabled
     * @when getToken('codex') is called
     * @then Should not attempt to read OAuth credentials file
     * @and Should return null since OAuth is not enabled
     */
    it('should not access OAuth file when OAuth is not enabled', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);
      oauthManager.registerProvider(codexProvider);

      // Registration should not trigger initialization
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Requesting token should not trigger initialization since OAuth is not enabled
      const token = await oauthManager.getToken('codex');

      // Should NOT have attempted to read credentials file
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Should return null when OAuth is not enabled
      expect(token).toBeNull();
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario Selective OAuth initialization for specific provider
     * @given Multiple OAuth providers registered
     * @when Only Codex token is requested
     * @then Should not read credentials file when OAuth is not enabled
     * @and Should return null without file access
     */
    it('should not read OAuth credentials when OAuth is not enabled', async () => {
      const codexProvider = new CodexOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      oauthManager.registerProvider(codexProvider);
      oauthManager.registerProvider(anthropicProvider);

      // Request only Codex token
      const codexToken = await oauthManager.getToken('codex');

      // Should not have attempted to read credentials
      expect(mockFs.readFile).not.toHaveBeenCalledWith(
        expect.stringContaining('oauth_creds.json'),
      );

      // Codex should return null (no credentials) without file access
      expect(codexToken).toBeNull();
    });
  });

  describe('Backward Compatibility', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario OAuth is not accessed even with existing credentials file
     * @given OAuth credentials file exists but OAuth is not enabled
     * @when getToken('codex') is called
     * @then Should not read credentials file
     * @and Should return null since OAuth is not enabled
     */
    it('should not access OAuth file even when credentials exist but OAuth not enabled', async () => {
      // Mock successful file read with valid OAuth credentials
      const mockCredentials = {
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockCredentials));

      const codexProvider = new CodexOAuthProvider(tokenStore);
      oauthManager.registerProvider(codexProvider);

      // Request token should NOT trigger file read since OAuth is not enabled
      const token = await oauthManager.getToken('codex');

      // Should NOT have read the credentials file
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Should return null since OAuth is not enabled
      expect(token).toBeNull();
    });
  });
});
