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
  type LoadBalancerSubProfile,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  collectContents,
  isAsyncIterableContents,
  replayableContents,
} from '../utils/collectContents.js';
import { FailoverState } from '../loadBalancing/failoverState.js';
import { projectNextSubProfilePromptEnvelope } from '../loadBalancing/promptEnvelopeProjection.js';
import { resolveSubProfileModel } from '../loadBalancing/subProfileHelpers.js';

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
  /** Model of each send attempt this delegate served, in attempt order. */
  readonly sentModels: string[];
  readonly delegateTokens: object[];
}

function createProjectingDelegate(spec: {
  name: string;
  estimateTokens: (options: GenerateChatOptions) => number | Promise<number>;
  releaseIfUnsent?: () => Promise<void>;
  resolveProjection?: (
    options: GenerateChatOptions,
  ) => Promise<PromptEnvelopeProjection | undefined>;
  /** Fail (throw) the first N send attempts; projection still succeeds. */
  failFirstSends?: number;
  /** Report this many usage tokens on the sent chunk (TPM tracking). */
  usageTokens?: number;
}): ProjectingDelegate {
  const projectedOptions: GenerateChatOptions[] = [];
  const sentModels: string[] = [];
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
      optionsOrStream: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncGenerator<IContent> {
      if (isAsyncIterableContents(optionsOrStream)) {
        throw new Error('legacy positional overload is not exercised here');
      }
      const options = optionsOrStream;
      projectedOptions.push(options);
      sentModels.push(options.resolved?.model ?? spec.name);
      if (sentModels.length <= (spec.failFirstSends ?? 0)) {
        throw new Error(`delegate ${spec.name} send failed`);
      }
      const okChunk: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      };
      if (spec.usageTokens === undefined) {
        yield okChunk;
        return;
      }
      // Gemini wire usage shape: BackendMetricsCollector.extractTokenCount
      // reads this compat form off the last chunk; IContent itself keeps
      // usage in neutral metadata, so the wire fields need a cast here.
      yield {
        ...okChunk,
        usageMetadata: { promptTokenCount: spec.usageTokens },
      } as unknown as IContent;
    },
    getModels: async () => [],
    getDefaultModel: () => 'delegate-default',
  };
  return { provider, projectedOptions, sentModels, delegateTokens };
}

/** Serialize contents + tool schemas the way an envelope estimate would. */
async function serializedEnvelopeTokens(
  options: GenerateChatOptions,
): Promise<number> {
  const contents = await collectContents(options.contents);
  const contentText = contents
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
    const contents = replayableContents([createTextContent('hello envelope')]);

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

    const firstPeek = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(firstPeek?.model).toBe('model-a');

    // The peek did not consume the rotation: the next selection is still
    // sub-profile 'a'.
    expect(lb.selectNextSubProfile().name).toBe('a');

    // The peek reflects the new position only after the caller advanced it.
    const secondPeek = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(secondPeek?.model).toBe('model-b');

    // Selection wraps back to 'a'; the peek follows the rotation.
    expect(lb.selectNextSubProfile().name).toBe('b');
    const thirdPeek = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(thirdPeek?.model).toBe('model-a');
  });

  it('peeks the failover start index without mutating failover state', async () => {
    const delegate = createProjectingDelegate({
      name: 'openai',
      estimateTokens: async (options) => {
        const contents = await collectContents(options.contents);
        return Math.ceil(
          contents.map((content) => JSON.stringify(content.blocks)).join('')
            .length / 4,
        );
      },
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
      contents: replayableContents([
        createTextContent('a request payload far larger than five tokens'),
      ]),
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(lb.getCurrentFailoverIndex()).toBe(1);

    const projection = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(projection?.model).toBe('model-b');

    // Peeking did not move the failover index.
    expect(lb.getCurrentFailoverIndex()).toBe(1);
    const repeatPeek = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
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
      lb.projectPromptEnvelope({ contents: replayableContents([]) }),
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
      lb.projectPromptEnvelope({ contents: replayableContents([]) }),
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
      lb.projectPromptEnvelope({ contents: replayableContents([]) }),
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
      contents: replayableContents([createTextContent('token freshness')]),
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

    const first = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });
    expect(releases).toStrictEqual(['released-0']);
    expect('releaseIfUnsent' in (first ?? {})).toBe(false);

    // Each projection call releases its own delegate projection.
    await lb.projectPromptEnvelope({ contents: replayableContents([]) });
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

    await expect(
      lb.projectPromptEnvelope({ contents: replayableContents([]) }),
    ).rejects.toThrow('release exploded');
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
      contents: replayableContents([createTextContent('request')]),
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
      contents: replayableContents([createTextContent('analyze this request')]),
    });
    const withTools = await lb.projectPromptEnvelope({
      contents: replayableContents([createTextContent('analyze this request')]),
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
    const projection = await lb.projectPromptEnvelope({
      contents: replayableContents([]),
    });

    expect(projection?.accounting?.statefulParentUsed).toBe(true);
    expect(projection?.accounting?.retainedBaselineTokens).toBe(900);
    expect(await projection?.accounting?.incremental?.legacyEstimate()).toBe(
      334,
    );
  });

  describe('failover eligibility-aware peek (issue #3507, PR #3715)', () => {
    /**
     * Failover members with distinct delegate providers, so each member's
     * sends and projections are attributable to exactly one delegate. Each
     * carries an explicit baseURL: unknown provider names get no default
     * endpoint, and runtime normalization rejects a delegate resolution
     * without one.
     */
    function createFailoverMembers(): ResolvedSubProfile[] {
      return [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'prov-a',
          model: 'model-a',
          baseURL: 'https://a.example.test',
        }),
        createResolvedSubProfile({
          name: 'b',
          providerName: 'prov-b',
          model: 'model-b',
          baseURL: 'https://b.example.test',
        }),
        createResolvedSubProfile({
          name: 'c',
          providerName: 'prov-c',
          model: 'model-c',
          baseURL: 'https://c.example.test',
        }),
      ];
    }

    async function consumeSend(
      lb: LoadBalancingProvider,
      text: string,
    ): Promise<void> {
      for await (const _chunk of lb.generateChatCompletion({
        contents: replayableContents([createTextContent(text)]),
      })) {
        // consume
      }
    }

    it('skips a circuit-open start member and projects the next eligible member the next send attempts', async () => {
      const delegateA = createProjectingDelegate({
        name: 'prov-a',
        estimateTokens: () => 10,
        failFirstSends: 1,
      });
      const delegateB = createProjectingDelegate({
        name: 'prov-b',
        estimateTokens: () => 20,
      });
      providerManager.registerProvider(delegateA.provider);
      providerManager.registerProvider(delegateB.provider);

      const [a, b] = createFailoverMembers();
      const lb = createLoadBalancer(providerManager, {
        strategy: 'failover',
        lbProfileEphemeralSettings: {
          circuit_breaker_enabled: true,
          circuit_breaker_failure_threshold: 1,
          circuit_breaker_recovery_timeout_ms: 60000,
          failover_retry_count: 1,
        },
        subProfiles: [a, b],
      });

      // One failed send opens member 'a's circuit; the send lands on 'b'.
      await consumeSend(lb, 'first send');
      expect(lb.getStats().circuitBreakerStates.a.state).toBe('open');
      expect(lb.getCurrentFailoverIndex()).toBe(1);

      // Return the failover start index to the open-circuit member.
      lb.resetFailoverIndex();

      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents([]),
      });
      expect(projection?.model).toBe('model-b');

      // The peek consumed no selection state: the start index is unchanged,
      // and the next send starts from it — skipping the open-circuit 'a'
      // and attempting 'b' first, exactly the member the peek estimated.
      expect(lb.getCurrentFailoverIndex()).toBe(0);
      await consumeSend(lb, 'second send');
      expect(delegateB.sentModels).toStrictEqual(['model-b', 'model-b']);
      expect(delegateA.sentModels).toStrictEqual(['model-a']);
    });

    it('skips a TPM-ineligible start member (usage below threshold) and projects the next eligible member', async () => {
      const delegateA = createProjectingDelegate({
        name: 'prov-a',
        estimateTokens: () => 10,
        usageTokens: 100,
      });
      const delegateB = createProjectingDelegate({
        name: 'prov-b',
        estimateTokens: () => 20,
      });
      providerManager.registerProvider(delegateA.provider);
      providerManager.registerProvider(delegateB.provider);

      const [a, b] = createFailoverMembers();
      const lb = createLoadBalancer(providerManager, {
        strategy: 'failover',
        lbProfileEphemeralSettings: { tpm_threshold: 500 },
        subProfiles: [a, b],
      });

      // A successful send through 'a' records 100 usage tokens: its TPM is
      // positive but below the 500 threshold, so the send path skips it.
      await consumeSend(lb, 'tpm seeding send');
      const tpm = lb.getStats().currentTPM.a;
      expect(tpm).toBeGreaterThan(0);
      expect(tpm).toBeLessThan(500);
      expect(lb.getCurrentFailoverIndex()).toBe(0);

      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents([]),
      });
      expect(projection?.model).toBe('model-b');
      expect(lb.getCurrentFailoverIndex()).toBe(0);
    });

    it('targets the eligible start member when tpmThreshold is 0 (usage history never causes a skip)', async () => {
      const delegateA = createProjectingDelegate({
        name: 'prov-a',
        estimateTokens: () => 10,
        usageTokens: 100,
      });
      providerManager.registerProvider(delegateA.provider);

      const [a, b] = createFailoverMembers();
      const lb = createLoadBalancer(providerManager, {
        strategy: 'failover',
        lbProfileEphemeralSettings: { tpm_threshold: 0 },
        subProfiles: [a, b],
      });

      await consumeSend(lb, 'tpm seeding send');
      expect(lb.getStats().currentTPM.a).toBeGreaterThan(0);

      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents([]),
      });
      expect(projection?.model).toBe('model-a');
      expect(lb.getCurrentFailoverIndex()).toBe(0);
    });

    it('falls back to the start-index member when every member is ineligible, without throwing', async () => {
      const delegateA = createProjectingDelegate({
        name: 'prov-a',
        estimateTokens: () => 10,
        failFirstSends: 99,
      });
      const delegateB = createProjectingDelegate({
        name: 'prov-b',
        estimateTokens: () => 20,
        failFirstSends: 99,
      });
      providerManager.registerProvider(delegateA.provider);
      providerManager.registerProvider(delegateB.provider);

      const [a, b] = createFailoverMembers();
      const lb = createLoadBalancer(providerManager, {
        strategy: 'failover',
        lbProfileEphemeralSettings: {
          circuit_breaker_enabled: true,
          circuit_breaker_failure_threshold: 1,
          circuit_breaker_recovery_timeout_ms: 60000,
          failover_retry_count: 1,
        },
        subProfiles: [a, b],
      });

      // Every send fails: both circuits open and the send throws its
      // aggregate error (the send path's business, never the peek's).
      let sendError: unknown;
      try {
        await consumeSend(lb, 'doomed send');
      } catch (error) {
        sendError = error;
      }
      expect(sendError).toBeInstanceOf(Error);
      const stats = lb.getStats();
      expect(stats.circuitBreakerStates.a.state).toBe('open');
      expect(stats.circuitBreakerStates.b.state).toBe('open');

      lb.resetFailoverIndex();
      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents([]),
      });
      expect(projection?.model).toBe('model-a');
      expect(lb.getCurrentFailoverIndex()).toBe(0);
    });

    it('reads circuit state without stealing the half-open recovery probe from the next send', async () => {
      const delegateA = createProjectingDelegate({
        name: 'prov-a',
        estimateTokens: () => 10,
        failFirstSends: 1,
      });
      const delegateB = createProjectingDelegate({
        name: 'prov-b',
        estimateTokens: () => 20,
      });
      providerManager.registerProvider(delegateA.provider);
      providerManager.registerProvider(delegateB.provider);

      const [a, b] = createFailoverMembers();
      const lb = createLoadBalancer(providerManager, {
        strategy: 'failover',
        lbProfileEphemeralSettings: {
          circuit_breaker_enabled: true,
          circuit_breaker_failure_threshold: 1,
          circuit_breaker_recovery_timeout_ms: 100,
          failover_retry_count: 1,
        },
        subProfiles: [a, b],
      });

      // Open member 'a's circuit, then let its recovery window elapse.
      await consumeSend(lb, 'circuit opening send');
      expect(lb.getStats().circuitBreakerStates.a.state).toBe('open');
      await new Promise((resolve) => setTimeout(resolve, 150));
      lb.resetFailoverIndex();

      // The recovery window elapsed, so the pure eligibility read finds 'a'
      // eligible again and the peek projects it as the next target.
      const projection = await lb.projectPromptEnvelope({
        contents: replayableContents([]),
      });
      expect(projection?.model).toBe('model-a');

      // The peek left the circuit 'open': a mutating health read would have
      // entered 'half-open' and consumed the single recovery probe.
      expect(lb.getStats().circuitBreakerStates.a.state).toBe('open');

      // The next SEND consumes the probe and retries 'a'; success closes it.
      await consumeSend(lb, 'recovery probe send');
      expect(delegateA.sentModels).toStrictEqual(['model-a', 'model-a']);
      expect(lb.getStats().circuitBreakerStates.a.state).toBe('closed');
    });
  });

  describe('projectNextSubProfilePromptEnvelope eligibility traversal (issue #3507, PR #3715)', () => {
    function unitMembers(providerName: string): ResolvedSubProfile[] {
      return ['a', 'b', 'c'].map((name) =>
        createResolvedSubProfile({
          name,
          providerName,
          model: `model-${name}`,
          // Unknown provider names carry no default endpoint; normalization
          // requires an explicit baseURL on the delegate resolution.
          baseURL: 'https://unit.example.test',
        }),
      );
    }

    /** Resolve like the provider does: member model + auth onto `resolved`. */
    function unitResolvedOptions(
      subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
      options: GenerateChatOptions,
    ): GenerateChatOptions {
      return {
        ...options,
        resolved: {
          model: resolveSubProfileModel(subProfile),
          baseURL: subProfile.baseURL,
          authToken: subProfile.authToken,
        },
      };
    }

    it('round-robin peek never consults the eligibility predicate', async () => {
      const delegate = createProjectingDelegate({
        name: 'prov',
        estimateTokens: () => 10,
      });
      providerManager.registerProvider(delegate.provider);

      const projection = await projectNextSubProfilePromptEnvelope({
        config: {
          profileName: 'unit-lb',
          strategy: 'round-robin',
          subProfiles: unitMembers('prov'),
        },
        providerManager,
        failoverState: new FailoverState(),
        roundRobinIndex: 0,
        isBackendEligible: () => {
          throw new Error('round-robin peek must not consult eligibility');
        },
        buildDelegateResolvedOptions: unitResolvedOptions,
        options: { contents: replayableContents([]) },
      });

      expect(projection?.model).toBe('model-a');
    });

    it('failover traversal wraps circularly to the first eligible member without moving the start index', async () => {
      const delegate = createProjectingDelegate({
        name: 'prov',
        estimateTokens: () => 10,
      });
      providerManager.registerProvider(delegate.provider);

      const failoverState = new FailoverState();
      const { owner } = failoverState.claim();
      failoverState.setIfOwner(owner, 2);

      const projection = await projectNextSubProfilePromptEnvelope({
        config: {
          profileName: 'unit-lb',
          strategy: 'failover',
          subProfiles: unitMembers('prov'),
        },
        providerManager,
        failoverState,
        roundRobinIndex: 0,
        isBackendEligible: (name) => name === 'a',
        buildDelegateResolvedOptions: unitResolvedOptions,
        options: { contents: replayableContents([]) },
      });

      // Only 'a' passes the predicate, so the traversal from index 2 wraps
      // around the circle to index 0 — and leaves the start index alone.
      expect(projection?.model).toBe('model-a');
      expect(failoverState.getIndex()).toBe(2);
    });
  });
});
