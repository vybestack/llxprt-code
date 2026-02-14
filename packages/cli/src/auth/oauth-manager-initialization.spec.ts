/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import { KeyringTokenStore } from './types.js';
import { GeminiOAuthProvider } from './gemini-oauth-provider.js';
import { QwenOAuthProvider } from './qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import { promises as fs } from 'node:fs';

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

const mockFs = vi.mocked(fs);

describe('OAuth Provider Premature Initialization', () => {
  let tokenStore: KeyringTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(() => {
    vi.clearAllMocks();
    tokenStore = new KeyringTokenStore();
    oauthManager = new OAuthManager(tokenStore);

    // Mock the OAuth credentials file to not exist
    mockFs.readFile.mockRejectedValue(
      new Error(
        "ENOENT: no such file or directory, open '/.llxprt/oauth_creds.json'",
      ),
    );
  });

  describe('OAuth Provider Registration Should Not Trigger Initialization', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario Register Gemini OAuth provider without credentials file
     * @given Gemini OAuth credentials file does not exist
     * @when GeminiOAuthProvider is registered with OAuthManager
     * @then Should not attempt to read OAuth credentials file
     * @and Should not throw initialization errors
     */
    it('should not initialize Gemini OAuth when registering provider', async () => {
      const geminiProvider = new GeminiOAuthProvider(tokenStore);

      // This should not trigger any file reads or initialization
      expect(() => {
        oauthManager.registerProvider(geminiProvider);
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
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      const qwenProvider = new QwenOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      // Register all providers - should not trigger initialization
      expect(() => {
        oauthManager.registerProvider(geminiProvider);
        oauthManager.registerProvider(qwenProvider);
        oauthManager.registerProvider(anthropicProvider);
      }).not.toThrow();

      // Verify no file access was attempted during registration
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Verify all providers are registered
      const providers = oauthManager.getSupportedProviders();
      expect(providers).toContain('gemini');
      expect(providers).toContain('qwen');
      expect(providers).toContain('anthropic');
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario MCP operations should not trigger OAuth initialization
     * @given OAuth providers are registered
     * @when MCP-related operations are performed (no Gemini usage)
     * @then Should not trigger Gemini OAuth initialization
     * @and Should not attempt to read OAuth credentials
     */
    it('should not initialize OAuth during MCP operations', async () => {
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      const qwenProvider = new QwenOAuthProvider(tokenStore);

      oauthManager.registerProvider(geminiProvider);
      oauthManager.registerProvider(qwenProvider);

      // Simulate MCP operations that might access provider manager
      // These operations should not trigger any OAuth initialization
      const providers = oauthManager.getSupportedProviders();
      const statuses = await oauthManager.getAuthStatus();

      // Verify MCP operations completed successfully
      expect(providers).toContain('gemini');
      expect(providers).toContain('qwen');
      expect(statuses).toHaveLength(2);

      // Verify no OAuth initialization was triggered
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Verify providers remain unauthenticated (no OAuth triggered)
      const geminiStatus = statuses.find((s) => s.provider === 'gemini');
      const qwenStatus = statuses.find((s) => s.provider === 'qwen');

      expect(geminiStatus?.authenticated).toBe(false);
      expect(qwenStatus?.authenticated).toBe(false);
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario Profile loading without Gemini should not trigger OAuth
     * @given Profile is loaded without specifying Gemini provider
     * @when OAuth providers are accessed for provider status
     * @then Should not trigger Gemini OAuth initialization
     * @and Should not attempt to read credentials file
     */
    it('should not initialize OAuth when loading profile without Gemini provider', async () => {
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);

      oauthManager.registerProvider(geminiProvider);
      oauthManager.registerProvider(anthropicProvider);

      // Simulate profile loading operations that check provider status
      // but don't actually use Gemini
      const statuses = await oauthManager.getAuthStatus();
      const availableProviders = oauthManager.getSupportedProviders();

      // Verify operations completed
      expect(statuses).toHaveLength(2);
      expect(availableProviders).toContain('gemini');
      expect(availableProviders).toContain('anthropic');

      // Verify no OAuth initialization was triggered
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });
  });

  describe('OAuth Should Only Initialize When Actually Used', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario OAuth should not be accessed without explicit enablement
     * @given Gemini OAuth provider is registered but not enabled
     * @when getToken('gemini') is called
     * @then Should not attempt to read OAuth credentials file
     * @and Should return null since OAuth is not enabled
     */
    it('should not access OAuth file when OAuth is not enabled', async () => {
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      oauthManager.registerProvider(geminiProvider);

      // Registration should not trigger initialization
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Requesting token should not trigger initialization since OAuth is not enabled
      const token = await oauthManager.getToken('gemini');

      // Should NOT have attempted to read credentials file
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Should return null when OAuth is not enabled
      expect(token).toBeNull();
    });

    /**
     * @requirement ISSUE-308-FIX
     * @scenario Selective OAuth initialization for specific provider
     * @given Multiple OAuth providers registered
     * @when Only Qwen token is requested
     * @then Should initialize Qwen OAuth only
     * @and Should not initialize Gemini OAuth
     */
    it('should only initialize the specific OAuth provider when its token is requested', async () => {
      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      const qwenProvider = new QwenOAuthProvider(tokenStore);

      oauthManager.registerProvider(geminiProvider);
      oauthManager.registerProvider(qwenProvider);

      // Request only Qwen token
      const qwenToken = await oauthManager.getToken('qwen');

      // Should not have attempted to read Gemini credentials
      expect(mockFs.readFile).not.toHaveBeenCalledWith(
        expect.stringContaining('oauth_creds.json'),
      );

      // Qwen should return null (no credentials) without file access
      expect(qwenToken).toBeNull();
    });
  });

  describe('Backward Compatibility', () => {
    /**
     * @requirement ISSUE-308-FIX
     * @scenario OAuth is not accessed even with existing credentials file
     * @given OAuth credentials file exists but OAuth is not enabled
     * @when getToken('gemini') is called
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

      const geminiProvider = new GeminiOAuthProvider(tokenStore);
      oauthManager.registerProvider(geminiProvider);

      // Request token should NOT trigger file read since OAuth is not enabled
      const token = await oauthManager.getToken('gemini');

      // Should NOT have read the credentials file
      expect(mockFs.readFile).not.toHaveBeenCalled();

      // Should return null since OAuth is not enabled
      expect(token).toBeNull();
    });
  });
});
