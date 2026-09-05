/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  type Config,
  sanitizeForByteString,
  needsSanitization,
  debugLogger,
} from '@vybestack/llxprt-code-core';

import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { OpenAIVercelProvider } from '../openai-vercel/index.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import type { ProviderManager } from '../ProviderManager.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import type { OAuthManager } from '../auth/index.js';
import type { IModel } from '../IModel.js';
import { type ProviderAliasEntry } from './providerAliases.js';
import { createBuiltinProviderContributionRegistry } from './runtimePlugins/registry.js';
import type {
  ProviderAliasFactory,
  ProviderContributionRegistry,
  ProviderFactoryContext,
} from './runtimePlugins/types.js';
import {
  conservativeMediaTransportCapabilities,
  copyMediaTransportCapabilities,
  type ProviderMediaTransportCapabilities,
} from '../providerMediaTransportCapabilities.js';

/**
 * Sanitizes API keys to remove problematic characters that cause ByteString errors.
 * This handles cases where API key files have encoding issues or contain
 * Unicode replacement characters (U+FFFD).
 */
export function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    debugLogger.warn(
      '[ProviderManager] API key contained non-ASCII or control characters that were removed. ' +
        'Please check your API key file encoding (should be UTF-8 without BOM).',
    );
  }

  return sanitized;
}

/**
 * Resolves the API key an alias declares through `apiKeyEnv`.
 *
 * Returns undefined when authOnly is enabled: authOnly forces OAuth-only
 * authentication, so ambient environment credentials must not be bound to any
 * alias provider. This mirrors the rule the composition root already applies
 * to the shared OpenAI key in `resolveOpenaiApiKey`.
 */
function resolveAliasEnvApiKey(
  entry: ProviderAliasEntry,
  authOnlyEnabled: boolean,
): string | undefined {
  if (authOnlyEnabled || !entry.config.apiKeyEnv) {
    return undefined;
  }

  const envValue = process.env[entry.config.apiKeyEnv];
  if (!envValue || envValue.trim() === '') {
    return undefined;
  }

  const sanitized = sanitizeApiKey(envValue);
  return sanitized === '' ? undefined : sanitized;
}

export type AliasAwareBaseProvider = {
  authResolver?: {
    updateConfig?: (config: {
      providerId?: string;
      envKeyNames?: string[];
    }) => void;
  };
  baseProviderConfig?: {
    name?: string;
    envKeyNames?: string[];
  };
};

/**
 * Strips the environment credential names an alias provider would otherwise
 * authenticate with, when the alias is built under authOnly.
 *
 * `resolveAliasEnvApiKey` only withholds the key an alias declares in its own
 * `apiKeyEnv`; each concrete provider additionally hardcodes its own
 * `envKeyNames` (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
 * GOOGLE_API_KEY) in its BaseProviderConfig. AuthPrecedenceResolver skips that
 * environment fallback only while the settings service it resolves against
 * reports authOnly, but the composition root derives authOnly from ephemeral
 * config and merged user settings as well (resolveAuthOnlyFlag), which the
 * runtime settings service need not carry. An ambient key then authenticated
 * an alias that authOnly had already disqualified.
 *
 * The decision is therefore taken once, here, at construction: an alias built
 * under authOnly holds no environment names to resolve, so no later settings
 * lookup can disagree with the policy it was created with.
 */
function enforceAliasAuthOnly(
  provider: unknown,
  authOnlyEnabled: boolean,
): void {
  if (!authOnlyEnabled) {
    return;
  }

  const aliasAwareProvider = provider as AliasAwareBaseProvider;
  if (aliasAwareProvider.baseProviderConfig) {
    aliasAwareProvider.baseProviderConfig.envKeyNames = [];
  }
  aliasAwareProvider.authResolver?.updateConfig?.({ envKeyNames: [] });
}

type AliasDefaultModelProvider = {
  getDefaultModel: () => string;
};

type RuntimeMutableAliasConfig = {
  defaultModel?: string | null;
};

export function isAliasDefaultModelProvider(
  provider: unknown,
): provider is AliasDefaultModelProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'getDefaultModel' in provider &&
    typeof provider.getDefaultModel === 'function'
  );
}

export function overrideAliasDefaultModel(
  provider: unknown,
  entry: ProviderAliasEntry,
): void {
  if (!entry.config.defaultModel || !isAliasDefaultModelProvider(provider)) {
    return;
  }

  const originalGetDefaultModel = provider.getDefaultModel.bind(provider);
  const runtimeAliasConfig = entry.config as RuntimeMutableAliasConfig;
  provider.getDefaultModel = () =>
    runtimeAliasConfig.defaultModel ?? originalGetDefaultModel();
}

/**
 * Ensure alias providers use their own identifier when resolving authentication.
 * Without this, API keys saved via `/key` are stored under the alias name,
 * but the OpenAI provider would continue to look up credentials under `openai`.
 */
export function bindOpenAIAliasIdentity(
  provider: OpenAIProvider,
  alias: string,
): void {
  bindProviderAliasIdentity(provider, alias);
}

export function bindProviderAliasIdentity(
  provider: unknown,
  alias: string,
): void {
  const aliasName = alias.trim();
  if (aliasName === '') {
    return;
  }

  Object.defineProperty(provider, 'name', {
    value: aliasName,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  const aliasAwareProvider = provider as AliasAwareBaseProvider;
  if (aliasAwareProvider.baseProviderConfig) {
    aliasAwareProvider.baseProviderConfig.name = aliasName;
  }

  aliasAwareProvider.authResolver?.updateConfig?.({
    providerId: aliasName,
  });
}

interface AliasMediaCapabilityProvider {
  getMediaTransportCapabilities(): ProviderMediaTransportCapabilities;
}

function bindAliasMediaTransportCapabilities(
  provider: AliasMediaCapabilityProvider,
  entry: ProviderAliasEntry,
): void {
  const registered =
    entry.config.mediaTransportCapabilities ??
    conservativeMediaTransportCapabilities();
  Object.defineProperty(provider, 'getMediaTransportCapabilities', {
    value: (): ProviderMediaTransportCapabilities =>
      copyMediaTransportCapabilities(registered),
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Surface a declared {@link ProviderMediaSupport} block onto a provider config's
 * `providerSpecific` map so it is reachable at request time via
 * `providerConfig.providerSpecific.mediaSupport`.
 */
function withMediaSupport(
  config: IProviderConfig,
  entry: ProviderAliasEntry,
): IProviderConfig {
  const mediaSupport = entry.config.mediaSupport;
  if (!mediaSupport) {
    return config;
  }
  return {
    ...config,
    providerSpecific: {
      ...(config.providerSpecific ?? {}),
      mediaSupport: { ...mediaSupport },
    },
  };
}

/**
 * Resolve the tool format an alias's static models should declare, based on
 * the alias's base provider. OpenAI-protocol aliases use `openai`; the
 * Anthropic protocol alias uses `anthropic`.
 */
function staticModelsToolFormat(
  entry: ProviderAliasEntry,
): IModel['supportedToolFormats'] {
  if (entry.config.baseProvider.toLowerCase() === 'anthropic') {
    return ['anthropic'];
  }
  return ['openai'];
}

function mapStaticModels(entry: ProviderAliasEntry): IModel[] {
  const supportedToolFormats = staticModelsToolFormat(entry);
  return (entry.config.staticModels ?? []).map((model) => {
    const hasContextWindow = model.contextWindow !== undefined;
    const hasMaxOutputTokens = model.maxOutputTokens !== undefined;
    const geometryAuthority: IModel['geometryAuthority'] = {
      ...(hasContextWindow ? { contextWindow: true } : {}),
      ...(hasMaxOutputTokens ? { maxOutputTokens: true } : {}),
    };
    return {
      id: model.id,
      name: model.name,
      provider: entry.alias,
      supportedToolFormats,
      ...(model.contextWindow !== undefined
        ? { contextWindow: model.contextWindow }
        : {}),
      ...(model.maxOutputTokens !== undefined
        ? { maxOutputTokens: model.maxOutputTokens }
        : {}),
      // Mark static models that have explicit field geometry as
      // authoritative so registry hydration does not overwrite them
      // (issue #2483). Field-specific so partial authority works.
      ...(hasContextWindow || hasMaxOutputTokens ? { geometryAuthority } : {}),
    };
  });
}

function overrideStaticModels(
  provider: { getModels: () => Promise<IModel[]> },
  entry: ProviderAliasEntry,
): void {
  if (!entry.config.staticModels || entry.config.staticModels.length === 0) {
    return;
  }

  const staticModels = mapStaticModels(entry);
  provider.getModels = async () => staticModels;
}

export function createOpenAIAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  authOnlyEnabled: boolean,
): OpenAIProvider {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    throw new Error(
      `Alias '${entry.alias}' (${entry.filePath}) has no base-url and no ` +
        `default base URL is configured. Set 'base-url' on the alias or ` +
        `configure a default for the openai provider.`,
    );
  }

  const aliasProviderConfig: IProviderConfig = {
    ...openaiProviderConfig,
    baseUrl: resolvedBaseUrl,
  };

  if (entry.config.providerConfig) {
    Object.assign(aliasProviderConfig, entry.config.providerConfig);
  }

  if (entry.config.defaultModel) {
    aliasProviderConfig.defaultModel = entry.config.defaultModel;
  }

  const aliasApiKey =
    resolveAliasEnvApiKey(entry, authOnlyEnabled) ?? openaiApiKey;

  const provider = new OpenAIProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    withMediaSupport(aliasProviderConfig, entry),
  );

  enforceAliasAuthOnly(provider, authOnlyEnabled);

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindOpenAIAliasIdentity(provider, entry.alias);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
}

export function createOpenAIResponsesAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
  authOnlyEnabled: boolean,
): OpenAIResponsesProvider {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    throw new Error(
      `Alias '${entry.alias}' (${entry.filePath}) has no base-url and no ` +
        `default base URL is configured. Set 'base-url' on the alias or ` +
        `configure a default for the openai provider.`,
    );
  }

  const aliasProviderConfig: IProviderConfig = {
    ...openaiProviderConfig,
    baseUrl: resolvedBaseUrl,
  };

  if (entry.config.providerConfig) {
    Object.assign(aliasProviderConfig, entry.config.providerConfig);
  }

  if (entry.config.defaultModel) {
    aliasProviderConfig.defaultModel = entry.config.defaultModel;
  }

  const aliasApiKey =
    resolveAliasEnvApiKey(entry, authOnlyEnabled) ?? openaiApiKey;

  const provider = new OpenAIResponsesProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    aliasProviderConfig,
    oauthManager,
  );

  enforceAliasAuthOnly(provider, authOnlyEnabled);

  // Override the provider name to match the alias
  Object.defineProperty(provider, 'name', {
    value: entry.alias,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
}

export function createOpenAIVercelAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  authOnlyEnabled: boolean,
): OpenAIVercelProvider {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    throw new Error(
      `Alias '${entry.alias}' (${entry.filePath}) has no base-url and no ` +
        `default base URL is configured. Set 'base-url' on the alias or ` +
        `configure a default for the openai provider.`,
    );
  }

  const aliasProviderConfig: IProviderConfig = {
    ...openaiProviderConfig,
    baseUrl: resolvedBaseUrl,
  };

  if (entry.config.providerConfig) {
    Object.assign(aliasProviderConfig, entry.config.providerConfig);
  }

  if (entry.config.defaultModel) {
    aliasProviderConfig.defaultModel = entry.config.defaultModel;
  }

  const aliasApiKey =
    resolveAliasEnvApiKey(entry, authOnlyEnabled) ?? openaiApiKey;

  const provider = new OpenAIVercelProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    aliasProviderConfig,
  );

  enforceAliasAuthOnly(provider, authOnlyEnabled);

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
}

export function createGeminiAliasProvider(
  entry: ProviderAliasEntry,
  config: Config | undefined,
  authOnlyEnabled: boolean,
): GeminiProvider {
  const aliasApiKey = resolveAliasEnvApiKey(entry, authOnlyEnabled);

  const resolvedBaseUrl = entry.config['base-url'];

  const provider = new GeminiProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    config,
  );

  enforceAliasAuthOnly(provider, authOnlyEnabled);

  if (config && typeof provider.setConfig === 'function') {
    provider.setConfig(config);
  }

  overrideAliasDefaultModel(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
}

export function createAnthropicAliasProvider(
  entry: ProviderAliasEntry,
  oauthManager: OAuthManager | undefined,
  authOnlyEnabled: boolean,
): AnthropicProvider {
  const aliasApiKey = resolveAliasEnvApiKey(entry, authOnlyEnabled);

  const resolvedBaseUrl = entry.config['base-url'];

  const providerConfig: IProviderConfig = {};
  if (entry.config.providerConfig) {
    Object.assign(providerConfig, entry.config.providerConfig);
  }

  const provider = new AnthropicProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    providerConfig,
    oauthManager,
  );

  enforceAliasAuthOnly(provider, authOnlyEnabled);

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);
  bindAliasMediaTransportCapabilities(provider, entry);

  return provider;
}

/** Options accepted by {@link registerAliasProviders}. */
export interface RegisterAliasProvidersOptions {
  /**
   * The provider contribution registry alias construction dispatches through.
   * Defaults to the built-ins-only registry, so built-in alias construction is
   * unchanged for callers that load no runtime plugins. Note that an alias
   * naming an unknown base provider now throws instead of being skipped with a
   * warning.
   */
  providerContributions?: ProviderContributionRegistry;
}

/**
 * Builds the plugin-sourced alias entries the registry contributes, skipping any
 * whose name collides (case-insensitively) with a file-loaded alias. The user's
 * own alias file is the higher-authority layer, so it always wins. This is a
 * deterministic precedence rule, not a failure.
 */
function contributedAliasEntries(
  contributions: ProviderContributionRegistry,
  fileAliasEntries: readonly ProviderAliasEntry[],
): ProviderAliasEntry[] {
  const fileAliasNames = new Set(
    fileAliasEntries.map((entry) => entry.alias.toLowerCase()),
  );
  const entries: ProviderAliasEntry[] = [];
  for (const contributed of contributions.getContributedAliases()) {
    if (fileAliasNames.has(contributed.alias.toLowerCase())) {
      continue;
    }
    entries.push({
      alias: contributed.alias,
      config: contributed.config,
      // A contributed alias has no file on disk; record its origin honestly
      // rather than fabricating a path.
      filePath: `plugin:${contributed.pluginId}`,
      source: 'plugin',
    });
  }
  return entries;
}

function resolveAliasFactory(
  contributions: ProviderContributionRegistry,
  entry: ProviderAliasEntry,
): ProviderAliasFactory {
  const factory = contributions.getProviderFactory(entry.config.baseProvider);
  if (!factory) {
    throw new Error(
      `Alias '${entry.alias}' (${entry.filePath}) requests base provider ` +
        `'${entry.config.baseProvider}', which no built-in provider and no ` +
        `loaded runtime plugin contributes. Known provider ids: ` +
        `${contributions.listProviderIds().join(', ')}.`,
    );
  }
  return factory;
}

export function registerAliasProviders(
  providerManagerInstance: ProviderManager,
  aliasEntries: ProviderAliasEntry[],
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
  config: Config | undefined,
  authOnlyEnabled: boolean,
  options: RegisterAliasProvidersOptions = {},
): void {
  const contributions =
    options.providerContributions ??
    createBuiltinProviderContributionRegistry();
  const factoryContext: ProviderFactoryContext = {
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
    config,
    authOnlyEnabled,
  };

  const entries = [
    ...aliasEntries,
    ...contributedAliasEntries(contributions, aliasEntries),
  ];

  // Resolve every factory and construct every provider BEFORE touching the
  // manager. `refreshAliasProviders` re-runs this against a live manager, so a
  // single unresolvable alias must not leave half the aliases swapped out.
  const providers = entries.map((entry) =>
    resolveAliasFactory(contributions, entry)(entry, factoryContext),
  );

  for (const provider of providers) {
    providerManagerInstance.registerProvider(provider as never);
  }
}
