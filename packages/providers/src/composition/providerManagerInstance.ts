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
  DebugLogger,
  type MessageBus,
  type RuntimeContentGeneratorFactory,
  type ContentGenerator,
  type RuntimeProviderManager,
  type RuntimeTokenizer,
  type RuntimeTokenizerFactory,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { getRuntimeSettingsService } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { ProviderManager } from '../ProviderManager.js';
import type { IProviderManager } from '../IProviderManager.js';
import { FakeProvider } from '../fake/FakeProvider.js';
import { ProviderContentGenerator } from '../ProviderContentGenerator.js';
import { OpenAITokenizer } from '../tokenizers/OpenAITokenizer.js';
import { AnthropicTokenizer } from '../tokenizers/AnthropicTokenizer.js';

const logger = new DebugLogger('llxprt:provider:manager:instance');
import { type IFileSystem, NodeFileSystem } from './IFileSystem.js';
import stripJsonComments from 'strip-json-comments';
import { Storage } from '@vybestack/llxprt-code-settings';
import { OAuthManager, createTokenStore } from '../auth/index.js';
import type { OAuthManagerRuntimeMessageBusDeps } from '../auth/index.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { ensureOAuthProviderRegistered } from './oauth-provider-registration.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';

import { type IProviderConfig } from '../types/IProviderConfig.js';
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
  /**
   * OAuth settings surface injected by the composition root (CLI). Supplies
   * OAuth enablement read/write with full fidelity (comment-preserving writes
   * live in the CLI's settings layer). When omitted, the OAuth manager runs
   * without a settings provider — matching the prior behavior when no user
   * settings file was present.
   */
  oauthSettings?: IOAuthSettingsProvider;
  addItem?: OAuthUICallback;
  runtimeMessageBus?: MessageBus;
}

type RuntimeContextShape = ProviderRuntimeContext;

interface OpenAIRegistrationContext {
  apiKey?: string;
  baseUrl?: string;
  providerConfig: IProviderConfig;
  oauthManager: OAuthManager;
  config?: Config;
  authOnlyEnabled?: boolean;
}

class RuntimeTokenizerAdapter implements RuntimeTokenizer {
  constructor(
    private readonly tokenizer: {
      countTokens(text: string, model: string): Promise<number>;
    },
    private readonly model: string,
  ) {}

  async countTokens(content: unknown): Promise<number> {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content);
    return this.tokenizer.countTokens(text, this.model);
  }
}

const ANTHROPIC_TOKENIZER_MATCHERS = ['anthropic', 'claude'] as const;
const OPENAI_TOKENIZER_MATCHERS = [
  'openai',
  'codex',
  'gpt',
  'o1',
  'o3',
  'o4',
  'deepseek',
] as const;

function matchesTokenizer(
  providerKey: string,
  modelKey: string,
  matchers: readonly string[],
): boolean {
  return matchers.some(
    (matcher) => providerKey.includes(matcher) || modelKey.includes(matcher),
  );
}

function createCliTokenizerFactory(): RuntimeTokenizerFactory {
  const openaiTokenizer = new OpenAITokenizer();
  const anthropicTokenizer = new AnthropicTokenizer();

  return {
    getTokenizer(
      providerName: string,
      model?: string,
    ): RuntimeTokenizer | undefined {
      const providerKey = providerName.toLowerCase();
      const modelKey = (model ?? providerName).toLowerCase();
      if (
        matchesTokenizer(providerKey, modelKey, ANTHROPIC_TOKENIZER_MATCHERS)
      ) {
        return new RuntimeTokenizerAdapter(
          anthropicTokenizer,
          model ?? providerName,
        );
      }
      if (matchesTokenizer(providerKey, modelKey, OPENAI_TOKENIZER_MATCHERS)) {
        return new RuntimeTokenizerAdapter(
          openaiTokenizer,
          model ?? providerName,
        );
      }
      return undefined;
    },
  };
}

function createCliContentGeneratorFactory(
  config: Config,
): RuntimeContentGeneratorFactory<ContentGenerator> {
  return {
    createContentGenerator(manager: RuntimeProviderManager) {
      return new ProviderContentGenerator(
        manager as unknown as IProviderManager,
        {
          model: config.getModel(),
          providerManager: manager,
          proxy: config.getProxy(),
        },
      );
    },
  };
}

/**
 * @plan:PLAN-20260603-ISSUE1584.P16a
 * @requirement:REQ-DEP-001
 */
export function configureProviderRuntimeFactories(
  config: Config,
  manager: RuntimeProviderManager,
): void {
  config.setProviderManager(manager);
  const configWithFactories = config as Config & Record<string, unknown>;
  const setContentGeneratorFactory =
    configWithFactories['setContentGeneratorFactory'];
  if (typeof setContentGeneratorFactory === 'function') {
    setContentGeneratorFactory.call(
      config,
      createCliContentGeneratorFactory(config),
    );
  }
  const setTokenizerFactory = configWithFactories['setTokenizerFactory'];
  if (typeof setTokenizerFactory === 'function') {
    setTokenizerFactory.call(config, createCliTokenizerFactory());
  }
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

/**
 * Read-only view of the user settings fields this composition consumes.
 *
 * The OpenAI/authOnly fields read below are sourced from the raw user-scope
 * settings file. None of these keys are v2-namespace-remapped, so the raw read
 * matches `LoadedSettings.merged` with respect to path mapping. A subset of the
 * OpenAI fields (enableTextToolCallParsing, textToolCallModels,
 * openaiResponsesEnabled, providerToolFormatOverrides) DO carry SETTINGS_SCHEMA
 * defaults that the old merged view layered in; to preserve that behavior those
 * defaults are explicitly restored at the read site in resolveOpenaiSettings
 * (via `?? false` / `?? []` / `?? {}`). OAuth enablement read/write is handled
 * separately via the injected {@link IOAuthSettingsProvider} so that the CLI's
 * comment-preserving write path is preserved.
 */
type UserSettingsView = Record<string, unknown>;

function resolveUserSettings(fs: IFileSystem): UserSettingsView | undefined {
  let userSettings: UserSettingsView | undefined;
  try {
    const userSettingsPath = Storage.getGlobalSettingsPath();
    if (fs.existsSync(userSettingsPath)) {
      const userContent = fs.readFileSync(userSettingsPath, 'utf-8');
      userSettings = JSON.parse(
        stripJsonComments(userContent),
      ) as UserSettingsView;
    }
  } catch {
    // Failed to load user settings, ignore and fall back to defaults.
  }

  return userSettings;
}

function attachAddItemToOAuthProviders(
  oauthManager: OAuthManager,
  addItem?: OAuthUICallback,
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
  userSettings?: UserSettingsView,
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

  if (userSettings) {
    const mergedAuthOnly = userSettings.authOnly;
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
  try {
    const settingsService = getRuntimeSettingsService();
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

/** Resolves OpenAI-specific settings from user settings and ephemeral overrides. */
function resolveOpenaiSettings(
  config: Config | undefined,
  userSettings: UserSettingsView | undefined,
  authOnlyEnabled: boolean,
  allowBrowserEnvironment: boolean,
): {
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiProviderConfig: IProviderConfig;
} {
  const settingsData: Record<string, unknown> = userSettings ?? {};
  const ephemeralSettings = config?.getEphemeralSettings() ?? {};
  // Apply the same schema defaults the CLI's merged-settings layer supplied for
  // these keys (enableTextToolCallParsing/textToolCallModels/
  // openaiResponsesEnabled/providerToolFormatOverrides). Reading the raw user
  // settings file would otherwise yield `undefined` where the merged view
  // previously yielded the schema default, changing the IProviderConfig.
  const settingsOpenaiResponsesEnabled =
    settingsData.openaiResponsesEnabled ?? false;
  const effectiveOpenaiResponsesEnabled = resolveOpenaiResponsesEnabled(
    ephemeralSettings.openaiResponsesEnabled,
    authOnlyEnabled,
    settingsOpenaiResponsesEnabled,
  );

  const ephemeralAuthKey = ephemeralSettings['auth-key'];
  const openaiProviderSettings = settingsData.providers as
    | Record<string, unknown>
    | undefined;
  const openaiSettings = openaiProviderSettings?.openai as
    | Record<string, unknown>
    | undefined;
  const openaiProviderApiKey = openaiSettings?.['auth-key'] as
    | string
    | undefined;

  const openaiApiKey = resolveOpenaiApiKey(
    ephemeralAuthKey,
    openaiProviderApiKey,
    authOnlyEnabled,
  );

  const ephemeralBaseUrl = ephemeralSettings['base-url'];
  const providerBaseUrl = openaiSettings?.['base-url'] as string | undefined;
  const openaiBaseUrl = resolveOpenaiBaseUrl(ephemeralBaseUrl, providerBaseUrl);

  const openaiProviderConfig: IProviderConfig = {
    enableTextToolCallParsing:
      (settingsData.enableTextToolCallParsing as boolean | undefined) ?? false,
    textToolCallModels:
      (settingsData.textToolCallModels as string[] | undefined) ?? [],
    providerToolFormatOverrides:
      (settingsData.providerToolFormatOverrides as
        | Record<string, string>
        | undefined) ?? {},
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
  const userSettings = resolveUserSettings(fs);
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
    options.oauthSettings,
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
      configureProviderRuntimeFactories(config, manager);
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
    configureProviderRuntimeFactories(config, manager);
  }

  const authOnlyEnabled = resolveAuthOnlyFlag(config, userSettings);
  const { openaiApiKey, openaiBaseUrl, openaiProviderConfig } =
    resolveOpenaiSettings(
      config,
      userSettings,
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
  oauthSettings?: IOAuthSettingsProvider,
  addItem?: OAuthUICallback,
): ProviderManager {
  void config;
  void allowBrowserEnvironment;
  void oauthSettings;
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
