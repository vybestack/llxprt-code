/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager } from '../oauth-manager.js';
import {
  MemoryTokenStore,
  makeToken,
  createTestProvider,
} from './behavioral/test-utils.js';
import type { Config } from '@vybestack/llxprt-code-core';

describe('Issue 1616: getToken bucket peek loop', () => {
  let tokenStore: MemoryTokenStore;
  let manager: OAuthManager;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
    const provider = createTestProvider('anthropic');
    manager = new OAuthManager(tokenStore);
    manager.registerProvider(provider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return token from session bucket when it has a valid token', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    await tokenStore.saveToken('anthropic', makeToken('default-bucket-token'));

    const result = await manager.getToken('anthropic');

    expect(result).toBe('default-bucket-token');
  });

  it('should peek other buckets when session bucket has no token and return valid token', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    await tokenStore.saveToken(
      'anthropic',
      makeToken('claudius-bucket-token'),
      'claudius',
    );

    vi.spyOn(
      manager as unknown as { getProfileBuckets: () => Promise<string[]> },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const mockHandler = {
      tryFailover: vi.fn().mockResolvedValue(false),
      isEnabled: () => true,
      getBuckets: () => ['default', 'claudius', 'vybestack'],
      getCurrentBucket: () => 'default',
      resetSession: vi.fn(),
      reset: vi.fn(),
      getLastFailoverReasons: vi.fn().mockReturnValue({}),
    };
    const mockConfig = {
      getBucketFailoverHandler: () => mockHandler,
      setBucketFailoverHandler: vi.fn(),
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    const managerWithConfig = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    managerWithConfig.registerProvider(createTestProvider('anthropic'));
    await managerWithConfig.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      managerWithConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const result = await managerWithConfig.getToken('anthropic');

    expect(result).toBe('claudius-bucket-token');
  });

  it('should not call tryFailover during token discovery', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    await tokenStore.saveToken(
      'anthropic',
      makeToken('claudius-token'),
      'claudius',
    );

    vi.spyOn(
      manager as unknown as { getProfileBuckets: () => Promise<string[]> },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const tryFailoverSpy = vi.fn().mockResolvedValue(false);
    const mockHandler = {
      tryFailover: tryFailoverSpy,
      isEnabled: () => true,
      getBuckets: () => ['default', 'claudius', 'vybestack'],
      getCurrentBucket: () => 'default',
      resetSession: vi.fn(),
      reset: vi.fn(),
      getLastFailoverReasons: vi.fn().mockReturnValue({}),
    };
    const mockConfig = {
      getBucketFailoverHandler: () => mockHandler,
      setBucketFailoverHandler: vi.fn(),
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    const managerWithConfig = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    managerWithConfig.registerProvider(createTestProvider('anthropic'));
    await managerWithConfig.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      managerWithConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    await managerWithConfig.getToken('anthropic');

    expect(tryFailoverSpy).not.toHaveBeenCalled();
  });

  it('should skip expired tokens in peek loop and use valid one', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    const now = Math.floor(Date.now() / 1000);
    const expiredToken = {
      access_token: 'expired-token',
      refresh_token: 'expired-refresh',
      expiry: now - 3600,
      token_type: 'Bearer' as const,
      scope: '',
    };
    await tokenStore.saveToken('anthropic', expiredToken, 'claudius');
    await tokenStore.saveToken(
      'anthropic',
      makeToken('vybestack-token'),
      'vybestack',
    );

    vi.spyOn(
      manager as unknown as { getProfileBuckets: () => Promise<string[]> },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const tryFailoverSpy = vi.fn().mockResolvedValue(false);
    const mockHandler = {
      tryFailover: tryFailoverSpy,
      isEnabled: () => true,
      getBuckets: () => ['default', 'claudius', 'vybestack'],
      getCurrentBucket: () => 'default',
      resetSession: vi.fn(),
      reset: vi.fn(),
      getLastFailoverReasons: vi.fn().mockReturnValue({}),
    };
    const mockConfig = {
      getBucketFailoverHandler: () => mockHandler,
      setBucketFailoverHandler: vi.fn(),
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    const managerWithConfig = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    managerWithConfig.registerProvider(createTestProvider('anthropic'));
    await managerWithConfig.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      managerWithConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const result = await managerWithConfig.getToken('anthropic');

    expect(result).toBe('vybestack-token');
  });

  it('should switch session bucket when peeking finds a valid token in another bucket', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    await tokenStore.saveToken(
      'anthropic',
      makeToken('claudius-bucket-token'),
      'claudius',
    );

    vi.spyOn(
      manager as unknown as { getProfileBuckets: () => Promise<string[]> },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const tryFailoverSpy = vi.fn().mockResolvedValue(false);
    const mockHandler = {
      tryFailover: tryFailoverSpy,
      isEnabled: () => true,
      getBuckets: () => ['default', 'claudius', 'vybestack'],
      getCurrentBucket: () => 'default',
      resetSession: vi.fn(),
      reset: vi.fn(),
      getLastFailoverReasons: vi.fn().mockReturnValue({}),
    };
    const mockConfig = {
      getBucketFailoverHandler: () => mockHandler,
      setBucketFailoverHandler: vi.fn(),
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    const managerWithConfig = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    managerWithConfig.registerProvider(createTestProvider('anthropic'));
    await managerWithConfig.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      managerWithConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const setSessionBucketSpy = vi.spyOn(managerWithConfig, 'setSessionBucket');

    await managerWithConfig.getToken('anthropic');

    expect(setSessionBucketSpy).toHaveBeenCalledWith(
      'anthropic',
      'default',
      undefined,
    );
    expect(setSessionBucketSpy).toHaveBeenCalledWith(
      'anthropic',
      'claudius',
      undefined,
    );
  });

  it('should return null for multi-bucket profiles when no bucket has a valid token', async () => {
    await manager.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      manager as unknown as { getProfileBuckets: () => Promise<string[]> },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const mockFailoverHandler = {
      tryFailover: vi.fn().mockResolvedValue(false),
      isEnabled: () => true,
      getBuckets: () => ['default', 'claudius', 'vybestack'],
      getCurrentBucket: () => 'default',
      resetSession: vi.fn(),
      reset: vi.fn(),
      getLastFailoverReasons: vi.fn().mockReturnValue({}),
    };
    const mockConfig = {
      getBucketFailoverHandler: () => mockFailoverHandler,
      setBucketFailoverHandler: vi.fn(),
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    const managerWithConfig = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    managerWithConfig.registerProvider(createTestProvider('anthropic'));
    await managerWithConfig.toggleOAuthEnabled('anthropic');

    vi.spyOn(
      managerWithConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['default', 'claudius', 'vybestack']);

    const result = await managerWithConfig.getToken('anthropic');

    expect(result).toBeNull();
  });
});
