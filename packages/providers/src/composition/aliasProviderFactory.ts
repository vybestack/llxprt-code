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
    updateConfig?: (config: { providerId?: string }) => void;
  };
  baseProviderConfig?: {
    name?: string;
  };
};

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
): OpenAIProvider | null {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    debugLogger.warn(
      `[ProviderManager] Alias '${entry.alias}' is missing a baseUrl and no default is available, skipping.`,
    );
    return null;
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

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindOpenAIAliasIdentity(provider, entry.alias);

  return provider;
}

export function createOpenAIResponsesAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
  authOnlyEnabled: boolean,
): OpenAIResponsesProvider | null {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    debugLogger.warn(
      `[ProviderManager] Alias '${entry.alias}' is missing a baseUrl and no default is available, skipping.`,
    );
    return null;
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

  // Override the provider name to match the alias
  Object.defineProperty(provider, 'name', {
    value: entry.alias,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  return provider;
}

export function createOpenAIVercelAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  authOnlyEnabled: boolean,
): OpenAIVercelProvider | null {
  const resolvedBaseUrl = entry.config['base-url'] ?? openaiBaseUrl;
  if (!resolvedBaseUrl) {
    debugLogger.warn(
      `[ProviderManager] Alias '${entry.alias}' is missing a baseUrl and no default is available, skipping.`,
    );
    return null;
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

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);

  return provider;
}

export function createGeminiAliasProvider(
  entry: ProviderAliasEntry,
  config: Config | undefined,
  authOnlyEnabled: boolean,
): GeminiProvider | null {
  const aliasApiKey = resolveAliasEnvApiKey(entry, authOnlyEnabled);

  const resolvedBaseUrl = entry.config['base-url'];

  const provider = new GeminiProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    config,
  );

  if (config && typeof provider.setConfig === 'function') {
    provider.setConfig(config);
  }

  overrideAliasDefaultModel(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);

  return provider;
}

export function createAnthropicAliasProvider(
  entry: ProviderAliasEntry,
  oauthManager: OAuthManager | undefined,
  authOnlyEnabled: boolean,
): AnthropicProvider | null {
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

  overrideAliasDefaultModel(provider, entry);
  overrideStaticModels(provider, entry);

  bindProviderAliasIdentity(provider, entry.alias);

  return provider;
}

/** Inputs shared by every alias factory in one registration pass. */
interface AliasProviderContext {
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiProviderConfig: IProviderConfig;
  oauthManager: OAuthManager;
  config: Config | undefined;
  authOnlyEnabled: boolean;
}

type AliasProvider =
  | OpenAIProvider
  | OpenAIResponsesProvider
  | OpenAIVercelProvider
  | GeminiProvider
  | AnthropicProvider;

function createAliasProvider(
  entry: ProviderAliasEntry,
  context: AliasProviderContext,
): AliasProvider | null {
  const {
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
    config,
    authOnlyEnabled,
  } = context;

  switch (entry.config.baseProvider.toLowerCase()) {
    case 'openai':
      return createOpenAIAliasProvider(
        entry,
        openaiApiKey,
        openaiBaseUrl,
        openaiProviderConfig,
        authOnlyEnabled,
      );
    case 'openai-responses':
      return createOpenAIResponsesAliasProvider(
        entry,
        openaiApiKey,
        openaiBaseUrl,
        openaiProviderConfig,
        oauthManager,
        authOnlyEnabled,
      );
    case 'openaivercel':
    case 'openai-vercel':
      return createOpenAIVercelAliasProvider(
        entry,
        openaiApiKey,
        openaiBaseUrl,
        openaiProviderConfig,
        authOnlyEnabled,
      );
    case 'gemini':
      return createGeminiAliasProvider(entry, config, authOnlyEnabled);
    case 'anthropic':
      // Binding is by identity, not host: only the `claudecode` alias
      // receives the Claude subscription OAuth manager/identity; the
      // `anthropic` alias is API-key-only and must not bind OAuth.
      return createAnthropicAliasProvider(
        entry,
        entry.alias === 'claudecode' ? oauthManager : undefined,
        authOnlyEnabled,
      );
    default:
      debugLogger.warn(
        `[ProviderManager] Unsupported base provider '${entry.config.baseProvider}' for alias '${entry.alias}', skipping.`,
      );
      return null;
  }
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
): void {
  for (const entry of aliasEntries) {
    const provider = createAliasProvider(entry, {
      openaiApiKey,
      openaiBaseUrl,
      openaiProviderConfig,
      oauthManager,
      config,
      authOnlyEnabled,
    });
    if (provider) {
      providerManagerInstance.registerProvider(provider as never);
    }
  }
}
