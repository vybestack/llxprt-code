/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

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

import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider } from './types.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';

describe('OAuthManager.logout runtime cache handling', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();

    // Register runtime accessors via the bridge
    const managerMock = {
      getProviderByName: vi.fn(() => providerRef.current),
    };
    providerManagerRef.current = managerMock;
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => managerMock,
      getRuntimeContext: () => ({
        runtimeId: 'test-runtime',
        metadata: {},
      }),
      getCurrentProfileName: () => null,
    });
  });

  afterEach(() => {
    oauthRuntimeBridge.setAccessors(undefined);
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
      name: 'device-code-test',
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

    await manager.logout('device-code-test');

    expect(providerManagerRef.current).toBeDefined();
    providerManagerRef.current?.getProviderByName.mockReturnValue(provider);

    expect(flushMockRef.current).toBeDefined();
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
      name: 'device-code-test',
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

    manager.setSessionBucket('device-code-test', 'bucket-a');

    await manager.logout('device-code-test');

    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'bucket-a',
    );
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
      name: 'device-code-test',
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

    await manager.logoutAllBuckets('device-code-test');

    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'default',
    );
    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'bucket-a',
    );
    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'bucket-b',
    );
  });

  it('removes bucket tokens for every provider when logging out all providers', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn().mockResolvedValue(null),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi
        .fn()
        .mockResolvedValue(['device-code-test', 'anthropic']),
      listBuckets: vi.fn(async (provider: string) => {
        if (provider === 'device-code-test') {
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

    const deviceCodeProvider: OAuthProvider & { logout?: () => Promise<void> } =
      {
        name: 'device-code-test',
        initiateAuth: vi.fn(async () => ({
          access_token: 'device-code-test-token',
          refresh_token: 'device-code-test-refresh',
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

    manager.registerProvider(deviceCodeProvider);
    manager.registerProvider(anthropicProvider);
    providerRef.current = deviceCodeProvider;

    await manager.logoutAll();

    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'default',
    );
    expect(tokenStore.removeToken).toHaveBeenCalledWith(
      'device-code-test',
      'bucket-a',
    );
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
      name: 'device-code-test',
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

    manager.setSessionBucket('device-code-test', 'default');
    manager.setSessionBucket('device-code-test', 'bucket-a', {
      profileId: 'profile-a',
      providerId: 'device-code-test',
    });
    manager.setSessionBucket('device-code-test', 'bucket-b', {
      profileId: 'profile-b',
      providerId: 'device-code-test',
    });

    await manager.logoutAllBuckets('device-code-test');

    expect(manager.getSessionBucket('device-code-test')).toBeUndefined();
    expect(
      manager.getSessionBucket('device-code-test', {
        profileId: 'profile-a',
        providerId: 'device-code-test',
      }),
    ).toBeUndefined();
    expect(
      manager.getSessionBucket('device-code-test', {
        profileId: 'profile-b',
        providerId: 'device-code-test',
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

    manager.setSessionBucket('device-code-test', 'default');
    manager.setSessionBucket('device-code-test', 'bucket-a', {
      profileId: 'profile-a',
      providerId: 'device-code-test',
    });
    manager.setSessionBucket('device-code-test', 'bucket-b', {
      profileId: 'profile-b',
      providerId: 'device-code-test',
    });

    manager.clearSessionBucket('device-code-test');

    expect(manager.getSessionBucket('device-code-test')).toBeUndefined();
    expect(
      manager.getSessionBucket('device-code-test', {
        profileId: 'profile-a',
        providerId: 'device-code-test',
      }),
    ).toBe('bucket-a');
    expect(
      manager.getSessionBucket('device-code-test', {
        profileId: 'profile-b',
        providerId: 'device-code-test',
      }),
    ).toBe('bucket-b');
  });
});
