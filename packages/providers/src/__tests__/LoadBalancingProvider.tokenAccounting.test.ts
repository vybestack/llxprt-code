/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for load-balancer token accounting using the active
 * subprofile tokenizer (issue #2207).
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
): RuntimeTokenizerFactory {
  return {
    getTokenizer: (
      _providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined => tokenizerMap[model ?? _providerName],
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

function setupTwoTargetFailoverGuard(providerManager: ProviderManager): {
  provider: LoadBalancingProvider;
  openAiCalls: ReturnType<typeof vi.fn>;
  anthropicCalls: ReturnType<typeof vi.fn>;
} {
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
      getDefaultModel: () => 'gpt-4.1',
    }),
  );
  providerManager.registerProvider(
    createMockProvider({
      name: 'anthropic',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        anthropicCalls();
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
    }),
  );

  return {
    provider: new LoadBalancingProvider(
      {
        profileName: 'two-target-failover-guard',
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
    ),
    openAiCalls,
    anthropicCalls,
  };
}
describe('LoadBalancingProvider - Token Accounting (issue #2207)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  describe('Shared context limit fallback', () => {
    it('uses explicit contextLimit when configured', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'explicit-limit',
        strategy: 'round-robin',
        contextLimit: 50000,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
            contextWindow: 128000,
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const models = await provider.getModels();
      expect(models[0].contextWindow).toBe(50000);
    });

    it('falls back to min member contextWindow when no explicit limit', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'min-window',
        strategy: 'round-robin',
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
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
      const models = await provider.getModels();
      expect(models[0].contextWindow).toBe(128000);
    });

    it('returns undefined when no explicit limit and no known member windows', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'no-windows',
        strategy: 'round-robin',
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            contextWindow: undefined,
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const models = await provider.getModels();
      expect(models[0].contextWindow).toBeUndefined();
    });
  });

  describe('Active subprofile tokenizer estimation', () => {
    it('uses selected subprofile model tokenizer, not generic JSON estimate', async () => {
      const gptTokenizerUsed = vi.fn();
      const factory = createTokenizerFactory({
        'gpt-4.1': createCountingTokenizer((text) => gptTokenizerUsed(text)),
      });

      providerManager.setTokenizerFactory(factory);
      providerManager.registerProvider(createMockProvider({ name: 'openai' }));

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'tokenizer-test',
        strategy: 'round-robin',
        contextLimit: 1_000_000,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const contents = [createTextContent('hello world this is a test')];
      await consumeIterator(provider, contents);

      expect(gptTokenizerUsed).toHaveBeenCalledWith(
        'hello world this is a test',
      );
    });

    it('records accounting source for diagnostics after estimation', async () => {
      const factory = createTokenizerFactory({
        'gpt-4.1': createCountingTokenizer(() => {}),
      });

      providerManager.setTokenizerFactory(factory);
      providerManager.registerProvider(createMockProvider({ name: 'openai' }));

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'source-test',
        strategy: 'round-robin',
        contextLimit: 1_000_000,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      await consumeIterator(provider, [createTextContent('test')]);

      const stats = provider.getTokenAccountingDiagnostics();
      expect(stats.accountingSource).toBe('gpt-4.1 (tokenizer)');
      expect(stats.lastEstimatedTokens).toBe(1);
    });

    it('falls back to generic estimate when tokenizer cannot be resolved', async () => {
      providerManager.registerProvider(createMockProvider({ name: 'unknown' }));

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'fallback-test',
        strategy: 'round-robin',
        contextLimit: 1_000_000,
        subProfiles: [
          createResolvedSubProfile({
            name: 'unknown-sub',
            providerName: 'unknown',
            model: 'unknown-model',
            baseURL: 'https://example.test/v1',
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      await consumeIterator(provider, [createTextContent('test content')]);

      const stats = provider.getTokenAccountingDiagnostics();
      expect(stats.accountingSource).toMatch(/generic.*fallback/i);
      expect(stats.lastEstimatedTokens).toBeGreaterThan(0);
    });

    it('falls back per content when resolved tokenizer throws while counting', async () => {
      providerManager.setTokenizerFactory(
        createTokenizerFactory({
          'gpt-4.1': {
            countTokens: () =>
              Promise.reject(new Error('tokenizer unavailable')),
          },
        }),
      );
      providerManager.registerProvider(createMockProvider({ name: 'openai' }));

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'throwing-tokenizer-test',
        strategy: 'round-robin',
        contextLimit: 1_000_000,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
          }),
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      await consumeIterator(provider, [createTextContent('test content')]);

      const stats = provider.getTokenAccountingDiagnostics();
      expect(stats.accountingSource).toBe('gpt-4.1 (tokenizer)');
      expect(stats.lastEstimatedTokens).toBeGreaterThan(0);
    });
  });

  it('handles empty contents array without throwing', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));

    const provider = new LoadBalancingProvider(
      {
        profileName: 'empty-contents',
        strategy: 'round-robin',
        contextLimit: 10,
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

    await consumeIterator(provider, []);
    expect(provider.getTokenAccountingDiagnostics().lastEstimatedTokens).toBe(
      0,
    );
  });

  it('treats zero contextLimit as absent and uses member context window', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'zero-limit-fallback',
      strategy: 'round-robin',
      contextLimit: 0,
      subProfiles: [
        createResolvedSubProfile({
          name: 'gpt',
          providerName: 'openai',
          model: 'gpt-4.1',
          contextWindow: 1000,
        }),
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    await consumeIterator(provider, [createTextContent('small message')]);

    expect(provider.getTokenAccountingDiagnostics().sharedContextLimit).toBe(
      1000,
    );
  });

  it('advances round-robin when selected request is rejected before send', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
      'claude-opus-4': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));
    providerManager.registerProvider(createMockProvider({ name: 'anthropic' }));

    const lbConfig: LoadBalancingProviderConfig = {
      // Counting tokenizer estimates 9 tokens for this text (ceil(35/4)), exceeding the limit of 3.
      profileName: 'round-robin-rejection',
      strategy: 'round-robin',
      contextLimit: 3,
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

    await expect(
      consumeIterator(provider, [
        createTextContent('this rejected request is too large'),
      ]),
    ).rejects.toThrow(/context limit exceeded/i);

    await consumeIterator(provider, [createTextContent('ok')]);
    expect(provider.getTokenAccountingDiagnostics().selectedSubProfile).toBe(
      'opus',
    );
  });

  it('skips failover targets rejected by local context guard before provider call or metrics', async () => {
    const { provider, openAiCalls, anthropicCalls } =
      setupTwoTargetFailoverGuard(providerManager);

    await consumeIterator(provider, [createTextContent('large request')]);

    const stats = provider.getStats();
    expect(openAiCalls).not.toHaveBeenCalled();
    expect(stats.backendMetrics.gpt).toBeUndefined();
    expect(anthropicCalls).toHaveBeenCalledTimes(1);
    expect(stats.circuitBreakerStates.gpt).toBeUndefined();
    expect(stats.lastSelected).toBe('opus');
  });

  it('continues failover when compression callback fails for one target', async () => {
    const { provider, openAiCalls, anthropicCalls } =
      setupTwoTargetFailoverGuard(providerManager);
    const compressionCallback = vi.fn(async () => {
      throw new Error('compression unavailable');
    });
    provider.setCompressionCallback(compressionCallback);

    const results = await consumeIterator(provider, [
      createTextContent('large request'),
    ]);

    expect(compressionCallback).toHaveBeenCalledTimes(1);
    expect(openAiCalls).not.toHaveBeenCalled();
    expect(anthropicCalls).toHaveBeenCalledTimes(1);
    expect(results).toStrictEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
    ]);
    expect(provider.getStats().lastSelected).toBe('opus');
  });

  it('uses target contextWindow when explicit limit is larger than selected backend window', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createFixedTokenizer(50),
    });
    providerManager.setTokenizerFactory(factory);
    const openAiCalls = vi.fn();
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          openAiCalls();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
        },
        getDefaultModel: () => 'gpt-4.1',
      }),
    );

    const provider = new LoadBalancingProvider(
      {
        profileName: 'round-robin-target-window',
        strategy: 'round-robin',
        contextLimit: 100,
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
            contextWindow: 10,
          }),
        ],
      },
      providerManager,
    );

    await expect(
      consumeIterator(provider, [createTextContent('too large for backend')]),
    ).rejects.toThrow(/estimated 50 tokens exceeds configured limit 10/i);

    expect(openAiCalls).not.toHaveBeenCalled();
    expect(provider.getStats().totalRequests).toBe(0);
  });

  it('uses each failover target contextWindow when explicit limit is larger', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createFixedTokenizer(50),
      'claude-opus-4': createFixedTokenizer(60),
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
        getDefaultModel: () => 'gpt-4.1',
      }),
    );
    providerManager.registerProvider(
      createMockProvider({
        name: 'anthropic',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          anthropicCalls();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
        },
        getDefaultModel: () => 'claude-opus-4',
      }),
    );

    const provider = new LoadBalancingProvider(
      {
        profileName: 'failover-target-window',
        strategy: 'failover',
        contextLimit: 100,
        lbProfileEphemeralSettings: {
          'failover-retry-count': 1,
          'failover-retry-delay-ms': 0,
        },
        subProfiles: [
          createResolvedSubProfile({
            name: 'gpt',
            providerName: 'openai',
            model: 'gpt-4.1',
            contextWindow: 10,
          }),
          createResolvedSubProfile({
            name: 'opus',
            providerName: 'anthropic',
            model: 'claude-opus-4',
            contextWindow: 20,
          }),
        ],
      },
      providerManager,
    );

    await expect(
      consumeIterator(provider, [createTextContent('too large everywhere')]),
    ).rejects.toThrow(
      /context limit exceeded for all eligible backends.*gpt.*50.*10.*opus.*60.*20/i,
    );

    expect(openAiCalls).not.toHaveBeenCalled();
    expect(anthropicCalls).not.toHaveBeenCalled();
    expect(provider.getStats().totalRequests).toBe(0);
  });

  it('reports all local failover context-limit rejections clearly', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createFixedTokenizer(50),
      'claude-opus-4': createFixedTokenizer(60),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(createMockProvider({ name: 'openai' }));
    providerManager.registerProvider(createMockProvider({ name: 'anthropic' }));

    const provider = new LoadBalancingProvider(
      {
        profileName: 'all-local-reject',
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
      consumeIterator(provider, [createTextContent('too large')]),
    ).rejects.toThrow(
      /context limit exceeded for all eligible backends.*gpt.*50.*10.*opus.*60.*10/i,
    );
  });

  describe('Failover re-estimation', () => {
    it('re-estimates tokens using failover target tokenizer before sending', async () => {
      const gptTokenizerUsed = vi.fn();
      const opusTokenizerUsed = vi.fn();
      const factory = createTokenizerFactory({
        'gpt-4.1': createCountingTokenizer((text) => gptTokenizerUsed(text)),
        'claude-opus-4': createCountingTokenizer((text) =>
          opusTokenizerUsed(text),
        ),
      });

      providerManager.setTokenizerFactory(factory);

      let callCount = 0;
      const failingGptProvider: IProvider = {
        name: 'openai',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('429 rate limited');
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gpt-4.1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };
      providerManager.registerProvider(failingGptProvider);
      providerManager.registerProvider(
        createMockProvider({ name: 'anthropic' }),
      );

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'failover-tokenizer',
        strategy: 'failover',
        contextLimit: 1_000_000,
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
      await consumeIterator(provider, [createTextContent('test message')]);

      expect(gptTokenizerUsed).toHaveBeenCalledWith('test message');
      expect(opusTokenizerUsed).toHaveBeenCalledWith('test message');

      const stats = provider.getTokenAccountingDiagnostics();
      expect(stats.accountingSource).toBe('claude-opus-4 (tokenizer)');
      expect(stats.selectedSubProfile).toBe('opus');
    });
  });
});
