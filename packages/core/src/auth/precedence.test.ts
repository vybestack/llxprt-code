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
} from './precedence.js';

// Mock fs module
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockFs = await import('node:fs/promises');

// Mock OAuth manager for testing
const mockOAuthManager: OAuthManager = {
  getToken: vi.fn(),
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
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Authentication Precedence Chain', () => {
    it('should prioritize command key over all other methods', async () => {
      // Given: All auth methods available
      const config: AuthPrecedenceConfig = {
        commandKey: 'command-key-123',
        commandKeyfile: '/path/to/command/keyfile',
        cliKey: 'cli-key-456',
        cliKeyfile: '/path/to/cli/keyfile',
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

      // Then: Should use command key (highest priority)
      expect(result).toBe('command-key-123');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to command keyfile when no command key', async () => {
      // Given: Command keyfile and other methods available
      const keyFileContent = 'keyfile-content-123';
      vi.mocked(mockFs.readFile).mockResolvedValue(keyFileContent);

      const config: AuthPrecedenceConfig = {
        commandKeyfile: '/path/to/command/keyfile',
        cliKey: 'cli-key-456',
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

      // Then: Should use command keyfile (second priority)
      expect(result).toBe('keyfile-content-123');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        '/path/to/command/keyfile',
        'utf-8',
      );
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to CLI key when no command methods', async () => {
      // Given: CLI key and other methods available
      const config: AuthPrecedenceConfig = {
        cliKey: 'cli-key-456',
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

      // Then: Should use CLI key (third priority)
      expect(result).toBe('cli-key-456');
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to CLI keyfile when no command or CLI key', async () => {
      // Given: CLI keyfile and other methods available
      const keyFileContent = 'cli-keyfile-content-456';
      vi.mocked(mockFs.readFile).mockResolvedValue(keyFileContent);

      const config: AuthPrecedenceConfig = {
        cliKeyfile: '/path/to/cli/keyfile',
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

      // Then: Should use CLI keyfile (fourth priority)
      expect(result).toBe('cli-keyfile-content-456');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        '/path/to/cli/keyfile',
        'utf-8',
      );
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to environment variables when no file or explicit keys', async () => {
      // Given: Environment variable and OAuth available
      const config: AuthPrecedenceConfig = {
        envKeyNames: ['TEST_API_KEY', 'ANOTHER_API_KEY'],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'qwen',
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const resolver = new AuthPrecedenceResolver(config, mockOAuthManager);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should use environment variable (fifth priority)
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
      const result = await resolver.resolveAuthentication();

      // Then: Should use OAuth (lowest priority)
      expect(result).toBe('oauth-token-abc');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
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
      // Given: API key available
      const config: AuthPrecedenceConfig = {
        cliKey: 'cli-key-456',
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

    it('should get correct auth method name for CLI key', async () => {
      // Given: CLI key configured
      const config: AuthPrecedenceConfig = {
        cliKey: 'cli-key-456',
        envKeyNames: ['TEST_API_KEY'],
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Get auth method name
      const methodName = await resolver.getAuthMethodName();

      // Then: Should return cli-key
      expect(methodName).toBe('cli-key');
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
      // Given: Keyfile that cannot be read
      vi.mocked(mockFs.readFile).mockRejectedValue(new Error('File not found'));

      const config: AuthPrecedenceConfig = {
        commandKeyfile: '/nonexistent/keyfile',
        cliKey: 'cli-key-456',
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should fall back to CLI key
      expect(result).toBe('cli-key-456');
    });

    it('should handle empty keyfile gracefully', async () => {
      // Given: Empty keyfile
      vi.mocked(mockFs.readFile).mockResolvedValue('   \n  \t  '); // Whitespace only

      const config: AuthPrecedenceConfig = {
        commandKeyfile: '/path/to/empty/keyfile',
        cliKey: 'cli-key-456',
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Resolve authentication
      const result = await resolver.resolveAuthentication();

      // Then: Should fall back to CLI key
      expect(result).toBe('cli-key-456');
    });

    it('should handle keyfile with valid content', async () => {
      // Given: Keyfile with valid content
      vi.mocked(mockFs.readFile).mockResolvedValue('  valid-key-content  \n');

      const config: AuthPrecedenceConfig = {
        commandKeyfile: '/path/to/valid/keyfile',
        cliKey: 'cli-key-456',
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
        cliKey: 'old-key',
        envKeyNames: ['TEST_API_KEY'],
      };

      const resolver = new AuthPrecedenceResolver(config);

      // When: Update configuration
      resolver.updateConfig({ cliKey: 'new-key' });

      // Then: Should use updated configuration
      const result = await resolver.resolveAuthentication();
      expect(result).toBe('new-key');
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
      const result = await resolver.resolveAuthentication();
      expect(result).toBe('new-oauth-token');
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('qwen');
    });
  });
});
