/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #854 (review F1): a load-balancer peek must keep the delegate's
 * request-scoped source alive until the peek owner discharges it. These tests
 * use real source-backed projections (sealed segment files owned by a
 * Gpt56SourceProjection) and an on-demand SDK-body projection, estimate them
 * through the actual envelope estimator after the peek returns, and observe the
 * lease release on disk.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeProjection,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  LoadBalancingProvider,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { replayableContents } from '../utils/collectContents.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { serializeResponsesPromptEnvelope } from '../runtime/responses-source-serializer.js';
import { projectOpenAIChatPromptEnvelopeOnDemand } from '../runtime/promptEnvelopeProjections.js';

const scratch = mkdtempSync(join(tmpdir(), 'lb-peek-lease-'));
const factory = createRuntimeTokenizerFactory();
const sourceFactory = withGpt56DiskSources(factory, scratch);

const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};
const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'peek me 雪 " \\ line' }],
  },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'answer\n\n  indented' }] },
];

async function* stream(items: readonly IContent[]): AsyncGenerator<IContent> {
  yield* items;
}

interface SourceDelegate {
  readonly provider: IProvider;
  /** Directory of the sealed segment files behind each projection handed out. */
  readonly directories: string[];
  readonly projectionTokens: object[];
  /** Number of delegate projections currently holding their source lease. */
  readonly live: () => number;
}

/** A delegate whose projections own real on-disk segment files. */
function createSourceDelegate(name: string, model: string): SourceDelegate {
  const directories: string[] = [];
  const projectionTokens: object[] = [];
  let live = 0;
  const provider: IProvider = {
    name,
    async projectPromptEnvelope(): Promise<PromptEnvelopeProjection> {
      const prompt = await serializeResponsesPromptEnvelope({
        model,
        instructions: 'Be exact.',
        tools: [],
        context,
        contents: stream(rows),
      });
      const source = prompt.toEstimatorProjection();
      directories.push(dirname(source.promptSegments[0].source.path));
      const transportToken = Object.freeze({});
      projectionTokens.push(transportToken);
      live++;
      let released = false;
      return {
        model: prompt.model,
        protocol: prompt.protocol,
        method: prompt.method,
        projectionRevision: prompt.projectionRevision,
        unsupportedMedia: [],
        transportToken,
        finalizedProjection: source,
        legacyEstimate: () =>
          Promise.reject(new Error('source route must not use legacy path')),
        releaseIfUnsent: async () => {
          if (released) return;
          released = true;
          live--;
          await prompt.dispose();
        },
      };
    },
    async *generateChatCompletion(
      _options: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncGenerator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => model,
  };
  return { provider, directories, projectionTokens, live: () => live };
}

function member(name: string, model: string): ResolvedSubProfile {
  return {
    name,
    providerName: name,
    model,
    baseURL: `https://${name}.example.test`,
    authToken: 'test-token',
    ephemeralSettings: {},
    modelParams: {},
  };
}

let providerManager: ProviderManager;

function loadBalancerFor(
  profile: ResolvedSubProfile,
  strategy: 'round-robin' | 'failover' = 'round-robin',
): LoadBalancingProvider {
  // Failover needs a standby member; the peek targets the first eligible one.
  const subProfiles =
    strategy === 'failover'
      ? [profile, member('prov-standby', profile.model)]
      : [profile];
  return new LoadBalancingProvider(
    {
      profileName: 'peek-lease-lb',
      strategy,
      contextLimit: 1_000_000,
      subProfiles,
    },
    providerManager,
  );
}

describe('load-balancer peek keeps the delegate source alive (issue #854)', () => {
  beforeEach(() => {
    const settingsService = new SettingsService();
    const config: Config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  for (const strategy of ['round-robin', 'failover'] as const) {
    it(`${strategy}: estimates a real source projection after the peek returned`, async () => {
      const delegate = createSourceDelegate('prov-a', 'gpt-5.6-sol');
      providerManager.registerProvider(delegate.provider);
      const lb = loadBalancerFor(member('prov-a', 'gpt-5.6-sol'), strategy);

      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents(rows),
      });
      if (projection === undefined) throw new Error('expected a projection');

      expect(existsSync(delegate.directories[0])).toBe(true);
      const direct = await estimatePromptEnvelope(
        'prov-a',
        projection,
        sourceFactory,
      );
      expect(direct.estimatedPromptTokens).toBeGreaterThan(0);
      expect(direct.estimatorFamily).toBe('openai-gpt-5.6');

      await projection.releaseIfUnsent?.();
      expect(existsSync(delegate.directories[0])).toBe(false);
      expect(delegate.live()).toBe(0);
    });
  }

  it('the peek estimate equals the estimate of the delegate projection itself', async () => {
    const delegate = createSourceDelegate('prov-a', 'gpt-5.6-sol');
    providerManager.registerProvider(delegate.provider);
    const lb = loadBalancerFor(member('prov-a', 'gpt-5.6-sol'));

    const peeked = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    const own = await delegate.provider.projectPromptEnvelope?.({
      contents: replayableContents(rows),
    });
    if (peeked === undefined || own === undefined)
      throw new Error('expected projections');
    try {
      expect(
        await estimatePromptEnvelope('prov-a', peeked, sourceFactory),
      ).toStrictEqual(
        await estimatePromptEnvelope('prov-a', own, sourceFactory),
      );
    } finally {
      await peeked.releaseIfUnsent?.();
      await own.releaseIfUnsent?.();
    }
  });

  it('a released peek is disposed, and acquiring it afterwards fails (disposed-source regression)', async () => {
    const delegate = createSourceDelegate('prov-a', 'gpt-5.6-sol');
    providerManager.registerProvider(delegate.provider);
    const lb = loadBalancerFor(member('prov-a', 'gpt-5.6-sol'));

    const projection = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    if (projection === undefined) throw new Error('expected a projection');
    // Before the fix the peek released the delegate inside projectPromptEnvelope,
    // so this first estimate threw "Source projection is disposed".
    await estimatePromptEnvelope('prov-a', projection, sourceFactory);
    await projection.releaseIfUnsent?.();
    await expect(
      estimatePromptEnvelope('prov-a', projection, sourceFactory),
    ).rejects.toThrow('tokenization-failed');
  });

  it('an on-demand SDK body is readable for the legacy estimator until release', async () => {
    let bodyLeased = true;
    const body = {
      model: 'unregistered-model-x',
      messages: [{ role: 'user', content: 'legacy body 雪' }],
    };
    const delegate: IProvider = {
      name: 'prov-b',
      projectPromptEnvelope: async () =>
        projectOpenAIChatPromptEnvelopeOnDemand(
          () => {
            if (!bodyLeased) throw new Error('Request body lease released');
            return body;
          },
          {
            releaseIfUnsent: async () => {
              bodyLeased = false;
            },
          },
        ),
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'unregistered-model-x',
    };
    providerManager.registerProvider(delegate);
    const lb = loadBalancerFor(member('prov-b', 'unregistered-model-x'));

    const projection = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    if (projection === undefined) throw new Error('expected a projection');

    const estimate = await estimatePromptEnvelope(
      'prov-b',
      projection,
      factory,
    );
    expect(estimate.estimatedPromptTokens).toBeGreaterThan(0);
    expect(estimate.estimatorFamily).toBe('legacy-unregistered');

    await projection.releaseIfUnsent?.();
    expect(() => projection.legacyEstimate()).toThrow(
      'Request body lease released',
    );
  });

  it('a send that carries the peek token takes over and releases the peek lease', async () => {
    const delegate = createSourceDelegate('prov-a', 'gpt-5.6-sol');
    providerManager.registerProvider(delegate.provider);
    const lb = loadBalancerFor(member('prov-a', 'gpt-5.6-sol'));

    const peeked = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    if (peeked === undefined) throw new Error('expected a projection');
    await estimatePromptEnvelope('prov-a', peeked, sourceFactory);
    expect(delegate.live()).toBe(1);

    const chunks: IContent[] = [];
    for await (const chunk of lb.generateChatCompletion({
      contents: replayableContents(rows),
      promptEnvelopeTransportToken: peeked.transportToken,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    // The peek's directory is gone; the send's own projection (second
    // directory) is owned by the delegate send and is not part of the peek.
    expect(existsSync(delegate.directories[0])).toBe(false);
    // Discharging again after the send is a no-op.
    await peeked.releaseIfUnsent?.();
  });

  it('an unsent peek is discharged by its owner and leaves no lease behind', async () => {
    const delegate = createSourceDelegate('prov-a', 'gpt-5.6-sol');
    providerManager.registerProvider(delegate.provider);
    const lb = loadBalancerFor(member('prov-a', 'gpt-5.6-sol'));

    const first = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    const second = await lb.projectPromptEnvelope({
      contents: replayableContents(rows),
    });
    expect(delegate.live()).toBe(2);
    await first?.releaseIfUnsent?.();
    expect(delegate.live()).toBe(1);
    await second?.releaseIfUnsent?.();
    expect(delegate.live()).toBe(0);
    expect(delegate.directories.every((dir) => !existsSync(dir))).toBe(true);
  });

  it('holds a counting delegate lease until released, then releases it exactly once', async () => {
    const releases: string[] = [];
    const delegate: IProvider = {
      name: 'prov-c',
      projectPromptEnvelope: async () => ({
        model: 'model-c',
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 7,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({ kind: 'test' }),
        legacyEstimate: () => Promise.resolve(10),
        releaseIfUnsent: async () => {
          releases.push(`released-${releases.length}`);
        },
      }),
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'model-c',
    };
    providerManager.registerProvider(delegate);
    const lb = loadBalancerFor(member('prov-c', 'model-c'));

    const first = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(releases).toStrictEqual([]);
    await first?.releaseIfUnsent?.();
    await first?.releaseIfUnsent?.();
    expect(releases).toStrictEqual(['released-0']);
    const second = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    await second?.releaseIfUnsent?.();
    expect(releases).toStrictEqual(['released-0', 'released-1']);
  });

  it('propagates a failing delegate release', async () => {
    const delegate: IProvider = {
      name: 'prov-d',
      projectPromptEnvelope: async () => ({
        model: 'model-d',
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 7,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({ kind: 'test' }),
        legacyEstimate: () => Promise.resolve(10),
        releaseIfUnsent: () => Promise.reject(new Error('release exploded')),
      }),
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'model-d',
    };
    providerManager.registerProvider(delegate);
    const lb = loadBalancerFor(member('prov-d', 'model-d'));
    const projection = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    await expect(projection?.releaseIfUnsent?.()).rejects.toThrow(
      'release exploded',
    );
  });
});
