/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import type {
  LoadBalancingProviderConfig,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';

import { createProviderKeyStorage } from '../runtime/runtimeSettings.js';

const storedKeys = new Map<string, string>();

function createProjectionFixture(
  strategy: LoadBalancingProviderConfig['strategy'],
  rotateDuringProjection = false,
): {
  lb: LoadBalancingProvider;
  member: ResolvedSubProfile;
  options: GenerateChatOptions;
  projections: GenerateChatOptions[];
} {
  const settings = new SettingsService();
  settings.setCurrentProfileName('ambient-profile');
  settings.setProviderSetting('projection-probe', 'auth-key', 'ambient-key');
  const config = createRuntimeConfigStub(settings);
  const runtime = {
    settingsService: settings,
    config,
    runtimeId: 'projection-test',
  };
  const manager = new ProviderManager({
    settingsService: settings,
    config,
    runtime,
  });
  const projections: GenerateChatOptions[] = [];
  const delegate: IProvider = {
    name: 'projection-probe',
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    projectPromptEnvelope: async (options) => {
      projections.push(options);
      if (!rotateDuringProjection) return undefined;
      storedKeys.set('member-key', 'rotated-after-projection');
      return {
        model: 'test-model',
        protocol: 'openai-responses',
        method: 'responses/v1',
        projectionRevision: 3,
        unsupportedMedia: [],
        transportToken: { credential: options.resolved?.authToken },
        finalizedProjection: Object.freeze({
          kind: 'llxprt-provider-prompt-v3',
          protocol: 'openai-responses',
          promptText: 'test prompt',
        }),
        legacyEstimate: async () => 1,
      };
    },
    async *generateChatCompletion(options): AsyncGenerator<IContent> {
      if (Array.isArray(options)) throw new Error('expected delegate options');
      if (rotateDuringProjection) {
        expect(options.promptEnvelopeTransportToken).toStrictEqual({
          credential: options.resolved?.authToken,
        });
        expect(options.resolved?.authToken).not.toStrictEqual(
          storedKeys.get('member-key'),
        );
      }
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
    },
  };
  manager.registerProvider(delegate);
  manager.setTokenizerFactory({
    getTokenizer: () => undefined,
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'legacy-unregistered',
      estimatorVersion: 'test-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  });
  const member: ResolvedSubProfile = {
    name: 'key-member',
    providerName: delegate.name,
    model: 'test-model',
    baseURL: 'https://projection-probe.example.test',
    authKeyName: 'member-key',
    auth: { type: 'apikey' },
    ephemeralSettings: {},
    modelParams: {},
  };
  const lb = new LoadBalancingProvider(
    {
      profileName: 'lb-projection',
      strategy,
      contextLimit: 100,
      subProfiles: [member, { ...member, name: 'second-member' }],
    },
    manager,
  );
  return {
    lb,
    member,
    projections,
    options: {
      contents: [],
      settings,
      config,
      runtime,
      metadata: { profileId: 'ambient-profile' },
      resolved: { authToken: 'parent-key' },
    },
  };
}

async function consume(
  lb: LoadBalancingProvider,
  options: GenerateChatOptions,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of lb.generateChatCompletion(options))
    chunks.push(chunk);
  return chunks;
}

describe('load balancer projection credentials', () => {
  let restoreStorage: (() => void) | undefined;

  beforeEach(() => {
    if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
      throw new Error('Projection credential tests require isolated storage');
    }
    const getKey = vi.spyOn(createProviderKeyStorage(), 'getKey');
    restoreStorage = () => getKey.mockRestore();
    getKey.mockImplementation(async (name) => storedKeys.get(name) ?? null);
  });

  afterEach(() => {
    restoreStorage?.();
    restoreStorage = undefined;
  });

  const strategies: Array<LoadBalancingProviderConfig['strategy']> = [
    'round-robin',
    'failover',
  ];

  it.each(strategies)(
    '%s projects with the member key and reads rotation on the next projection',
    async (strategy) => {
      const { lb, member, options, projections } =
        createProjectionFixture(strategy);
      try {
        storedKeys.set('member-key', '  first-key  ');
        await consume(lb, options);
        storedKeys.set('member-key', '  rotated-key  ');
        await consume(lb, options);

        expect(
          projections.map((projection) => ({
            token: projection.resolved?.authToken,
            profileId: projection.metadata?.profileId,
            delegate: projection.metadata?.loadBalancerDelegate,
          })),
        ).toStrictEqual([
          { token: 'first-key', profileId: 'key-member', delegate: true },
          {
            token: 'rotated-key',
            profileId:
              strategy === 'round-robin' ? 'second-member' : 'key-member',
            delegate: true,
          },
        ]);
        expect(member.authToken).toStrictEqual(undefined);
        expect(options.resolved?.authToken).toStrictEqual('parent-key');
      } finally {
        storedKeys.clear();
      }
    },
  );

  it('carries the projection credential through round-robin transport despite rotation', async () => {
    const { lb, options, projections } = createProjectionFixture(
      'round-robin',
      true,
    );
    try {
      storedKeys.set('member-key', 'projection-credential');
      expect(await consume(lb, options)).toStrictEqual([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
      ]);
      expect(projections.length).toStrictEqual(1);
    } finally {
      storedKeys.clear();
    }
  });

  it('retains the attempt credential for the compressed projection', async () => {
    const { lb, member, options, projections } =
      createProjectionFixture('round-robin');
    try {
      storedKeys.set('member-key', 'before-compression');
      lb.setCompressionCallback(async () => {
        storedKeys.set('member-key', 'after-compression');
        return [];
      });
      await consume(lb, {
        ...options,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'long prompt '.repeat(1000) }],
          },
        ],
      });

      expect(
        projections.map((projection) => ({
          token: projection.resolved?.authToken,
          profileId: projection.metadata?.profileId,
        })),
      ).toStrictEqual([
        { token: 'before-compression', profileId: 'key-member' },
        { token: 'before-compression', profileId: 'key-member' },
      ]);
      expect(member.authToken).toStrictEqual(undefined);
    } finally {
      storedKeys.clear();
    }
  });
});
