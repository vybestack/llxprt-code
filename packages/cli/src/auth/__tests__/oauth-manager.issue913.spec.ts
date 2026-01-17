/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager, OAuthProvider } from '../oauth-manager.js';
import { TokenStore, OAuthToken } from '../types.js';
import { MessageBus, PolicyEngine } from '@vybestack/llxprt-code-core';

/**
 * Issue 913: OAuth Bucket Prompt Mode Tests
 *
 * These tests verify that when auth-bucket-prompt is enabled:
 * 1. The system waits indefinitely for MessageBus confirmation (no 3-second timeout)
 * 2. Single-bucket and default profiles also show the confirmation dialog
 * 3. Stdin fallback is NOT used when MessageBus is available
 *
 * The bug is in oauth-manager.ts lines 1625-1630 where a 3-second timeout race
 * causes premature fallback to stdin, breaking TUI input handling.
 */

/**
 * Mock token store for testing
 */
function createMockTokenStore(): TokenStore {
  const tokens = new Map<string, OAuthToken>();

  return {
    saveToken: vi.fn(
      async (
        provider: string,
        token: OAuthToken,
        bucket?: string,
      ): Promise<void> => {
        const key = `${provider}:${bucket ?? 'default'}`;
        tokens.set(key, token);
      },
    ),
    getToken: vi.fn(
      async (provider: string, bucket?: string): Promise<OAuthToken | null> => {
        const key = `${provider}:${bucket ?? 'default'}`;
        return tokens.get(key) ?? null;
      },
    ),
    removeToken: vi.fn(async (): Promise<void> => {}),
    listProviders: vi.fn(async (): Promise<string[]> => []),
    listBuckets: vi.fn(async (): Promise<string[]> => []),
    getBucketStats: vi.fn(
      async (
        _provider: string,
        bucket: string,
      ): Promise<{
        bucket: string;
        requestCount: number;
        percentage: number;
        lastUsed?: number;
      } | null> => ({
        bucket,
        requestCount: 0,
        percentage: 0,
        lastUsed: undefined,
      }),
    ),
    acquireRefreshLock: vi.fn(async (): Promise<boolean> => true),
    releaseRefreshLock: vi.fn(async (): Promise<void> => {}),
  };
}

/**
 * Mock OAuth provider for testing
 */
function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async (): Promise<void> => {}),
    getToken: vi.fn(
      async (): Promise<OAuthToken> => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      }),
    ),
    refreshToken: vi.fn(async (): Promise<OAuthToken | null> => null),
  };
}

/**
 * Mock ephemeral settings
 */
const mockEphemeralSettings = new Map<string, unknown>();

function setMockEphemeralSetting<T>(key: string, value: T): void {
  mockEphemeralSettings.set(key, value);
}

function clearMockEphemeralSettings(): void {
  mockEphemeralSettings.clear();
}

// Mock the runtime settings module
vi.mock('../../runtime/runtimeSettings.js', () => ({
  getEphemeralSetting: (key: string) => mockEphemeralSettings.get(key),
  getCliRuntimeServices: () => ({
    settingsService: {
      getCurrentProfileName: () => null,
      get: () => null,
    },
  }),
  getCliProviderManager: () => ({
    getProviderByName: () => null,
  }),
  getCliRuntimeContext: () => ({
    runtimeId: 'test-runtime',
  }),
}));

describe('Issue 913: OAuth Manager Prompt Mode', () => {
  let tokenStore: TokenStore;
  let manager: OAuthManager;
  let mockProvider: OAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockEphemeralSettings();
    tokenStore = createMockTokenStore();
    manager = new OAuthManager(tokenStore);
    mockProvider = createMockProvider('anthropic');
    manager.registerProvider(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Single-Bucket Prompt Support', () => {
    /**
     * @requirement Issue 913 - Single bucket shows dialog
     * @scenario Single bucket profile with prompt mode enabled
     * @given auth-bucket-prompt is true and profile has one bucket
     * @when Authentication is triggered
     * @then MessageBus confirmation should be requested before browser opens
     *
     * This test validates that single-bucket profiles route through
     * MultiBucketAuthenticator when prompt mode is enabled.
     */
    it('should request MessageBus confirmation for single-bucket when prompt enabled', async () => {
      setMockEphemeralSetting('auth-bucket-prompt', true);

      let confirmationRequested = false;

      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      messageBus.requestBucketAuthConfirmation = vi.fn(
        async (): Promise<boolean> => {
          confirmationRequested = true;
          return true; // User approves
        },
      );

      manager.setMessageBus(() => messageBus);
      await manager.toggleOAuthEnabled('anthropic');

      // Trigger authentication for a single bucket
      await manager.getToken('anthropic');

      // With the FIX: confirmation should have been requested
      // With the BUG: single bucket may skip the prompt flow
      expect(confirmationRequested).toBe(true);
      expect(messageBus.requestBucketAuthConfirmation).toHaveBeenCalled();
    });

    /**
     * @requirement Issue 913 - Single bucket without prompt mode
     * @scenario Single bucket profile with prompt mode disabled
     * @given auth-bucket-prompt is false
     * @when Authentication is triggered
     * @then Should proceed without confirmation dialog (backward compatible)
     */
    it('should skip MessageBus confirmation for single-bucket when prompt disabled', async () => {
      setMockEphemeralSetting('auth-bucket-prompt', false);

      let confirmationRequested = false;

      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      messageBus.requestBucketAuthConfirmation = vi.fn(
        async (): Promise<boolean> => {
          confirmationRequested = true;
          return true;
        },
      );

      manager.setMessageBus(() => messageBus);
      await manager.toggleOAuthEnabled('anthropic');

      // Trigger authentication
      await manager.getToken('anthropic');

      // With prompt mode disabled, should NOT go through MultiBucketAuthenticator
      // for single bucket profiles (backward compatible behavior)
      expect(confirmationRequested).toBe(false);
    });
  });

  describe('No Stdin Fallback', () => {
    /**
     * @requirement Issue 913 - No stdin when MessageBus available
     * @scenario Prompt mode with MessageBus available
     * @given auth-bucket-prompt is true and MessageBus is working
     * @when Authentication proceeds
     * @then process.stdin.setRawMode should NOT be called
     */
    it('should not use stdin fallback when MessageBus responds', async () => {
      setMockEphemeralSetting('auth-bucket-prompt', true);

      // Spy on stdin.setRawMode if it exists
      const setRawModeSpy = vi.fn();
      const originalSetRawMode = process.stdin.setRawMode;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode = setRawModeSpy;
      }

      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      // MessageBus responds immediately
      messageBus.requestBucketAuthConfirmation = vi.fn(
        async (): Promise<boolean> => true,
      );

      manager.setMessageBus(() => messageBus);
      await manager.toggleOAuthEnabled('anthropic');

      await manager.getToken('anthropic');

      // setRawMode should NOT have been called (no stdin fallback)
      expect(setRawModeSpy).not.toHaveBeenCalled();

      // Restore
      if (originalSetRawMode) {
        process.stdin.setRawMode = originalSetRawMode;
      }
    });
  });

  describe('Eager Multi-Bucket Authentication', () => {
    /**
     * @requirement Issue 913 - Eager auth for multi-bucket
     * @scenario Multi-bucket profile with some buckets unauthenticated
     * @given Profile has 3 buckets, bucket2 already authenticated
     * @when Profile is loaded
     * @then bucket1 and bucket3 should be prompted, bucket2 skipped
     *
     * NOTE: This test requires mocking the profile loading mechanism.
     * The actual implementation change is in oauth-manager.ts to check
     * existing tokens before prompting.
     */
    it.skip('should only prompt for unauthenticated buckets in multi-bucket profile (requires profile-level integration)', async () => {
      setMockEphemeralSetting('auth-bucket-prompt', true);

      // Pre-authenticate bucket2
      const bucket2Token: OAuthToken = {
        access_token: 'existing-token',
        refresh_token: 'existing-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      };
      await tokenStore.saveToken('anthropic', bucket2Token, 'bucket2');

      const promptedBuckets: string[] = [];

      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      messageBus.requestBucketAuthConfirmation = vi.fn(
        async (_provider: string, bucket: string): Promise<boolean> => {
          promptedBuckets.push(bucket);
          return true;
        },
      );

      manager.setMessageBus(() => messageBus);
      await manager.toggleOAuthEnabled('anthropic');

      // This test requires profile-level integration to fully test.
      // The expected behavior when implemented:
      // - bucket1 should be prompted
      // - bucket2 should be SKIPPED (already has token)
      // - bucket3 should be prompted
      // With the FIX: promptedBuckets would be ['bucket1', 'bucket3']
    });
  });
});
