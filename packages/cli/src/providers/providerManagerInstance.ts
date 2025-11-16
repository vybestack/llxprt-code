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
  SettingsService,
  createProviderRuntimeContext,
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

let fileSystemInstance: IFileSystem | null = null;
let singletonManager: ProviderManager | null = null;
let singletonOAuthManager: OAuthManager | null = null;
let openAIContexts = new WeakMap<ProviderManager, OpenAIRegistrationContext>();

interface ProviderManagerFactoryOptions {
  config?: Config;
  allowBrowserEnvironment?: boolean;
  settings?: LoadedSettings;
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
}

type RuntimeContextShape = {
  settingsService: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
};

interface OpenAIRegistrationContext {
  apiKey?: string;
  baseUrl?: string;
  providerConfig: ProviderConfigWithToolMode;
  oauthManager: OAuthManager;
}

type ProviderConfigWithToolMode = IProviderConfig & {
  toolCallProcessingMode?: 'pipeline' | 'legacy';
};

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

function resolveLoadedSettings(
  fs: IFileSystem,
  settings?: LoadedSettings,
): LoadedSettings | undefined {
  if (settings) {
    return settings;
  }

  let userSettings: Settings | undefined;
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
    }
  } catch (_error) {
    // Failed to load user settings, ignore and fall back to defaults.
  }

  return userSettings
    ? new LoadedSettings(
        { path: '', settings: {} },
        { path: '', settings: {} },
        { path: USER_SETTINGS_PATH, settings: userSettings },
        { path: '', settings: {} },
        true,
      )
    : undefined;
}

function attachAddItemToOAuthProviders(
  oauthManager: OAuthManager,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number,
): void {
  if (!addItem) {
    return;
  }

  const providersMap = (
    oauthManager as unknown as { providers?: Map<string, unknown> }
  ).providers;

  if (!(providersMap instanceof Map)) {
    return;
  }

  for (const provider of providersMap.values()) {
    const candidate = provider as {
      setAddItem?: (callback: typeof addItem) => void;
    };
    candidate.setAddItem?.(addItem);
  }
}

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

export function createProviderManager(
  context: RuntimeContextShape,
  options: ProviderManagerFactoryOptions = {},
): { manager: ProviderManager; oauthManager: OAuthManager } {
  const fs = getFileSystem();
  const loadedSettings = resolveLoadedSettings(fs, options.settings);
  const ManagerCtor = ProviderManager as unknown as {
    new (context?: unknown): ProviderManager;
  };
  const manager = new ManagerCtor(context);

  const tokenStore = new MultiProviderTokenStore();
  const oauthManager = new OAuthManager(tokenStore, loadedSettings);

  const { config, allowBrowserEnvironment = false, addItem } = options;

  if (config) {
    manager.setConfig(config);
    config.setProviderManager(manager);
  }

  const authOnlyEnabled = resolveAuthOnlyFlag(config, loadedSettings);
  const geminiProvider = getGeminiProvider(oauthManager, config);
  manager.registerProvider(geminiProvider);

  void ensureOAuthProviderRegistered(
    'gemini',
    oauthManager,
    tokenStore,
    addItem,
  );

  const settingsData = loadedSettings?.merged || {};
  const ephemeralSettings = config?.getEphemeralSettings?.() ?? {};
  const effectiveOpenaiResponsesEnabled: boolean | undefined =
    ephemeralSettings.openaiResponsesEnabled !== undefined
      ? Boolean(ephemeralSettings.openaiResponsesEnabled)
      : authOnlyEnabled
        ? true
        : typeof settingsData.openaiResponsesEnabled === 'boolean'
          ? settingsData.openaiResponsesEnabled
          : undefined;

  // Check for CLI-provided API key first (highest priority)
  // NOTE: Bootstrap args (--key, --keyfile) should be applied to ephemeral settings
  // by calling applyCliArgumentOverrides() BEFORE creating the provider manager.
  // We check ephemeralSettings['auth-key'] which should already contain the resolved value.
  const ephemeralAuthKey = ephemeralSettings['auth-key'];

  // Also check provider-specific settings if no ephemeral auth-key
  const settingsProviders = settingsData as Record<string, unknown>;
  const openaiProviderSettings = settingsProviders.providers as
    | Record<string, unknown>
    | undefined;
  const openaiSettings = openaiProviderSettings?.openai as
    | Record<string, unknown>
    | undefined;
  const openaiProviderApiKey =
    (openaiSettings?.apiKey as string | undefined) ||
    (openaiSettings?.['auth-key'] as string | undefined);

  let openaiApiKey: string | undefined;

  if (
    ephemeralAuthKey &&
    typeof ephemeralAuthKey === 'string' &&
    ephemeralAuthKey.trim() !== ''
  ) {
    openaiApiKey = sanitizeApiKey(ephemeralAuthKey);
  } else if (
    openaiProviderApiKey &&
    typeof openaiProviderApiKey === 'string' &&
    openaiProviderApiKey.trim() !== ''
  ) {
    openaiApiKey = sanitizeApiKey(openaiProviderApiKey);
  } else if (process.env.OPENAI_API_KEY && !authOnlyEnabled) {
    openaiApiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
  }

  // Check for CLI-provided baseUrl in ephemerals or provider settings
  // NOTE: Bootstrap args (--baseurl) should be applied to ephemeral settings
  // by calling applyCliArgumentOverrides() BEFORE creating the provider manager.
  const ephemeralBaseUrl = ephemeralSettings['base-url'];
  const providerBaseUrl =
    (openaiSettings?.baseUrl as string | undefined) ||
    (openaiSettings?.baseURL as string | undefined);
  const openaiBaseUrl =
    ephemeralBaseUrl && typeof ephemeralBaseUrl === 'string'
      ? ephemeralBaseUrl
      : providerBaseUrl && typeof providerBaseUrl === 'string'
        ? providerBaseUrl
        : process.env.OPENAI_BASE_URL;

  if (process.env.DEBUG || process.env.VERBOSE) {
    console.log('[ProviderManager] Initializing OpenAI provider with:', {
      hasApiKey: !!openaiApiKey,
      hasEphemeralAuthKey: !!ephemeralAuthKey,
      hasProviderApiKey: !!openaiProviderApiKey,
      baseUrl: openaiBaseUrl || 'default',
    });
  }

  const openaiProviderConfig: ProviderConfigWithToolMode = {
    enableTextToolCallParsing: settingsData.enableTextToolCallParsing,
    textToolCallModels: settingsData.textToolCallModels,
    providerToolFormatOverrides: settingsData.providerToolFormatOverrides,
    openaiResponsesEnabled: effectiveOpenaiResponsesEnabled,
    toolCallProcessingMode: settingsData.toolCallProcessingMode,
    allowBrowserEnvironment,
    getEphemeralSettings: config
      ? () => config.getEphemeralSettings()
      : undefined,
  };

  manager.registerProvider(
    getOpenAIProvider(
      openaiApiKey,
      openaiBaseUrl,
      openaiProviderConfig,
      oauthManager,
    ),
  );

  const aliasEntries = loadProviderAliasEntries();
  registerAliasProviders(
    manager,
    aliasEntries,
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
  );

  manager.registerProvider(getQwenProvider(openaiProviderConfig, oauthManager));

  void ensureOAuthProviderRegistered('qwen', oauthManager, tokenStore, addItem);

  if (effectiveOpenaiResponsesEnabled) {
    manager.registerProvider(
      getOpenAIResponsesProvider(
        openaiApiKey,
        openaiBaseUrl,
        allowBrowserEnvironment,
      ),
    );
  }

  manager.registerProvider(
    getAnthropicProvider(
      authOnlyEnabled,
      oauthManager,
      allowBrowserEnvironment,
    ),
  );

  void ensureOAuthProviderRegistered(
    'anthropic',
    oauthManager,
    tokenStore,
    addItem,
  );

  manager.setActiveProvider('gemini');
  attachAddItemToOAuthProviders(oauthManager, addItem);

  const openAIContext: OpenAIRegistrationContext = {
    apiKey: openaiApiKey ?? undefined,
    baseUrl: openaiBaseUrl ?? undefined,
    providerConfig: openaiProviderConfig,
    oauthManager,
  };
  openAIContexts.set(manager, openAIContext);

  return { manager, oauthManager };
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
  if (singletonManager && addItem && singletonOAuthManager) {
    attachAddItemToOAuthProviders(singletonOAuthManager, addItem);
  }

  if (!singletonManager) {
    const runtime = createProviderRuntimeContext({
      settingsService: config?.getSettingsService() ?? new SettingsService(),
      config,
      runtimeId: 'provider-manager-singleton',
      metadata: { source: 'providerManagerInstance.getProviderManager' },
    });
    const { manager, oauthManager } = createProviderManager(runtime, {
      config,
      allowBrowserEnvironment,
      settings,
      addItem,
    });
    singletonManager = manager;
    singletonOAuthManager = oauthManager;
    if (config) {
      config.setProviderManager(manager);
    }
  }

  return singletonManager;
}

export function resetProviderManager(): void {
  singletonManager = null;
  singletonOAuthManager = null;
  openAIContexts = new WeakMap();
}

export function getOAuthManager(): OAuthManager | null {
  return singletonOAuthManager;
}

export function refreshAliasProviders(): void {
  if (!singletonManager) {
    return;
  }

  const context = openAIContexts.get(singletonManager);
  if (!context) {
    return;
  }

  const aliasEntries = loadProviderAliasEntries();
  registerAliasProviders(
    singletonManager,
    aliasEntries,
    context.apiKey,
    context.baseUrl,
    context.providerConfig,
    context.oauthManager,
  );
}

export { getProviderManager as providerManager };

function getOpenAIProvider(
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
): OpenAIProvider {
  return new OpenAIProvider(
    openaiApiKey || undefined,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
  );
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
      default: {
        console.warn(
          `[ProviderManager] Unsupported base provider '${entry.config.baseProvider}' for alias '${entry.alias}', skipping.`,
        );
      }
    }
  }
}

type AliasAwareOpenAIProvider = OpenAIProvider & {
  authResolver?: {
    updateConfig: (config: { providerId?: string }) => void;
  };
  baseProviderConfig?: {
    name?: string;
  };
};

/**
 * Ensure alias providers use their own identifier when resolving authentication.
 * Without this, API keys saved via `/key` are stored under the alias name,
 * but the OpenAI provider would continue to look up credentials under `openai`.
 */
export function bindOpenAIAliasIdentity(
  provider: OpenAIProvider,
  alias: string,
): void {
  const aliasName = alias?.trim();
  if (!aliasName) {
    return;
  }

  Object.defineProperty(provider, 'name', {
    value: aliasName,
    writable: false,
    enumerable: true,
    configurable: true,
  });

  const aliasAwareProvider = provider as unknown as AliasAwareOpenAIProvider;
  if (aliasAwareProvider.baseProviderConfig) {
    aliasAwareProvider.baseProviderConfig.name = aliasName;
  }

  aliasAwareProvider.authResolver?.updateConfig?.({
    providerId: aliasName,
  });
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

  bindOpenAIAliasIdentity(provider, entry.alias);

  return provider;
}

function getQwenProvider(
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
): OpenAIProvider {
  const qwenProviderConfig = {
    ...openaiProviderConfig,
    forceQwenOAuth: true,
  };
  const qwenProvider = new OpenAIProvider(
    undefined,
    'https://portal.qwen.ai/v1',
    qwenProviderConfig,
    oauthManager,
  );
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
  const openaiResponsesProvider = new OpenAIResponsesProvider(
    openaiApiKey || undefined,
    openaiBaseUrl,
    { allowBrowserEnvironment },
  );
  return openaiResponsesProvider;
}

function getGeminiProvider(
  oauthManager: OAuthManager,
  config?: Config,
): GeminiProvider {
  const geminiProvider = new GeminiProvider(
    undefined,
    undefined,
    config,
    oauthManager,
  );
  if (config && typeof geminiProvider.setConfig === 'function') {
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
  const anthropicProvider = new AnthropicProvider(
    anthropicApiKey || undefined,
    anthropicBaseUrl,
    { allowBrowserEnvironment },
    oauthManager,
  );
  return anthropicProvider;
}
