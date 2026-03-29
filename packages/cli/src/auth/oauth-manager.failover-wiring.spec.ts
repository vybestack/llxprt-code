/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from './__tests__/behavioral/test-utils.js';
import type {
  Config,
  BucketFailoverHandler,
  OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';

describe('OAuthManager - Bucket Failover Handler Wiring (Issue 1151)', () => {
  let oauthManager: OAuthManager;
  let mockConfig: Config;
  let mockGetBucketFailoverHandler: ReturnType<typeof vi.fn>;
  let mockSetBucketFailoverHandler: ReturnType<typeof vi.fn>;
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
    const provider = createTestProvider('anthropic');

    mockGetBucketFailoverHandler = vi.fn();
    mockSetBucketFailoverHandler = vi.fn();
    mockConfig = {
      getBucketFailoverHandler: mockGetBucketFailoverHandler,
      setBucketFailoverHandler: mockSetBucketFailoverHandler,
    } as unknown as Config;

    oauthManager = new OAuthManager(tokenStore, undefined, {
      config: mockConfig,
    });
    oauthManager.registerProvider(provider);
  });

  it('should create BucketFailoverHandler when profile has multiple buckets', async () => {
    vi.spyOn(
      oauthManager as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket1', 'bucket2', 'bucket3']);

    mockGetBucketFailoverHandler.mockReturnValue(undefined);

    await oauthManager.getOAuthToken('anthropic');

    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0];
    expect(handlerArg).toBeDefined();
    expect(handlerArg.getBuckets()).toEqual(['bucket1', 'bucket2', 'bucket3']);
  });

  it('should reuse existing handler if buckets match in the same scope', async () => {
    await tokenStore.saveToken('anthropic', {
      access_token: 'test-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh-token',
      scope: '',
    });

    vi.spyOn(
      oauthManager as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket1', 'bucket2']);

    const existingHandler: BucketFailoverHandler = {
      getBuckets: vi.fn().mockReturnValue(['bucket1', 'bucket2']),
      getCurrentBucket: vi.fn(),
      tryFailover: vi.fn(),
      isEnabled: vi.fn(),
    };

    mockGetBucketFailoverHandler.mockReturnValue(existingHandler);

    await oauthManager.getOAuthToken('anthropic');

    expect(mockSetBucketFailoverHandler).not.toHaveBeenCalled();
  });

  it('should recreate handler when the request scope changes even if buckets match', async () => {
    await tokenStore.saveToken('anthropic', {
      access_token: 'test-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh-token',
      scope: '',
    });

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'subagent-profile',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    vi.spyOn(
      oauthManager as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket1', 'bucket2']);

    const existingHandler: BucketFailoverHandler = {
      getBuckets: vi.fn().mockReturnValue(['bucket1', 'bucket2']),
      getCurrentBucket: vi.fn(),
      tryFailover: vi.fn(),
      isEnabled: vi.fn(),
    };

    mockGetBucketFailoverHandler.mockReturnValue(existingHandler);

    await oauthManager.getOAuthToken('anthropic', metadata);

    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0] as {
      getRequestMetadata: () => OAuthTokenRequestMetadata | undefined;
      reset: () => void;
    };

    expect(handlerArg.getRequestMetadata()).toEqual(metadata);
    expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();
  });

  it('should recreate handler if bucket list changes', async () => {
    await tokenStore.saveToken('anthropic', {
      access_token: 'test-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'test-refresh-token',
      scope: '',
    });

    vi.spyOn(
      oauthManager as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket1', 'bucket3', 'bucket4']);

    const existingHandler: BucketFailoverHandler = {
      getBuckets: vi.fn().mockReturnValue(['bucket1', 'bucket2']),
      getCurrentBucket: vi.fn(),
      tryFailover: vi.fn(),
      isEnabled: vi.fn(),
    };

    mockGetBucketFailoverHandler.mockReturnValue(existingHandler);

    await oauthManager.getOAuthToken('anthropic');

    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0];
    expect(handlerArg.getBuckets()).toEqual(['bucket1', 'bucket3', 'bucket4']);
  });

  it('should warn if buckets configured but no config available', async () => {
    const oauthManagerNoConfig = new OAuthManager(tokenStore);
    oauthManagerNoConfig.registerProvider(createTestProvider('anthropic'));

    vi.spyOn(
      oauthManagerNoConfig as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket1', 'bucket2']);

    const { DebugLogger } = await import('@vybestack/llxprt-code-core');
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

    await oauthManagerNoConfig.getOAuthToken('anthropic');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[issue1029\].*buckets.*no Config available/),
    );

    warnSpy.mockRestore();
  });

  it('wires a metadata-scoped failover handler during eager multi-bucket auth', async () => {
    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    vi.spyOn(
      oauthManager as unknown as {
        getProfileBuckets: () => Promise<string[]>;
      },
      'getProfileBuckets',
    ).mockResolvedValue(['bucket-a', 'bucket-b']);

    const orchestrator = (
      oauthManager as unknown as {
        authFlowOrchestrator: {
          authenticateMultipleBuckets: (
            providerName: string,
            buckets: string[],
            requestMetadata?: OAuthTokenRequestMetadata,
          ) => Promise<void>;
        };
      }
    ).authFlowOrchestrator;

    vi.spyOn(orchestrator, 'authenticateMultipleBuckets').mockImplementation(
      async (
        providerName: string,
        buckets: string[],
        requestMetadata?: OAuthTokenRequestMetadata,
      ) => {
        const { BucketFailoverHandlerImpl } = await import(
          './BucketFailoverHandlerImpl.js'
        );
        const handler = new BucketFailoverHandlerImpl(
          buckets,
          providerName,
          oauthManager,
          requestMetadata,
        );
        mockConfig.setBucketFailoverHandler(handler);
      },
    );

    await oauthManager.authenticateMultipleBuckets(
      'anthropic',
      ['bucket-a', 'bucket-b'],
      metadata,
    );

    expect(mockSetBucketFailoverHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockSetBucketFailoverHandler.mock.calls[0][0] as {
      getCurrentBucket: () => string | undefined;
      reset: () => void;
    };

    oauthManager.setSessionBucket('anthropic', 'bucket-b', metadata);
    expect(handlerArg.getCurrentBucket()).toBe('bucket-a');
    handlerArg.reset();
    expect(oauthManager.getSessionBucket('anthropic', metadata)).toBe(
      'bucket-a',
    );
    expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();
  });
});
