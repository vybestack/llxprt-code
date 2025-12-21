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
});
