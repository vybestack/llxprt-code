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

interface ProviderManagerFactoryOptions {
  config?: Config;
  allowBrowserEnvironment?: boolean;
  settings?: LoadedSettings;
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
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

type RuntimeContextShape = {
  settingsService: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
};

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

  const geminiProvider = new GeminiProvider(
    undefined,
    undefined,
    config,
    oauthManager,
  );

  if (
    config &&
    'setConfig' in geminiProvider &&
    typeof geminiProvider.setConfig === 'function'
  ) {
    geminiProvider.setConfig(config);
  }

  manager.registerProvider(geminiProvider);

  void ensureOAuthProviderRegistered(
    'gemini',
    oauthManager,
    tokenStore,
    addItem,
  );

  // Check if authOnly mode is enabled - if so, ignore API keys
  const ephemeralSettings = config?.getEphemeralSettings() || {};
  const authOnlyEnabled = ephemeralSettings.authOnly === true;

  let openaiApiKey: string | undefined;
  if (process.env.OPENAI_API_KEY && !authOnlyEnabled) {
    openaiApiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
  }

  const openaiBaseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.DEBUG || process.env.VERBOSE) {
    console.log('[ProviderManager] Initializing OpenAI provider with:', {
      hasApiKey: !!openaiApiKey,
      baseUrl: openaiBaseUrl || 'default',
    });
  }

  const settingsData = loadedSettings?.merged || {};
  // Merge settings from both loaded settings and ephemeral settings for runtime config
  // When authOnly is enabled, enable openaiResponses to provide additional options
  const effectiveOpenaiResponsesEnabled: boolean | undefined =
    ephemeralSettings.openaiResponsesEnabled !== undefined
      ? Boolean(ephemeralSettings.openaiResponsesEnabled)
      : authOnlyEnabled
        ? true
        : typeof settingsData.openaiResponsesEnabled === 'boolean'
          ? settingsData.openaiResponsesEnabled
          : undefined;
  const openaiProviderConfig = {
    enableTextToolCallParsing: settingsData.enableTextToolCallParsing,
    textToolCallModels: settingsData.textToolCallModels,
    providerToolFormatOverrides: settingsData.providerToolFormatOverrides,
    openaiResponsesEnabled: effectiveOpenaiResponsesEnabled,
    allowBrowserEnvironment,
    getEphemeralSettings: config
      ? () => config.getEphemeralSettings()
      : undefined,
  };

  const openaiProvider = new OpenAIProvider(
    openaiApiKey ?? undefined,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
  );
  manager.registerProvider(openaiProvider);

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
  manager.registerProvider(qwenProvider);

  void ensureOAuthProviderRegistered('qwen', oauthManager, tokenStore, addItem);

  if (effectiveOpenaiResponsesEnabled) {
    const openaiResponsesProvider = new OpenAIResponsesProvider(
      openaiApiKey ?? undefined,
      openaiBaseUrl,
      openaiProviderConfig,
    );
    manager.registerProvider(openaiResponsesProvider);
  }

  let anthropicApiKey: string | undefined;
  if (process.env.ANTHROPIC_API_KEY && !authOnlyEnabled) {
    anthropicApiKey = sanitizeApiKey(process.env.ANTHROPIC_API_KEY);
  }
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const anthropicProviderConfig = {
    allowBrowserEnvironment,
  };
  // Always pass oauthManager to Anthropic provider to enable OAuth as an option
  const anthropicProvider = new AnthropicProvider(
    anthropicApiKey ?? undefined,
    anthropicBaseUrl,
    anthropicProviderConfig,
    oauthManager,
  );
  manager.registerProvider(anthropicProvider);

  // Always register OAuth provider for Anthropic to make it available as an option
  void ensureOAuthProviderRegistered(
    'anthropic',
    oauthManager,
    tokenStore,
    addItem,
  );

  manager.setActiveProvider('gemini');
  attachAddItemToOAuthProviders(oauthManager, addItem);

  return { manager, oauthManager };
}

let singletonManager: ProviderManager | null = null;

export function getProviderManager(
  config?: Config,
  allowBrowserEnvironment = false,
  settings?: LoadedSettings,
): ProviderManager {
  if (!singletonManager) {
    const runtime = createProviderRuntimeContext({
      settingsService: config?.getSettingsService() ?? new SettingsService(),
      config,
      runtimeId: 'provider-manager-singleton',
      metadata: { source: 'providerManagerInstance.getProviderManager' },
    });
    const { manager } = createProviderManager(runtime, {
      config,
      allowBrowserEnvironment,
      settings,
    });
    singletonManager = manager;
    if (config) {
      config.setProviderManager(manager);
    }
  }
  return singletonManager;
}

export function resetProviderManager(): void {
  singletonManager = null;
}
