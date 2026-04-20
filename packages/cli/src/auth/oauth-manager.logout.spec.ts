/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { flushMockRef, providerManagerRef, providerRef } = vi.hoisted(() => ({
  flushMockRef: {
    current: undefined as ReturnType<typeof vi.fn> | undefined,
  },
  providerManagerRef: {
    current: undefined as
      | { getProviderByName: ReturnType<typeof vi.fn> }
      | undefined,
  },
  providerRef: {
    current: undefined as unknown,
  },
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  const flushMock = vi.fn(() => ({
    runtimeId: 'test-runtime',
    revokedTokens: [],
  }));
  flushMockRef.current = flushMock;
  return {
    ...actual,
    flushRuntimeAuthScope: flushMock,
  };
});

vi.mock('../runtime/runtimeSettings.js', async () => {
  const actual = await vi.importActual<
    typeof import('../runtime/runtimeSettings.js')
  >('../runtime/runtimeSettings.js');
  const managerMock = {
    getProviderByName: vi.fn(() => providerRef.current),
  };
  providerManagerRef.current = managerMock;
  return {
    ...actual,
    getCliRuntimeContext: vi.fn(() => ({
      runtimeId: 'test-runtime',
      metadata: {},
    })),
    getCliProviderManager: vi.fn(() => managerMock),
  };
});

import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider } from './types.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';

describe('OAuthManager.logout runtime cache handling', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
    providerManagerRef.current?.getProviderByName.mockReset();
  });

  it('flushes runtime auth scope when logging out a provider', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    const provider: OAuthProvider & {
      logout?: () => Promise<void>;
      clearState?: () => void;
      clearAuthCache?: () => void;
    } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      })),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
      clearState: vi.fn(),
      clearAuthCache: vi.fn(),
    };

    manager.registerProvider(provider);
    providerRef.current = provider;

    await manager.logout('qwen');

    expect(providerManagerRef.current).toBeDefined();
    providerManagerRef.current?.getProviderByName.mockReturnValue(provider);

    expect(flushMockRef.current).toBeDefined();
    flushMockRef.current &&
      // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
      expect(flushMockRef.current).toHaveBeenCalledWith('test-runtime');
  });

  it('removes the session bucket token even when provider.logout exists', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue(['default', 'bucket-a']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    const provider: OAuthProvider & { logout?: () => Promise<void> } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      })),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerProvider(provider);
    providerRef.current = provider;

    manager.setSessionBucket('qwen', 'bucket-a');

    await manager.logout('qwen');

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-a');
  });

  it('removes bucket tokens when logging out all buckets', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi
        .fn()
        .mockResolvedValue(['default', 'bucket-a', 'bucket-b']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    const provider: OAuthProvider & { logout?: () => Promise<void> } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      })),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerProvider(provider);
    providerRef.current = provider;

    await manager.logoutAllBuckets('qwen');

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-a');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-b');
  });

  it('removes bucket tokens for every provider when logging out all providers', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue(['qwen', 'anthropic']),
      listBuckets: vi.fn(async (provider: string) => {
        if (provider === 'qwen') {
          return ['default', 'bucket-a'];
        }
        if (provider === 'anthropic') {
          return ['default', 'bucket-b'];
        }
        return [];
      }),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    const qwenProvider: OAuthProvider & { logout?: () => Promise<void> } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => ({
        access_token: 'qwen-token',
        refresh_token: 'qwen-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      })),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    const anthropicProvider: OAuthProvider & { logout?: () => Promise<void> } =
      {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => ({
          access_token: 'anthropic-token',
          refresh_token: 'anthropic-refresh',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer' as const,
        })),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
        logout: vi.fn().mockResolvedValue(undefined),
      };

    manager.registerProvider(qwenProvider);
    manager.registerProvider(anthropicProvider);
    providerRef.current = qwenProvider;

    await manager.logoutAll();

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-a');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('anthropic', 'default');
    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'anthropic',
      'bucket-b',
    );
  });

  it('clears profile-scoped session buckets when logging out all buckets', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue(['default', 'bucket-a']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    const provider: OAuthProvider & { logout?: () => Promise<void> } = {
      name: 'qwen',
      initiateAuth: vi.fn(async () => ({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      })),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerProvider(provider);
    providerRef.current = provider;

    manager.setSessionBucket('qwen', 'default');
    manager.setSessionBucket('qwen', 'bucket-a', {
      profileId: 'profile-a',
      providerId: 'qwen',
    });
    manager.setSessionBucket('qwen', 'bucket-b', {
      profileId: 'profile-b',
      providerId: 'qwen',
    });

    await manager.logoutAllBuckets('qwen');

    expect(manager.getSessionBucket('qwen')).toBeUndefined();
    expect(
      manager.getSessionBucket('qwen', {
        profileId: 'profile-a',
        providerId: 'qwen',
      }),
    ).toBeUndefined();
    expect(
      manager.getSessionBucket('qwen', {
        profileId: 'profile-b',
        providerId: 'qwen',
      }),
    ).toBeUndefined();
  });

  it('does not clear profile-scoped session buckets when clearing only the unscoped provider bucket', () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue([]),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new OAuthManager(tokenStore);

    manager.setSessionBucket('qwen', 'default');
    manager.setSessionBucket('qwen', 'bucket-a', {
      profileId: 'profile-a',
      providerId: 'qwen',
    });
    manager.setSessionBucket('qwen', 'bucket-b', {
      profileId: 'profile-b',
      providerId: 'qwen',
    });

    manager.clearSessionBucket('qwen');

    expect(manager.getSessionBucket('qwen')).toBeUndefined();
    expect(
      manager.getSessionBucket('qwen', {
        profileId: 'profile-a',
        providerId: 'qwen',
      }),
    ).toBe('bucket-a');
    expect(
      manager.getSessionBucket('qwen', {
        profileId: 'profile-b',
        providerId: 'qwen',
      }),
    ).toBe('bucket-b');
  });
});
