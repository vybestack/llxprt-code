/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for load-balancer compression callback accounting and mixed
 * provider tokenizers (issue #2207).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import {
  LoadBalancerAllContextLimitsExceededError,
  LoadBalancerCompressionCallbackError,
} from '../loadBalancing/contextLimitError.js';

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

function createMockProvider(overrides: Partial<IProvider> = {}): IProvider {
  return {
    name: overrides.name ?? 'mock-provider',
    generateChatCompletion:
      overrides.generateChatCompletion ??
      async function* (): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
    getModels: overrides.getModels ?? (async () => []),
    getDefaultModel: overrides.getDefaultModel ?? (() => 'mock-model'),
    getServerTools: overrides.getServerTools ?? (() => []),
    invokeServerTool: overrides.invokeServerTool ?? (async () => ({})),
  };
}

function createCountingTokenizer(
  spy: (text: string) => void,
): RuntimeTokenizer {
  return {
    countTokens: (content: unknown) => {
      if (typeof content !== 'string') {
        return Promise.reject(
          new Error(`countTokens received non-string input: ${typeof content}`),
        );
      }
      spy(content);
      return Promise.resolve(Math.ceil(content.length / 4));
    },
  };
}

function createFixedTokenizer(tokens: number): RuntimeTokenizer {
  return {
    countTokens: () => Promise.resolve(tokens),
  };
}

function createTokenizerFactory(
  tokenizerMap: Record<string, RuntimeTokenizer>,
  reportSource?: (model: string) => void,
): RuntimeTokenizerFactory {
  return {
    getTokenizer: (
      _providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined => {
      const key = model ?? _providerName;
      if (reportSource) {
        reportSource(key);
      }
      return tokenizerMap[key];
    },
  };
}

async function consumeIterator(
  provider: LoadBalancingProvider,
  contents: IContent[],
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const chunk of provider.generateChatCompletion({
    contents,
  } as GenerateChatOptions)) {
    results.push(chunk);
  }
  return results;
}

describe('LoadBalancingProvider - compression accounting (issue #2207)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('compresses each failover target from the original request contents', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
      'claude-opus-4': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);

    const sentToAnthropic: IContent[][] = [];
    let openAiAttempts = 0;
    providerManager.registerProvider({
      name: 'openai',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        openAiAttempts++;
        yield* [];
        throw new Error('429 rate limited');
      },
      getModels: async () => [],
      getDefaultModel: () => 'gpt-4.1',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    });
    providerManager.registerProvider({
      name: 'anthropic',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        sentToAnthropic.push(structuredClone(options.contents));
        options.contents[0].blocks[0] = {
          type: 'text',
          text: 'mutated by delegate provider',
        };
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'claude-opus-4',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    });

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'failover-compression',
      strategy: 'failover',
      contextLimit: 4,
      lbProfileEphemeralSettings: {
        'failover-retry-count': 1,
        'failover-retry-delay-ms': 0,
      },
      subProfiles: [
        createResolvedSubProfile({
          name: 'gpt',
          providerName: 'openai',
          model: 'gpt-4.1',
        }),
        createResolvedSubProfile({
          name: 'opus',
          providerName: 'anthropic',
          model: 'claude-opus-4',
        }),
      ],
    };
    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const compressionInputs: IContent[][] = [];
    const compressionCallback = vi.fn(async (contents: IContent[]) => {
      compressionInputs.push(structuredClone(contents));
      contents[0].blocks[0] = {
        type: 'text',
        text: 'mutated during first compression attempt',
      };
      return [createTextContent('ok')];
    });
    provider.setCompressionCallback(compressionCallback);

    const originalContents = [
      createTextContent('this message needs compression'),
    ];
    await consumeIterator(provider, originalContents);

    expect(openAiAttempts).toBe(1);
    expect(compressionCallback).toHaveBeenCalledTimes(2);
    expect(compressionInputs).toStrictEqual([
      originalContents,
      originalContents,
    ]);
    expect(sentToAnthropic).toHaveLength(1);
    expect(sentToAnthropic[0][0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'ok',
    });
  });

  it('invokes compression callback when estimate exceeds limit', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });

    providerManager.setTokenizerFactory(factory);
    const sentToOpenAi: IContent[][] = [];
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          sentToOpenAi.push(structuredClone(options.contents));
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
      }),
    );

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'compress-test',
      strategy: 'round-robin',
      contextLimit: 10,
      subProfiles: [
        createResolvedSubProfile({
          name: 'gpt',
          providerName: 'openai',
          model: 'gpt-4.1',
        }),
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    const compressionCallback = vi.fn(async (_contents: IContent[]) => [
      createTextContent('compressed'),
    ]);
    provider.setCompressionCallback(compressionCallback);

    const result = await consumeIterator(provider, [
      createTextContent('this is a very long message that exceeds the limit'),
    ]);

    expect(compressionCallback).toHaveBeenCalledTimes(1);
    expect(sentToOpenAi).toStrictEqual([[createTextContent('compressed')]]);
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not trigger compression when estimate equals the limit exactly', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    const sentToOpenAi: IContent[][] = [];
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          sentToOpenAi.push(structuredClone(options.contents));
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
      }),
    );

    const provider = new LoadBalancingProvider(
      {
        profileName: 'boundary-test',
        strategy: 'round-robin',
        contextLimit: 3,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
        ],
      },
      providerManager,
    );
    const compressionCallback = vi.fn(async (contents: IContent[]) => contents);
    provider.setCompressionCallback(compressionCallback);

    await consumeIterator(provider, [createTextContent('abcdefghij')]);

    expect(compressionCallback).not.toHaveBeenCalled();
    expect(sentToOpenAi).toStrictEqual([[createTextContent('abcdefghij')]]);
  });

  it('throws when no compression callback is set and limit exceeded', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });

    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'no-callback-test',
      strategy: 'round-robin',
      contextLimit: 5,
      subProfiles: [
        createResolvedSubProfile({
          name: 'gpt',
          providerName: 'openai',
          model: 'gpt-4.1',
        }),
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    await expect(
      consumeIterator(provider, [
        createTextContent(
          'this is a very long message that will exceed the tiny limit',
        ),
      ]),
    ).rejects.toThrow(/context limit exceeded/i);
  });

  it('throws aggregate context-limit error when all failover targets exceed the limit', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createFixedTokenizer(50),
      'claude-opus-4': createFixedTokenizer(60),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));
    providerManager.registerProvider(createMockProvider({ name: 'anthropic' }));

    const provider = new LoadBalancingProvider(
      {
        profileName: 'aggregate-limit-test',
        strategy: 'failover',
        contextLimit: 10,
        lbProfileEphemeralSettings: {
          'failover-retry-count': 1,
          'failover-retry-delay-ms': 0,
        },
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
          createResolvedSubProfile({
            name: 'opus',
            providerName: 'anthropic',
            model: 'claude-opus-4',
          }),
        ],
      },
      providerManager,
    );

    await expect(
      consumeIterator(provider, [createTextContent('too large everywhere')]),
    ).rejects.toThrow(LoadBalancerAllContextLimitsExceededError);
  });

  it('propagates compression callback failures without failover retry', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createFixedTokenizer(50),
      'claude-opus-4': createFixedTokenizer(2),
    });
    providerManager.setTokenizerFactory(factory);
    const openAiCalls = vi.fn();
    const anthropicCalls = vi.fn();
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          openAiCalls();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
        },
      }),
    );
    providerManager.registerProvider(
      createMockProvider({
        name: 'anthropic',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          anthropicCalls();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
        },
      }),
    );

    const provider = new LoadBalancingProvider(
      {
        profileName: 'callback-failure-test',
        strategy: 'failover',
        contextLimit: 10,
        lbProfileEphemeralSettings: {
          'failover-retry-count': 1,
          'failover-retry-delay-ms': 0,
        },
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
          createResolvedSubProfile({
            name: 'opus',
            providerName: 'anthropic',
            model: 'claude-opus-4',
          }),
        ],
      },
      providerManager,
    );
    provider.setCompressionCallback(async () => {
      throw new Error('compression callback failed');
    });

    await expect(
      consumeIterator(provider, [createTextContent('needs compression')]),
    ).rejects.toThrow(LoadBalancerCompressionCallbackError);
    expect(openAiCalls).not.toHaveBeenCalled();
    expect(anthropicCalls).not.toHaveBeenCalled();
  });
  it('GPT-first with Opus failover uses GPT tokenizer then Opus on failover', async () => {
    const tokenizersUsed: string[] = [];
    const resolverEvents: string[] = [];
    const factory = createTokenizerFactory(
      {
        'gpt-4.1': createCountingTokenizer(() => {
          tokenizersUsed.push('gpt-4.1');
        }),
        'claude-opus-4': createCountingTokenizer(() => {
          tokenizersUsed.push('claude-opus-4');
        }),
      },
      (model) => resolverEvents.push(model),
    );

    providerManager.setTokenizerFactory(factory);

    let gptCallCount = 0;
    const gptProvider: IProvider = {
      name: 'openai',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        gptCallCount++;
        if (gptCallCount === 1) {
          throw new Error('429 rate limited');
        }
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'gpt-4.1',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    };
    providerManager.registerProvider(gptProvider);
    const anthropicCallCount = { value: 0 };
    providerManager.registerProvider(
      createMockProvider({
        name: 'anthropic',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          anthropicCallCount.value++;
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getDefaultModel: () => 'claude-opus-4',
      }),
    );

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'gptfirst',
      strategy: 'failover',
      contextLimit: 100000,
      lbProfileEphemeralSettings: {
        'failover-retry-count': 1,
        'failover-retry-delay-ms': 0,
      },
      subProfiles: [
        createResolvedSubProfile({
          name: 'gpt',
          providerName: 'openai',
          model: 'gpt-4.1',
          contextWindow: 128000,
        }),
        createResolvedSubProfile({
          name: 'opus',
          providerName: 'anthropic',
          model: 'claude-opus-4',
          contextWindow: 200000,
        }),
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    await consumeIterator(provider, [
      createTextContent('hello from mixed profile test'),
    ]);

    expect(anthropicCallCount.value).toBe(1);
    expect(gptCallCount).toBe(1);
    expect(resolverEvents).toContain('gpt-4.1');
    expect(resolverEvents).toContain('claude-opus-4');
    expect(tokenizersUsed).toContain('gpt-4.1');
    expect(tokenizersUsed).toContain('claude-opus-4');
    expect(tokenizersUsed.indexOf('gpt-4.1')).toBeLessThan(
      tokenizersUsed.indexOf('claude-opus-4'),
    );
  });
});
