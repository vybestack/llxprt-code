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
import { GeminiOAuthProvider } from '../auth/gemini-oauth-provider.js';
import { QwenOAuthProvider } from '../auth/qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
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

function registerOAuthProviders(
  oauthManager: OAuthManager,
  tokenStore: MultiProviderTokenStore,
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number,
): void {
  const geminiOAuthProvider = new GeminiOAuthProvider(tokenStore);
  const qwenOAuthProvider = new QwenOAuthProvider(tokenStore);
  const anthropicOAuthProvider = new AnthropicOAuthProvider(tokenStore);

  oauthManager.registerProvider(geminiOAuthProvider);
  oauthManager.registerProvider(qwenOAuthProvider);
  oauthManager.registerProvider(anthropicOAuthProvider);

  if (addItem) {
    const providersMap = (
      oauthManager as unknown as {
        providers?: Map<string, unknown>;
      }
    ).providers;
    if (providersMap instanceof Map) {
      for (const provider of providersMap.values()) {
        const p = provider as {
          name?: string;
          setAddItem?: (callback: typeof addItem) => void;
        };
        if (p.name && p.setAddItem) {
          p.setAddItem(addItem);
        }
      }
    }
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
  registerOAuthProviders(oauthManager, tokenStore, options.addItem);

  const { config, allowBrowserEnvironment = false } = options;

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
  if (config) {
    geminiProvider.setConfig(config);
  }
  manager.registerProvider(geminiProvider);

  let openaiApiKey: string | undefined;
  if (process.env.OPENAI_API_KEY) {
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

  const openaiProvider = new OpenAIProvider(
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
    oauthManager,
  );
  manager.registerProvider(openaiProvider);

  if (settingsData.openaiResponsesEnabled) {
    const openaiResponsesProvider = new OpenAIResponsesProvider(
      openaiApiKey,
      openaiBaseUrl,
      openaiProviderConfig,
    );
    manager.registerProvider(openaiResponsesProvider);
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
    ? sanitizeApiKey(process.env.ANTHROPIC_API_KEY)
    : undefined;
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL;

  const anthropicProvider = new AnthropicProvider(
    anthropicApiKey,
    anthropicBaseUrl,
    undefined,
    oauthManager,
  );
  manager.registerProvider(anthropicProvider);

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
