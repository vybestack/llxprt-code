/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Legacy behavioral tests for KeyringTokenStore.
 * More comprehensive tests live in __tests__/keyring-token-store.test.ts and
 * __tests__/keyring-token-store.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KeyringTokenStore } from './keyring-token-store.js';
import { SecureStore } from '../storage/secure-store.js';
import { OAuthToken } from './types.js';
import type { KeyringAdapter } from '../storage/secure-store.js';

function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

describe('KeyringTokenStore - Behavioral Tests (migrated)', () => {
  let tokenStore: KeyringTokenStore;
  let tempDir: string;

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
    tempDir = await fs.mkdtemp(join(tmpdir(), 'token-store-test-'));

    const secureStore = new SecureStore('llxprt-code-oauth', {
      fallbackDir: join(tempDir, '.llxprt', 'oauth'),
      fallbackPolicy: 'allow',
      keyringLoader: async () => createMockKeyring(),
    });
    tokenStore = new KeyringTokenStore({ secureStore });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Token CRUD Operations', () => {
    it('should save and retrieve token for new provider', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      const retrieved = await tokenStore.getToken('qwen');
      expect(retrieved).toBeDefined();
      expect(retrieved?.access_token).toBe('qwen-access-token-123');
    });

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

    it('should remove token and return null on subsequent gets', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.removeToken('qwen');
      const retrieved = await tokenStore.getToken('qwen');
      expect(retrieved).toBeNull();
    });
  });

  describe('Multi-Provider Scenarios', () => {
    it('should handle multiple providers independently', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('gemini', _validGeminiToken);
      const qwenToken = await tokenStore.getToken('qwen');
      const geminiToken = await tokenStore.getToken('gemini');
      expect(qwenToken).toEqual(validQwenToken);
      expect(geminiToken).toEqual(_validGeminiToken);
      expect(qwenToken?.access_token).not.toBe(geminiToken?.access_token);
    });

    it('should list all providers with stored tokens in sorted order', async () => {
      await tokenStore.saveToken('qwen', validQwenToken);
      await tokenStore.saveToken('gemini', _validGeminiToken);
      await tokenStore.saveToken('anthropic', validQwenToken);
      const providers = await tokenStore.listProviders();
      expect(providers.sort()).toEqual(['anthropic', 'gemini', 'qwen']);
      expect(providers).toHaveLength(3);
    });

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

  describe('Error Handling', () => {
    it('should return null for non-existent provider without throwing error', async () => {
      const token = await tokenStore.getToken('non-existent');
      expect(token).toBeNull();
    });

    it('should handle removal of non-existent tokens gracefully', async () => {
      await expect(
        tokenStore.removeToken('non-existent'),
      ).resolves.not.toThrow();
    });
  });

  describe('Token Updates', () => {
    it('should completely replace existing tokens when saving new ones', async () => {
      const _updatedToken: OAuthToken = {
        access_token: 'updated-access-token',
        refresh_token: 'updated-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 1800,
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

    it('should handle tokens with optional fields correctly', async () => {
      const minimalToken: OAuthToken = {
        access_token: 'minimal-access-token',
        expiry: Math.floor(Date.now() / 1000) + 600,
        token_type: 'Bearer' as const,
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
    it('should handle provider names with special characters', async () => {
      const specialProviders = [
        'provider-with-hyphens',
        'provider_with_underscores',
        'provider123',
      ];

      for (const provider of specialProviders) {
        await tokenStore.saveToken(provider, validQwenToken);
        const retrieved = await tokenStore.getToken(provider);
        expect(retrieved).toEqual(validQwenToken);
      }
    });

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
    it('should handle concurrent token operations safely', async () => {
      const providers = ['concurrent1', 'concurrent2', 'concurrent3'];
      const tokens = providers.map((provider, index) => ({
        ...validQwenToken,
        access_token: `concurrent-token-${index}`,
      }));

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

  describe('Bucket Support', () => {
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

    it('should save and retrieve token from named bucket', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      const retrieved = await tokenStore.getToken('anthropic', 'work-company');
      expect(retrieved).toEqual(workToken);
      expect(retrieved?.access_token).toBe('work-access-token');
    });

    it('should use default bucket when bucket parameter is undefined', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toEqual(workToken);
    });

    it('should retrieve from default bucket when bucket parameter is undefined', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toEqual(workToken);
    });

    it('should use default bucket when bucket is explicitly "default"', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'default');
      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toEqual(workToken);

      // Verify it's stored as default, not as a named "default" bucket
      const retrievedExplicit = await tokenStore.getToken(
        'anthropic',
        'default',
      );
      expect(retrievedExplicit).toEqual(workToken);
    });

    it('should list all buckets for a provider', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'default');
      await tokenStore.saveToken('anthropic', personalToken, 'work-company');
      await tokenStore.saveToken('anthropic', workToken, 'personal-gmail');

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toHaveLength(3);
      expect(buckets).toContain('default');
      expect(buckets).toContain('work-company');
      expect(buckets).toContain('personal-gmail');
    });

    it('should return default in list when only default bucket exists', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual(['default']);
    });

    it('should return empty array when no buckets exist for provider', async () => {
      const buckets = await tokenStore.listBuckets('nonexistent');
      expect(buckets).toEqual([]);
    });

    it('should not include other providers buckets in listing', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      await tokenStore.saveToken('gemini', personalToken, 'work-company');
      await tokenStore.saveToken('qwen', workToken, 'personal-gmail');

      const anthropicBuckets = await tokenStore.listBuckets('anthropic');
      const geminiBuckets = await tokenStore.listBuckets('gemini');

      expect(anthropicBuckets).toEqual(['work-company']);
      expect(geminiBuckets).toEqual(['work-company']);
      expect(anthropicBuckets).not.toContain('personal-gmail');
    });

    it('should maintain isolation between providers with same bucket name', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      await tokenStore.saveToken('gemini', personalToken, 'work-company');

      const anthropicToken = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const geminiToken = await tokenStore.getToken('gemini', 'work-company');

      expect(anthropicToken).toEqual(workToken);
      expect(geminiToken).toEqual(personalToken);
      expect(anthropicToken?.access_token).not.toBe(geminiToken?.access_token);
    });

    it('should remove token from specific bucket only', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      await tokenStore.saveToken('anthropic', personalToken, 'personal-gmail');

      await tokenStore.removeToken('anthropic', 'work-company');

      const workTokenRetrieved = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const personalTokenRetrieved = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );

      expect(workTokenRetrieved).toBeNull();
      expect(personalTokenRetrieved).toEqual(personalToken);

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual(['personal-gmail']);
    });

    it('should delete default bucket when no bucket parameter provided', async () => {
      await tokenStore.saveToken('anthropic', workToken);
      await tokenStore.removeToken('anthropic');

      const retrieved = await tokenStore.getToken('anthropic');
      expect(retrieved).toBeNull();

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toEqual([]);
    });

    it('should reject bucket names with unsafe characters', async () => {
      const invalidBucketNames = [
        'bucket:name',
        'bucket/name',
        'bucket\\name',
        'bucket<name',
        'bucket>name',
        'bucket"name',
        'bucket|name',
        'bucket?name',
        'bucket*name',
        'bucket@name',
        'bucket.name',
      ];

      for (const bucketName of invalidBucketNames) {
        await expect(
          tokenStore.saveToken('anthropic', workToken, bucketName),
        ).rejects.toThrow();
      }
    });

    it('should accept valid bucket names with allowed characters', async () => {
      const validBucketNames = [
        'work-company',
        'personal-gmail',
        'bucket-with-hyphens',
        'bucket_with_underscores',
        'BucketMixedCase',
        'simple123',
      ];

      for (const bucketName of validBucketNames) {
        await tokenStore.saveToken('anthropic', workToken, bucketName);
        const retrieved = await tokenStore.getToken('anthropic', bucketName);
        expect(retrieved).toEqual(workToken);
      }
    });

    it('should maintain isolation when updating tokens in different buckets', async () => {
      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      await tokenStore.saveToken('anthropic', personalToken, 'personal-gmail');

      const updatedWorkToken: OAuthToken = {
        ...workToken,
        access_token: 'updated-work-token',
      };

      await tokenStore.saveToken('anthropic', updatedWorkToken, 'work-company');

      const workRetrieved = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const personalRetrieved = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );

      expect(workRetrieved?.access_token).toBe('updated-work-token');
      expect(personalRetrieved?.access_token).toBe('personal-access-token');
    });
  });
});
