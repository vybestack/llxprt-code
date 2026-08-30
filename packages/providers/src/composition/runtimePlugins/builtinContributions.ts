/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createAnthropicAliasProvider,
  createGeminiAliasProvider,
  createOpenAIAliasProvider,
  createOpenAIResponsesAliasProvider,
  createOpenAIVercelAliasProvider,
} from '../aliasProviderFactory.js';
import type { RuntimeProviderContribution } from './types.js';

/**
 * Built-in provider contributions that the CLI's provider composition resolves aliases
 * against. Each provider id delegates to the existing alias factory with no behavior
 * change. The missing-base-url null return on the OpenAI-family factories is a
 * documented existing behavior (plan section 4) and is preserved exactly.
 */
export function createBuiltinProviderContributions(): RuntimeProviderContribution[] {
  return [
    {
      providerId: 'openai',
      createProvider: (entry, context) =>
        createOpenAIAliasProvider(
          entry,
          context.openaiApiKey,
          context.openaiBaseUrl,
          context.openaiProviderConfig,
        ),
    },
    {
      providerId: 'openai-responses',
      createProvider: (entry, context) =>
        createOpenAIResponsesAliasProvider(
          entry,
          context.openaiApiKey,
          context.openaiBaseUrl,
          context.openaiProviderConfig,
          context.oauthManager,
        ),
    },
    {
      providerId: 'openaivercel',
      createProvider: (entry, context) =>
        createOpenAIVercelAliasProvider(
          entry,
          context.openaiApiKey,
          context.openaiBaseUrl,
          context.openaiProviderConfig,
        ),
    },
    {
      providerId: 'openai-vercel',
      createProvider: (entry, context) =>
        createOpenAIVercelAliasProvider(
          entry,
          context.openaiApiKey,
          context.openaiBaseUrl,
          context.openaiProviderConfig,
        ),
    },
    {
      providerId: 'gemini',
      createProvider: (entry, context) =>
        createGeminiAliasProvider(entry, context.config),
    },
    {
      providerId: 'anthropic',
      createProvider: (entry, context) => {
        // Binding is by identity, not host: only the `claudecode` alias receives
        // the Claude subscription OAuth manager/identity; the `anthropic` alias is
        // API-key-only and must not bind OAuth.
        const oauthManagerForAlias =
          entry.alias === 'claudecode' ? context.oauthManager : undefined;
        return createAnthropicAliasProvider(
          entry,
          oauthManagerForAlias,
          context.authOnlyEnabled,
        );
      },
    },
  ];
}
