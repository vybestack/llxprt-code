/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ProviderManager,
  OpenAIProvider,
  OpenAIResponsesProvider,
  AnthropicProvider,
  GeminiProvider,
  sanitizeForByteString,
  needsSanitization,
  getSettingsService,
} from '@vybestack/llxprt-code-core';
import { IFileSystem, NodeFileSystem } from './IFileSystem.js';
import {
  Settings,
  LoadedSettings,
  USER_SETTINGS_PATH,
} from '../config/settings.js';
import stripJsonComments from 'strip-json-comments';
import { OAuthManager } from '../auth/oauth-manager.js';
import { MultiProviderTokenStore } from '../auth/types.js';
import { ensureOAuthProviderRegistered } from './oauth-provider-registration.js';
import { HistoryItemWithoutId } from '../ui/types.js';
import { IProviderConfig } from '@vybestack/llxprt-code-core/providers/types/IProviderConfig.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasEntry,
} from './providerAliases.js';

/**
 * Sanitizes API keys to remove problematic characters that cause ByteString errors.
 * This handles cases where API key files have encoding issues or contain
 * Unicode replacement characters (U+FFFD).
 */
function sanitizeApiKey(key: string): string {
  const sanitized = sanitizeForByteString(key);

  if (needsSanitization(key)) {
    console.warn(
      '[ProviderManager] API key contained non-ASCII or control characters that were removed. ' +
        'Please check your API key file encoding (should be UTF-8 without BOM).',
    );
  }

  return sanitized;
}

let providerManagerInstance: ProviderManager | null = null;
let fileSystemInstance: IFileSystem | null = null;
let oauthManagerInstance: OAuthManager | null = null;

interface OpenAIRegistrationContext {
  apiKey?: string;
  baseUrl?: string;
  providerConfig: IProviderConfig;
  oauthManager: OAuthManager;
}

let openAIRegistrationContext: OpenAIRegistrationContext | null = null;

function coerceAuthOnly(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

function resolveAuthOnlyFlag(
  config?: Config,
  loadedSettings?: LoadedSettings,
): boolean {
  if (config && typeof config.getEphemeralSettings === 'function') {
    const authOnlyValue = (
      config.getEphemeralSettings() as Record<string, unknown>
    ).authOnly;
    if (authOnlyValue !== undefined) {
      const coerced = coerceAuthOnly(authOnlyValue);
      if (typeof coerced === 'boolean') {
        return coerced;
      }
    }
  }

  if (loadedSettings?.merged) {
    const mergedAuthOnly = (loadedSettings.merged as Record<string, unknown>)
      .authOnly;
    if (mergedAuthOnly !== undefined) {
      const coerced = coerceAuthOnly(mergedAuthOnly);
      if (typeof coerced === 'boolean') {
        return coerced;
      }
    }
  }

  if (typeof getSettingsService === 'function') {
    try {
      const settingsService = getSettingsService();
      if (settingsService && typeof settingsService.get === 'function') {
        const serviceValue = settingsService.get('authOnly');
        if (serviceValue !== undefined) {
          const coerced = coerceAuthOnly(serviceValue);
          if (typeof coerced === 'boolean') {
            return coerced;
          }
        }
      }
    } catch (_error) {
      // Ignore SettingsService lookup failures and fall back to default
    }
  }

  return false;
}

/**
 * Set a custom file system implementation (mainly for testing).
 */
export function setFileSystem(fs: IFileSystem): void {
  fileSystemInstance = fs;
}

/**
 * Get the file system implementation to use.
 */
function getFileSystem(): IFileSystem {
  if (!fileSystemInstance) {
    fileSystemInstance = new NodeFileSystem();
  }
  return fileSystemInstance;
}

export function getProviderManager(
  config?: Config,
  allowBrowserEnvironment = false,
  settings?: LoadedSettings,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number,
): ProviderManager {
  // If we have an existing instance and addItem is provided, update the OAuth providers
  if (providerManagerInstance && addItem && oauthManagerInstance) {
    // Access the private providers Map - this is a necessary workaround
    // since OAuthManager doesn't expose a public method to access providers
    const providersMap = (
      oauthManagerInstance as unknown as { providers?: Map<string, unknown> }
    ).providers;
    if (providersMap && providersMap instanceof Map) {
      for (const provider of providersMap.values()) {
        const p = provider as {
          name?: string;
          setAddItem?: (callback: typeof addItem) => void;
        };
        if (p.name === 'anthropic' && p.setAddItem) {
          p.setAddItem(addItem);
        }
        if (p.name === 'qwen' && p.setAddItem) {
          p.setAddItem(addItem);
        }
        if (p.name === 'gemini' && p.setAddItem) {
          p.setAddItem(addItem);
        }
      }
    }
  }

  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();
    const fs = getFileSystem();

    // If settings weren't passed in, try to load them
    let loadedSettings = settings;
    if (!loadedSettings) {
      // Load user settings
      let userSettings: Settings | undefined;
      try {
        if (fs.existsSync(USER_SETTINGS_PATH)) {
          const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
          userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
        }
      } catch (_error) {
        // Failed to load user settings, that's OK
      }

      // Create LoadedSettings from user settings for OAuth manager
      loadedSettings = userSettings
        ? new LoadedSettings(
            { path: '', settings: {} }, // system
            { path: '', settings: {} }, // systemDefaults
            { path: USER_SETTINGS_PATH, settings: userSettings }, // user
            { path: '', settings: {} }, // workspace
            true, // isTrusted
          )
        : undefined;
    }

    const authOnlyEnabled = resolveAuthOnlyFlag(config, loadedSettings);

    // @plan:PLAN-20250823-AUTHFIXES.P15
    // @requirement:REQ-004
    // Create OAuth manager for providers with TokenStore integration
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore, loadedSettings);
    oauthManagerInstance = oauthManager;

    // CRITICAL FIX: Don't register OAuth providers upfront
    // They should be registered on-demand when actually needed
    // This prevents premature OAuth initialization during MCP operations

    // Set config BEFORE registering providers so logging wrapper works
    if (config) {
      providerManagerInstance.setConfig(config);
      // CRITICAL: Set provider manager on config so LoggingProviderWrapper can accumulate tokens!
      config.setProviderManager(providerManagerInstance);
    }

    // Register OAuth providers on-demand when creating actual providers
    // Gemini Provider
    providerManagerInstance.registerProvider(
      getGeminiProvider(oauthManager, config),
    );

    // Register Gemini OAuth provider when Gemini provider is created
    if (oauthManager && tokenStore) {
      void ensureOAuthProviderRegistered(
        'gemini',
        oauthManager,
        tokenStore,
        addItem,
      );
    }

    // Gemini auth configuration removed - use explicit --key/--keyfile, /key//keyfile commands, profiles, env vars, or OAuth only

    // Always register OpenAI provider
    // Priority: Environment variable only - no automatic keyfile loading
    let openaiApiKey: string | undefined;

    if (!authOnlyEnabled && process.env.OPENAI_API_KEY) {
      openaiApiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
    }

    const openaiBaseUrl = process.env.OPENAI_BASE_URL;
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.log('[ProviderManager] Initializing OpenAI provider with:', {
        hasApiKey: !!openaiApiKey,
        baseUrl: openaiBaseUrl || 'default',
      });
    }
    // Create provider config from loaded settings
    const settingsData = loadedSettings?.merged || {};
    const openaiProviderConfig = {
      enableTextToolCallParsing: settingsData.enableTextToolCallParsing,
      textToolCallModels: settingsData.textToolCallModels,
      providerToolFormatOverrides: settingsData.providerToolFormatOverrides,
      openaiResponsesEnabled: settingsData.openaiResponsesEnabled,
      allowBrowserEnvironment,
      getEphemeralSettings: config
        ? () => config.getEphemeralSettings()
        : undefined,
    };
    openAIRegistrationContext = {
      apiKey: openaiApiKey || undefined,
      baseUrl: openaiBaseUrl,
      providerConfig: openaiProviderConfig,
      oauthManager,
    };

    providerManagerInstance.registerProvider(
      getOpenAIProvider(
        openaiApiKey,
        openaiBaseUrl,
        openaiProviderConfig,
        oauthManager,
      ),
    );
    const aliasEntries = loadProviderAliasEntries();
    registerAliasProviders(
      providerManagerInstance,
      aliasEntries,
      openaiApiKey,
      openaiBaseUrl,
      openaiProviderConfig,
      oauthManager,
    );

    // Register qwen as an alias to OpenAI provider with OAuth
    // When user selects "--provider qwen", we create a separate OpenAI instance for Qwen
    // Create a special config for qwen that ensures proper OAuth identification
    providerManagerInstance.registerProvider(
      getQwenProvider(openaiProviderConfig, oauthManager),
    );

    // Register Qwen OAuth provider when Qwen provider is created
    if (oauthManager && tokenStore) {
      void ensureOAuthProviderRegistered(
        'qwen',
        oauthManager,
        tokenStore,
        addItem,
      );
    }

    // Register OpenAI Responses provider (for o1, o3 models)
    // This provider exclusively uses the /responses endpoint
    providerManagerInstance.registerProvider(
      getOpenAIResponsesProvider(
        openaiApiKey,
        openaiBaseUrl,
        allowBrowserEnvironment,
      ),
    );

    // Always register Anthropic provider
    // Priority: Environment variable only - no automatic keyfile loading
    providerManagerInstance.registerProvider(
      getAnthropicProvider(
        authOnlyEnabled,
        oauthManager,
        allowBrowserEnvironment,
      ),
    );

    // Always register Anthropic OAuth provider so users can switch between API key and OAuth flows
    if (oauthManager && tokenStore) {
      void ensureOAuthProviderRegistered(
        'anthropic',
        oauthManager,
        tokenStore,
        addItem,
      );
    }

    // Set default provider to gemini
    providerManagerInstance.setActiveProvider('gemini');
  }

  return providerManagerInstance;
}

export function resetProviderManager(): void {
  providerManagerInstance = null;
  fileSystemInstance = null;
  oauthManagerInstance = null;
}

export function getOAuthManager(): OAuthManager | null {
  return oauthManagerInstance;
}
function getOpenAIProvider(
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
): OpenAIProvider {
  const openaiProvider = new OpenAIProvider(
    openaiApiKey || undefined, // Pass undefined, not empty string, to allow OAuth fallback
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
  );
  return openaiProvider;
}
function registerAliasProviders(
  providerManagerInstance: ProviderManager,
  aliasEntries: ProviderAliasEntry[],
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
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
      default:
        console.warn(
          `[ProviderManager] Unsupported base provider '${entry.config.baseProvider}' for alias '${entry.alias}', skipping.`,
        );
    }
  }
}

function createOpenAIAliasProvider(
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
): OpenAIProvider | null {
  const resolvedBaseUrl = entry.config.baseUrl || openaiBaseUrl;
  if (!resolvedBaseUrl) {
    console.warn(
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
    aliasApiKey || undefined,
    resolvedBaseUrl,
    aliasProviderConfig,
    oauthManager,
  );

  if (
    entry.config.defaultModel &&
    typeof provider.getDefaultModel === 'function'
  ) {
    const configuredDefaultModel = entry.config.defaultModel;
    const originalGetDefaultModel = provider.getDefaultModel.bind(provider);
    provider.getDefaultModel = () =>
      configuredDefaultModel || originalGetDefaultModel();
  }

  Object.defineProperty(provider, 'name', {
    value: entry.alias,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  return provider;
}

export function refreshAliasProviders(): void {
  if (!providerManagerInstance || !openAIRegistrationContext) {
    return;
  }

  const aliasEntries = loadProviderAliasEntries();
  registerAliasProviders(
    providerManagerInstance,
    aliasEntries,
    openAIRegistrationContext.apiKey,
    openAIRegistrationContext.baseUrl,
    openAIRegistrationContext.providerConfig,
    openAIRegistrationContext.oauthManager,
  );
}

function getQwenProvider(
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
): OpenAIProvider {
  const qwenProviderConfig = {
    ...openaiProviderConfig,
    // Override any OAuth-related settings that might affect provider identification
    forceQwenOAuth: true,
  };
  const qwenProvider = new OpenAIProvider(
    undefined, // No API key - force OAuth
    'https://portal.qwen.ai/v1', // Set Qwen base URL to trigger OAuth enablement
    qwenProviderConfig,
    oauthManager,
  );
  // Override the name to 'qwen' so it can be selected
  Object.defineProperty(qwenProvider, 'name', {
    value: 'qwen',
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return qwenProvider;
}
function getOpenAIResponsesProvider(
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  allowBrowserEnvironment: boolean,
): OpenAIResponsesProvider {
  // Create provider config from user settings
  const openaiProviderConfig = {
    allowBrowserEnvironment,
  };
  const openaiResponsesProvider = new OpenAIResponsesProvider(
    openaiApiKey || undefined, // Use same API key as OpenAI
    openaiBaseUrl,
    openaiProviderConfig,
  );
  return openaiResponsesProvider;
}
function getGeminiProvider(
  oauthManager: OAuthManager,
  config?: Config,
): GeminiProvider {
  // Register OAuth providers on-demand when creating actual providers
  // Gemini Provider
  const geminiProvider = new GeminiProvider(
    undefined,
    undefined,
    config,
    oauthManager,
  );
  if (config) {
    geminiProvider.setConfig(config);
  }
  return geminiProvider;
}
function getAnthropicProvider(
  authOnlyEnabled: boolean,
  oauthManager: OAuthManager,
  allowBrowserEnvironment: boolean,
): AnthropicProvider {
  let anthropicApiKey: string | undefined;

  if (!authOnlyEnabled && process.env.ANTHROPIC_API_KEY) {
    anthropicApiKey = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
  }

  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
  // Create provider config from user settings
  const anthropicProviderConfig = {
    allowBrowserEnvironment,
  };
  const anthropicProvider = new AnthropicProvider(
    anthropicApiKey || undefined, // Pass undefined instead of empty string to allow OAuth fallback
    anthropicBaseUrl,
    anthropicProviderConfig,
    oauthManager,
  );
  return anthropicProvider;
}
export { getProviderManager as providerManager };
