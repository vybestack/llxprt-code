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

    // Mock HOME/USERPROFILE environment to point to temp directory
    // Save both for cross-platform compatibility
    originalHome = process.env.HOME || process.env.USERPROFILE;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir; // For Windows

    tokenStore = new MultiProviderTokenStore(join(tempDir, '.llxprt', 'oauth'));
  });

  afterEach(async () => {
    // Restore original HOME/USERPROFILE environment
    if (originalHome) {
      if (process.platform === 'win32') {
        process.env.USERPROFILE = originalHome;
      } else {
        process.env.HOME = originalHome;
      }
    } else {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
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

      // Skip permission check on Windows as it handles permissions differently
      if (process.platform !== 'win32') {
        const stats = await fs.stat(tokenPath);
        expect(stats.mode & 0o777).toBe(0o600); // File permissions are 0600
      }

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
    it.skipIf(process.platform === 'win32')(
      'should create token files with secure 0600 permissions',
      async () => {
        await tokenStore.saveToken('security-test', validQwenToken);
        const tokenPath = join(
          tempDir,
          '.llxprt',
          'oauth',
          'security-test.json',
        );
        const stats = await fs.stat(tokenPath);
        expect(stats.mode & 0o777).toBe(0o600);
        expect(stats.mode & 0o044).toBe(0); // No group/other read
        expect(stats.mode & 0o022).toBe(0); // No group/other write
      },
    );

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
    it.skipIf(process.platform === 'win32')(
      'should create oauth directory structure with secure permissions',
      async () => {
        await tokenStore.saveToken('dir-test', validQwenToken);
        const oauthDir = join(tempDir, '.llxprt', 'oauth');
        const llxprtDir = join(tempDir, '.llxprt');
        const oauthStats = await fs.stat(oauthDir);
        const llxprtStats = await fs.stat(llxprtDir);
        expect(oauthStats.isDirectory()).toBe(true);
        expect(llxprtStats.isDirectory()).toBe(true);
        expect(oauthStats.mode & 0o777).toBe(0o700); // Directory should be 0700
      },
    );
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
    it.skipIf(process.platform === 'win32')(
      'should handle filesystem permission errors appropriately',
      async () => {
        // Create directory with no write permissions
        const restrictedDir = join(tempDir, '.llxprt');
        await fs.mkdir(restrictedDir, { recursive: true });
        await fs.chmod(restrictedDir, 0o444); // Read-only
        await expect(
          tokenStore.saveToken('permission-test', validQwenToken),
        ).rejects.toThrow();
        await fs.chmod(restrictedDir, 0o755); // Restore permissions for cleanup
      },
    );
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
    it.skipIf(process.platform === 'win32')(
      'should preserve secure file permissions when updating tokens',
      async () => {
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
      },
    );

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

  describe('Bucket Support - Phase 1', () => {
    const workToken: OAuthToken = {
      access_token: 'work-access-token',
      refresh_token: 'work-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      scope: 'work-scope',
      token_type: 'Bearer' as const,
    };

    const personalToken: OAuthToken = {
      access_token: 'personal-access-token',
      refresh_token: 'personal-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      scope: 'personal-scope',
      token_type: 'Bearer' as const,
    };

    /**
     * @requirement REQ-490.1 - Bucket Storage
     * @scenario Save token to named bucket
     * @given Empty token store
     * @when saveToken('anthropic', token, 'work@company.com') is called
     * @then Token is saved to anthropic-work@company.com.json
     */
    it('should save token to named bucket with correct filename pattern', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');

      const tokenPath = join(
        tempDir,
        '.llxprt',
        'oauth',
        'anthropic-work@company.com.json',
      );
      await fs.access(tokenPath); // File exists
      const content = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
      expect(content).toEqual(workToken);
    });

    /**
     * @requirement REQ-490.1 - Bucket Storage
     * @scenario Retrieve token from named bucket
     * @given Token saved in named bucket
     * @when getToken('anthropic', 'work@company.com') is called
     * @then Returns correct token from that bucket
     */
    it('should retrieve token from named bucket', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');
      const retrieved = await tokenStore.getToken(
        'anthropic',
        'work@company.com',
      );
      expect(retrieved).toEqual(workToken);
      expect(retrieved?.access_token).toBe('work-access-token');
    });

    /**
     * @requirement REQ-490.1 - Backward Compatibility
     * @scenario Save token to default bucket
     * @given Empty token store
     * @when saveToken('anthropic', token) is called without bucket
     * @then Token is saved to anthropic.json (default bucket)
     */
    it('should use default bucket when bucket parameter is undefined', async () => {
      await tokenStore.saveToken('anthropic', workToken);

      const tokenPath = join(tempDir, '.llxprt', 'oauth', 'anthropic.json');
      await fs.access(tokenPath);
      const content = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
      expect(content).toEqual(workToken);
    });

    /**
     * @requirement REQ-490.1 - Backward Compatibility
     * @scenario Get token from default bucket
     * @given Token saved without bucket parameter
     * @when getToken('anthropic') is called
     * @then Returns token from default bucket
     */
    it('should retrieve from default bucket when bucket parameter is undefined', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toEqual(workToken);
    });

    /**
     * @requirement REQ-490.1 - Bucket Storage
     * @scenario Explicit default bucket
     * @given Empty token store
     * @when saveToken('anthropic', token, 'default') is called
     * @then Token is saved to anthropic.json (not anthropic-default.json)
     */
    it('should use default bucket when bucket is explicitly "default"', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'default');

      const defaultPath = join(tempDir, '.llxprt', 'oauth', 'anthropic.json');
      const namedPath = join(
        tempDir,
        '.llxprt',
        'oauth',
        'anthropic-default.json',
      );

      await fs.access(defaultPath); // Should exist
      await expect(fs.access(namedPath)).rejects.toThrow(); // Should NOT exist

      const content = JSON.parse(await fs.readFile(defaultPath, 'utf8'));
      expect(content).toEqual(workToken);
    });

    /**
     * @requirement REQ-490.1 - Bucket Listing
     * @scenario List all buckets for a provider
     * @given Multiple buckets for anthropic provider
     * @when listBuckets('anthropic') is called
     * @then Returns array of bucket names including default
     */
    it('should list all buckets for a provider', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'default');
      await tokenStore.saveToken(
        'anthropic',
        personalToken,
        'work@company.com',
      );
      await tokenStore.saveToken('anthropic', workToken, 'personal@gmail.com');

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toHaveLength(3);
      expect(buckets).toContain('default');
      expect(buckets).toContain('work@company.com');
      expect(buckets).toContain('personal@gmail.com');
      expect(buckets).toEqual(
        expect.arrayContaining([
          'default',
          'personal@gmail.com',
          'work@company.com',
        ]),
      );
    });

    /**
     * @requirement REQ-490.1 - Bucket Listing
     * @scenario List buckets when only default exists
     * @given Only default bucket exists
     * @when listBuckets('anthropic') is called
     * @then Returns ['default']
     */
    it('should return default in list when only default bucket exists', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual(['default']);
    });

    /**
     * @requirement REQ-490.1 - Bucket Listing
     * @scenario List buckets for non-existent provider
     * @given No buckets exist for provider
     * @when listBuckets('nonexistent') is called
     * @then Returns empty array
     */
    it('should return empty array when no buckets exist for provider', async () => {
      const buckets = await tokenStore.listBuckets('nonexistent');
      expect(buckets).toEqual([]);
    });

    /**
     * @requirement REQ-490.1 - Bucket Isolation
     * @scenario Provider bucket isolation
     * @given Buckets for multiple providers
     * @when listBuckets is called for one provider
     * @then Returns only that provider's buckets
     */
    it('should not include other providers buckets in listing', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');
      await tokenStore.saveToken('gemini', personalToken, 'work@company.com');
      await tokenStore.saveToken('qwen', workToken, 'personal@gmail.com');

      const anthropicBuckets = await tokenStore.listBuckets('anthropic');
      const geminiBuckets = await tokenStore.listBuckets('gemini');

      expect(anthropicBuckets).toEqual(['work@company.com']);
      expect(geminiBuckets).toEqual(['work@company.com']);
      expect(anthropicBuckets).not.toContain('personal@gmail.com');
    });

    /**
     * @requirement REQ-490.1 - Bucket Isolation
     * @scenario Bucket isolation across providers
     * @given Same bucket name for different providers
     * @when tokens are saved and retrieved
     * @then Each provider's bucket is completely isolated
     */
    it('should maintain isolation between providers with same bucket name', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');
      await tokenStore.saveToken('gemini', personalToken, 'work@company.com');

      const anthropicToken = await tokenStore.getToken(
        'anthropic',
        'work@company.com',
      );
      const geminiToken = await tokenStore.getToken(
        'gemini',
        'work@company.com',
      );

      expect(anthropicToken).toEqual(workToken);
      expect(geminiToken).toEqual(personalToken);
      expect(anthropicToken?.access_token).not.toBe(geminiToken?.access_token);
    });

    /**
     * @requirement REQ-490.1 - Bucket Deletion
     * @scenario Delete token from specific bucket
     * @given Multiple buckets exist
     * @when removeToken('anthropic', 'work@company.com') is called
     * @then Only that bucket is removed, others remain
     */
    it('should remove token from specific bucket only', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');
      await tokenStore.saveToken(
        'anthropic',
        personalToken,
        'personal@gmail.com',
      );

      await tokenStore.removeToken('anthropic', 'work@company.com');

      const workTokenRetrieved = await tokenStore.getToken(
        'anthropic',
        'work@company.com',
      );
      const personalTokenRetrieved = await tokenStore.getToken(
        'anthropic',
        'personal@gmail.com',
      );

      expect(workTokenRetrieved).toBeNull();
      expect(personalTokenRetrieved).toEqual(personalToken);

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual(['personal@gmail.com']);
    });

    /**
     * @requirement REQ-490.1 - Bucket Deletion
     * @scenario Delete default bucket
     * @given Default bucket exists
     * @when removeToken('anthropic') is called without bucket
     * @then Default bucket is removed
     */
    it('should delete default bucket when no bucket parameter provided', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      await tokenStore.removeToken('anthropic');

      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toBeNull();

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual([]);
    });

    /**
     * @requirement REQ-490.1 - Bucket Name Validation
     * @scenario Reject invalid bucket names
     * @given Invalid bucket name characters
     * @when saveToken is called with invalid bucket name
     * @then Throws error with validation message
     */
    it('should reject bucket names with filesystem-unsafe characters', async () => {
      const invalidBucketNames = [
        'bucket:name', // colon
        'bucket/name', // forward slash
        'bucket\\name', // backslash
        'bucket<name', // less than
        'bucket>name', // greater than
        'bucket"name', // quote
        'bucket|name', // pipe
        'bucket?name', // question mark
        'bucket*name', // asterisk
      ];

      for (const bucketName of invalidBucketNames) {
        await expect(
          tokenStore.saveToken('anthropic', workToken, bucketName),
        ).rejects.toThrow();
      }
    });

    /**
     * @requirement REQ-490.1 - Bucket Name Validation
     * @scenario Accept valid bucket names
     * @given Valid bucket name patterns
     * @when saveToken is called
     * @then Tokens are saved successfully
     */
    it('should accept valid bucket names including emails and alphanumeric', async () => {
      const validBucketNames = [
        'work@company.com',
        'personal@gmail.com',
        'bucket-with-hyphens',
        'bucket_with_underscores',
        'bucket.with.dots',
        'simple123',
      ];

      for (const bucketName of validBucketNames) {
        await tokenStore.saveToken('anthropic', workToken, bucketName);
        const retrieved = await tokenStore.getToken('anthropic', bucketName);
        expect(retrieved).toEqual(workToken);
      }
    });

    /**
     * @requirement REQ-490.1 - File Permissions
     * @scenario Bucket files have secure permissions
     * @given Named bucket token saved
     * @when file is created
     * @then File has 0600 permissions
     */
    it.skipIf(process.platform === 'win32')(
      'should create bucket files with 0600 permissions',
      async () => {
        await tokenStore.saveToken('anthropic', workToken, 'work@company.com');

        const tokenPath = join(
          tempDir,
          '.llxprt',
          'oauth',
          'anthropic-work@company.com.json',
        );
        const stats = await fs.stat(tokenPath);
        expect(stats.mode & 0o777).toBe(0o600);
      },
    );

    /**
     * @requirement REQ-490.1 - Backward Compatibility
     * @scenario Existing anthropic.json works as default
     * @given Pre-existing anthropic.json file
     * @when getToken('anthropic') is called
     * @then Returns token from anthropic.json
     */
    it('should read existing provider.json files as default bucket', async () => {
      // Simulate pre-existing file (before bucket feature)
      const legacyPath = join(tempDir, '.llxprt', 'oauth', 'anthropic.json');
      await fs.mkdir(join(tempDir, '.llxprt', 'oauth'), { recursive: true });
      await fs.writeFile(legacyPath, JSON.stringify(workToken), {
        mode: 0o600,
      });

      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toEqual(workToken);

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('default');
    });

    /**
     * @requirement REQ-490.1 - Bucket Isolation
     * @scenario Multiple buckets maintain separate tokens
     * @given Different tokens in different buckets
     * @when tokens are updated independently
     * @then Each bucket maintains its own token
     */
    it('should maintain isolation when updating tokens in different buckets', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work@company.com');
      await tokenStore.saveToken(
        'anthropic',
        personalToken,
        'personal@gmail.com',
      );

      const updatedWorkToken: OAuthToken = {
        ...workToken,
        access_token: 'updated-work-token',
      };

      await tokenStore.saveToken(
        'anthropic',
        updatedWorkToken,
        'work@company.com',
      );

      const workRetrieved = await tokenStore.getToken(
        'anthropic',
        'work@company.com',
      );
      const personalRetrieved = await tokenStore.getToken(
        'anthropic',
        'personal@gmail.com',
      );

      expect(workRetrieved?.access_token).toBe('updated-work-token');
      expect(personalRetrieved?.access_token).toBe('personal-access-token');
    });
  });
});
