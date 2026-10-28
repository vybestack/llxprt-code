/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers';
import { bindProviderAliasIdentity } from '@vybestack/llxprt-code-providers/composition/aliasProviderFactory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';

/**
 * A provider contribution whose factory registers an OAuth provider named
 * after each alias on the OAuth manager the host hands it, the way a runtime
 * plugin that needs OAuth does. Pass `contributions` to
 * `prepareAgentPreflight` (Route B), write each alias with
 * `writeProviderAliasConfig(alias, { baseProvider: providerId })`, and enable
 * OAuth for the aliases with `enableOAuthProviders`.
 */
export interface OAuthContribution {
  readonly providerId: string;
  readonly contributions: ProviderContributionRegistry;
}

export function createOAuthContribution(
  providerId = 'oauth-contribution-provider',
): OAuthContribution {
  const contributions = buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: (entry, context) => {
              const provider = new OpenAIProvider(
                'test-key',
                'http://oauth-contribution.invalid/v1',
              );
              bindProviderAliasIdentity(provider, entry.alias);
              const unexpectedInteractiveAuth = async (): Promise<never> => {
                throw new Error('Unexpected interactive authentication');
              };
              context.oauthManager.registerProvider({
                name: entry.alias,
                initiateAuth: unexpectedInteractiveAuth,
                getToken: async () => null,
                refreshToken: async () => null,
              });
              return provider;
            },
          },
        ],
      },
    },
  ]);
  return { providerId, contributions };
}

/**
 * Enables OAuth for the named providers in the user settings file under
 * `configHome` (`LLXPRT_CONFIG_HOME`), the file the OAuth manager's settings
 * provider reads.
 */
export async function enableOAuthProviders(
  configHome: string,
  providers: readonly string[],
): Promise<void> {
  await writeFile(
    join(configHome, 'settings.json'),
    JSON.stringify({
      oauthEnabledProviders: Object.fromEntries(
        providers.map((name) => [name, true]),
      ),
    }),
  );
}
