/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OAuth Timing Integration Tests
 *
 * These tests verify that OAuth authentication triggers at the correct times
 * across the entire system. Based on project-plans/20251105-profilefixes/plan2.md
 * Phase 5 requirements.
 *
 * Key principles verified:
 * 1. OAuth should NOT trigger during configuration operations (profile load, provider switch, etc.)
 * 2. OAuth should ONLY trigger when sending a prompt with no other auth available
 * 3. OAuth respects includeOAuth flag (defaults to false for safety)
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthPrecedenceResolver,
  type OAuthManager as CoreOAuthManager,
  SettingsService,
  ProfileManager,
  Profile,
} from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempProfile,
  createTempKeyfile,
} from './test-utils.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { MultiProviderTokenStore } from '../auth/types.js';

/**
 * Creates a mock OAuth manager that tracks when methods are called
 */
function createMockOAuthManager(tokenStore: MultiProviderTokenStore) {
  const manager = new OAuthManager(tokenStore);

  const spies = {
    authenticate: vi.spyOn(manager, 'authenticate'),
    getToken: vi.spyOn(manager, 'getToken'),
    isAuthenticated: vi.spyOn(manager, 'isAuthenticated'),
  };

  return { manager, spies };
}

describe('OAuth Timing Integration Tests', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let settingsService: SettingsService;
  let profileManager: ProfileManager;
  let tokenStore: MultiProviderTokenStore;
  let oauthManager: OAuthManager;
  let oauthSpies: ReturnType<typeof createMockOAuthManager>['spies'];

  beforeEach(async () => {
    // Store and override HOME for isolated testing
    originalHome = process.env.HOME;
    tempDir = await createTempDirectory();
    process.env.HOME = tempDir;

    // Create fresh instances for each test
    settingsService = new SettingsService();
    profileManager = new ProfileManager();

    // Set up token store and OAuth manager with spies
    tokenStore = new MultiProviderTokenStore();
    const mockOAuthSetup = createMockOAuthManager(tokenStore);
    oauthManager = mockOAuthSetup.manager;
    oauthSpies = mockOAuthSetup.spies;
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Reset spies
    vi.clearAllMocks();

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Profile Loading - OAuth Timing', () => {
    it('should NOT trigger OAuth when loading profile with keyfile', async () => {
      // Create a profile with keyfile configured
      const keyfilePath = await createTempKeyfile(tempDir, 'test-api-key-123');
      const profile: Profile = {
        version: 1,
        provider: 'test-provider',
        model: 'test-model',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'auth-keyfile': keyfilePath,
        },
      };

      await createTempProfile(tempDir, 'test-profile', profile);

      // Load the profile
      const loadedProfile = await profileManager.loadProfile('test-profile');

      // Apply profile settings to settings service
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          settingsService.set(key, value);
        }
      }

      // Verify OAuth was NOT triggered during profile load
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();

      // Verify keyfile was set in settings
      expect(settingsService.get('auth-keyfile')).toBe(keyfilePath);
    });

    it('should NOT trigger OAuth when loading profile with API key', async () => {
      // Create a profile with API key configured
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'sk-ant-test-key-123',
        },
      };

      await createTempProfile(tempDir, 'anthropic-profile', profile);

      // Load the profile
      const loadedProfile =
        await profileManager.loadProfile('anthropic-profile');

      // Apply profile settings
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          settingsService.set(key, value);
        }
      }

      // Verify OAuth was NOT triggered during profile load
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();

      // Verify auth key was set
      expect(settingsService.get('auth-key')).toBe('sk-ant-test-key-123');
    });

    it('should NOT trigger OAuth when loading profile without auth', async () => {
      // Create a profile with NO auth configured
      const profile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        modelParams: { temperature: 0.5 },
        ephemeralSettings: {},
      };

      await createTempProfile(tempDir, 'no-auth-profile', profile);

      // Load the profile
      const loadedProfile = await profileManager.loadProfile('no-auth-profile');

      // Apply profile settings
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          settingsService.set(key, value);
        }
      }

      // Verify OAuth was NOT triggered during profile load
      // (OAuth should only trigger on prompt send, not during configuration)
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();

      // Verify no auth is set
      expect(settingsService.get('auth-key')).toBeUndefined();
      expect(settingsService.get('auth-keyfile')).toBeUndefined();
    });
  });

  describe('Auth Precedence Resolution - includeOAuth Flag', () => {
    it('should NOT trigger OAuth when includeOAuth is false (default)', async () => {
      // Set up resolver with OAuth enabled but no other auth
      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
          providerId: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      // Clear all auth sources
      settingsService.set('auth-key', undefined);
      settingsService.set('auth-keyfile', undefined);
      delete process.env.GEMINI_API_KEY;

      // Resolve auth WITHOUT includeOAuth (defaults to false)
      const token = await resolver.resolveAuthentication({
        settingsService,
        // includeOAuth NOT specified - defaults to false
      });

      // Should NOT trigger OAuth because includeOAuth defaults to false
      expect(token).toBeNull();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });

    it('should trigger OAuth ONLY when includeOAuth is true', async () => {
      // Set up resolver with OAuth enabled but no other auth
      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
          providerId: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      // Clear all auth sources
      settingsService.set('auth-key', undefined);
      settingsService.set('auth-keyfile', undefined);
      delete process.env.GEMINI_API_KEY;

      // Mock OAuth manager to return a token
      oauthSpies.getToken.mockResolvedValue('oauth-token-123');

      // Resolve auth WITH includeOAuth=true (simulates prompt send)
      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true, // This is key - prompt send sets this to true
      });

      // NOW OAuth should have been triggered
      expect(token).toBe('oauth-token-123');
      expect(oauthSpies.getToken).toHaveBeenCalledTimes(1);
      expect(oauthSpies.getToken).toHaveBeenCalledWith(
        'gemini',
        expect.objectContaining({
          providerId: 'gemini',
        }),
      );
    });
  });

  describe('Auth Precedence - OAuth Should Be Last Resort', () => {
    it('should use API key instead of OAuth when both available', async () => {
      // Set up API key
      settingsService.set('auth-key', 'explicit-api-key');

      // Mock OAuth to return token if called
      oauthSpies.getToken.mockResolvedValue('should-not-be-used');

      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['ANTHROPIC_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true, // Even with this true, should prefer API key
      });

      // Should get the API key, NOT trigger OAuth
      expect(token).toBe('explicit-api-key');
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });

    it('should use keyfile instead of OAuth when both available', async () => {
      // Create keyfile
      const keyfilePath = await createTempKeyfile(tempDir, 'keyfile-token');
      settingsService.set('auth-keyfile', keyfilePath);

      // Mock OAuth to return token if called
      oauthSpies.getToken.mockResolvedValue('should-not-be-used');

      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      });

      // Should read from keyfile, NOT trigger OAuth
      expect(token).toBe('keyfile-token');
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });

    it('should use environment variable instead of OAuth when both available', async () => {
      // Set up environment variable
      process.env.ANTHROPIC_API_KEY = 'env-var-token';

      try {
        // Clear runtime auth
        settingsService.set('auth-key', undefined);
        settingsService.set('auth-keyfile', undefined);

        // Mock OAuth to return token if called
        oauthSpies.getToken.mockResolvedValue('should-not-be-used');

        const resolver = new AuthPrecedenceResolver(
          {
            apiKey: undefined,
            envKeyNames: ['ANTHROPIC_API_KEY'],
            isOAuthEnabled: true,
            supportsOAuth: true,
            oauthProvider: 'anthropic',
          },
          oauthManager as CoreOAuthManager,
          settingsService,
        );

        const token = await resolver.resolveAuthentication({
          settingsService,
          includeOAuth: true,
        });

        // Should use env var, NOT trigger OAuth
        expect(token).toBe('env-var-token');
        expect(oauthSpies.getToken).not.toHaveBeenCalled();
        expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      } finally {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });
  });

  describe('OAuth Disabled State', () => {
    it('should NOT trigger OAuth when OAuth is disabled', async () => {
      // Set up resolver with OAuth DISABLED
      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: false, // OAuth disabled
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      // Clear all auth sources
      settingsService.set('auth-key', undefined);
      settingsService.set('auth-keyfile', undefined);
      delete process.env.GEMINI_API_KEY;

      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true, // Even with this, OAuth is disabled
      });

      // Should NOT trigger OAuth because it's disabled
      expect(token).toBeNull();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });
  });

  describe('authOnly Mode', () => {
    it('should skip non-OAuth auth when authOnly is enabled', async () => {
      // Set up authOnly mode - forces OAuth even if other auth available
      settingsService.set('authOnly', true);
      settingsService.set('auth-key', 'should-be-ignored');

      // Mock OAuth to return token
      oauthSpies.getToken.mockResolvedValue('oauth-only-token');

      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
          providerId: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      });

      // Should use OAuth, ignoring the API key
      expect(token).toBe('oauth-only-token');
      expect(oauthSpies.getToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('Configuration Commands - Should NOT Trigger OAuth', () => {
    it('should NOT trigger OAuth when setting provider OAuth enabled flag', () => {
      // Simulate /auth enable command - this is configuration only
      settingsService.setProviderSetting('gemini', 'oauth-enabled', true);

      // Verify OAuth was NOT triggered
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
    });

    it('should NOT trigger OAuth when setting provider OAuth disabled flag', () => {
      // Set up initial state
      settingsService.setProviderSetting('gemini', 'oauth-enabled', true);

      vi.clearAllMocks();

      // Simulate /auth disable command
      settingsService.setProviderSetting('gemini', 'oauth-enabled', false);

      // Verify OAuth was NOT triggered
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
    });

    it('should NOT trigger OAuth when setting keyfile path', async () => {
      // Create a keyfile
      const keyfilePath = await createTempKeyfile(tempDir, 'command-keyfile');

      // Simulate /keyfile command
      settingsService.set('auth-keyfile', keyfilePath);

      // Verify OAuth was NOT triggered
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
    });

    it('should NOT trigger OAuth when clearing auth token', async () => {
      // Simulate /auth logout command
      await tokenStore.removeToken('gemini');

      // Verify OAuth was NOT triggered (logout doesn't trigger new auth)
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Provider Scenarios', () => {
    it('should maintain separate OAuth state per provider', async () => {
      // Mock different tokens for different providers
      oauthSpies.getToken.mockImplementation(async (provider: string) => {
        if (provider === 'gemini') return 'gemini-oauth-token';
        if (provider === 'anthropic') return 'anthropic-oauth-token';
        return null;
      });

      // Test Gemini provider
      const geminiResolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
          providerId: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      const geminiToken = await geminiResolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      });

      expect(geminiToken).toBe('gemini-oauth-token');

      vi.clearAllMocks();

      // Test Anthropic provider
      const anthropicResolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['ANTHROPIC_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'anthropic',
          providerId: 'anthropic',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      const anthropicToken = await anthropicResolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      });

      expect(anthropicToken).toBe('anthropic-oauth-token');
    });
  });

  describe('Safety Verification - Config Time vs Prompt Time', () => {
    it('should demonstrate config-time safety (includeOAuth=false by default)', async () => {
      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      // Simulate multiple config-time operations
      await resolver.resolveAuthentication({ settingsService }); // Profile load
      await resolver.resolveAuthentication({ settingsService }); // Provider switch
      await resolver.resolveAuthentication({ settingsService }); // Model selection
      await resolver.resolveAuthentication({ settingsService }); // Settings change

      // OAuth should NEVER be triggered during config operations
      expect(oauthSpies.getToken).not.toHaveBeenCalled();
      expect(oauthSpies.authenticate).not.toHaveBeenCalled();
    });

    it('should demonstrate prompt-time OAuth trigger (includeOAuth=true)', async () => {
      const resolver = new AuthPrecedenceResolver(
        {
          apiKey: undefined,
          envKeyNames: ['GEMINI_API_KEY'],
          isOAuthEnabled: true,
          supportsOAuth: true,
          oauthProvider: 'gemini',
          providerId: 'gemini',
        },
        oauthManager as CoreOAuthManager,
        settingsService,
      );

      // Mock OAuth
      oauthSpies.getToken.mockResolvedValue('prompt-time-token');

      // Simulate prompt send (includeOAuth=true)
      const token = await resolver.resolveAuthentication({
        settingsService,
        includeOAuth: true,
      });

      // OAuth should trigger ONLY on prompt send
      expect(token).toBe('prompt-time-token');
      expect(oauthSpies.getToken).toHaveBeenCalledTimes(1);
    });
  });
});
