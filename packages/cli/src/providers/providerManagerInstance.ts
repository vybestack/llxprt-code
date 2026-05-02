/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  ProviderManager,
  OpenAIProvider,
  OpenAIResponsesProvider,
  OpenAIVercelProvider,
  AnthropicProvider,
  GeminiProvider,
  FakeProvider,
  sanitizeForByteString,
  needsSanitization,
  type SettingsService,
  getSettingsService,
  DebugLogger,
  debugLogger,
  type MessageBus,
} from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:provider:manager:instance');
import { type IFileSystem, NodeFileSystem } from './IFileSystem.js';
import {
  type Settings,
  LoadedSettings,
  USER_SETTINGS_PATH,
  type MergedSettings,
} from '../config/settings.js';
import stripJsonComments from 'strip-json-comments';
import { OAuthManager } from '../auth/oauth-manager.js';
import type { OAuthManagerRuntimeMessageBusDeps } from '../auth/types.js';
import { ensureOAuthProviderRegistered } from './oauth-provider-registration.js';
import { createTokenStore } from '../auth/proxy/credential-store-factory.js';
import { type HistoryItemWithoutId } from '../ui/types.js';

import { type IProviderConfig } from '@vybestack/llxprt-code-core/providers/types/IProviderConfig.js';
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
    debugLogger.warn(
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
    baseTimestamp?: number,
  ) => number;
  runtimeMessageBus?: MessageBus;
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
  providerConfig: IProviderConfig;
  oauthManager: OAuthManager;
  config?: Config;
  authOnlyEnabled?: boolean;
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
  fileSystemInstance ??= new NodeFileSystem();
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
  } catch {
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
    baseTimestamp?: number,
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

function resolveOpenaiResponsesEnabled(
  ephemeralValue: unknown,
  authOnlyEnabled: boolean,
  settingsValue: unknown,
): boolean | undefined {
  if (ephemeralValue !== undefined) {
    return Boolean(ephemeralValue);
  }

  if (authOnlyEnabled) {
    return true;
  }

  return typeof settingsValue === 'boolean' ? settingsValue : undefined;
}

function resolveOpenaiApiKey(
  ephemeralAuthKey: unknown,
  openaiProviderApiKey: string | undefined,
  authOnlyEnabled: boolean,
): string | undefined {
  if (typeof ephemeralAuthKey === 'string' && ephemeralAuthKey.trim() !== '') {
    return sanitizeApiKey(ephemeralAuthKey);
  }

  if (
    typeof openaiProviderApiKey === 'string' &&
    openaiProviderApiKey.trim() !== ''
  ) {
    return sanitizeApiKey(openaiProviderApiKey);
  }

  const envApiKey = process.env.OPENAI_API_KEY;
  if (typeof envApiKey === 'string' && envApiKey !== '' && !authOnlyEnabled) {
    return sanitizeApiKey(envApiKey);
  }

  return undefined;
}

function resolveOpenaiBaseUrl(
  ephemeralBaseUrl: unknown,
  providerBaseUrl: string | undefined,
): string | undefined {
  if (typeof ephemeralBaseUrl === 'string') {
    return ephemeralBaseUrl;
  }

  if (typeof providerBaseUrl === 'string') {
    return providerBaseUrl;
  }

  return process.env.OPENAI_BASE_URL;
}

function resolveAuthOnlyFlag(
  config?: Config,
  loadedSettings?: LoadedSettings,
): boolean {
  if (config && typeof config.getEphemeralSettings === 'function') {
    const authOnlyValue = config.getEphemeralSettings().authOnly;
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
      const serviceValue = settingsService.get('authOnly');
      if (serviceValue !== undefined) {
        const coerced = coerceAuthOnly(serviceValue);
        if (typeof coerced === 'boolean') {
          return coerced;
        }
      }
    } catch {
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

  // @plan:PLAN-20250214-CREDPROXY.P33
  const tokenStore = createTokenStore();
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  const runtimeOAuthMessageBus = options.runtimeMessageBus;
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  const oauthRuntimeDeps: OAuthManagerRuntimeMessageBusDeps = {
    messageBus: runtimeOAuthMessageBus,
    config: options.config,
  };
  const oauthManager = new OAuthManager(
    tokenStore,
    loadedSettings,
    oauthRuntimeDeps,
  );

  const { config, allowBrowserEnvironment = false, addItem } = options;

  // Short-circuit: when LLXPRT_FAKE_RESPONSES is set, register only FakeProvider
  // and return immediately. This avoids real provider registration (which may
  // require valid API keys) and ensures FakeProvider stays active even after the
  // bootstrap calls switchActiveProvider().
  const fakeResponsesPath = process.env.LLXPRT_FAKE_RESPONSES;
  if (fakeResponsesPath) {
    if (config) {
      manager.setConfig(config);
      config.setProviderManager(manager);
    }
    const fakeProvider = new FakeProvider(fakeResponsesPath, process.cwd());
    manager.registerProvider(fakeProvider);
    manager.setActiveProvider('fake');
    logger.debug(
      () => `FakeProvider active — replaying from ${fakeResponsesPath}`,
    );
    return { manager, oauthManager };
  }

  logger.debug('createProviderManager config check', {
    hasConfig: config !== undefined,
    configType: config?.constructor.name,
  });

  if (config) {
    manager.setConfig(config);
    config.setProviderManager(manager);
    logger.debug(
      'OAuthManager runtime dependencies configured from composition root',
    );
  } else {
    logger.debug('No config provided; runtime MessageBus was not injected');
  }

  const authOnlyEnabled = resolveAuthOnlyFlag(config, loadedSettings);

  const settingsData =
    loadedSettings?.merged ?? ({} as Partial<MergedSettings>);
  const ephemeralSettings = config?.getEphemeralSettings() ?? {};
  const effectiveOpenaiResponsesEnabled = resolveOpenaiResponsesEnabled(
    ephemeralSettings.openaiResponsesEnabled,
    authOnlyEnabled,
    settingsData.openaiResponsesEnabled,
  );

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
    (openaiSettings?.apiKey as string | undefined) ??
    (openaiSettings?.['auth-key'] as string | undefined);

  const openaiApiKey = resolveOpenaiApiKey(
    ephemeralAuthKey,
    openaiProviderApiKey,
    authOnlyEnabled,
  );

  // Check for CLI-provided baseUrl in ephemerals or provider settings
  // NOTE: Bootstrap args (--baseurl) should be applied to ephemeral settings
  // by calling applyCliArgumentOverrides() BEFORE creating the provider manager.
  const ephemeralBaseUrl = ephemeralSettings['base-url'];
  const providerBaseUrl = openaiSettings?.['base-url'] as string | undefined;
  const openaiBaseUrl = resolveOpenaiBaseUrl(ephemeralBaseUrl, providerBaseUrl);

  // Debug logging removed - was using debugLogger.log which violates project guidelines
  // Use DebugLogger if detailed logging is needed here

  const openaiProviderConfig: IProviderConfig = {
    enableTextToolCallParsing: settingsData.enableTextToolCallParsing,
    textToolCallModels: settingsData.textToolCallModels,
    providerToolFormatOverrides: settingsData.providerToolFormatOverrides,
    openaiResponsesEnabled: effectiveOpenaiResponsesEnabled,
    allowBrowserEnvironment,
    getEphemeralSettings: config
      ? () => config.getEphemeralSettings()
      : undefined,
  };

  // All providers are now registered via alias configs
  const aliasEntries = loadProviderAliasEntries();
  registerAliasProviders(
    manager,
    aliasEntries,
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
    config,
    authOnlyEnabled,
  );

  // Register OAuth providers for authentication support
  void ensureOAuthProviderRegistered(
    'gemini',
    oauthManager,
    tokenStore,
    addItem,
  );

  void ensureOAuthProviderRegistered('qwen', oauthManager, tokenStore, addItem);

  void ensureOAuthProviderRegistered(
    'anthropic',
    oauthManager,
    tokenStore,
    addItem,
  );

  void ensureOAuthProviderRegistered(
    'codex',
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
    config,
    authOnlyEnabled,
  };
  openAIContexts.set(manager, openAIContext);

  return { manager, oauthManager };
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P08
 * @requirement REQ-D01-003.3
 * @requirement REQ-D01-004.3
 * @requirement REQ-D01-001.4
 * @pseudocode lines 92-102
 */
export function registerProviderManagerSingleton(
  manager: ProviderManager,
  oauthManager: OAuthManager,
): void {
  singletonManager = manager;
  singletonOAuthManager = oauthManager;
}

export function getProviderManager(
  config?: Config,
  allowBrowserEnvironment = false,
  settings?: LoadedSettings,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
  ) => number,
): ProviderManager {
  void config;
  void allowBrowserEnvironment;
  void settings;
  if (singletonManager && addItem && singletonOAuthManager) {
    attachAddItemToOAuthProviders(singletonOAuthManager, addItem);
  }

  if (!singletonManager) {
    throw new Error(
      'ProviderManager singleton has not been registered. Initialize provider infrastructure at the composition root before requesting it.',
    );
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
    context.config,
    context.authOnlyEnabled,
  );
}

export { getProviderManager as providerManager };

function registerAliasProviders(
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

type AliasAwareBaseProvider = {
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

function isAliasDefaultModelProvider(
  provider: unknown,
): provider is AliasDefaultModelProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'getDefaultModel' in provider &&
    typeof provider.getDefaultModel === 'function'
  );
}

function overrideAliasDefaultModel(
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

function bindProviderAliasIdentity(provider: unknown, alias: string): void {
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

function createOpenAIAliasProvider(
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

function createOpenAIResponsesAliasProvider(
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

function createOpenAIVercelAliasProvider(
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

function createGeminiAliasProvider(
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

function createAnthropicAliasProvider(
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
