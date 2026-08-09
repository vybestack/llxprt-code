/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for load-balancer system-prompt model rendering (issue #3157).
 *
 * The load balancer selects a sub-profile per request and overwrites
 * resolved.model with that sub-profile's model. These tests assert that the
 * system instruction the delegate receives renders the SAME model that
 * resolved.model carries — for both round-robin and failover strategies —
 * and that the LB's own prompt projection/accounting observes the same
 * prompt it transmits.
 *
 * Anti-mock-theater: every assertion is against the actual
 * GenerateChatOptions the delegate provider receives and the prompt text it
 * actually gets — the observable contract between the balancer and its
 * backend.
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
import { LoadBalancerFailoverError } from '../errors.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';

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

interface CapturingProvider extends IProvider {
  readonly captured: GenerateChatOptions[];
}

function createCapturingProvider(name: string): CapturingProvider {
  const captured: GenerateChatOptions[] = [];
  return {
    name,
    captured,
    async *generateChatCompletion(
      options: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent> {
      if (Array.isArray(options)) {
        throw new Error(
          'legacy array overload of generateChatCompletion is not exercised by these tests',
        );
      }
      captured.push(options);
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => 'test',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  };
}

/**
 * Assembler that records every model it is asked to render, so tests can
 * assert invocation counts (at-most-once per selected attempt).
 */
function trackingAssembler(render: (model: string) => string): {
  assembler: { assemble: (model: string) => Promise<string> };
  invocations: string[];
} {
  const invocations: string[] = [];
  const assembler = {
    assemble: async (model: string): Promise<string> => {
      invocations.push(model);
      return render(model);
    },
  };
  return { assembler, invocations };
}

async function consume(
  provider: LoadBalancingProvider,
  options: GenerateChatOptions,
): Promise<void> {
  for await (const _ of provider.generateChatCompletion(options)) {
    // exhaust
  }
}

function createTokenizerFactory(
  tokenizerMap: Record<string, RuntimeTokenizer>,
): RuntimeTokenizerFactory {
  return {
    getTokenizer: (
      _providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined => tokenizerMap[model ?? _providerName],
    async estimatePrompt(request) {
      return {
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'legacy-unregistered',
        estimatorVersion: 'core-estimate-tokens-v1',
        assetRevision: 'none',
        projectionRevision: request.projectionRevision,
      };
    },
  };
}

describe('LoadBalancingProvider - system prompt model rendering (issue #3157)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  describe('Round-robin', () => {
    it('renders the selected sub-profile model on every selection, not the parent name', async () => {
      const delegateA = createCapturingProvider('openai');
      const delegateB = createCapturingProvider('anthropic');
      providerManager.registerProvider(delegateA);
      providerManager.registerProvider(delegateB);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'rr-model-render',
          strategy: 'round-robin',
          contextLimit: 1_000_000,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
            createResolvedSubProfile({
              name: 'b',
              providerName: 'anthropic',
              model: 'model-b',
            }),
          ],
        },
        providerManager,
      );

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      await consume(lb, {
        contents: [createTextContent('first')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });
      await consume(lb, {
        contents: [createTextContent('second')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // Two different models across the two selections.
      expect(delegateA.captured).toHaveLength(1);
      expect(delegateB.captured).toHaveLength(1);
      expect(delegateA.captured[0].resolved?.model).toBe('model-a');
      expect(delegateB.captured[0].resolved?.model).toBe('model-b');

      // Rendered model equals resolved.model on each request.
      expect(delegateA.captured[0].systemInstruction).toBe('[model=model-a]');
      expect(delegateA.captured[0].systemInstruction).toBe(
        `[model=${delegateA.captured[0].resolved?.model}]`,
      );
      expect(delegateB.captured[0].systemInstruction).toBe('[model=model-b]');
      expect(delegateB.captured[0].systemInstruction).toBe(
        `[model=${delegateB.captured[0].resolved?.model}]`,
      );

      // Assembler invoked exactly once per selected request.
      expect(invocations).toEqual(['model-a', 'model-b']);
    });

    it('two members on the same model: each request still renders that model', async () => {
      const delegate = createCapturingProvider('openai');
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'rr-same-model',
          strategy: 'round-robin',
          contextLimit: 1_000_000,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'shared-model',
            }),
            createResolvedSubProfile({
              name: 'b',
              providerName: 'openai',
              model: 'shared-model',
            }),
          ],
        },
        providerManager,
      );

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      await consume(lb, {
        contents: [createTextContent('first')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });
      await consume(lb, {
        contents: [createTextContent('second')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // Both requests resolved the same shared model.
      expect(delegate.captured).toHaveLength(2);
      expect(delegate.captured[0].resolved?.model).toBe('shared-model');
      expect(delegate.captured[1].resolved?.model).toBe('shared-model');

      // Each rendered prompt equals resolved.model — uniform rule, no special
      // case for homogeneous pools.
      expect(delegate.captured[0].systemInstruction).toBe(
        '[model=shared-model]',
      );
      expect(delegate.captured[0].systemInstruction).toBe(
        `[model=${delegate.captured[0].resolved?.model}]`,
      );
      expect(delegate.captured[1].systemInstruction).toBe(
        '[model=shared-model]',
      );
      expect(delegate.captured[1].systemInstruction).toBe(
        `[model=${delegate.captured[1].resolved?.model}]`,
      );

      // One render per selected request.
      expect(invocations).toEqual(['shared-model', 'shared-model']);
    });
  });

  describe('Failover', () => {
    it('the transmitting backend receives its own rendered model after the primary fails', async () => {
      const primaryCaptured: GenerateChatOptions[] = [];
      const secondaryCaptured: GenerateChatOptions[] = [];
      let primaryAttempts = 0;

      const primary: IProvider = {
        name: 'openai',
        async *generateChatCompletion(
          options: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          if (Array.isArray(options)) {
            throw new Error(
              'legacy array overload of generateChatCompletion is not exercised by these tests',
            );
          }
          primaryCaptured.push(options);
          primaryAttempts++;
          if (primaryAttempts === 1) {
            throw new Error('primary down');
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-a',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };
      const secondary: IProvider = {
        name: 'anthropic',
        async *generateChatCompletion(
          options: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          if (Array.isArray(options)) {
            throw new Error(
              'legacy array overload of generateChatCompletion is not exercised by these tests',
            );
          }
          secondaryCaptured.push(options);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-b',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };
      providerManager.registerProvider(primary);
      providerManager.registerProvider(secondary);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'failover-model-render',
          strategy: 'failover',
          contextLimit: 1_000_000,
          lbProfileEphemeralSettings: {
            failover_retry_count: 1,
            failover_retry_delay_ms: 0,
          },
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
            createResolvedSubProfile({
              name: 'b',
              providerName: 'anthropic',
              model: 'model-b',
            }),
          ],
        },
        providerManager,
      );

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      await consume(lb, {
        contents: [createTextContent('request')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // The secondary backend transmitted.
      expect(secondaryCaptured).toHaveLength(1);
      expect(secondaryCaptured[0].resolved?.model).toBe('model-b');
      expect(secondaryCaptured[0].systemInstruction).toBe('[model=model-b]');
      expect(secondaryCaptured[0].systemInstruction).toBe(
        `[model=${secondaryCaptured[0].resolved?.model}]`,
      );

      // Each attempted backend was rendered once.
      expect(invocations).toEqual(['model-a', 'model-b']);
    });

    it('re-renders once per retry attempt on the same backend when retryCount > 1 (pre-yield failure)', async () => {
      const captured: GenerateChatOptions[] = [];
      let attempts = 0;
      const delegate: IProvider = {
        name: 'openai',
        async *generateChatCompletion(
          options: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          if (Array.isArray(options)) {
            throw new Error(
              'legacy array overload of generateChatCompletion is not exercised by these tests',
            );
          }
          captured.push(options);
          attempts++;
          if (attempts === 1) {
            const err = new Error('rate limited') as Error & {
              status: number;
            };
            err.status = 429;
            throw err;
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-a',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'failover-retry-same-backend',
          strategy: 'failover',
          contextLimit: 1_000_000,
          lbProfileEphemeralSettings: {
            failover_retry_count: 2,
            failover_retry_delay_ms: 0,
          },
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
        },
        providerManager,
      );

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      await consume(lb, {
        contents: [createTextContent('request')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // The same backend was attempted twice (first failed pre-yield, second
      // succeeded) — both invocations are model-a, proving the retry stayed on
      // sub-profile 'a' rather than advancing to 'b'.
      expect(captured).toHaveLength(2);
      expect(invocations).toEqual(['model-a', 'model-a']);

      // The successful (second) attempt rendered its own model.
      expect(captured[1].systemInstruction).toBe('[model=model-a]');
      expect(captured[1].systemInstruction).toBe(
        `[model=${captured[1].resolved?.model}]`,
      );
    });
  });

  describe('Prompt projection observes what is sent', () => {
    it('projectPromptEnvelope and transport both see the sub-profile-rendered prompt', async () => {
      const projectedSystemInstructions: string[] = [];
      const sentSystemInstructions: string[] = [];

      const delegate: IProvider = {
        name: 'openai',
        async projectPromptEnvelope(options: GenerateChatOptions) {
          projectedSystemInstructions.push(
            options.systemInstruction ?? '<none>',
          );
          return {
            model: options.resolved?.model ?? 'model-a',
            protocol: 'openai-responses',
            method: 'responses/v1',
            projectionRevision: 1,
            unsupportedMedia: [],
            transportToken: Object.freeze({
              seq: projectedSystemInstructions.length,
            }),
            finalizedProjection: Object.freeze({
              kind: 'test',
              protocol: 'test',
              promptText: 'proj',
            }),
            legacyEstimate: () => Promise.resolve(5),
          };
        },
        async *generateChatCompletion(
          options: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          if (Array.isArray(options)) {
            throw new Error(
              'legacy array overload of generateChatCompletion is not exercised by these tests',
            );
          }
          sentSystemInstructions.push(options.systemInstruction ?? '<none>');
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-a',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      providerManager.setTokenizerFactory(createTokenizerFactory({}));
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'projection-model-render',
          strategy: 'round-robin',
          contextLimit: 100,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
          ],
        },
        providerManager,
      );

      const { assembler } = trackingAssembler((m) => `[model=${m}]`);

      await consume(lb, {
        contents: [createTextContent('request')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // Projection and transport both saw the sub-profile-rendered prompt.
      expect(projectedSystemInstructions).toEqual(['[model=model-a]']);
      expect(sentSystemInstructions).toEqual(['[model=model-a]']);
    });
  });

  describe('Assembler rejection (fail-fast, no swallowing)', () => {
    it('round-robin propagates a rejecting assembler without a try/catch swallow', async () => {
      const delegate = createCapturingProvider('openai');
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'rejecting-assembler-rr',
          strategy: 'round-robin',
          contextLimit: 1_000_000,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
          ],
        },
        providerManager,
      );

      const { assembler } = trackingAssembler(() => {
        throw new Error('assembler rejected');
      });

      await expect(
        consume(lb, {
          contents: [createTextContent('request')],
          systemInstruction: '[model=load-balancer]',
          systemPromptAssembler: assembler,
        }),
      ).rejects.toThrow('assembler rejected');

      // The rejection happened before delegation, so the delegate was never
      // called.
      expect(delegate.captured).toHaveLength(0);
    });

    it('failover aggregates a rejecting assembler into LoadBalancerFailoverError without swallowing it', async () => {
      const delegate = createCapturingProvider('openai');
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'rejecting-assembler-failover',
          strategy: 'failover',
          contextLimit: 1_000_000,
          lbProfileEphemeralSettings: {
            failover_retry_count: 1,
            failover_retry_delay_ms: 0,
          },
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
        },
        providerManager,
      );

      const { assembler, invocations } = trackingAssembler(() => {
        throw new Error('assembler rejected');
      });

      let thrown: unknown;
      try {
        await consume(lb, {
          contents: [createTextContent('request')],
          systemInstruction: '[model=load-balancer]',
          systemPromptAssembler: assembler,
        });
      } catch (e) {
        thrown = e;
      }

      // The aggregate carries the rejection; it is not swallowed.
      expect(thrown).toBeInstanceOf(LoadBalancerFailoverError);
      const aggregate = thrown as LoadBalancerFailoverError;
      expect(aggregate.message).toContain('assembler rejected');
      expect(aggregate.failures.length).toBe(2);

      // The assembler was invoked once per backend attempt.
      expect(invocations).toEqual(['model-a', 'model-b']);

      // The delegate was never reached.
      expect(delegate.captured).toHaveLength(0);
    });
  });

  describe('Compression callback path', () => {
    it('pre-compression projection, post-compression projection, and final delegate all observe the selected-model prompt; transmitted token is the post-compression projection token', async () => {
      const projectedSystemInstructions: string[] = [];
      const projectionTokens: object[] = [];
      const sentSystemInstructions: string[] = [];
      const sentTokens: Array<object | undefined> = [];

      const delegate: IProvider = {
        name: 'openai',
        async projectPromptEnvelope(options: GenerateChatOptions) {
          const transportToken = Object.freeze({
            seq: projectionTokens.length,
          });
          projectionTokens.push(transportToken);
          projectedSystemInstructions.push(
            options.systemInstruction ?? '<none>',
          );
          return {
            model: options.resolved?.model ?? 'model-a',
            protocol: 'openai-responses',
            method: 'responses/v1',
            projectionRevision: 1,
            unsupportedMedia: [],
            transportToken,
            finalizedProjection: Object.freeze({
              kind: 'test',
              protocol: 'test',
              promptText: 'proj',
            }),
            legacyEstimate: () =>
              Promise.resolve(
                options.contents.some((content) =>
                  content.blocks.some(
                    (block) =>
                      block.type === 'text' && block.text === 'compressed',
                  ),
                )
                  ? 5
                  : 20,
              ),
          };
        },
        async *generateChatCompletion(
          options: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          if (Array.isArray(options)) {
            throw new Error(
              'legacy array overload of generateChatCompletion is not exercised by these tests',
            );
          }
          sentSystemInstructions.push(options.systemInstruction ?? '<none>');
          sentTokens.push(options.promptEnvelopeTransportToken);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-a',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      providerManager.setTokenizerFactory(createTokenizerFactory({}));
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'compression-model-render',
          strategy: 'round-robin',
          contextLimit: 10,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
          ],
        },
        providerManager,
      );
      lb.setCompressionCallback(async () => [createTextContent('compressed')]);

      const { assembler } = trackingAssembler((m) => `[model=${m}]`);

      await consume(lb, {
        contents: [createTextContent('large request')],
        systemInstruction: '[model=load-balancer]',
        systemPromptAssembler: assembler,
      });

      // Two projections fired: pre-compression (over-limit) and
      // post-compression (under-limit). Both observed the selected-model prompt.
      expect(projectedSystemInstructions).toEqual([
        '[model=model-a]',
        '[model=model-a]',
      ]);

      // The final delegate transport saw the same selected-model prompt.
      expect(sentSystemInstructions).toEqual(['[model=model-a]']);

      // Two projection tokens were created; only the post-compression token
      // was transmitted to the delegate.
      expect(projectionTokens).toHaveLength(2);
      expect(sentTokens).toStrictEqual([projectionTokens[1]]);
    });
  });

  describe('Guard cases', () => {
    it('no assembler on options: delegate receives the caller systemInstruction byte-identical', async () => {
      const delegate = createCapturingProvider('openai');
      providerManager.registerProvider(delegate);

      const lb = new LoadBalancingProvider(
        {
          profileName: 'no-assembler',
          strategy: 'round-robin',
          contextLimit: 1_000_000,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
          ],
        },
        providerManager,
      );

      await consume(lb, {
        contents: [createTextContent('request')],
        systemInstruction: 'CALLER_PROMPT',
      });

      expect(delegate.captured[0].systemInstruction).toBe('CALLER_PROMPT');
    });

    it('assembler present but no systemInstruction: delegate receives undefined and the LB originates nothing', async () => {
      const delegate = createCapturingProvider('openai');
      providerManager.registerProvider(delegate);

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      const lb = new LoadBalancingProvider(
        {
          profileName: 'no-instruction',
          strategy: 'round-robin',
          contextLimit: 1_000_000,
          subProfiles: [
            createResolvedSubProfile({
              name: 'a',
              providerName: 'openai',
              model: 'model-a',
            }),
          ],
        },
        providerManager,
      );

      await consume(lb, {
        contents: [createTextContent('request')],
        systemPromptAssembler: assembler,
      });

      expect(delegate.captured[0].systemInstruction).toBeUndefined();
      expect(invocations).toEqual([]);
    });

    it('legacy sub-profile without modelId: prompt untouched and assembler never invoked', async () => {
      const delegate = createCapturingProvider('legacy-prov');
      providerManager.registerProvider(delegate);

      const { assembler, invocations } = trackingAssembler(
        (m) => `[model=${m}]`,
      );

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'legacy-no-modelid',
        strategy: 'round-robin',
        contextLimit: 1_000_000,
        subProfiles: [
          {
            name: 'legacy',
            providerName: 'legacy-prov',
            baseURL: 'https://legacy.test',
            authToken: 'tok',
          },
        ],
      };

      const lb = new LoadBalancingProvider(lbConfig, providerManager);

      await consume(lb, {
        contents: [createTextContent('request')],
        systemInstruction: 'CALLER_PROMPT',
        systemPromptAssembler: assembler,
      });

      expect(delegate.captured[0].systemInstruction).toBe('CALLER_PROMPT');
      expect(invocations).toEqual([]);
    });
  });
});
