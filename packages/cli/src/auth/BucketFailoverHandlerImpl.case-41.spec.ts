/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import { MemoryTokenStore } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #41', () => {
  it('passes request metadata through eager multi-bucket authentication', async () => {
    const tokenStore = new MemoryTokenStore();
    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };
    const oauthManager = {
      getOAuthToken: vi.fn(async () => null),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => undefined),
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
      metadata,
    );

    await handler.ensureBucketsAuthenticated();

    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledWith(
      'anthropic',
      ['bucket-a', 'bucket-b', 'bucket-c'],
      metadata,
    );
  });
});
