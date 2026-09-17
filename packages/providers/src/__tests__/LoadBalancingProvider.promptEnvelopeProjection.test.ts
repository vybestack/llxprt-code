/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for LoadBalancingProvider.projectPromptEnvelope
 * (issue #3507, AC1): the load balancer projects the NEXT sub-profile's
 * delegate prompt envelope as an estimate-only value so tool-aware
 * pre-send enforcement sees the envelope the next send would transmit.
 *
 * Estimation policy (issue #3507): the projection is a peek, not a send.
 * It must not consume round-robin or failover selection state, the
 * send-time guard still re-estimates authoritatively, and rotation drift
 * between peek and send degrades to guard behavior. The estimate-only
 * wrapper carries a fresh transport token and releases the delegate's
 * request-scoped projection within the call.
 *
 * Anti-mock-theater: every assertion reads values the delegate projection
 * actually returned and effects the delegate's release callback actually
 * performed — no mock-interaction assertions.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function createTextContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function createResolvedSubProfile(
  overrides: Partial<ResolvedSubProfile>,
): ResolvedSubProfile {
  return {
    name: overrides.name ?? 'sub',
    providerName: overrides.providerName ?? 'openai',
    model: overrides.model ?? 'gpt-4.1',
    baseURL: overrides.baseURL,
    authToken: overrides.authToken ?? 'test-token',
    authKeyfile: overrides.authKeyfile,
    contextWindow: overrides.contextWindow,
    ephemeralSettings: overrides.ephemeralSettings ?? {},
    modelParams: overrides.modelParams ?? {},
  };
}

/**
 * A real delegate provider whose projectPromptEnvelope builds genuine
 * projections: it records the options it received, hands out
 * request-scoped transport tokens, and estimates the serialized envelope
 * (contents + tool schemas) like a real provider projection would.
 */
interface ProjectingDelegate {
  readonly provider: IProvider;
  readonly projectedOptions: GenerateChatOptions[];
  readonly delegateTokens: object[];
}

function createProjectingDelegate(spec: {
  name: string;
  estimateTokens: (options: GenerateChatOptions) => number;
  releaseIfUnsent?: () => Promise<void>;
  resolveProjection?: (
    options: GenerateChatOptions,
  ) => Promise<PromptEnvelopeProjection | undefined>;
}): ProjectingDelegate {
  const projectedOptions: GenerateChatOptions[] = [];
  const delegateTokens: object[] = [];
  const provider: IProvider = {
    name: spec.name,
    async projectPromptEnvelope(options: GenerateChatOptions) {
      projectedOptions.push(options);
      if (spec.resolveProjection !== undefined) {
        return spec.resolveProjection(options);
      }
      const transportToken = Object.freeze({ seq: delegateTokens.length });
      delegateTokens.push(transportToken);
      return {
        model: options.resolved?.model ?? spec.name,
        protocol: 'openai-chat',
        method: 'chat/completions/v1',
        projectionRevision: 7,
        unsupportedMedia: [],
        transportToken,
        finalizedProjection: Object.freeze({ kind: 'test', promptText: 'x' }),
        legacyEstimate: () => Promise.resolve(spec.estimateTokens(options)),
        ...(spec.releaseIfUnsent === undefined
          ? {}
          : { releaseIfUnsent: spec.releaseIfUnsent }),
      };
    },
    async *generateChatCompletion(
      options: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent> {
      if (Array.isArray(options)) {
        throw new Error('legacy array overload is not exercised here');
      }
      projectedOptions.push(options);
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => 'delegate-default',
  };
  return { provider, projectedOptions, delegateTokens };
}

/** Serialize contents + tool schemas the way an envelope estimate would. */
function serializedEnvelopeTokens(options: GenerateChatOptions): number {
  const contentText = options.contents
    .map((content) => JSON.stringify(content.blocks))
    .join('\n');
  const toolText = (options.tools ?? [])
    .map((toolset) => JSON.stringify(toolset.functionDeclarations))
    .join('\n');
  return Math.ceil((contentText.length + toolText.length) / 4);
}

function createLoadBalancer(
  providerManager: ProviderManager,
  overrides: Partial<LoadBalancingProviderConfig> = {},
): LoadBalancingProvider {
  return new LoadBalancingProvider(
    {
      profileName: 'projection-lb',
      strategy: 'round-robin',
      contextLimit: 1_000_000,
      ...overrides,
      subProfiles: overrides.subProfiles ?? [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'openai',
          model: 'model-a',
        }),
      ],
    },
    providerManager,
  );
}

describe('LoadBalancingProvider.projectPromptEnvelope (issue #3507, AC1)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('forwards the peeked sub-profile delegate projection as an estimate-only envelope', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 1234,
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);
    const contents = [createTextContent('hello envelope')];

    const projection = await lb.projectPromptEnvelope({ contents });

    expect(projection).toBeDefined();
    // Estimation fields are the delegate projection's own values.
    expect(projection?.model).toBe('model-a');
    expect(projection?.protocol).toBe('openai-chat');
    expect(projection?.method).toBe('chat/completions/v1');
    expect(projection?.projectionRevision).toBe(7);
    expect(projection?.unsupportedMedia).toStrictEqual([]);
    expect(await projection?.legacyEstimate()).toBe(1234);
    // No delegate accounting to forward means no accounting field at all.
    expect('accounting' in (projection ?? {})).toBe(false);
    // The delegate projected the caller's contents.
    expect(delegate.projectedOptions[0]?.contents).toBe(contents);
  });

  it('peeks without consuming round-robin selection state, and the peek follows rotation position', async () => {
    providerManager.registerProvider(
      createProjectingDelegate({
        name: 'openai',
        estimateTokens: () => 10,
      }).provider,
    );
    const lb = createLoadBalancer(providerManager, {
      subProfiles: [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'openai',
          model: 'model-a',
        }),
        createResolvedSubProfile({
          name: 'b',
          providerName: 'openai',
          model: 'model-b',
        }),
      ],
    });

    const firstPeek = await lb.projectPromptEnvelope({ contents: [] });
    expect(firstPeek?.model).toBe('model-a');

    // The peek did not consume the rotation: the next selection is still
    // sub-profile 'a'.
    expect(lb.selectNextSubProfile().name).toBe('a');

    // The peek reflects the new position only after the caller advanced it.
    const secondPeek = await lb.projectPromptEnvelope({ contents: [] });
    expect(secondPeek?.model).toBe('model-b');

    // Selection wraps back to 'a'; the peek follows the rotation.
    expect(lb.selectNextSubProfile().name).toBe('b');
    const thirdPeek = await lb.projectPromptEnvelope({ contents: [] });
    expect(thirdPeek?.model).toBe('model-a');
  });

  it('peeks the failover start index without mutating failover state', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: (options) =>
        Math.ceil(
          options.contents
            .map((content) => JSON.stringify(content.blocks))
            .join('').length / 4,
        ),
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager, {
      strategy: 'failover',
      // Shared limit high enough that only member 'a' fails its own window.
      contextLimit: 1_000_000,
      subProfiles: [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'openai',
          model: 'model-a',
          contextWindow: 5,
        }),
        createResolvedSubProfile({
          name: 'b',
          providerName: 'openai',
          model: 'model-b',
          contextWindow: 1_000_000,
        }),
      ],
    });

    // A send over sub-profile 'a's tiny member window fails the guard, so
    // failover lands on (and sticks to) backend 'b'.
    const chunks: IContent[] = [];
    for await (const chunk of lb.generateChatCompletion({
      contents: [
        createTextContent('a request payload far larger than five tokens'),
      ],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(lb.getCurrentFailoverIndex()).toBe(1);

    const projection = await lb.projectPromptEnvelope({ contents: [] });
    expect(projection?.model).toBe('model-b');

    // Peeking did not move the failover index.
    expect(lb.getCurrentFailoverIndex()).toBe(1);
    const repeatPeek = await lb.projectPromptEnvelope({ contents: [] });
    expect(repeatPeek?.model).toBe('model-b');
    expect(lb.getCurrentFailoverIndex()).toBe(1);
  });

  it('resolves undefined when the delegate provider is not registered', async () => {
    const lb = createLoadBalancer(providerManager, {
      subProfiles: [
        createResolvedSubProfile({
          name: 'missing',
          providerName: 'not-registered',
          model: 'model-a',
        }),
      ],
    });

    await expect(
      lb.projectPromptEnvelope({ contents: [] }),
    ).resolves.toBeUndefined();
  });

  it('resolves undefined when the delegate lacks projectPromptEnvelope', async () => {
    const plainDelegate: IProvider = {
      name: 'openai',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'delegate-default',
    };
    providerManager.registerProvider(plainDelegate);

    const lb = createLoadBalancer(providerManager);

    await expect(
      lb.projectPromptEnvelope({ contents: [] }),
    ).resolves.toBeUndefined();
  });

  it('resolves undefined when the delegate projection resolves undefined', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 0,
      resolveProjection: () => Promise.resolve(undefined),
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);

    await expect(
      lb.projectPromptEnvelope({ contents: [] }),
    ).resolves.toBeUndefined();
  });

  it('returns a fresh frozen transport token, never the delegate reservation', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 10,
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);
    const projection = await lb.projectPromptEnvelope({
      contents: [createTextContent('token freshness')],
    });

    expect(projection?.transportToken).not.toBe(delegate.delegateTokens[0]);
    expect(Object.isFrozen(projection?.transportToken)).toBe(true);
  });

  it('awaits the delegate release exactly once per projection and forwards no release obligation', async () => {
    const releases: string[] = [];
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 10,
      releaseIfUnsent: async () => {
        releases.push(`released-${releases.length}`);
      },
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);

    const first = await lb.projectPromptEnvelope({ contents: [] });
    expect(releases).toStrictEqual(['released-0']);
    expect('releaseIfUnsent' in (first ?? {})).toBe(false);

    // Each projection call releases its own delegate projection.
    await lb.projectPromptEnvelope({ contents: [] });
    expect(releases).toStrictEqual(['released-0', 'released-1']);
  });

  it('propagates a failing delegate release', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 10,
      releaseIfUnsent: () => Promise.reject(new Error('release exploded')),
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);

    await expect(lb.projectPromptEnvelope({ contents: [] })).rejects.toThrow(
      'release exploded',
    );
  });

  it('delegate receives the sub-profile-rendered system prompt (guard-parity options)', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 10,
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);
    const invocations: string[] = [];

    const projection = await lb.projectPromptEnvelope({
      contents: [createTextContent('request')],
      systemInstruction: '[model=load-balancer]',
      systemPromptAssembler: {
        assemble: async (request) => {
          invocations.push(request.model);
          return `[model=${request.model}]`;
        },
      },
    });

    expect(projection?.model).toBe('model-a');
    expect(invocations).toStrictEqual(['model-a']);
    expect(delegate.projectedOptions[0]?.systemInstruction).toBe(
      '[model=model-a]',
    );
  });

  it('tool-bearing options project strictly larger than tool-less options through the LB projection', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: serializedEnvelopeTokens,
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);

    const withoutTools = await lb.projectPromptEnvelope({
      contents: [createTextContent('analyze this request')],
    });
    const withTools = await lb.projectPromptEnvelope({
      contents: [createTextContent('analyze this request')],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Reads a file from the workspace',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    });

    const without = await withoutTools?.legacyEstimate();
    const with_ = await withTools?.legacyEstimate();
    expect(typeof without).toBe('number');
    expect(typeof with_).toBe('number');
    expect(with_ as number).toBeGreaterThan(without as number);
  });

  it('forwards stateful accounting when the delegate projection carries it', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: () => 1234,
      resolveProjection: () =>
        Promise.resolve({
          model: 'model-a',
          protocol: 'openai-chat',
          method: 'chat/completions/v1',
          projectionRevision: 7,
          unsupportedMedia: [],
          transportToken: Object.freeze({ reserved: true }),
          finalizedProjection: Object.freeze({ kind: 'test' }),
          legacyEstimate: () => Promise.resolve(1234),
          accounting: {
            statefulParentUsed: true,
            retainedBaselineTokens: 900,
            incremental: {
              finalizedProjection: Object.freeze({ kind: 'test-incremental' }),
              legacyEstimate: () => Promise.resolve(334),
            },
          },
        }),
    });
    providerManager.registerProvider(delegate.provider);

    const lb = createLoadBalancer(providerManager);
    const projection = await lb.projectPromptEnvelope({ contents: [] });

    expect(projection?.accounting?.statefulParentUsed).toBe(true);
    expect(projection?.accounting?.retainedBaselineTokens).toBe(900);
    expect(await projection?.accounting?.incremental?.legacyEstimate()).toBe(
      334,
    );
  });
});
