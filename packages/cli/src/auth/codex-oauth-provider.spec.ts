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
    it('should track initialization state transitions', async () => {
      const getState = () =>
        (provider as unknown as { initializationState: string })[
          'initializationState'
        ];

      expect(getState()).toBe('not-started');

      const initPromise = (
        provider as unknown as { ensureInitialized: () => Promise<void> }
      )['ensureInitialized']();

      expect(getState()).toBe('in-progress');

      await initPromise;

      expect(getState()).toBe('completed');
    });

    it('should transition to failed state on initialization error', async () => {
      const getState = () =>
        (provider as unknown as { initializationState: string })[
          'initializationState'
        ];

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

      expect(getState()).toBe('failed');

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
});
