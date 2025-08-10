/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MultiProviderTokenStore } from './token-store.js';
import { OAuthToken } from './types.js';

describe('MultiProviderTokenStore - Behavioral Tests', () => {
  let tokenStore: MultiProviderTokenStore;
  let tempDir: string;
  let originalHome: string | undefined;

  const validQwenToken: OAuthToken = {
    access_token: 'qwen-access-token-123',
    refresh_token: 'qwen-refresh-token-456',
    expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    scope: 'read write',
    token_type: 'Bearer' as const,
  };

  const _validGeminiToken: OAuthToken = {
    access_token: 'gemini-access-token-789',
    refresh_token: 'gemini-refresh-token-101',
    expiry: Math.floor(Date.now() / 1000) + 7200, // 2 hours from now
    scope: 'admin',
    token_type: 'Bearer' as const,
  };

  beforeEach(async () => {
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'token-store-test-'));

    // Mock HOME environment to point to temp directory
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;

    tokenStore = new MultiProviderTokenStore();
  });

  afterEach(async () => {
    // Restore original HOME environment
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Token CRUD Operations', () => {
    /**
     * @requirement REQ-003.1
     * @scenario Save token for new provider
     * @given Empty token store
     * @when saveToken('qwen', validToken) is called
     * @then Token is persisted to ~/.llxprt/oauth/qwen.json
     * @and File has 0600 permissions
     */
    it('should save token for new provider with correct file permissions', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);

      // Verify expected behavior when implemented:
      const tokenPath = join(tempDir, '.llxprt', 'oauth', 'qwen.json');
      await fs.access(tokenPath); // File exists
      const stats = await fs.stat(tokenPath);
      expect(stats.mode & 0o777).toBe(0o600); // File permissions are 0600
      const content = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
      expect(content).toEqual(validQwenToken);
    });

    /**
     * @requirement REQ-003.1
     * @scenario Retrieve saved token
     * @given Token saved for 'qwen' provider
     * @when getToken('qwen') is called
     * @then Returns the saved token with all fields
     */
    it('should retrieve saved token with all fields intact', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      const retrievedToken = await tokenStore.getToken('qwen');
      expect(retrievedToken).toEqual(validQwenToken);
      expect(retrievedToken?.access_token).toBe('qwen-access-token-123');
      expect(retrievedToken?.refresh_token).toBe('qwen-refresh-token-456');
      expect(retrievedToken?.expiry).toBe(validQwenToken.expiry);
      expect(retrievedToken?.scope).toBe('read write');
      expect(retrievedToken?.token_type).toBe('Bearer');
    });

    /**
     * @requirement REQ-003.3
     * @scenario Token structure validation
     * @given Token with access_token, refresh_token, expiry
     * @when saveToken is called
     * @then All fields are preserved in storage
     */
    it('should preserve all token fields when saving and retrieving', async () => {
      const complexToken: OAuthToken = {
        access_token: 'complex-access-token-with-special-chars!@#$%',
        refresh_token: 'complex-refresh-token-with-unicode-café',
        expiry: 1735689600, // Fixed timestamp for testing
        scope: 'read:user write:repo admin:org',
        token_type: 'Bearer' as const,
      };

      await tokenStore.saveToken('complex', complexToken);
      const retrieved = await tokenStore.getToken('complex');
      expect(retrieved).toEqual(complexToken);
      expect(retrieved?.access_token).toContain('special-chars!@#$%');
      expect(retrieved?.refresh_token).toContain('unicode-café');
    });

    /**
     * @requirement REQ-003.1
     * @scenario Remove provider token
     * @given Token exists for 'qwen'
     * @when removeToken('qwen') called
     * @then File deleted, getToken returns null
     */
    it('should remove token file and return null on subsequent gets', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.removeToken('qwen');
      const retrieved = await tokenStore.getToken('qwen');
      expect(retrieved).toBeNull();
      const tokenPath = join(tempDir, '.llxprt', 'oauth', 'qwen.json');
      await expect(fs.access(tokenPath)).rejects.toThrow();
    });
  });

  describe('Multi-Provider Scenarios', () => {
    /**
     * @requirement REQ-003.1
     * @scenario Multiple providers coexist
     * @given Tokens saved for 'qwen' and 'gemini'
     * @when getToken('qwen') is called
     * @then Returns only qwen token, gemini unaffected
     */
    it('should handle multiple providers independently', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('gemini', _validGeminiToken);
      const qwenToken = await tokenStore.getToken('qwen');
      const geminiToken = await tokenStore.getToken('gemini');
      expect(qwenToken).toEqual(validQwenToken);
      expect(geminiToken).toEqual(_validGeminiToken);
      expect(qwenToken?.access_token).not.toBe(geminiToken?.access_token);
    });

    /**
     * @requirement REQ-003.1
     * @scenario List all authenticated providers
     * @given Tokens for 'qwen', 'gemini' exist
     * @when listProviders() is called
     * @then Returns ['gemini', 'qwen'] sorted
     */
    it('should list all providers with stored tokens in sorted order', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('gemini', _validGeminiToken);
      await tokenStore.saveToken('anthropic', validQwenToken); // Using same token structure
      const providers = await tokenStore.listProviders();
      expect(providers).toEqual(['anthropic', 'gemini', 'qwen']);
      expect(providers).toHaveLength(3);
    });

    /**
     * @requirement REQ-003.1
     * @scenario Provider isolation
     * @given Multiple providers have tokens
     * @when one provider token is removed
     * @then Other providers remain unaffected
     */
    it('should maintain provider isolation when removing tokens', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('gemini', _validGeminiToken);
      await tokenStore.removeToken('qwen');
      const qwenToken = await tokenStore.getToken('qwen');
      const geminiToken = await tokenStore.getToken('gemini');
      expect(qwenToken).toBeNull();
      expect(geminiToken).toEqual(_validGeminiToken);
      const providers = await tokenStore.listProviders();
      expect(providers).toEqual(['gemini']);
    });
  });

  describe('Security & Permissions', () => {
    /**
     * @requirement REQ-003.2
     * @scenario Secure file permissions
     * @given New token being saved
     * @when saveToken creates file
     * @then File has 0600 (owner read/write only)
     */
    it('should create token files with secure 0600 permissions', async () => {
      await tokenStore.saveToken('security-test', validQwenToken);
      const tokenPath = join(tempDir, '.llxprt', 'oauth', 'security-test.json');
      const stats = await fs.stat(tokenPath);
      expect(stats.mode & 0o777).toBe(0o600);
      expect(stats.mode & 0o044).toBe(0); // No group/other read
      expect(stats.mode & 0o022).toBe(0); // No group/other write
    });

    /**
     * @requirement REQ-003.4
     * @scenario Correct storage path
     * @given Token for provider 'qwen'
     * @when saved to filesystem
     * @then Path is ~/.llxprt/oauth/qwen.json
     */
    it('should store tokens in correct ~/.llxprt/oauth/ directory structure', async () => {
      await tokenStore.saveToken('path-test', validQwenToken);
      const expectedPath = join(tempDir, '.llxprt', 'oauth', 'path-test.json');
      await fs.access(expectedPath); // Should not throw
      const content = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
      expect(content).toEqual(validQwenToken);
    });

    /**
     * @requirement REQ-003.2
     * @scenario Directory creation with secure permissions
     * @given ~/.llxprt/oauth directory doesn't exist
     * @when first token is saved
     * @then Directory is created with appropriate permissions
     */
    it('should create oauth directory structure with secure permissions', async () => {
      await tokenStore.saveToken('dir-test', validQwenToken);
      const oauthDir = join(tempDir, '.llxprt', 'oauth');
      const llxprtDir = join(tempDir, '.llxprt');
      const oauthStats = await fs.stat(oauthDir);
      const llxprtStats = await fs.stat(llxprtDir);
      expect(oauthStats.isDirectory()).toBe(true);
      expect(llxprtStats.isDirectory()).toBe(true);
      expect(oauthStats.mode & 0o777).toBe(0o700); // Directory should be 0700
    });
  });

  describe('Error Handling', () => {
    /**
     * @requirement REQ-003.1
     * @scenario Get token for unauthenticated provider
     * @given No token exists for 'anthropic'
     * @when getToken('anthropic') is called
     * @then Returns null, no error thrown
     */
    it('should return null for non-existent provider without throwing error', async () => {
      const token = await tokenStore.getToken('non-existent');
      expect(token).toBeNull();
    });

    /**
     * @requirement REQ-003.2
     * @scenario Handle corrupted token file
     * @given Malformed JSON in token file
     * @when getToken is called
     * @then Returns null and logs warning
     */
    it('should handle corrupted token files gracefully', async () => {
      // First save a valid token
      await tokenStore.saveToken('corrupted', validQwenToken);
      // Then corrupt the file
      const tokenPath = join(tempDir, '.llxprt', 'oauth', 'corrupted.json');
      await fs.writeFile(tokenPath, '{ invalid json }');
      const token = await tokenStore.getToken('corrupted');
      expect(token).toBeNull();
    });

    /**
     * @requirement REQ-003.1
     * @scenario Remove non-existent token
     * @given No token exists for provider
     * @when removeToken is called
     * @then Operation succeeds silently
     */
    it('should handle removal of non-existent tokens gracefully', async () => {
      // Should not throw error
      await expect(
        tokenStore.removeToken('non-existent'),
      ).resolves.not.toThrow();
    });

    /**
     * @requirement REQ-003.2
     * @scenario Handle filesystem permission errors
     * @given Filesystem permission restrictions
     * @when attempting to save token
     * @then Throws appropriate error
     */
    it('should handle filesystem permission errors appropriately', async () => {
      // Create directory with no write permissions
      const restrictedDir = join(tempDir, '.llxprt');
      await fs.mkdir(restrictedDir, { recursive: true });
      await fs.chmod(restrictedDir, 0o444); // Read-only
      await expect(
        tokenStore.saveToken('permission-test', validQwenToken),
      ).rejects.toThrow();
      await fs.chmod(restrictedDir, 0o755); // Restore permissions for cleanup
    });
  });

  describe('Token Updates', () => {
    /**
     * @requirement REQ-003.3
     * @scenario Update existing token
     * @given Existing token for 'qwen'
     * @when saveToken with new token called
     * @then Old token replaced completely
     */
    it('should completely replace existing tokens when saving new ones', async () => {
      const _updatedToken: OAuthToken = {
        access_token: 'updated-access-token',
        refresh_token: 'updated-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
        scope: 'limited-scope',
        token_type: 'Bearer' as const,
      };

      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('qwen', _updatedToken);
      const retrieved = await tokenStore.getToken('qwen');
      expect(retrieved).toEqual(_updatedToken);
      expect(retrieved?.access_token).toBe('updated-access-token');
      expect(retrieved?.scope).toBe('limited-scope');
      expect(retrieved).not.toEqual(validQwenToken);
    });

    /**
     * @requirement REQ-003.3
     * @scenario Token update preserves file permissions
     * @given Existing token file with 0600 permissions
     * @when token is updated
     * @then File permissions remain 0600
     */
    it('should preserve secure file permissions when updating tokens', async () => {
      const _updatedToken: OAuthToken = {
        access_token: 'permission-update-token',
        expiry: Math.floor(Date.now() / 1000) + 900, // 15 minutes
        token_type: 'Bearer' as const,
      };

      await tokenStore.saveToken('permission-update', validQwenToken);
      await tokenStore.saveToken('permission-update', _updatedToken);
      const tokenPath = join(
        tempDir,
        '.llxprt',
        'oauth',
        'permission-update.json',
      );
      const stats = await fs.stat(tokenPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });

    /**
     * @requirement REQ-003.1
     * @scenario Partial token updates
     * @given Token with optional refresh_token
     * @when saving token without refresh_token
     * @then Only required fields are stored
     */
    it('should handle tokens with optional fields correctly', async () => {
      const minimalToken: OAuthToken = {
        access_token: 'minimal-access-token',
        expiry: Math.floor(Date.now() / 1000) + 600, // 10 minutes
        token_type: 'Bearer' as const,
        // No refresh_token or scope
      };

      await tokenStore.saveToken('minimal', minimalToken);
      const retrieved = await tokenStore.getToken('minimal');
      expect(retrieved).toEqual(minimalToken);
      expect(retrieved?.refresh_token).toBeUndefined();
      expect(retrieved?.scope).toBeUndefined();
      expect(retrieved?.access_token).toBe('minimal-access-token');
    });
  });

  describe('Provider Name Validation', () => {
    /**
     * @requirement REQ-003.1
     * @scenario Handle special characters in provider names
     * @given Provider name with special characters
     * @when saving token
     * @then Sanitizes filename appropriately
     */
    it('should handle provider names with special characters', async () => {
      // Test with various special characters that might be problematic in filenames
      const specialProviders = [
        'provider-with-hyphens',
        'provider_with_underscores',
        'provider.with.dots',
      ];

      for (const provider of specialProviders) {
        await tokenStore.saveToken(provider, validQwenToken);
        const retrieved = await tokenStore.getToken(provider);
        expect(retrieved).toEqual(validQwenToken);
      }
    });

    /**
     * @requirement REQ-003.1
     * @scenario Handle empty or invalid provider names
     * @given Empty or invalid provider name
     * @when attempting to save token
     * @then Throws appropriate error
     */
    it('should reject empty or invalid provider names', async () => {
      const invalidProviders = ['', ' ', '\t', '\n'];

      for (const provider of invalidProviders) {
        await expect(
          tokenStore.saveToken(provider, validQwenToken),
        ).rejects.toThrow();
      }
    });
  });

  describe('Concurrent Operations', () => {
    /**
     * @requirement REQ-003.1
     * @scenario Concurrent token operations
     * @given Multiple simultaneous token operations
     * @when operations are performed concurrently
     * @then All operations complete successfully
     */
    it('should handle concurrent token operations safely', async () => {
      const providers = ['concurrent1', 'concurrent2', 'concurrent3'];
      const tokens = providers.map((provider, index) => ({
        ...validQwenToken,
        access_token: `concurrent-token-${index}`,
      }));

      // Test concurrent saves
      const savePromises = providers.map((provider, index) =>
        tokenStore.saveToken(provider, tokens[index]),
      );

      await Promise.all(savePromises);
      const getPromises = providers.map((provider) =>
        tokenStore.getToken(provider),
      );
      const retrievedTokens = await Promise.all(getPromises);
      retrievedTokens.forEach((token, index) => {
        expect(token?.access_token).toBe(`concurrent-token-${index}`);
      });
    });
  });
});
