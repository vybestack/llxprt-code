/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google Gemini runtime plugin (#2763).
 *
 * The host loader (`@vybestack/llxprt-code-providers` composition barrel)
 * imports this package's named `llxprtRuntimePlugin` export and validates it
 * against manifest v1 before anything is constructed.
 *
 * This plugin is the single home of the Gemini provider implementation: it
 * contributes the `gemini` provider id, the built-in `gemini` alias (byte-for-
 * byte the alias config the base package used to ship), and an alias-aware
 * factory adapted from the former base `createGeminiAliasProvider`. The
 * alias-construction helpers it consumes are provider-agnostic host utilities
 * exported from the `@vybestack/llxprt-code-providers/composition.js` subpath;
 * this package does not re-export them.
 */
import { GeminiProvider } from './gemini/GeminiProvider.js';
import {
  bindAliasMediaTransportCapabilities,
  bindProviderAliasIdentity,
  enforceAliasAuthOnly,
  overrideAliasDefaultModel,
  resolveAliasEnvApiKey,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  ProviderAliasEntry,
  ProviderAliasFactory,
  ProviderFactoryContext,
  RuntimePluginManifest,
} from '@vybestack/llxprt-code-providers/composition.js';

const createGeminiPluginProvider: ProviderAliasFactory = (
  entry: ProviderAliasEntry,
  context: ProviderFactoryContext,
) => {
  const config = context.config;

  const aliasApiKey = resolveAliasEnvApiKey(entry, context.authOnlyEnabled);

  const resolvedBaseUrl = entry.config['base-url'];

  const provider = new GeminiProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    config,
  );

  enforceAliasAuthOnly(provider, context.authOnlyEnabled);

  if (config && typeof provider.setConfig === 'function') {
    provider.setConfig(config);
  }

  overrideAliasDefaultModel(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
};

export const llxprtRuntimePlugin = {
  apiVersion: 1,
  id: '@vybestack/llxprt-plugin-google-gemini',
  providers: [
    {
      providerId: 'gemini',
      createProvider: createGeminiPluginProvider,
      builtinAliases: [
        {
          alias: 'gemini',
          config: {
            name: 'gemini',
            modelsDevProviderId: 'google',
            description: 'Google Gemini API',
            baseProvider: 'gemini',
            'base-url': 'https://generativelanguage.googleapis.com',
            defaultModel: 'gemini-2.5-pro',
            apiKeyEnv: 'GEMINI_API_KEY',
          },
        },
      ],
    },
  ],
} satisfies RuntimePluginManifest;
