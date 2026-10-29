/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { Profile, StandardProfile } from '@vybestack/llxprt-code-settings';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createOwnerPolicyFixture } from './__tests__/session-policy-fixture.js';
import { resolveCompressionProvider } from './CompressionProfileResolver.js';

const ownerFetch: NetworkFetch = () =>
  Promise.reject(new Error('Test resolver makes no requests'));

describe('compression profile Config ownership', () => {
  it.each(['default', 'standard', 'roundrobin', 'failover'])(
    'keeps the selected Config separate from the %s request runtime',
    async (mode) => {
      const fixture = createOwnerPolicyFixture();
      const selectedConfig = createRuntimeConfigStub(fixture.settings);
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
      const profile: Profile =
        mode === 'roundrobin' || mode === 'failover'
          ? {
              ...standard,
              provider: 'load-balancer',
              type: 'loadbalancer',
              policy: mode,
              profiles: ['member'],
            }
          : standard;
      try {
        const result = await resolveCompressionProvider(
          {
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
            profileDefinitions: {
              loadProfile: async (name): Promise<Profile> =>
                name === 'member' ? standard : profile,
            },
            readProviderKeys: () => {
              throw new Error('This profile names no stored key');
            },
            resolveExplicitCompressionProvider: () => provider,
            roundRobinIndexes: new Map(),
          },
          mode === 'default' ? undefined : 'summary-profile',
          () => provider,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedConfig,
        );
        expect(result.config).toBe(selectedConfig);
        expect(result.runtime).not.toHaveProperty('config');
        expect(result.invocation?.sessionId).toBe(
          fixture.runtime.state.sessionId,
        );
      } finally {
        await selectedConfig.dispose();
      }
    },
  );
});
