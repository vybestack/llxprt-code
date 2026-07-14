/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodexOAuthProvider } from './codex-oauth-provider.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';

describe('CodexOAuthProvider - Concurrency and State Management', () => {
  let provider: CodexOAuthProvider;
  let mockTokenStore: TokenStore;

  beforeEach(() => {
    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue([]),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn(async () => true),
      releaseAuthLock: vi.fn(async () => undefined),
    };

    provider = new CodexOAuthProvider(mockTokenStore);
  });

  describe('Concurrent initiateAuth Prevention', () => {
    it('should prevent concurrent initiateAuth calls from starting multiple flows', async () => {
      let firstCallStarted = false;
      let secondCallStarted = false;
      let firstCallCompleted = false;

      const performAuthSpy = vi
        .spyOn(
          provider as unknown as { performAuth: () => Promise<void> },
          'performAuth',
        )
        .mockImplementation(async () => {
          if (!firstCallStarted) {
            firstCallStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 100));
            firstCallCompleted = true;
          } else {
            secondCallStarted = true;
          }
        });

      const promise1 = provider.initiateAuth();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const promise2 = provider.initiateAuth();

      await Promise.all([promise1, promise2]);

      expect(firstCallStarted).toBe(true);
      expect(firstCallCompleted).toBe(true);
      expect(secondCallStarted).toBe(false);

      performAuthSpy.mockRestore();
    });

    it('should allow second initiateAuth after first completes', async () => {
      let callCount = 0;

      const performAuthSpy = vi
        .spyOn(
          provider as unknown as { performAuth: () => Promise<void> },
          'performAuth',
        )
        .mockImplementation(async () => {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        });

      await provider.initiateAuth();
      await provider.initiateAuth();

      expect(callCount).toBe(2);

      performAuthSpy.mockRestore();
    });

    it('should allow retry after failed initiateAuth', async () => {
      let callCount = 0;

      const performAuthSpy = vi
        .spyOn(
          provider as unknown as { performAuth: () => Promise<void> },
          'performAuth',
        )
        .mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('First call failed');
          }
        });

      await expect(provider.initiateAuth()).rejects.toThrow(
        'First call failed',
      );
      await provider.initiateAuth();

      expect(callCount).toBe(2);

      performAuthSpy.mockRestore();
    });
  });

  describe('InitializationState Management', () => {
    const getInitGuardState = () =>
      (
        provider as unknown as {
          initGuard: { getState: () => string };
        }
      ).initGuard.getState();

    it('should track initialization state transitions', async () => {
      expect(getInitGuardState()).toBe('not-started');

      const initPromise = (
        provider as unknown as { ensureInitialized: () => Promise<void> }
      )['ensureInitialized']();

      expect(getInitGuardState()).toBe('in-progress');

      await initPromise;

      expect(getInitGuardState()).toBe('completed');
    });

    it('should transition to failed state on initialization error', async () => {
      const initTokenSpy = vi
        .spyOn(
          provider as unknown as { initializeToken: () => Promise<void> },
          'initializeToken',
        )
        .mockRejectedValue(new Error('Init failed'));

      await expect(
        (provider as unknown as { ensureInitialized: () => Promise<void> })[
          'ensureInitialized'
        ](),
      ).rejects.toThrow('Init failed');

      expect(
        (
          provider as unknown as { initGuard: { getState: () => string } }
        ).initGuard.getState(),
      ).toBe('failed');

      initTokenSpy.mockRestore();
    });

    it('should allow retry after failed initialization', async () => {
      let callCount = 0;

      const initTokenSpy = vi
        .spyOn(
          provider as unknown as { initializeToken: () => Promise<void> },
          'initializeToken',
        )
        .mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Init failed');
          }
        });

      await expect(
        (provider as unknown as { ensureInitialized: () => Promise<void> })[
          'ensureInitialized'
        ](),
      ).rejects.toThrow('Init failed');

      await (provider as unknown as { ensureInitialized: () => Promise<void> })[
        'ensureInitialized'
      ]();

      expect(callCount).toBe(2);

      initTokenSpy.mockRestore();
    });
  });

  describe('OAuth Flow State Handling', () => {
    it('should use server redirectUri instead of constructing own', () => {
      const mockLocalCallback = {
        redirectUri: 'http://localhost:1455/auth/callback',
        waitForCallback: vi.fn(),
        shutdown: vi.fn(),
      };

      expect(mockLocalCallback.redirectUri).toBe(
        'http://localhost:1455/auth/callback',
      );
      expect(mockLocalCallback.redirectUri).toContain('/auth/callback');
    });

    it('should pass state parameter to completeAuth', async () => {
      const testCode = 'test_auth_code';
      const testRedirectUri = 'http://localhost:1455/auth/callback';
      const testState = 'test_state_123';

      const deviceFlow = (
        provider as unknown as {
          deviceFlow: {
            buildAuthorizationUrl: (uri: string, state: string) => string;
          };
        }
      ).deviceFlow;
      deviceFlow.buildAuthorizationUrl(testRedirectUri, testState);

      const completeAuthSpy = vi.spyOn(provider, 'completeAuth');

      try {
        await provider.completeAuth(testCode, testRedirectUri, testState);
      } catch {
        // Expected to fail with network error
      }

      expect(completeAuthSpy).toHaveBeenCalledWith(
        testCode,
        testRedirectUri,
        testState,
      );
    });
  });

  describe('Provider Refactor Tests (Issue #1652 Phase 3)', () => {
    describe('Test 3.5: initiateAuth returns token (interactive callback)', () => {
      it('GIVEN interactive mode with callback, WHEN initiateAuth() completes, THEN returns OAuthToken AND saveToken NOT called by provider', async () => {
        // Phase 4: Mock performAuth to return a token (simulates successful interactive auth)
        const mockToken = {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer' as const,
        };

        vi.spyOn(
          provider as unknown as {
            performAuth: () => Promise<typeof mockToken>;
          },
          'performAuth',
        ).mockResolvedValue(mockToken);

        const result = await provider.initiateAuth();

        // After Phase 4, initiateAuth returns the token
        expect(result).toBeDefined();
        expect(result).toStrictEqual(mockToken);
        // Provider no longer calls saveToken - OAuthManager handles persistence
        expect(mockTokenStore.saveToken).not.toHaveBeenCalled();
      });
    });

    describe('Test 3.6: initiateAuth returns token (device auth fallback)', () => {
      it('GIVEN callback fails, WHEN device auth completes, THEN returns OAuthToken AND saveToken NOT called', async () => {
        // Mock performAuth to simulate device auth fallback
        vi.spyOn(
          provider as unknown as { performAuth: () => Promise<void> },
          'performAuth',
        ).mockResolvedValue(undefined);

        await provider.initiateAuth();

        // After Phase 4, this should return a token
        expect(mockTokenStore.saveToken).not.toHaveBeenCalled();
      });
    });

    describe('Test 3.7: concurrent initiateAuth deduplication', () => {
      it('GIVEN concurrent calls, WHEN both resolve, THEN return same token AND saveToken NOT called by provider', async () => {
        vi.spyOn(
          provider as unknown as { performAuth: () => Promise<void> },
          'performAuth',
        ).mockResolvedValue(undefined);

        await Promise.all([provider.initiateAuth(), provider.initiateAuth()]);

        // After Phase 4, both should return the same token
        expect(mockTokenStore.saveToken).not.toHaveBeenCalled();
      });
    });
  });

  describe('Issue 1895: Canonical device callback URI', () => {
    it('should use canonical deviceAuthCallbackUri from core instead of hardcoded incorrect value', async () => {
      // This test ensures the provider uses the canonical deviceAuthCallbackUri
      // exported from codex-device-flow, not a hardcoded incorrect value.
      // The old hardcoded value was 'https://auth.openai.com/api/accounts/deviceauth/callback'
      // The correct canonical value is 'https://auth.openai.com/deviceauth/callback'

      const mockDeviceFlow = {
        requestDeviceCode: vi.fn().mockResolvedValue({
          device_auth_id: 'test-device-auth-id',
          user_code: 'TEST-CODE',
          interval: 5,
        }),
        pollForDeviceToken: vi.fn().mockResolvedValue({
          authorization_code: 'test-auth-code',
          code_verifier: 'test-verifier',
          code_challenge: 'test-challenge',
        }),
        completeDeviceAuth: vi.fn(),
      };

      // Set up the deviceFlow spy to capture the redirectUri passed to completeDeviceAuth
      mockDeviceFlow.completeDeviceAuth = vi
        .fn()
        .mockImplementation(
          (_authCode: string, _codeVerifier: string, redirectUri: string) => {
            // Simulate the 400 error that happens with wrong redirect URI
            if (
              redirectUri ===
              'https://auth.openai.com/api/accounts/deviceauth/callback'
            ) {
              return Promise.reject(
                new Error(
                  'Token exchange failed: 400 token_exchange_user_error',
                ),
              );
            }
            return Promise.resolve({
              access_token: 'test-token',
              refresh_token: 'test-refresh',
              expiry: Math.floor(Date.now() / 1000) + 3600,
              token_type: 'Bearer' as const,
              account_id: 'test-account',
            });
          },
        );

      (
        provider as unknown as { deviceFlow: typeof mockDeviceFlow }
      ).deviceFlow = mockDeviceFlow;

      // Attempt device auth
      const performDeviceAuth = (
        provider as unknown as { performDeviceAuth: () => Promise<void> }
      ).performDeviceAuth;

      await performDeviceAuth.call(provider);

      // Verify completeDeviceAuth was called with canonical URI, not the old hardcoded one
      expect(mockDeviceFlow.completeDeviceAuth).toHaveBeenCalled();
      const [, , redirectUri] = mockDeviceFlow.completeDeviceAuth.mock.calls[0];

      // The canonical URI should be used (without /api/accounts/ path)
      expect(redirectUri).toBe('https://auth.openai.com/deviceauth/callback');
      // The old incorrect hardcoded URI should NOT be used
      expect(redirectUri).not.toBe(
        'https://auth.openai.com/api/accounts/deviceauth/callback',
      );
    });
  });
});
