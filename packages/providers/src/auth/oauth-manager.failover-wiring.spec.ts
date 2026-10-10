/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { OAuthManager } from './oauth-manager.js';
import {
  createTestProvider,
  MemoryTokenStore,
} from './__tests__/behavioral/test-utils.js';

async function owner(): Promise<OAuthManager> {
  const store = new MemoryTokenStore();
  for (const bucket of ['primary', 'secondary', 'third']) {
    await store.saveToken(
      'anthropic',
      {
        access_token: `credential-${bucket}`,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      bucket,
    );
  }
  const oauth = new OAuthManager(store);
  oauth.registerProvider(createTestProvider('anthropic'));
  await oauth.toggleOAuthEnabled('anthropic');
  return oauth;
}

describe('OAuth owner bucket recovery', () => {
  it('rotates a configured bucket using live token authority without Config', async () => {
    const oauth = await owner();
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    const operations = oauth.composeRetryOperations('anthropic');
    expect(
      await operations.tryBucketFailover?.({ triggeringStatus: 429 }),
    ).toBe(true);
    expect(operations.readCurrentBucket?.()).toBe('secondary');
    expect(await oauth.getToken('anthropic')).toBe('credential-secondary');
    expect(oauth.getSessionBucket('anthropic')).toBe('secondary');
    expect(operations.readFailoverBuckets?.()).toStrictEqual([
      'primary',
      'secondary',
    ]);
  });

  it('retains already failed bucket exclusions when the same owner configures the same bucket list', async () => {
    const oauth = await owner();
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    const operations = oauth.composeRetryOperations('anthropic');
    await operations.tryBucketFailover?.({ triggeringStatus: 429 });
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    expect(
      await operations.tryBucketFailover?.({ triggeringStatus: 429 }),
    ).toBe(false);
    expect(operations.readFailoverBuckets?.()).toStrictEqual([
      'primary',
      'secondary',
    ]);
  });

  it('replaces bucket routing when the owner installs a different bucket list', async () => {
    const oauth = await owner();
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    await oauth
      .composeRetryOperations('anthropic')
      .tryBucketFailover?.({ triggeringStatus: 429 });
    oauth.configureBucketFailover('anthropic', ['primary', 'third']);
    const operations = oauth.composeRetryOperations('anthropic');
    expect(
      await operations.tryBucketFailover?.({ triggeringStatus: 429 }),
    ).toBe(true);
    expect(operations.readCurrentBucket?.()).toBe('third');
  });

  it('isolates equal profile labels on independently composed owners', async () => {
    const left = await owner();
    const right = await owner();
    const metadata = { profileId: 'same-label', providerId: 'anthropic' };
    left.configureBucketFailover(
      'anthropic',
      ['primary', 'secondary'],
      metadata,
    );
    right.configureBucketFailover('anthropic', ['primary', 'third'], metadata);
    await left
      .composeRetryOperations('anthropic', metadata)
      .tryBucketFailover?.({ triggeringStatus: 429 });
    expect(left.getSessionBucket('anthropic', metadata)).toBe('secondary');
    expect(right.getSessionBucket('anthropic', metadata)).toBe('primary');
    expect(left.getSessionBucket('anthropic')).toBeUndefined();
  });

  it('isolates distinct profile bucket routes within the same owner', async () => {
    const oauth = await owner();
    const foreground = { profileId: 'foreground', providerId: 'anthropic' };
    const child = { profileId: 'child', providerId: 'anthropic' };
    oauth.configureBucketFailover(
      'anthropic',
      ['primary', 'secondary'],
      foreground,
    );
    oauth.configureBucketFailover('anthropic', ['primary', 'third'], child);
    await oauth
      .composeRetryOperations('anthropic', child)
      .tryBucketFailover?.({ triggeringStatus: 429 });
    expect(oauth.getSessionBucket('anthropic', child)).toBe('third');
    expect(oauth.getSessionBucket('anthropic', foreground)).toBe('primary');
  });

  it('removes stale failover routing when a profile reduces to one bucket', async () => {
    const oauth = await owner();
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    const operations = oauth.composeRetryOperations('anthropic');
    await operations.tryBucketFailover?.({ triggeringStatus: 429 });
    oauth.configureBucketFailover('anthropic', ['primary']);
    expect(operations.readFailoverBuckets?.()).toStrictEqual([]);
    expect(
      await operations.tryBucketFailover?.({ triggeringStatus: 429 }),
    ).toBe(false);
    expect(oauth.getSessionBucket('anthropic')).not.toBe('secondary');
  });

  it('restores the owner bucket exclusions after a failed profile transition', async () => {
    const oauth = await owner();
    oauth.configureBucketFailover('anthropic', ['primary', 'secondary']);
    const operations = oauth.composeRetryOperations('anthropic');
    await operations.tryBucketFailover?.({ triggeringStatus: 429 });
    const restore = oauth.checkpointRetryHandlers();
    oauth.clearRetryHandlers();
    oauth.configureBucketFailover('anthropic', ['primary', 'third']);
    oauth.setSessionBucket('anthropic', 'primary');
    restore();
    expect(
      await operations.tryBucketFailover?.({ triggeringStatus: 429 }),
    ).toBe(false);
    expect(operations.readCurrentBucket?.()).toBe('secondary');
    expect(oauth.getSessionBucket('anthropic')).toBe('secondary');
  });
});
