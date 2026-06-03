/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  ProviderManager,
  FakeProvider,
  type SettingsService,
  getSettingsService,
  DebugLogger,
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

import {
  sanitizeApiKey,
  registerAliasProviders,
} from './aliasProviderFactory.js';

export { bindOpenAIAliasIdentity } from './aliasProviderFactory.js';

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

  const settingsServiceAuthOnly = tryGetSettingsServiceAuthOnly();
  if (settingsServiceAuthOnly !== undefined) {
    return settingsServiceAuthOnly;
  }

  return false;
}

/**
 * Attempts to get authOnly from SettingsService, returning undefined on failure.
 */
function tryGetSettingsServiceAuthOnly(): boolean | undefined {
  if (typeof getSettingsService !== 'function') {
    return undefined;
  }
  try {
    const settingsService = getSettingsService();
    const serviceValue = settingsService.get('authOnly');
    if (serviceValue === undefined) {
      return undefined;
    }
    const coerced = coerceAuthOnly(serviceValue);
    return typeof coerced === 'boolean' ? coerced : undefined;
  } catch {
    // Ignore SettingsService lookup failures and fall back to default
    return undefined;
  }
}

/** Registers OAuth providers for authentication support. */
function registerOAuthProviders(
  oauthManager: OAuthManager,
  tokenStore: ReturnType<typeof createTokenStore>,
  addItem: ProviderManagerFactoryOptions['addItem'],
): void {
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
}

/** Resolves OpenAI-specific settings from merged settings and ephemeral overrides. */
function resolveOpenaiSettings(
  config: Config | undefined,
  loadedSettings: LoadedSettings | undefined,
  authOnlyEnabled: boolean,
  allowBrowserEnvironment: boolean,
): {
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiProviderConfig: IProviderConfig;
} {
  const settingsData =
    loadedSettings?.merged ?? ({} as Partial<MergedSettings>);
  const ephemeralSettings = config?.getEphemeralSettings() ?? {};
  const effectiveOpenaiResponsesEnabled = resolveOpenaiResponsesEnabled(
    ephemeralSettings.openaiResponsesEnabled,
    authOnlyEnabled,
    settingsData.openaiResponsesEnabled,
  );

  const ephemeralAuthKey = ephemeralSettings['auth-key'];
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

  const ephemeralBaseUrl = ephemeralSettings['base-url'];
  const providerBaseUrl = openaiSettings?.['base-url'] as string | undefined;
  const openaiBaseUrl = resolveOpenaiBaseUrl(ephemeralBaseUrl, providerBaseUrl);

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

  return { openaiApiKey, openaiBaseUrl, openaiProviderConfig };
}

/** Registers all alias-based providers and OAuth providers on the manager. */
function registerAllProviders(
  manager: ProviderManager,
  aliasEntries: ProviderAliasEntry[],
  openaiApiKey: string | undefined,
  openaiBaseUrl: string | undefined,
  openaiProviderConfig: IProviderConfig,
  oauthManager: OAuthManager,
  tokenStore: ReturnType<typeof createTokenStore>,
  config: Config | undefined,
  authOnlyEnabled: boolean,
  addItem: ProviderManagerFactoryOptions['addItem'],
): void {
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

  registerOAuthProviders(oauthManager, tokenStore, addItem);
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
  const oauthRuntimeDeps: OAuthManagerRuntimeMessageBusDeps = {
    messageBus: options.runtimeMessageBus,
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
  }

  const authOnlyEnabled = resolveAuthOnlyFlag(config, loadedSettings);
  const { openaiApiKey, openaiBaseUrl, openaiProviderConfig } =
    resolveOpenaiSettings(
      config,
      loadedSettings,
      authOnlyEnabled,
      allowBrowserEnvironment,
    );

  const aliasEntries = loadProviderAliasEntries();
  registerAllProviders(
    manager,
    aliasEntries,
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
    tokenStore,
    config,
    authOnlyEnabled,
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
