/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';

export function loadPrecedenceProviderContributions(): Promise<ProviderContributionRegistry> {
  return loadRuntimePlugins(['precedence-fixture-gemini'], {
    importModule: async () => ({
      llxprtRuntimePlugin: {
        apiVersion: 1,
        id: 'precedence-fixture-gemini',
        providers: [
          {
            providerId: 'gemini',
            createProvider: (entry: {
              alias: string;
              config: { defaultModel?: string };
            }) => ({
              name: entry.alias,
              getDefaultModel: () =>
                entry.config.defaultModel ?? 'gemini-2.5-pro',
              getModels: async () => [],
              async *generateChatCompletion() {
                yield {
                  speaker: 'ai',
                  blocks: [{ type: 'text', text: 'ready' }],
                };
              },
            }),
            builtinAliases: [
              {
                alias: 'gemini',
                config: {
                  baseProvider: 'gemini',
                  defaultModel: 'gemini-2.5-pro',
                },
              },
            ],
          },
        ],
      },
    }),
  });
}

export function registerPrecedenceProviders(
  manager: RuntimeProviderManager,
): void {
  for (const name of ['openai', 'anthropic']) {
    manager.registerProvider({
      name,
      getDefaultModel: () => 'mock-default-model',
      getModels: async () => [],
      async *generateChatCompletion() {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ready' }] };
      },
    });
  }
}
