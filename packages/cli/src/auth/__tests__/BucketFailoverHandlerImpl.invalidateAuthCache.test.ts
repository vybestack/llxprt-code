/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    flushRuntimeAuthScope: vi.fn(),
  };
});

import {
  flushRuntimeAuthScope,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import { BucketFailoverHandlerImpl } from '../BucketFailoverHandlerImpl.js';
import type { BucketFailoverOAuthManagerLike } from '../types.js';

describe('BucketFailoverHandlerImpl.invalidateAuthCache', () => {
  it('flushes the runtime auth scope for unbucketed profiles', () => {
    const oauthManager: BucketFailoverOAuthManagerLike = {
      getSessionBucket: vi.fn().mockReturnValue(undefined),
      setSessionBucket: vi.fn(),
      getTokenStore: vi.fn(),
      getOAuthToken: vi.fn(),
      authenticate: vi.fn(),
      authenticateMultipleBuckets: vi.fn(),
      forceRefreshToken: vi.fn(),
    };

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinking',
      providerId: 'anthropic',
      runtimeMetadata: { source: 'test' },
    };

    const handler = new BucketFailoverHandlerImpl(
      ['default'],
      'anthropic',
      oauthManager,
      metadata,
    );

    handler.invalidateAuthCache('runtime-1739');

    expect(flushRuntimeAuthScope).toHaveBeenCalledWith('runtime-1739');
  });
});
