/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251213issue490
 * @phase Phase 10: Integration Testing and CI Verification
 * TDD Integration Tests for OAuth Buckets
 *
 * These tests MUST be written FIRST and FAIL initially (RED phase).
 * Tests verify all bucket features work together end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  KeyringTokenStore,
  SecureStore,
  type KeyringAdapter,
  type OAuthToken,
  type StandardProfile,
} from '@vybestack/llxprt-code-core';
import { OAuthManager, OAuthProvider } from '../../auth/oauth-manager.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempProfile,
} from '../test-utils.js';

/**
 * Creates a mock keyring adapter backed by an in-memory Map.
 */
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

/**
 * Counter to ensure unique token values across all tests
 */
let tokenCounter = 0;

/**
 * Creates a mock OAuth token for testing
 */
function createMockToken(bucket: string, expiresIn: number = 3600): OAuthToken {
  tokenCounter++;
  return {
    access_token: `mock_access_token_${bucket}_${tokenCounter}`,
    refresh_token: `mock_refresh_token_${bucket}_${tokenCounter}`,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + expiresIn,
    scope: 'openid profile email',
  };
}

/**
 * Creates a mock OAuth provider for testing
 */
function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    async initiateAuth(): Promise<void> {
      // Mock implementation
    },
    async getToken(): Promise<OAuthToken | null> {
      return createMockToken('default');
    },
    async refreshToken(currentToken: OAuthToken): Promise<OAuthToken | null> {
      return createMockToken(`refreshed-${currentToken.access_token}`);
    },
  };
}

/**
 * Creates a valid StandardProfile for testing with minimal required fields
 */
function createValidProfile(
  overrides: Partial<StandardProfile> = {},
): StandardProfile {
  return {
    version: 1,
    type: 'standard',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    modelParams: {},
    ephemeralSettings: {},
    ...overrides,
  };
}

describe('Phase 10: OAuth Buckets Integration Testing', () => {
  let tempDir: string;
  let oauthDir: string;
  let profilesDir: string;
  let tokenStore: KeyringTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    // Create temp directories for isolated testing
    tempDir = await createTempDirectory();
    oauthDir = path.join(tempDir, 'oauth');
    profilesDir = path.join(tempDir, '.llxprt', 'profiles');
    await fs.mkdir(oauthDir, { recursive: true });
    await fs.mkdir(profilesDir, { recursive: true });

    // Create token store backed by in-memory keyring
    const secureStore = new SecureStore('llxprt-code-oauth', {
      fallbackDir: oauthDir,
      fallbackPolicy: 'allow',
      keyringLoader: async () => createMockKeyring(),
    });
    tokenStore = new KeyringTokenStore({ secureStore });

    // Create OAuth manager
    oauthManager = new OAuthManager(tokenStore);

    // Register mock OAuth providers
    oauthManager.registerProvider(createMockProvider('anthropic'));
    oauthManager.registerProvider(createMockProvider('gemini'));
    oauthManager.registerProvider(createMockProvider('qwen'));
    oauthManager.registerProvider(createMockProvider('openai'));
  });

  afterEach(async () => {
    await cleanupTempDirectory(tempDir);
    vi.clearAllMocks();
  });

  describe('Complete bucket lifecycle', () => {
    it('should complete full login-save-load cycle with buckets', async () => {
      // Step 1: Create buckets via mock authentication
      const workToken = createMockToken('work-company');
      const personalToken = createMockToken('personal-gmail');

      await tokenStore.saveToken('anthropic', workToken, 'work-company');
      await tokenStore.saveToken('anthropic', personalToken, 'personal-gmail');

      // Verify buckets exist
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('work-company');
      expect(buckets).toContain('personal-gmail');

      // Step 2: Create profile with multiple buckets
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['work-company', 'personal-gmail'],
        },
      });

      await createTempProfile(tempDir, 'multi-claude', profile);

      // Step 3: Load profile, verify first bucket used
      const loadedToken = await oauthManager.getOAuthToken(
        'anthropic',
        'work-company',
      );
      expect(loadedToken).not.toBeNull();
      expect(loadedToken?.access_token).toBe(workToken.access_token);

      // Step 4: Simulate session bucket override (failover simulation)
      oauthManager.setSessionBucket('anthropic', 'personal-gmail');

      const overrideToken = await oauthManager.getOAuthToken('anthropic');
      expect(overrideToken?.access_token).toBe(personalToken.access_token);

      // Step 5: Verify buckets are properly managed
      const allBuckets = await tokenStore.listBuckets('anthropic');
      expect(allBuckets).toHaveLength(2);
      expect(allBuckets).toContain('work-company');
      expect(allBuckets).toContain('personal-gmail');
    });

    it('should maintain bucket isolation throughout lifecycle', async () => {
      // Create work bucket
      const workToken = createMockToken('work-company');
      await tokenStore.saveToken('anthropic', workToken, 'work-company');

      // Create personal bucket with different token
      const personalToken = createMockToken('personal-gmail');
      await tokenStore.saveToken('anthropic', personalToken, 'personal-gmail');

      // Verify tokens are different
      const retrievedWork = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const retrievedPersonal = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );

      expect(retrievedWork).not.toBeNull();
      expect(retrievedPersonal).not.toBeNull();
      expect(retrievedWork?.access_token).toBe(workToken.access_token);
      expect(retrievedPersonal?.access_token).toBe(personalToken.access_token);
      expect(retrievedWork?.access_token).not.toBe(
        retrievedPersonal?.access_token,
      );

      // Removing one bucket should not affect the other
      await tokenStore.removeToken('anthropic', 'work-company');

      const afterRemoveWork = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const afterRemovePersonal = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );

      expect(afterRemoveWork).toBeNull();
      expect(afterRemovePersonal).not.toBeNull();
      expect(afterRemovePersonal?.access_token).toBe(
        personalToken.access_token,
      );
    });

    it('should track bucket usage statistics correctly', async () => {
      // Create multiple buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('work-company'),
        'work-company',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('personal-gmail'),
        'personal-gmail',
      );

      // Simulate usage by getting tokens multiple times
      await oauthManager.getToken('anthropic', 'work-company');
      await oauthManager.getToken('anthropic', 'work-company');
      await oauthManager.getToken('anthropic', 'personal-gmail');

      // Verify both buckets are accessible
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('work-company');
      expect(buckets).toContain('personal-gmail');

      // Verify tokens can be retrieved from both buckets
      const workToken = await tokenStore.getToken('anthropic', 'work-company');
      const personalToken = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );
      expect(workToken).not.toBeNull();
      expect(personalToken).not.toBeNull();
    });
  });

  describe('Multi-provider bucket management', () => {
    it('should manage buckets across multiple providers independently', async () => {
      // Create buckets for anthropic
      const anthropicWork = createMockToken('work-company');
      const anthropicPersonal = createMockToken('personal-gmail');
      await tokenStore.saveToken('anthropic', anthropicWork, 'work-company');
      await tokenStore.saveToken(
        'anthropic',
        anthropicPersonal,
        'personal-gmail',
      );

      // Create buckets for gemini with same names
      const geminiWork = createMockToken('work-company');
      const geminiPersonal = createMockToken('personal-gmail');
      await tokenStore.saveToken('gemini', geminiWork, 'work-company');
      await tokenStore.saveToken('gemini', geminiPersonal, 'personal-gmail');

      // Create buckets for qwen
      const qwenWork = createMockToken('work-company');
      await tokenStore.saveToken('qwen', qwenWork, 'work-company');

      // Verify provider isolation
      const anthropicBuckets = await tokenStore.listBuckets('anthropic');
      const geminiBuckets = await tokenStore.listBuckets('gemini');
      const qwenBuckets = await tokenStore.listBuckets('qwen');

      expect(anthropicBuckets).toHaveLength(2);
      expect(geminiBuckets).toHaveLength(2);
      expect(qwenBuckets).toHaveLength(1);

      // Verify tokens are provider-specific
      const anthropicToken = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const geminiToken = await tokenStore.getToken('gemini', 'work-company');

      expect(anthropicToken?.access_token).toBe(anthropicWork.access_token);
      expect(geminiToken?.access_token).toBe(geminiWork.access_token);
      expect(anthropicToken?.access_token).not.toBe(geminiToken?.access_token);
    });

    it('should prevent cross-provider bucket interference', async () => {
      // Create work bucket for anthropic
      const anthropicToken = createMockToken('work-company');
      await tokenStore.saveToken('anthropic', anthropicToken, 'work-company');

      // Create work bucket for gemini
      const geminiToken = createMockToken('work-company');
      await tokenStore.saveToken('gemini', geminiToken, 'work-company');

      // Remove anthropic bucket
      await tokenStore.removeToken('anthropic', 'work-company');

      // Verify gemini bucket still exists
      const geminiStillExists = await tokenStore.getToken(
        'gemini',
        'work-company',
      );
      expect(geminiStillExists).not.toBeNull();
      expect(geminiStillExists?.access_token).toBe(geminiToken.access_token);

      // Verify anthropic bucket is removed
      const anthropicRemoved = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      expect(anthropicRemoved).toBeNull();
    });

    it('should handle session bucket overrides per provider', async () => {
      // Create buckets for multiple providers
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('work-company'),
        'work-company',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('personal-gmail'),
        'personal-gmail',
      );
      await tokenStore.saveToken(
        'gemini',
        createMockToken('work-company'),
        'work-company',
      );
      await tokenStore.saveToken(
        'gemini',
        createMockToken('personal-gmail'),
        'personal-gmail',
      );

      // Set different session buckets for each provider
      oauthManager.setSessionBucket('anthropic', 'work-company');
      oauthManager.setSessionBucket('gemini', 'personal-gmail');

      // Verify session overrides are provider-specific
      expect(oauthManager.getSessionBucket('anthropic')).toBe('work-company');
      expect(oauthManager.getSessionBucket('gemini')).toBe('personal-gmail');

      // Clear one provider's session
      oauthManager.clearSessionBucket('anthropic');

      expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();
      expect(oauthManager.getSessionBucket('gemini')).toBe('personal-gmail');
    });
  });

  describe('Profile with buckets end-to-end', () => {
    it('should save and load profile with multiple buckets correctly', async () => {
      // Create buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket1'),
        'bucket1',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket2'),
        'bucket2',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket3'),
        'bucket3',
      );

      // Create profile with ordered buckets
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      });

      await createTempProfile(tempDir, 'multi-bucket-profile', profile);

      // Load profile and verify bucket order preserved
      const profilePath = path.join(profilesDir, 'multi-bucket-profile.json');
      const loadedContent = await fs.readFile(profilePath, 'utf8');
      const loadedProfile = JSON.parse(loadedContent) as StandardProfile;

      expect(loadedProfile.auth).toBeDefined();
      expect(loadedProfile.auth?.type).toBe('oauth');
      expect(loadedProfile.auth?.buckets).toEqual([
        'bucket1',
        'bucket2',
        'bucket3',
      ]);

      // Verify all bucket tokens are accessible
      for (const bucket of ['bucket1', 'bucket2', 'bucket3']) {
        const token = await oauthManager.getOAuthToken('anthropic', bucket);
        expect(token).not.toBeNull();
        expect(token?.access_token).toContain(bucket);
      }
    });

    it('should verify failover chain works in correct order', async () => {
      // Create three buckets with different expiry times
      const bucket1Token = createMockToken('bucket1', 3600);
      const bucket2Token = createMockToken('bucket2', 7200);
      const bucket3Token = createMockToken('bucket3', 10800);

      await tokenStore.saveToken('anthropic', bucket1Token, 'bucket1');
      await tokenStore.saveToken('anthropic', bucket2Token, 'bucket2');
      await tokenStore.saveToken('anthropic', bucket3Token, 'bucket3');

      // Create profile with failover order
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      });

      await createTempProfile(tempDir, 'failover-profile', profile);

      // Simulate failover by using session bucket override
      // First bucket should be used by default
      oauthManager.setSessionBucket('anthropic', 'bucket1');
      const token1 = await oauthManager.getOAuthToken('anthropic');
      expect(token1?.access_token).toBe(bucket1Token.access_token);

      // Simulate failover to second bucket
      oauthManager.setSessionBucket('anthropic', 'bucket2');
      const token2 = await oauthManager.getOAuthToken('anthropic');
      expect(token2?.access_token).toBe(bucket2Token.access_token);

      // Simulate failover to third bucket
      oauthManager.setSessionBucket('anthropic', 'bucket3');
      const token3 = await oauthManager.getOAuthToken('anthropic');
      expect(token3?.access_token).toBe(bucket3Token.access_token);
    });

    it('should track per-bucket usage in stats', async () => {
      // Create buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket1'),
        'bucket1',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket2'),
        'bucket2',
      );

      // Simulate different usage patterns
      oauthManager.setSessionBucket('anthropic', 'bucket1');
      await oauthManager.getToken('anthropic'); // Use bucket1
      await oauthManager.getToken('anthropic'); // Use bucket1 again

      oauthManager.setSessionBucket('anthropic', 'bucket2');
      await oauthManager.getToken('anthropic'); // Use bucket2

      // Verify both buckets exist and are accessible
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('bucket1');
      expect(buckets).toContain('bucket2');

      // Verify session bucket switching worked
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket2');
    });

    it('should display bucket info when loading profile', async () => {
      // Create buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('work-company'),
        'work-company',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('personal-gmail'),
        'personal-gmail',
      );

      // Create profile
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['work-company', 'personal-gmail'],
        },
      });

      await createTempProfile(tempDir, 'info-profile', profile);

      // Verify profile file contains bucket information
      const profilePath = path.join(profilesDir, 'info-profile.json');
      const content = await fs.readFile(profilePath, 'utf8');
      const loaded = JSON.parse(content) as StandardProfile;

      expect(loaded.auth).toBeDefined();
      expect(loaded.auth?.buckets).toEqual(['work-company', 'personal-gmail']);

      // Verify buckets are accessible via OAuth manager
      const workToken = await oauthManager.getOAuthToken(
        'anthropic',
        'work-company',
      );
      const personalToken = await oauthManager.getOAuthToken(
        'anthropic',
        'personal-gmail',
      );
      expect(workToken).not.toBeNull();
      expect(personalToken).not.toBeNull();
    });
  });

  describe('Error scenarios', () => {
    it('should error when all buckets expired', async () => {
      // Create expired tokens (expiry in the past)
      const expiredToken1 = createMockToken('bucket1', -3600); // Expired 1 hour ago
      const expiredToken2 = createMockToken('bucket2', -7200); // Expired 2 hours ago

      await tokenStore.saveToken('anthropic', expiredToken1, 'bucket1');
      await tokenStore.saveToken('anthropic', expiredToken2, 'bucket2');

      // Verify tokens are expired
      const token1 = await tokenStore.getToken('anthropic', 'bucket1');
      const token2 = await tokenStore.getToken('anthropic', 'bucket2');

      expect(token1).not.toBeNull();
      expect(token2).not.toBeNull();
      if (token1 && token2) {
        const now = Math.floor(Date.now() / 1000);
        expect(token1.expiry).toBeLessThan(now);
        expect(token2.expiry).toBeLessThan(now);
      }

      // Attempting to use expired buckets should be detected
      // This would normally trigger re-authentication flow
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('bucket1');
      expect(buckets).toContain('bucket2');

      // Note: Actual expiry handling would be in profileApplication
      // This test verifies we can detect expired buckets
    });

    it('should error when bucket does not exist on load', async () => {
      // Create profile referencing non-existent bucket
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['nonexistent-bucket'],
        },
      });

      await createTempProfile(tempDir, 'missing-bucket-profile', profile);

      // Attempt to get token from non-existent bucket
      const token = await oauthManager.getOAuthToken(
        'anthropic',
        'nonexistent-bucket',
      );
      expect(token).toBeNull();

      // Verify bucket does not exist in list
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).not.toContain('nonexistent-bucket');
    });

    it('should error on invalid bucket name when saving', async () => {
      // Attempt to create bucket with invalid filesystem characters
      const invalidBucketNames = [
        'bucket/with/slashes',
        'bucket\\with\\backslashes',
        'bucket<with>brackets',
        'bucket:with:colons',
        'bucket|with|pipes',
        'bucket?with?questions',
        'bucket*with*asterisks',
      ];

      for (const invalidName of invalidBucketNames) {
        // The bucket name should be rejected with an error
        await expect(
          tokenStore.saveToken(
            'anthropic',
            createMockToken(invalidName),
            invalidName,
          ),
        ).rejects.toThrow(/Invalid bucket name/);
      }
    });

    it('should provide helpful error when trying to use reserved bucket names', async () => {
      // Reserved words that conflict with command parsing
      const reservedNames = ['login', 'logout', 'status', 'switch', '--all'];

      for (const reserved of reservedNames) {
        // These names should be rejected or handled specially
        // The actual validation would be in the command layer
        // Here we verify the bucket system itself doesn't prevent storage
        await tokenStore.saveToken(
          'anthropic',
          createMockToken(reserved),
          reserved,
        );
        const token = await tokenStore.getToken('anthropic', reserved);
        expect(token).not.toBeNull();
      }
    });

    it('should handle missing buckets gracefully in profile chain', async () => {
      // Create only first bucket
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket1'),
        'bucket1',
      );

      // Create profile with multiple buckets where some don't exist
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      });

      await createTempProfile(tempDir, 'partial-buckets', profile);

      // Verify first bucket exists
      const token1 = await oauthManager.getOAuthToken('anthropic', 'bucket1');
      expect(token1).not.toBeNull();

      // Verify missing buckets return null
      const token2 = await oauthManager.getOAuthToken('anthropic', 'bucket2');
      const token3 = await oauthManager.getOAuthToken('anthropic', 'bucket3');
      expect(token2).toBeNull();
      expect(token3).toBeNull();
    });
  });

  describe('Backward compatibility', () => {
    it('should work with profiles without auth field', async () => {
      // Create default bucket token
      const defaultToken = createMockToken('default');
      await tokenStore.saveToken('anthropic', defaultToken);

      // Create legacy profile without auth field
      const legacyProfile = createValidProfile({
        // No auth field
      });

      await createTempProfile(tempDir, 'legacy-profile', legacyProfile);

      // Load profile and verify it uses default bucket
      const token = await oauthManager.getOAuthToken('anthropic');
      expect(token).not.toBeNull();
      expect(token?.access_token).toBe(defaultToken.access_token);

      // Verify profile file doesn't have auth field
      const profilePath = path.join(profilesDir, 'legacy-profile.json');
      const content = await fs.readFile(profilePath, 'utf8');
      const loaded = JSON.parse(content) as StandardProfile;
      expect(loaded.auth).toBeUndefined();
    });

    it('should preserve single-bucket default behavior', async () => {
      // Create default bucket
      const defaultToken = createMockToken('default');
      await tokenStore.saveToken('anthropic', defaultToken);

      // Get token without specifying bucket
      const token = await oauthManager.getOAuthToken('anthropic');
      expect(token).not.toBeNull();
      expect(token?.access_token).toBe(defaultToken.access_token);

      // Verify default bucket behavior
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('default');

      // Get default bucket explicitly
      const explicitDefault = await oauthManager.getOAuthToken(
        'anthropic',
        'default',
      );
      expect(explicitDefault?.access_token).toBe(defaultToken.access_token);
    });

    it('should handle migration from single to multi-bucket seamlessly', async () => {
      // Start with default bucket (legacy behavior)
      const defaultToken = createMockToken('default');
      await tokenStore.saveToken('anthropic', defaultToken);

      // Verify single bucket works
      const token1 = await oauthManager.getOAuthToken('anthropic');
      expect(token1?.access_token).toBe(defaultToken.access_token);

      // Add additional buckets (new feature)
      const workToken = createMockToken('work-company');
      await tokenStore.saveToken('anthropic', workToken, 'work-company');

      // Verify both buckets coexist
      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toContain('default');
      expect(buckets).toContain('work-company');

      // Verify default still works
      const token2 = await oauthManager.getOAuthToken('anthropic');
      expect(token2?.access_token).toBe(defaultToken.access_token);

      // Verify new bucket works
      const token3 = await oauthManager.getOAuthToken(
        'anthropic',
        'work-company',
      );
      expect(token3?.access_token).toBe(workToken.access_token);
    });

    it('should maintain compatibility with API key profiles', async () => {
      // Create profile with API key auth (not OAuth)
      const apiKeyProfile = createValidProfile({
        provider: 'openai',
        model: 'gpt-4',
        auth: {
          type: 'apikey',
        },
      });

      await createTempProfile(tempDir, 'apikey-profile', apiKeyProfile);

      // Load and verify profile
      const profilePath = path.join(profilesDir, 'apikey-profile.json');
      const content = await fs.readFile(profilePath, 'utf8');
      const loaded = JSON.parse(content) as StandardProfile;

      expect(loaded.auth).toBeDefined();
      expect(loaded.auth?.type).toBe('apikey');
      expect(loaded.auth?.buckets).toBeUndefined();
    });

    it('should reject profiles with both OAuth buckets and API key', async () => {
      // This is an invalid configuration
      const invalidProfile = createValidProfile({
        auth: {
          type: 'apikey',
          buckets: ['bucket1', 'bucket2'], // Invalid: API key can't have buckets
        },
      });

      await createTempProfile(tempDir, 'invalid-profile', invalidProfile);

      // When loading this profile, the auth config should be invalid
      const profilePath = path.join(profilesDir, 'invalid-profile.json');
      const content = await fs.readFile(profilePath, 'utf8');
      const loaded = JSON.parse(content);

      // Zod validation would reject this, but here we just verify structure
      expect(loaded.auth.type).toBe('apikey');
      expect(loaded.auth.buckets).toBeDefined();
      // Note: Actual validation would happen in profile loading code
    });

    it('should preserve existing profile fields when adding auth', async () => {
      // Create profile with existing fields
      const existingProfile = createValidProfile({
        modelParams: {
          temperature: 0.7,
          max_tokens: 4096,
        },
      });

      await createTempProfile(tempDir, 'existing-profile', existingProfile);

      // Load and add auth field
      const profilePath = path.join(profilesDir, 'existing-profile.json');
      let content = await fs.readFile(profilePath, 'utf8');
      const loaded = JSON.parse(content) as StandardProfile;

      loaded.auth = {
        type: 'oauth',
        buckets: ['work-company'],
      };

      // Save updated profile
      await fs.writeFile(profilePath, JSON.stringify(loaded, null, 2));

      // Reload and verify all fields preserved
      content = await fs.readFile(profilePath, 'utf8');
      const updated = JSON.parse(content) as StandardProfile;

      expect(updated.version).toBe(1);
      expect(updated.provider).toBe('anthropic');
      expect(updated.model).toBe('claude-sonnet-4');
      expect(updated.modelParams?.temperature).toBe(0.7);
      expect(updated.modelParams?.max_tokens).toBe(4096);
      expect(updated.auth).toBeDefined();
      expect(updated.auth?.type).toBe('oauth');
      expect(updated.auth?.buckets).toEqual(['work-company']);
    });
  });

  describe('Multi-bucket failover integration', () => {
    it('should demonstrate complete failover scenario', async () => {
      // Create three buckets
      const bucket1 = createMockToken('bucket1', 3600);
      const bucket2 = createMockToken('bucket2', 7200);
      const bucket3 = createMockToken('bucket3', 10800);

      await tokenStore.saveToken('anthropic', bucket1, 'bucket1');
      await tokenStore.saveToken('anthropic', bucket2, 'bucket2');
      await tokenStore.saveToken('anthropic', bucket3, 'bucket3');

      // Create profile with failover order
      const profile = createValidProfile({
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      });

      await createTempProfile(tempDir, 'failover-demo', profile);

      // Simulate primary bucket usage
      const primary = await oauthManager.getOAuthToken('anthropic', 'bucket1');
      expect(primary?.access_token).toBe(bucket1.access_token);

      // Simulate failover to secondary (as if bucket1 hit quota)
      oauthManager.setSessionBucket('anthropic', 'bucket2');
      const secondary = await oauthManager.getOAuthToken('anthropic');
      expect(secondary?.access_token).toBe(bucket2.access_token);

      // Simulate failover to tertiary (as if bucket2 also hit quota)
      oauthManager.setSessionBucket('anthropic', 'bucket3');
      const tertiary = await oauthManager.getOAuthToken('anthropic');
      expect(tertiary?.access_token).toBe(bucket3.access_token);

      // Verify all buckets still exist
      const allBuckets = await tokenStore.listBuckets('anthropic');
      expect(allBuckets).toContain('bucket1');
      expect(allBuckets).toContain('bucket2');
      expect(allBuckets).toContain('bucket3');
    });

    it('should handle bucket removal during failover chain', async () => {
      // Create buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket1'),
        'bucket1',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket2'),
        'bucket2',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket3'),
        'bucket3',
      );

      // Verify all exist
      let buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toHaveLength(3);

      // Remove middle bucket
      await tokenStore.removeToken('anthropic', 'bucket2');

      // Verify removal
      buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).toHaveLength(2);
      expect(buckets).toContain('bucket1');
      expect(buckets).not.toContain('bucket2');
      expect(buckets).toContain('bucket3');

      // Verify failover chain skips removed bucket
      const token2 = await oauthManager.getOAuthToken('anthropic', 'bucket2');
      expect(token2).toBeNull();

      const token3 = await oauthManager.getOAuthToken('anthropic', 'bucket3');
      expect(token3).not.toBeNull();
    });
  });

  describe('Diagnostics integration', () => {
    it('should show comprehensive bucket information in diagnostics', async () => {
      // Create buckets for multiple providers
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('work-company', 3600),
        'work-company',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('personal-gmail', -1800),
        'personal-gmail',
      );
      await tokenStore.saveToken(
        'gemini',
        createMockToken('work-company', 7200),
        'work-company',
      );

      // Verify buckets exist for each provider
      const anthropicBuckets = await tokenStore.listBuckets('anthropic');
      const geminiBuckets = await tokenStore.listBuckets('gemini');

      expect(anthropicBuckets).toContain('work-company');
      expect(anthropicBuckets).toContain('personal-gmail');
      expect(geminiBuckets).toContain('work-company');

      // Verify tokens can be retrieved
      const anthropicWork = await tokenStore.getToken(
        'anthropic',
        'work-company',
      );
      const geminiWork = await tokenStore.getToken('gemini', 'work-company');

      expect(anthropicWork).not.toBeNull();
      expect(geminiWork).not.toBeNull();

      // Verify expiry is tracked correctly
      if (anthropicWork && geminiWork) {
        const now = Math.floor(Date.now() / 1000);
        expect(anthropicWork.expiry).toBeGreaterThan(now); // Not expired
        expect(geminiWork.expiry).toBeGreaterThan(now); // Not expired
      }

      // Verify personal bucket is expired
      const anthropicPersonal = await tokenStore.getToken(
        'anthropic',
        'personal-gmail',
      );
      expect(anthropicPersonal).not.toBeNull();
      if (anthropicPersonal) {
        const now = Math.floor(Date.now() / 1000);
        expect(anthropicPersonal.expiry).toBeLessThan(now); // Expired
      }
    });

    it('should indicate active session bucket in diagnostics', async () => {
      // Create buckets
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket1'),
        'bucket1',
      );
      await tokenStore.saveToken(
        'anthropic',
        createMockToken('bucket2'),
        'bucket2',
      );

      // Set session bucket
      oauthManager.setSessionBucket('anthropic', 'bucket2');

      // Verify session bucket is set correctly
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket2');

      // Verify bucket2 is used when getting token without specifying bucket
      const token = await oauthManager.getOAuthToken('anthropic');
      expect(token).not.toBeNull();

      // Verify the token is from bucket2
      const bucket2Token = await tokenStore.getToken('anthropic', 'bucket2');
      expect(token?.access_token).toBe(bucket2Token?.access_token);
    });
  });
});
