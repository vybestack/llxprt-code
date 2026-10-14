/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createProfileSchemas } from './profileSchemas.js';

describe('profile schema owner', () => {
  it('completes saved profiles from the schema owner, not invocation runtime', async () => {
    const schemas = createProfileSchemas({
      listProfiles: async () => ['owner-profile'],
      getActiveProviderName: () => 'owner-provider',
      listBuckets: async () => ['owner-bucket'],
    });
    const profile = schemas.profileLoadSchema[0];
    if (profile.kind !== 'value' || profile.completer === undefined)
      throw new Error('Profile load completer is unavailable');

    const suggestions = await profile.completer(
      createMockCommandContext({
        runtimeApi: {
          listSavedProfiles: async () => ['invocation-profile'],
          providerStatus: () => ({ providerName: 'invocation-provider' }),
        },
      }),
      '',
      {
        tokens: [],
        partialToken: '',
        hasTrailingSpace: false,
        position: 1,
      },
    );

    expect(suggestions.map(({ value }) => value)).toStrictEqual([
      'owner-profile',
    ]);
  });

  it('completes default-profile and bucket arguments from the schema owner', async () => {
    const schemas = createProfileSchemas({
      listProfiles: async () => ['owner-profile'],
      getActiveProviderName: () => 'owner-provider',
      listBuckets: async (provider) => [`${provider}-bucket-a`, 'bucket-b'],
    });
    const invocation = createMockCommandContext({
      runtimeApi: {
        listSavedProfiles: async () => ['invocation-profile'],
        providerStatus: () => ({ providerName: 'invocation-provider' }),
      },
    });
    const complete = async (
      schema: typeof schemas.profileSetDefaultSchema,
      tokens: string[],
    ) => {
      const node = schema[0];
      if (node.kind !== 'value' || node.completer === undefined)
        throw new Error('Value completer is unavailable');
      return (
        await node.completer(invocation, '', {
          tokens,
          partialToken: '',
          hasTrailingSpace: false,
          position: tokens.length,
        })
      ).map(({ value }) => value);
    };

    expect(await complete(schemas.profileSetDefaultSchema, [])).toStrictEqual([
      'none',
      'owner-profile',
    ]);

    const model = schemas.profileSaveSchema[0];
    if (model.kind !== 'literal') throw new Error('Expected model literal');
    const name = model.next?.[0];
    if (name?.kind !== 'value') throw new Error('Expected profile-name value');
    const bucket = name.next?.[0];
    if (bucket?.kind !== 'value' || bucket.completer === undefined)
      throw new Error('Bucket completer is unavailable');
    const buckets = await bucket.completer(invocation, '', {
      tokens: ['save', 'model', 'demo', 'bucket-b'],
      partialToken: '',
      hasTrailingSpace: true,
      position: 4,
    });
    expect(buckets.map(({ value }) => value)).toStrictEqual([
      'owner-provider-bucket-a',
    ]);
  });
});
