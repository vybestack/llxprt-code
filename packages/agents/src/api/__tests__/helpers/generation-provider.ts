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
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';

export interface GenerationProviderOptions {
  /** Contributed alias hosts select as the provider name (`gemini` selects temporary-client generation). */
  readonly alias: string;
  /** Text of each answered request, in arrival order. Defaults to two numbered replies. */
  readonly replies?: readonly string[];
}

export type GenerationRequest = NormalizedGenerateChatOptions;

/**
 * A provider a host registers as a provider contribution, answering requests
 * from a scripted list and recording every request it receives. `generating`
 * runs after a request is recorded and before it answers; a test assigns it to
 * hold or fail requests.
 */
export interface GenerationProvider {
  readonly alias: string;
  readonly contributions: ProviderContributionRegistry;
  readonly requests: readonly GenerationRequest[];
  generating: ((request: GenerationRequest) => Promise<void>) | undefined;
}

class ScriptedOpenAIProvider extends OpenAIProvider {
  constructor(private readonly handle: ScriptedReplies) {
    super('test-key', 'http://generation-provider.invalid/v1');
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const text = await this.handle.answer(options);
    yield { speaker: 'ai', blocks: [{ type: 'text', text }] };
  }
}

class ScriptedReplies {
  readonly requests: GenerationRequest[] = [];
  generating: ((request: GenerationRequest) => Promise<void>) | undefined;
  private answered = 0;

  constructor(private readonly replies: readonly string[]) {}

  async answer(request: GenerationRequest): Promise<string> {
    this.requests.push(request);
    await this.generating?.(request);
    if (this.answered >= this.replies.length)
      throw new Error(
        `Generation provider has no reply for request ${this.answered + 1}`,
      );
    const text = this.replies[this.answered];
    this.answered += 1;
    return text;
  }
}

export function createGenerationProvider(
  options: GenerationProviderOptions,
): GenerationProvider {
  const providerId = `${options.alias}-provider`;
  const script = new ScriptedReplies(
    options.replies ?? ['turn one reply', 'turn two reply'],
  );
  const contributions = buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry) => {
              const provider = new ScriptedOpenAIProvider(script);
              bindProviderAliasIdentity(provider, entry.alias);
              return provider;
            },
            builtinAliases: [
              {
                alias: options.alias,
                config: {
                  baseProvider: providerId,
                  'base-url': 'http://generation-provider.invalid/v1',
                  'requires-auth': false,
                  defaultModel: 'primary-model',
                  staticModels: [
                    { id: 'primary-model', name: 'Primary model' },
                    { id: 'replacement-model', name: 'Replacement model' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ]);
  return {
    alias: options.alias,
    contributions,
    requests: script.requests,
    get generating() {
      return script.generating;
    },
    set generating(hook) {
      script.generating = hook;
    },
  };
}
