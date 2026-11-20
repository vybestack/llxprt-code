/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../../IProvider.js';

export function createMockProvider(
  overrides: Partial<IProvider> = {},
): IProvider {
  return {
    name: overrides.name ?? 'mock-provider',
    generateChatCompletion:
      overrides.generateChatCompletion ??
      async function* (): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
    getModels: overrides.getModels ?? (async () => []),
    getDefaultModel: overrides.getDefaultModel ?? (() => 'mock-model'),
  };
}

export function createCountingTokenizer(
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

export function createFixedTokenizer(tokens: number): RuntimeTokenizer {
  return {
    countTokens: () => Promise.resolve(tokens),
  };
}

export function createTokenizerFactory(
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
