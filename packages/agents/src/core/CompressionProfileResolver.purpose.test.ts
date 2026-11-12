/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: refusal review resolves its profile through the same isolated
 * auxiliary resolver that compression uses. Compression keeps its labels; the
 * reviewer gets its own runtime id and its own error, and neither touches the
 * session that asked.
 */

import { describe, expect, it } from 'bun:test';
import type { Profile, StandardProfile } from '@vybestack/llxprt-code-settings';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { CompressionProfileNotFoundError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { createOwnerPolicyFixture } from './__tests__/session-policy-fixture.js';
import {
  resolveCompressionProvider,
  type AuxiliaryProfilePurpose,
} from './CompressionProfileResolver.js';
import {
  REFUSAL_REVIEW_PROFILE_PURPOSE,
  RefusalReviewProfileError,
} from '../refusal/reviewProfile.js';

const ownerFetch: NetworkFetch = () =>
  Promise.reject(new Error('Test resolver makes no requests'));

const provider: RuntimeProvider = {
  name: 'openai',
  getDefaultModel: () => 'summary-model',
  getModels: async () => [],
  async *generateChatCompletion() {
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'summary' }] };
  },
};

const standard: StandardProfile = {
  version: 1,
  provider: 'openai',
  model: 'summary-model',
  modelParams: {},
  ephemeralSettings: {},
};

function resolveWith(
  purpose: AuxiliaryProfilePurpose | undefined,
  loadProfile: (name: string) => Promise<Profile>,
) {
  const fixture = createOwnerPolicyFixture();
  return {
    fixture,
    result: resolveCompressionProvider(
      {
        ...(purpose === undefined ? {} : { purpose }),
        providerRuntime: { runtimeId: fixture.runtime.state.runtimeId },
        runtimeState: fixture.runtime.state,
        prepareProviderInvocation: (name, parameters, signal) =>
          fixture.owner.prepareProviderInvocation(
            fixture.runtime.state.runtimeId,
            name,
            parameters,
            signal,
            fixture.runtime.state.sessionId,
            ownerFetch,
          ),
        profileDefinitions: { loadProfile },
        readProviderKeys: () => {
          throw new Error('This profile names no stored key');
        },
        resolveExplicitCompressionProvider: () => provider,
        roundRobinIndexes: new Map(),
      },
      'summary-profile',
      () => provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ),
  };
}

describe('auxiliary profile purposes', () => {
  it('keeps the compression runtime id and metadata for compression', async () => {
    const { fixture, result } = resolveWith(undefined, async () => standard);

    const resolved = await result;

    expect({
      runtimeId: resolved.runtime.runtimeId,
      profile: resolved.runtime.metadata?.compressionProfile,
      source: resolved.runtime.metadata?.source,
    }).toStrictEqual({
      runtimeId: `${fixture.runtime.state.runtimeId}::compression-profile:summary-profile`,
      profile: 'summary-profile',
      source: 'ChatSession.resolveCompressionProvider',
    });
  });

  it('gives the refusal reviewer its own isolated runtime id and session identity', async () => {
    const { fixture, result } = resolveWith(
      REFUSAL_REVIEW_PROFILE_PURPOSE,
      async () => standard,
    );

    const resolved = await result;

    expect({
      runtimeId: resolved.runtime.runtimeId,
      profile: resolved.runtime.metadata?.refusalReviewProfile,
      compressionLabel: resolved.runtime.metadata?.compressionProfile,
      sessionId: resolved.invocation?.sessionId,
    }).toStrictEqual({
      runtimeId: `${fixture.runtime.state.runtimeId}::refusal-review-profile:summary-profile`,
      profile: 'summary-profile',
      compressionLabel: undefined,
      sessionId: fixture.runtime.state.sessionId,
    });
  });

  it('fails a missing compression profile with the compression error', async () => {
    const { result } = resolveWith(undefined, () =>
      Promise.reject(new Error('no such file')),
    );

    await expect(result).rejects.toBeInstanceOf(
      CompressionProfileNotFoundError,
    );
  });

  it('fails a missing review profile with an error that names refusal.review-profile', async () => {
    const { result } = resolveWith(REFUSAL_REVIEW_PROFILE_PURPOSE, () =>
      Promise.reject(new Error('no such file')),
    );

    const failure = await result.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RefusalReviewProfileError);
    expect((failure as Error).message).toContain('refusal.review-profile');
    expect((failure as Error).message).toContain("'summary-profile'");
    expect((failure as Error).message).not.toContain('compression.profile');
  });
});
