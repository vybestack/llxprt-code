/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AuthFlowOrchestrator — Phase 6 extraction
 * Covers lock parameters, lock acquisition order, and lock release on exceptions.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  OAuthToken,
  TokenStore,
  OAuthProvider,
  BucketFailoverOAuthManagerLike,
  AuthenticatorInterface,
} from '../types.js';
import { AuthFlowOrchestrator } from '../auth-flow-orchestrator.js';
import { ProviderRegistry } from '../provider-registry.js';

// ---------------------------------------------------------------------------
// Mock runtime settings to prevent MissingProviderRuntimeError
// ---------------------------------------------------------------------------
vi.mock('../../runtime/runtimeSettings.js', () => ({
  getEphemeralSetting: vi.fn((key: string) => {
    if (key === 'auth-bucket-delay') return 0;
    return undefined;
  }),
  getCliRuntimeServices: vi.fn(() => ({
    settingsService: {
      getCurrentProfileName: () => null,
      get: () => null,
    },
  })),
  getCliProviderManager: vi.fn(() => undefined),
  getCliRuntimeContext: vi.fn(() => undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(accessToken: string, expiryOffset = 3600): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffset,
    token_type: 'Bearer' as const,
    scope: '',
  };
}

function createTokenStore(): TokenStore & {
  acquireAuthLockParams: unknown[];
  acquireRefreshLockParams: unknown[];
  callOrder: string[];
} {
  const acquireAuthLockParams: unknown[] = [];
  const acquireRefreshLockParams: unknown[] = [];
  const callOrder: string[] = [];

  return {
    acquireAuthLockParams,
    acquireRefreshLockParams,
    callOrder,
    saveToken: vi.fn(async () => {}),
    getToken: vi.fn(async () => null),
    removeToken: vi.fn(async () => {}),
    listProviders: vi.fn(async () => []),
    listBuckets: vi.fn(async () => []),
    getBucketStats: vi.fn(async () => null),
    acquireRefreshLock: vi.fn(async (provider: string, opts: unknown) => {
      callOrder.push('acquireRefreshLock');
      acquireRefreshLockParams.push({ provider, opts });
      return true;
    }),
    releaseRefreshLock: vi.fn(async () => {}),
    acquireAuthLock: vi.fn(async (provider: string, opts: unknown) => {
      callOrder.push('acquireAuthLock');
      acquireAuthLockParams.push({ provider, opts });
      return true;
    }),
    releaseAuthLock: vi.fn(async () => {}),
  };
}

function createProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async () => makeToken(`${name}-token`)),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
  };
}

function createFacadeRef(): BucketFailoverOAuthManagerLike {
  return {
    getSessionBucket: vi.fn(() => undefined),
    setSessionBucket: vi.fn(),
    getOAuthToken: vi.fn(async () => null),
    authenticate: vi.fn(async () => {}),
    authenticateMultipleBuckets: vi.fn(async () => {}),
    getTokenStore: vi.fn(),
  };
}

function createOrchestrator(
  tokenStore: TokenStore,
  providerRegistry?: ProviderRegistry,
  facadeRef?: BucketFailoverOAuthManagerLike,
) {
  const registry = providerRegistry ?? new ProviderRegistry();
  const facade = facadeRef ?? createFacadeRef();

  return new AuthFlowOrchestrator(tokenStore, registry, facade);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthFlowOrchestrator', () => {
  describe('authenticate() — auth lock parameters', () => {
    it('acquires auth lock with waitMs:60000 and staleMs:360000', async () => {
      const tokenStore = createTokenStore();
      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticate('anthropic', 'default');

      expect(tokenStore.acquireAuthLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          waitMs: 60000,
          staleMs: 360000,
        }),
      );
    });
  });

  describe('authenticate() — nested refresh lock parameters', () => {
    it('acquires nested refresh lock with waitMs:10000 and staleMs:30000 when expired token has refresh_token', async () => {
      const tokenStore = createTokenStore();
      const expiredToken = makeToken('expired-token', -100); // expired

      // Return expired token with a refresh_token on first getToken call
      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken); // under auth lock
      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken); // re-read under refresh lock

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      // refreshToken returns null → falls through to initiateAuth
      vi.mocked(provider.refreshToken).mockResolvedValue(null);
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticate('anthropic', 'default');

      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          waitMs: 10000,
          staleMs: 30000,
        }),
      );
    });
  });

  describe('authenticate() — lock acquisition order', () => {
    it('acquires auth lock BEFORE refresh lock', async () => {
      const tokenStore = createTokenStore();
      const expiredToken = makeToken('expired-token', -100);
      expiredToken.refresh_token = 'valid-refresh';

      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken);
      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken);

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      vi.mocked(provider.refreshToken).mockResolvedValue(null);
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticate('anthropic', 'default');

      const authIdx = tokenStore.callOrder.indexOf('acquireAuthLock');
      const refreshIdx = tokenStore.callOrder.indexOf('acquireRefreshLock');

      expect(authIdx).toBeGreaterThanOrEqual(0);
      expect(refreshIdx).toBeGreaterThanOrEqual(0);
      expect(authIdx).toBeLessThan(refreshIdx);
    });
  });

  describe('authenticate() — lock release on exception paths', () => {
    it('releases auth lock even when provider.initiateAuth throws', async () => {
      const tokenStore = createTokenStore();
      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      vi.mocked(provider.initiateAuth).mockRejectedValue(
        new Error('auth failed'),
      );
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await expect(
        orchestrator.authenticate('anthropic', 'default'),
      ).rejects.toThrow('auth failed');

      expect(tokenStore.releaseAuthLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
    });

    it('releases nested refresh lock when refresh throws', async () => {
      const tokenStore = createTokenStore();
      const expiredToken = makeToken('expired-token', -100);
      expiredToken.refresh_token = 'valid-refresh';

      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken);
      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(expiredToken);

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      // Refresh throws — should release refresh lock then fall through to initiateAuth
      vi.mocked(provider.refreshToken).mockRejectedValue(
        new Error('refresh network error'),
      );
      // initiateAuth also throws to confirm the exception path
      vi.mocked(provider.initiateAuth).mockRejectedValue(
        new Error('browser auth failed'),
      );
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await expect(
        orchestrator.authenticate('anthropic', 'default'),
      ).rejects.toThrow();

      // Refresh lock must be released even though refresh threw
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
      // Auth lock must also be released
      expect(tokenStore.releaseAuthLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
    });
  });

  describe('authenticate() — successful path', () => {
    it('saves token and marks provider OAuth-enabled after successful auth', async () => {
      const tokenStore = createTokenStore();
      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      const freshToken = makeToken('fresh-token');
      vi.mocked(provider.initiateAuth).mockResolvedValue(freshToken);
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticate('anthropic', 'default');

      expect(tokenStore.saveToken).toHaveBeenCalledWith(
        'anthropic',
        freshToken,
        'default',
      );
      expect(registry.isOAuthEnabled('anthropic')).toBe(true);
    });

    it('returns early if valid disk token found after acquiring auth lock', async () => {
      const tokenStore = createTokenStore();
      const validToken = makeToken('existing-token', 3600);

      // Returns valid token under lock (double-check after acquiring)
      vi.mocked(tokenStore.getToken).mockResolvedValueOnce(validToken);

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticate('anthropic', 'default');

      // initiateAuth must NOT be called since disk token was valid
      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });
  });

  describe('authenticate() — lock timeout path', () => {
    it('throws when auth lock cannot be acquired and no valid disk token', async () => {
      const tokenStore = createTokenStore();
      vi.mocked(tokenStore.acquireAuthLock).mockResolvedValue(false);
      vi.mocked(tokenStore.getToken).mockResolvedValue(null);

      const registry = new ProviderRegistry();
      registry.registerProvider(createProvider('anthropic'));

      const orchestrator = createOrchestrator(tokenStore, registry);
      await expect(
        orchestrator.authenticate('anthropic', 'default'),
      ).rejects.toThrow(/Failed to acquire auth lock/);
    });

    it('returns early when auth lock times out but valid disk token exists', async () => {
      const tokenStore = createTokenStore();
      vi.mocked(tokenStore.acquireAuthLock).mockResolvedValue(false);
      const validToken = makeToken('cross-process-token', 3600);
      vi.mocked(tokenStore.getToken).mockResolvedValue(validToken);

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      // Should NOT throw
      await expect(
        orchestrator.authenticate('anthropic', 'default'),
      ).resolves.not.toThrow();

      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });
  });

  describe('authenticateMultipleBuckets() — basic behavior', () => {
    it('implements AuthenticatorInterface', () => {
      const tokenStore = createTokenStore();
      const orchestrator = createOrchestrator(tokenStore);

      // Check the instance satisfies AuthenticatorInterface
      const asInterface: AuthenticatorInterface = orchestrator;
      expect(typeof asInterface.authenticate).toBe('function');
      expect(typeof asInterface.authenticateMultipleBuckets).toBe('function');
    });

    it('skips already-authenticated buckets', async () => {
      const tokenStore = createTokenStore();
      const validToken = makeToken('bucket-token', 3600);

      // All buckets return valid tokens → nothing needs auth
      vi.mocked(tokenStore.getToken).mockResolvedValue(validToken);

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);
      await orchestrator.authenticateMultipleBuckets('anthropic', [
        'bucket1',
        'bucket2',
      ]);

      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });
  });

  describe('authenticateMultipleBuckets() — progress display (issue #1620)', () => {
    it('passes unauthenticated bucket count to onPrompt, not total bucket count', async () => {
      const { getEphemeralSetting } = await import(
        '../../runtime/runtimeSettings.js'
      );
      vi.mocked(getEphemeralSetting).mockImplementation((key: string) => {
        if (key === 'auth-bucket-prompt') return true;
        if (key === 'auth-bucket-delay') return 0;
        return undefined;
      });

      const tokenStore = createTokenStore();
      const validToken = makeToken('already-authed', 3600);

      vi.mocked(tokenStore.getToken).mockImplementation(
        async (_provider: string, bucket?: string) => {
          if (bucket === 'bucket1' || bucket === 'bucket2') {
            return validToken;
          }
          return null;
        },
      );

      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      registry.registerProvider(provider);

      const facadeRef = createFacadeRef();
      const orchestrator = createOrchestrator(tokenStore, registry, facadeRef);

      const confirmationCalls: Array<{
        bucketIndex: number;
        totalBuckets: number;
      }> = [];
      const mockMessageBus = {
        requestBucketAuthConfirmation: vi.fn(
          async (
            _provider: string,
            _bucket: string,
            bucketIndex: number,
            totalBuckets: number,
          ) => {
            confirmationCalls.push({ bucketIndex, totalBuckets });
            return true;
          },
        ),
      };

      orchestrator.setRuntimeMessageBus(
        mockMessageBus as unknown as import('@vybestack/llxprt-code-core').MessageBus,
      );

      await orchestrator.authenticateMultipleBuckets('anthropic', [
        'bucket1',
        'bucket2',
        'bucket3',
      ]);

      expect(confirmationCalls).toHaveLength(1);
      expect(confirmationCalls[0]).toEqual({
        bucketIndex: 1,
        totalBuckets: 1,
      });
    });
  });

  describe('requireRuntimeMessageBus()', () => {
    it('throws descriptive error when no messageBus is configured and auth-bucket-prompt is enabled', async () => {
      // Enable prompt mode so the onPrompt callback is invoked and calls requireRuntimeMessageBus
      const { getEphemeralSetting } = await import(
        '../../runtime/runtimeSettings.js'
      );
      vi.mocked(getEphemeralSetting).mockImplementation((key: string) => {
        if (key === 'auth-bucket-prompt') return true;
        if (key === 'auth-bucket-delay') return 0;
        return undefined;
      });

      const tokenStore = createTokenStore();
      const registry = new ProviderRegistry();
      const provider = createProvider('anthropic');
      // initiateAuth never returns — we never reach it; the error is in onPrompt
      vi.mocked(provider.initiateAuth).mockImplementation(
        () => new Promise(() => {}),
      );
      registry.registerProvider(provider);

      const orchestrator = createOrchestrator(tokenStore, registry);

      // getToken returns expired so bucket is unauthenticated → triggers prompt
      vi.mocked(tokenStore.getToken).mockResolvedValue(null);

      await expect(
        orchestrator.authenticateMultipleBuckets('anthropic', ['bucket1']),
      ).rejects.toThrow(/requires a runtime MessageBus/i);
    });
  });

  describe('userDismissedAuthPrompt state', () => {
    it('starts as false (not dismissed)', () => {
      const tokenStore = createTokenStore();
      const orchestrator = createOrchestrator(tokenStore);
      // Access via type cast to test internal state
      const internal = orchestrator as unknown as {
        userDismissedAuthPrompt: boolean;
      };
      expect(internal.userDismissedAuthPrompt).toBe(false);
    });
  });
});
