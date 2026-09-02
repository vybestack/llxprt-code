/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the load-balancer context guard passing its token
 * facts to the compression callback (issue #3499).
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';

interface GuardInfo {
  estimatedTokens: number;
  contextLimit: number;
}

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

function createTokenizerFactory(
  tokenizerMap: Record<string, RuntimeTokenizer>,
): RuntimeTokenizerFactory {
  return {
    getTokenizer: (
      providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined => tokenizerMap[model ?? providerName],
    estimatePrompt: (request) =>
      request.legacyEstimate().then((count) => ({
        count,
        method: 'exact',
        family: 'test',
        estimatorVersion: 'test',
        assetRevision: 'test',
        projectionRevision: request.projectionRevision,
      })),
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

describe('LoadBalancingProvider - compression guard facts (issue #3499)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('passes the guard estimate and context limit to the compression callback', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    const sentToOpenAi: IContent[][] = [];
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        async *generateChatCompletion(
          optionsOrContent: GenerateChatOptions | IContent[],
        ): AsyncGenerator<IContent> {
          const contents = Array.isArray(optionsOrContent)
            ? optionsOrContent
            : optionsOrContent.contents;
          sentToOpenAi.push(structuredClone(contents));
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
      }),
    );

    const contextLimit = 10;
    const provider = new LoadBalancingProvider(
      {
        profileName: 'guard-facts-test',
        strategy: 'round-robin',
        contextLimit,
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

    const requestText = 'this is a very long message that exceeds the limit';
    let capturedGuard: GuardInfo | undefined;
    const compressionCallback = vi.fn(
      async (_contents: IContent[], guard?: GuardInfo): Promise<IContent[]> => {
        capturedGuard = guard;
        return [createTextContent('ok')];
      },
    );
    provider.setCompressionCallback(compressionCallback);

    const result = await consumeIterator(provider, [
      createTextContent(requestText),
    ]);

    // The counting tokenizer is the estimator under test; the guard must
    // report exactly the number it computed for the over-limit request.
    const expectedEstimate = Math.ceil(requestText.length / 4);
    expect(expectedEstimate).toBeGreaterThan(contextLimit);
    expect(compressionCallback).toHaveBeenCalledTimes(1);
    expect(capturedGuard).toStrictEqual({
      estimatedTokens: expectedEstimate,
      contextLimit,
    });
    // The compressed payload re-estimates under the limit, so the request
    // proceeds (existing guard behavior).
    expect(sentToOpenAi).toStrictEqual([[createTextContent('ok')]]);
    expect(result.length).toBeGreaterThan(0);
  });

  it('still invokes single-argument callbacks when the estimate exceeds the limit', async () => {
    const factory = createTokenizerFactory({
      'gpt-4.1': createCountingTokenizer(() => {}),
    });
    providerManager.setTokenizerFactory(factory);
    providerManager.registerProvider(
      createMockProvider({
        name: 'openai',
        getDefaultModel: () => 'gpt-4.1',
      }),
    );

    const provider = new LoadBalancingProvider(
      {
        profileName: 'legacy-callback-test',
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

    const compressionCallback = vi.fn(async (_contents: IContent[]) => [
      createTextContent('ok'),
    ]);
    provider.setCompressionCallback(compressionCallback);

    const result = await consumeIterator(provider, [
      createTextContent('this is a very long message that exceeds the limit'),
    ]);

    expect(compressionCallback).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
  });
});
