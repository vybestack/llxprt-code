/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const profileBucketsRef = vi.hoisted(() => ({
  current: ['bucket-a', 'bucket-b'],
}));

vi.mock('../runtime/runtimeSettings.js', async () => {
  const actual = await vi.importActual<
    typeof import('../runtime/runtimeSettings.js')
  >('../runtime/runtimeSettings.js');

  return {
    ...actual,
    getCliRuntimeServices: vi.fn(() => ({
      settingsService: {
        getCurrentProfileName: () => 'dualclaude',
        get: () => 'dualclaude',
      },
    })),
  };
});

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  class MockProfileManager {
    async loadProfile(): Promise<unknown> {
      return {
        auth: {
          type: 'oauth',
          buckets: profileBucketsRef.current,
        },
      };
    }
  }

  return {
    ...actual,
    ProfileManager: MockProfileManager,
  };
});

import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type {
  BucketFailoverHandler,
  Config,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';

function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: '',
  };
}

describe('OAuthManager bucket failover integration (CLI)', () => {
  let tokenStore: TokenStore;
  let oauthManager: OAuthManager;

  beforeEach(() => {
    tokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn(async (_provider: string, bucket?: string) => {
        if (bucket === 'bucket-a') {
          return makeToken('token-bucket-a');
        }
        return null;
      }),
      removeToken: vi.fn(),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => profileBucketsRef.current),
      getBucketStats: vi.fn(async () => null),
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
    };

    oauthManager = new OAuthManager(tokenStore);

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
    };
    oauthManager.registerProvider(provider);
  });

  it('defaults to the first profile bucket and configures a failover handler', async () => {
    const config: Pick<
      Config,
      'getBucketFailoverHandler' | 'setBucketFailoverHandler'
    > = {
      getBucketFailoverHandler: vi.fn(() => undefined),
      setBucketFailoverHandler: vi.fn(),
    };

    oauthManager.setConfigGetter(() => config as unknown as Config);

    await oauthManager.toggleOAuthEnabled('anthropic');
    const token = await oauthManager.getToken('anthropic');

    expect(token).toBe('token-bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
    expect(config.setBucketFailoverHandler).toHaveBeenCalledTimes(1);
    expect(tokenStore.getToken).toHaveBeenCalledWith('anthropic', 'bucket-a');
  });

  it('getToken tries bucket failover before triggering full OAuth when session bucket has no token', async () => {
    // Set up: session bucket is bucket-b (no token), but bucket-a has a valid token
    // The failover handler should switch to bucket-a and return that token
    const failoverHandler: BucketFailoverHandler = {
      getBuckets: () => ['bucket-a', 'bucket-b'],
      getCurrentBucket: () => 'bucket-b',
      tryFailover: vi.fn(async () => {
        // Simulate what BucketFailoverHandlerImpl does: switch the session bucket
        oauthManager.setSessionBucket('anthropic', 'bucket-a');
        return true;
      }),
      isEnabled: () => true,
    };

    const config: Pick<
      Config,
      'getBucketFailoverHandler' | 'setBucketFailoverHandler'
    > = {
      getBucketFailoverHandler: vi.fn(() => failoverHandler),
      setBucketFailoverHandler: vi.fn(),
    };

    oauthManager.setConfigGetter(() => config as unknown as Config);
    await oauthManager.toggleOAuthEnabled('anthropic');

    // Force session bucket to bucket-b (which has no token)
    oauthManager.setSessionBucket('anthropic', 'bucket-b');

    // Token store: bucket-a has a token, bucket-b does not
    (tokenStore.getToken as ReturnType<typeof vi.fn>).mockImplementation(
      async (_provider: string, bucket?: string) => {
        if (bucket === 'bucket-a') {
          return makeToken('token-bucket-a');
        }
        return null;
      },
    );

    const token = await oauthManager.getToken('anthropic');

    expect(failoverHandler.tryFailover).toHaveBeenCalled();
    expect(token).toBe('token-bucket-a');
  });

  it('getToken falls through to full OAuth when failover fails', async () => {
    const failoverHandler: BucketFailoverHandler = {
      getBuckets: () => ['bucket-a', 'bucket-b'],
      getCurrentBucket: () => 'bucket-b',
      tryFailover: vi.fn(async () => false),
      isEnabled: () => true,
    };

    const config: Pick<
      Config,
      'getBucketFailoverHandler' | 'setBucketFailoverHandler'
    > = {
      getBucketFailoverHandler: vi.fn(() => failoverHandler),
      setBucketFailoverHandler: vi.fn(),
    };

    oauthManager.setConfigGetter(() => config as unknown as Config);
    await oauthManager.toggleOAuthEnabled('anthropic');

    // Force session bucket to bucket-b (which has no token)
    oauthManager.setSessionBucket('anthropic', 'bucket-b');

    // All buckets return null tokens
    (tokenStore.getToken as ReturnType<typeof vi.fn>).mockImplementation(
      async () => null,
    );

    // getToken should fall through to full OAuth flow which will call authenticate
    // Since the mock provider's initiateAuth and getToken return null/undefined,
    // this should throw (authentication completed but no token was returned)
    await expect(oauthManager.getToken('anthropic')).rejects.toThrow();
    expect(failoverHandler.tryFailover).toHaveBeenCalled();
  });
});
