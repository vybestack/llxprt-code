/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AuthPrecedenceResolver,
  AuthPrecedenceConfig,
  OAuthManager,
  type OAuthTokenRequestMetadata,
} from './precedence.js';
import {
  getSettingsService,
  registerSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';

// Mock fs module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockFs = await import('node:fs/promises');

// Mock OAuth manager for testing
const mockOAuthManagerGetToken = vi.fn<
  [string, OAuthTokenRequestMetadata | undefined],
  Promise<string | null>
>();

const mockOAuthManager: OAuthManager = {
  getToken: mockOAuthManagerGetToken,
  isAuthenticated: vi.fn(),
};

describe('AuthPrecedenceResolver', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear environment variables
    delete process.env.TEST_API_KEY;
    delete process.env.ANOTHER_API_KEY;
    // Reset settings service to ensure clean state
    resetSettingsService();
    registerSettingsService(new SettingsService());
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  describe('Authentication Precedence Chain', () => {
    it('should prioritize SettingsService auth-key over all other methods', async () => {
      // Given: All auth methods available
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-auth-key-123');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use SettingsService auth-key (highest priority)
      expect(result).toBe('settings-auth-key-123');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to SettingsService auth-keyfile when no auth-key', async () => {
      // Given: SettingsService keyfile and other methods available
      const keyFileContent = 'keyfile-content-123';
      vi.mocked(mockFs.readFile).mockResolvedValue(keyFileContent);

      const settingsService = getSettingsService();
      settingsService.set('auth-keyfile', '/path/to/settings/keyfile');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use SettingsService auth-keyfile (second priority)
      expect(result).toBe('keyfile-content-123');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        '/path/to/settings/keyfile',
        'utf-8',
      );
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to environment variables when no SettingsService methods', async () => {
      // Given: Environment variable and other methods available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use environment variable (third priority)
      expect(result).toBe('env-key-789');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should check multiple environment variables in order', async () => {
      // Given: Multiple environment variables, only second one set
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['FIRST_API_KEY', 'SECOND_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      // Only second env var is set
      process.env.SECOND_API_KEY = 'second-env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use second environment variable
      expect(result).toBe('second-env-key-789');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to OAuth when no other methods available', async () => {
      // Given: Only OAuth available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      // No environment variables set
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Should use OAuth (lowest priority)
      expect(result).toBe('oauth-token-abc');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.any(Object),
      );
    });

    it('should return null when no authentication methods available', async () => {
      // Given: No auth methods available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false, // OAuth disabled
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      // No environment variables set
      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should return null
      expect(result).toBe(null);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should force OAuth when authOnly setting is enabled', async () => {
      // Given: All non-OAuth auth methods available but authOnly is true
      const settingsService = getSettingsService();
      settingsService.set('authOnly', true);
      settingsService.set('auth-key', 'settings-auth-key-123');
      settingsService.set('auth-keyfile', '/path/to/keyfile');

      vi.mocked(mockFs.readFile).mockResolvedValue('keyfile-content');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'anthropic',
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      // Then: Should ignore keys/env and use OAuth
      expect(result).toBe('oauth-token-abc');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          providerId: 'anthropic',
          profileId: 'default',
        }),
      );
    });

    it('should return null when authOnly is enabled but OAuth is unavailable', async () => {
      // Given: authOnly true but OAuth disabled
      const settingsService = getSettingsService();
      settingsService.set('authOnly', true);
      settingsService.set('auth-key', 'settings-auth-key-123');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false,
        supportsOAuth: false,
        oauthProvider: 'anthropic',
      };

      process.env.TEST_API_KEY = 'env-key-789';

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should not fall back to keys/env
      expect(result).toBe(null);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('OAuth Enablement Checks', () => {
    it('should not use OAuth when disabled', async () => {
      // Given: OAuth disabled but OAuth manager available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should not use OAuth
      expect(result).toBe(null);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should not use OAuth when not supported', async () => {
      // Given: OAuth enabled but not supported
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: false, // Not supported
        oauthProvider: 'qwen',
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should not use OAuth
      expect(result).toBe(null);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should not use OAuth when no OAuth manager', async () => {
      // Given: OAuth enabled and supported but no manager
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      const resolver = new AuthPrecedenceResolver(config, undefined); // No OAuth manager

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should not use OAuth
      expect(result).toBe(null);
    });

    it('should not use OAuth when no provider specified', async () => {
      // Given: OAuth enabled and supported but no provider
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: undefined, // No provider
      };

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should not use OAuth
      expect(result).toBe(null);
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('Utility Methods', () => {
    it('should correctly identify when non-OAuth auth is available', async () => {
      // Given: SettingsService auth-key available
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-key-456');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Check for non-OAuth auth
      const hasNonOAuth = await resolver.hasNonOAuthAuthentication();

      // Then: Should return true
      expect(hasNonOAuth).toBe(true);
    });

    it('should correctly identify when only OAuth is available', async () => {
      // Given: Only OAuth available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Check if OAuth only
      const isOAuthOnly = await resolver.isOAuthOnlyAvailable();

      // Then: Should return true
      expect(isOAuthOnly).toBe(true);
    });

    it('should get correct auth method name for SettingsService auth-key', async () => {
      // Given: SettingsService auth-key configured
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-key-456');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Get auth method name
      const methodName = await resolver.getAuthMethodName();

      // Then: Should return command-key (SettingsService auth-key represents command-level auth)
      expect(methodName).toBe('command-key');
    });

    it('should get correct auth method name for environment variable', async () => {
      // Given: Environment variable configured
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      process.env.TEST_API_KEY = 'env-key-789';
      const resolver = new AuthPrecedenceResolver(config);

      // When: Get auth method name
      const methodName = await resolver.getAuthMethodName();

      // Then: Should return env-test_api_key
      expect(methodName).toBe('env-test_api_key');
    });
  });

  describe('File Handling', () => {
    it('should handle keyfile read errors gracefully', async () => {
      // Given: SettingsService keyfile that cannot be read
      vi.mocked(mockFs.readFile).mockRejectedValue(new Error('File not found'));

      const settingsService = getSettingsService();
      settingsService.set('auth-keyfile', '/nonexistent/keyfile');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      process.env.TEST_API_KEY = 'env-fallback-key';
      const resolver = new AuthPrecedenceResolver(config);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should fall back to environment variable
      expect(result).toBe('env-fallback-key');
    });

    it('should handle empty keyfile gracefully', async () => {
      // Given: Empty SettingsService keyfile
      vi.mocked(mockFs.readFile).mockResolvedValue('   \n  \t  '); // Whitespace only

      const settingsService = getSettingsService();
      settingsService.set('auth-keyfile', '/path/to/empty/keyfile');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      process.env.TEST_API_KEY = 'env-fallback-key';
      const resolver = new AuthPrecedenceResolver(config);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should fall back to environment variable
      expect(result).toBe('env-fallback-key');
    });

    it('should handle keyfile with valid content', async () => {
      // Given: SettingsService keyfile with valid content
      vi.mocked(mockFs.readFile).mockResolvedValue('  valid-key-content  \n');

      const settingsService = getSettingsService();
      settingsService.set('auth-keyfile', '/path/to/valid/keyfile');

      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use keyfile content (trimmed)
      expect(result).toBe('valid-key-content');
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration correctly', async () => {
      // Given: Initial configuration
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY'],
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Update configuration with new env key names
      resolver.updateConfig({ envKeyNames: ['NEW_TEST_API_KEY'] });

      // Set the new env var
      process.env.NEW_TEST_API_KEY = 'new-key';

      // Then: Should use updated configuration
      const result = await resolver.resolveAuthentication();
      expect(result).toBe('new-key');

      // Cleanup
      delete process.env.NEW_TEST_API_KEY;
    });

    it('should update OAuth manager correctly', async () => {
      // Given: Initial resolver without OAuth manager
      const config: AuthPrecedenceConfig = {
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Update OAuth manager
      resolver.updateOAuthManager(mockOAuthManager);
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('new-oauth-token');

      // Then: Should use updated OAuth manager
      const result = await resolver.resolveAuthentication({
        includeOAuth: true,
      });
      expect(result).toBe('new-oauth-token');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'qwen',
        expect.any(Object),
      );
    });
  });

  describe('Injected SettingsService', () => {
    let originalContext: ReturnType<
      typeof getActiveProviderRuntimeContext
    > | null;

    const createStubSettingsService = (
      values: Record<string, unknown>,
    ): SettingsService => {
      const service = new SettingsService();
      for (const [key, value] of Object.entries(values)) {
        service.set(key, value);
      }
      vi.spyOn(service, 'get').mockImplementation((key: string) =>
        SettingsService.prototype.get.call(service, key),
      );
      vi.spyOn(service, 'set').mockImplementation((key: string, value) =>
        SettingsService.prototype.set.call(service, key, value),
      );
      return service;
    };

    beforeEach(() => {
      try {
        originalContext = getActiveProviderRuntimeContext();
      } catch {
        originalContext = null;
      }
    });

    afterEach(() => {
      if (originalContext) {
        setActiveProviderRuntimeContext(originalContext);
      }
    });

    it('uses the SettingsService injected via constructor', async () => {
      const injected = createStubSettingsService({
        'auth-key': 'injected-key',
      });
      const resolver = new AuthPrecedenceResolver(
        {},
        mockOAuthManager,
        injected,
      );

      const result = await resolver.resolveAuthentication();
      expect(result).toBe('injected-key');
      expect(injected.get).toHaveBeenCalledWith('auth-key');
    });

    it('falls back to the active runtime context when no service is injected', async () => {
      const runtimeService = createStubSettingsService({
        'auth-key': 'runtime-key',
      });
      const runtimeContext = createProviderRuntimeContext({
        settingsService: runtimeService,
      });
      setActiveProviderRuntimeContext(runtimeContext);

      const resolver = new AuthPrecedenceResolver({}, mockOAuthManager);
      const result = await resolver.resolveAuthentication();

      expect(result).toBe('runtime-key');
      expect(runtimeService.get).toHaveBeenCalledWith('auth-key');
    });
  });
});
