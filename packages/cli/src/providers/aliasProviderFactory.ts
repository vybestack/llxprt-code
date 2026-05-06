/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type ProviderManager,
  OpenAIProvider,
  OpenAIResponsesProvider,
  OpenAIVercelProvider,
  AnthropicProvider,
  GeminiProvider,
  sanitizeForByteString,
  needsSanitization,
  debugLogger,
} from '@vybestack/llxprt-code-core';

import { type IProviderConfig } from '@vybestack/llxprt-code-core/providers/types/IProviderConfig.js';
import { type OAuthManager } from '../auth/oauth-manager.js';
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

export function createOpenAIAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
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

  let aliasApiKey: string | undefined;
  if (entry.config.apiKeyEnv) {
    const envValue = process.env[entry.config.apiKeyEnv];
    if (envValue && envValue.trim() !== '') {
      aliasApiKey = sanitizeApiKey(envValue);
    }
  }
  if (!aliasApiKey && openaiApiKey) {
    aliasApiKey = openaiApiKey;
  }

  const provider = new OpenAIProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    aliasProviderConfig,
    oauthManager,
  );

  overrideAliasDefaultModel(provider, entry);

  // Override getModels() to return static models if configured
  // This avoids API calls for providers that don't have a /models endpoint
  if (entry.config.staticModels && entry.config.staticModels.length > 0) {
    const staticModels = entry.config.staticModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: entry.alias,
      supportedToolFormats: ['openai'] as string[],
    }));
    provider.getModels = async () => staticModels;
  }

  bindOpenAIAliasIdentity(provider, entry.alias);

  return provider;
}

export function createOpenAIResponsesAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
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

  let aliasApiKey: string | undefined;
  if (entry.config.apiKeyEnv) {
    const envValue = process.env[entry.config.apiKeyEnv];
    if (envValue && envValue.trim() !== '') {
      aliasApiKey = sanitizeApiKey(envValue);
    }
  }
  if (!aliasApiKey && openaiApiKey) {
    aliasApiKey = openaiApiKey;
  }

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

  // Override getModels() to return static models if configured
  if (entry.config.staticModels && entry.config.staticModels.length > 0) {
    const staticModels = entry.config.staticModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: entry.alias,
      supportedToolFormats: ['openai'] as string[],
    }));
    provider.getModels = async () => staticModels;
  }

  return provider;
}

export function createOpenAIVercelAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
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

  let aliasApiKey: string | undefined;
  if (entry.config.apiKeyEnv) {
    const envValue = process.env[entry.config.apiKeyEnv];
    if (envValue && envValue.trim() !== '') {
      aliasApiKey = sanitizeApiKey(envValue);
    }
  }
  if (!aliasApiKey && openaiApiKey) {
    aliasApiKey = openaiApiKey;
  }

  const provider = new OpenAIVercelProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    aliasProviderConfig,
    oauthManager,
  );

  overrideAliasDefaultModel(provider, entry);

  // Override getModels() to return static models if configured
  if (entry.config.staticModels && entry.config.staticModels.length > 0) {
    const staticModels = entry.config.staticModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: entry.alias,
      supportedToolFormats: ['openai'] as string[],
    }));
    provider.getModels = async () => staticModels;
  }

  bindProviderAliasIdentity(provider, entry.alias);

  return provider;
}

export function createGeminiAliasProvider(
  entry: ProviderAliasEntry,
  oauthManager: OAuthManager,
  config?: Config,
): GeminiProvider | null {
  let aliasApiKey: string | undefined;
  if (entry.config.apiKeyEnv) {
    const envValue = process.env[entry.config.apiKeyEnv];
    if (envValue && envValue.trim() !== '') {
      aliasApiKey = sanitizeApiKey(envValue);
    }
  }

  const resolvedBaseUrl = entry.config['base-url'];

  const provider = new GeminiProvider(
    aliasApiKey ?? undefined,
    resolvedBaseUrl,
    config,
    oauthManager,
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
  oauthManager: OAuthManager,
  authOnlyEnabled = false,
): AnthropicProvider | null {
  let aliasApiKey: string | undefined;
  // Only use environment variable API key if authOnly is not enabled
  if (!authOnlyEnabled && entry.config.apiKeyEnv) {
    const envValue = process.env[entry.config.apiKeyEnv];
    if (envValue && envValue.trim() !== '') {
      aliasApiKey = sanitizeApiKey(envValue);
    }
  }

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

  bindProviderAliasIdentity(provider, entry.alias);

  return provider;
}

export function registerAliasProviders(
  providerManagerInstance: ProviderManager,
  aliasEntries: ProviderAliasEntry[],
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
  config?: Config,
  authOnlyEnabled = false,
): void {
  for (const entry of aliasEntries) {
    switch (entry.config.baseProvider.toLowerCase()) {
      case 'openai': {
        const provider = createOpenAIAliasProvider(
          entry,
          openaiApiKey,
          openaiBaseUrl,
          openaiProviderConfig,
          oauthManager,
        );
        if (provider) {
          providerManagerInstance.registerProvider(provider);
        }
        break;
      }
      case 'openai-responses': {
        const provider = createOpenAIResponsesAliasProvider(
          entry,
          openaiApiKey,
          openaiBaseUrl,
          openaiProviderConfig,
          oauthManager,
        );
        if (provider) {
          providerManagerInstance.registerProvider(provider);
        }
        break;
      }
      case 'openaivercel':
      case 'openai-vercel': {
        const provider = createOpenAIVercelAliasProvider(
          entry,
          openaiApiKey,
          openaiBaseUrl,
          openaiProviderConfig,
          oauthManager,
        );
        if (provider) {
          providerManagerInstance.registerProvider(provider);
        }
        break;
      }
      case 'gemini': {
        const provider = createGeminiAliasProvider(entry, oauthManager, config);
        if (provider) {
          providerManagerInstance.registerProvider(provider);
        }
        break;
      }
      case 'anthropic': {
        const provider = createAnthropicAliasProvider(
          entry,
          oauthManager,
          authOnlyEnabled,
        );
        if (provider) {
          providerManagerInstance.registerProvider(provider);
        }
        break;
      }
      default: {
        debugLogger.warn(
          `[ProviderManager] Unsupported base provider '${entry.config.baseProvider}' for alias '${entry.alias}', skipping.`,
        );
      }
    }
  }
}
