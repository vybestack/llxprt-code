/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { resolveCurrentProfileSessionBucket } from './token-profile-resolver.js';

describe('current profile session bucket', () => {
  const metadata = { providerId: 'codex', profileId: 'team' };

  it('uses the scoped session before loading profile buckets', async () => {
    const bucket = await resolveCurrentProfileSessionBucket(
      'codex',
      metadata,
      (_provider, scope) =>
        scope?.profileId === 'team' ? 'team-b' : 'default',
      () => {
        throw new Error('Profile buckets must not be loaded');
      },
    );
    expect(bucket).toBe('team-b');
  });

  it('uses a sole profile bucket before reading an unscoped session', async () => {
    const bucket = await resolveCurrentProfileSessionBucket(
      'codex',
      metadata,
      (_provider, scope) => {
        if (scope === undefined)
          throw new Error('Unscoped session must not be read');
        return undefined;
      },
      async () => ['only'],
    );
    expect(bucket).toBe('only');
  });

  it.each([
    { buckets: [], expected: 'shared' },
    { buckets: ['other', 'shared'], expected: 'shared' },
    { buckets: ['other', 'team'], expected: undefined },
  ])(
    'accepts an unscoped bucket only when compatible with $buckets',
    async ({ buckets, expected }) => {
      const bucket = await resolveCurrentProfileSessionBucket(
        'codex',
        metadata,
        (_provider, scope) => (scope === undefined ? 'shared' : undefined),
        async () => [...buckets],
      );
      expect(bucket).toBe(expected);
    },
  );

  it('propagates profile read failures', async () => {
    const failure = new Error('Profile unavailable');
    await expect(
      resolveCurrentProfileSessionBucket(
        'codex',
        metadata,
        () => undefined,
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});
