/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  OpenAIProvider,
  type NormalizedGenerateChatOptions,
} from '@vybestack/llxprt-code-providers';
import type {
  OAuthManager,
  OAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';

/** Answers one OAuth token refresh; `signal` is the one the manager passed. */
export type OAuthRefresh = (
  current: OAuthToken,
  signal?: AbortSignal,
) => Promise<OAuthToken | null>;

export interface RefreshableOAuthEntry {
  /** Contributed alias hosts select as the provider name and OAuth name. */
  readonly alias: string;
  readonly refresh: OAuthRefresh;
}

/**
 * An OAuth provider whose token refresh is whatever the test supplies: hold it,
 * answer it, observe its abort signal, count it. The test chooses what the
 * refresh does, so it also registers on a stand-alone `OAuthManager`.
 */
export function createRefreshableOAuthProvider(
  entry: RefreshableOAuthEntry,
): OAuthProvider {
  const unexpectedInteractiveAuth = async (): Promise<never> => {
    throw new Error('Unexpected interactive authentication');
  };
  return {
    name: entry.alias,
    initiateAuth: unexpectedInteractiveAuth,
    getToken: async () => null,
    refreshToken: entry.refresh,
  };
}

/**
 * Provider contributions whose factories register a refreshable OAuth provider
 * on the OAuth manager the host hands them, the way a runtime plugin that needs
 * OAuth does, and whose providers answer chat requests. Pass `contributions` to
 * `AgentConfig.providerContributions` (Route C), enable OAuth for the aliases
 * with `enableOAuthProviders`, and select an alias in a profile.
 */
export interface RefreshableOAuthContribution {
  readonly contributions: ProviderContributionRegistry;
  /** The OAuth managers the host handed the factories, in creation order. */
  readonly managers: readonly OAuthManager[];
}

class AnsweringOpenAIProvider extends OpenAIProvider {
  constructor() {
    super('test-key', 'http://refreshable-oauth.invalid/v1');
  }

  protected override async *generateChatCompletionWithOptions(
    _options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answered' }] };
  }
}

export function createRefreshableOAuthContribution(
  entries: readonly RefreshableOAuthEntry[],
): RefreshableOAuthContribution {
  const managers: OAuthManager[] = [];
  const contributions = buildProviderContributionRegistry(
    entries.map((entry) => {
      const providerId = `${entry.alias}-provider`;
      return {
        specifier: `memory:${providerId}`,
        manifest: {
          apiVersion: 1,
          id: providerId,
          providers: [
            {
              providerId,
              createProvider: (aliasEntry, context) => {
                const provider = new AnsweringOpenAIProvider();
                bindProviderAliasIdentity(provider, aliasEntry.alias);
                if (!managers.includes(context.oauthManager)) {
                  managers.push(context.oauthManager);
                }
                context.oauthManager.registerProvider(
                  createRefreshableOAuthProvider(entry),
                );
                return provider;
              },
              builtinAliases: [
                {
                  alias: entry.alias,
                  config: {
                    baseProvider: providerId,
                    'base-url': 'http://refreshable-oauth.invalid/v1',
                    defaultModel: 'refreshable-default',
                    staticModels: [
                      {
                        id: 'refreshable-default',
                        name: 'Refreshable default',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };
    }),
  );
  return { contributions, managers };
}
