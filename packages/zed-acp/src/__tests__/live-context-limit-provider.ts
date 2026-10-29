/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import {
  bindProviderAliasIdentity,
  buildProviderContributionRegistry,
  type ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';

export interface LiveContextLimitProviderOptions {
  /** Contributed alias hosts select as the provider name. */
  readonly alias: string;
  /** Read on every `getContextLimit()` call, so a test can change it live. */
  readonly readContextLimit: () => number;
  /** Text every request streams back. */
  readonly responseText: string;
}

class LiveContextLimitOpenAIProvider extends OpenAIProvider {
  constructor(
    private readonly readContextLimit: () => number,
    private readonly responseText: string,
  ) {
    super('test-key', 'http://live-context-limit.invalid/v1');
  }

  getContextLimit(): number {
    return this.readContextLimit();
  }

  protected override async *generateChatCompletionWithOptions(
    _options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: this.responseText }],
    };
  }
}

/**
 * A provider registered the way a host registers one (a provider
 * contribution) whose reported context limit follows a test variable. Pass the
 * result to `AgentConfig.providerContributions` and select `alias` as the
 * provider.
 */
export function createLiveContextLimitProvider(
  options: LiveContextLimitProviderOptions,
): ProviderContributionRegistry {
  const providerId = `${options.alias}-provider`;
  return buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new LiveContextLimitOpenAIProvider(
                options.readContextLimit,
                options.responseText,
              );
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias: options.alias,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://live-context-limit.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'live-limit-default',
                  staticModels: [
                    { id: 'live-limit-default', name: 'Live limit default' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ]);
}
