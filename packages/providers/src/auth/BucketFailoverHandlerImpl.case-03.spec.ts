/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import {
  createBucketFailoverFixture,
  makeToken,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #3', () => {
  it('uses scoped session buckets when initialized with request metadata', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    oauthManager.setSessionBucket('anthropic', 'bucket-b', metadata);

    const HandlerCtor = BucketFailoverHandlerImpl as unknown as {
      new (
        buckets: string[],
        provider: string,
        oauthManager: OAuthManager,
        metadata?: OAuthTokenRequestMetadata,
      ): BucketFailoverHandlerImpl;
    };

    const handler = new HandlerCtor(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
      metadata,
    );

    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.getSessionBucket('anthropic', metadata)).toBe(
      'bucket-b',
    );
    expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();

    handler.reset();

    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic', metadata)).toBe(
      'bucket-a',
    );
    expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();
  });
});
