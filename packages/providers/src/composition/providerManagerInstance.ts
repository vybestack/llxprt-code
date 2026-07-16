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
  UNCONFIGURED_PROVIDER,
} from '@vybestack/llxprt-code-core';
import { ProviderManager } from '../ProviderManager.js';
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
import { registerStandardOAuthProviders } from './oauth-provider-registration.js';
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
  activateConfiguredProvider?: boolean;
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

function createRuntimeTokenizerFactory(): RuntimeTokenizerFactory {
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

function createRuntimeContentGeneratorFactory(
  config: Config,
): RuntimeContentGeneratorFactory<ContentGenerator> {
  return {
    createContentGenerator(manager: RuntimeProviderManager) {
      return new ProviderContentGenerator(manager, {
        model: config.getModel(),
        providerManager: manager,
        proxy: config.getProxy(),
      });
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
      createRuntimeContentGeneratorFactory(config),
    );
  }
  const setTokenizerFactory = configWithFactories['setTokenizerFactory'];
  if (typeof setTokenizerFactory === 'function') {
    setTokenizerFactory.call(config, createRuntimeTokenizerFactory());
  }
}

/**
 * Normalizes a candidate explicit-provider value. Returns the trimmed value
 * when it is a non-empty, non-sentinel string; otherwise undefined. The
 * neutral UNCONFIGURED_PROVIDER sentinel and whitespace-only values are
 * treated as absent so precedence falls through to lower sources.
 */
function normalizeExplicitProvider(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === UNCONFIGURED_PROVIDER) {
    return undefined;
  }
  return trimmed;
}

/**
 * Resolves an explicitly-configured provider name (or undefined when
 * nothing is configured). Checks, in order: config.getProvider(), the
 * settingsService's activeProvider, and the user-settings file's
 * activeProvider/defaultProvider. Returns undefined when none are present so
 * the manager starts without an implicit provider fallback.
 *
 * Bare API keys / env credentials are intentionally NOT consulted here —
 * they do not select a provider. Only an explicit provider/profile/default
 * counts.
 *
 * The neutral `UNCONFIGURED_PROVIDER` sentinel and whitespace-only values
 * are treated as absent at every source so resolution continues to
 * lower-precedence sources and never passes the sentinel to
 * activateExplicitProvider or setActiveProvider.
 */
function resolveExplicitProvider(
  config: Config | undefined,
  context: RuntimeContextShape,
  userSettings: UserSettingsView | undefined,
): string | undefined {
  // 1. Config provider (set by CLI --provider, --profile-load, or
  // LLXPRT_DEFAULT_PROVIDER during config resolution).
  if (config && typeof config.getProvider === 'function') {
    const configProvider = config.getProvider();
    const resolvedConfig = normalizeExplicitProvider(configProvider);
    if (resolvedConfig !== undefined) {
      return resolvedConfig;
    }
  }

  // 2. SettingsService activeProvider (ephemeral runtime state, not
  // persisted — set by a prior switchActiveProvider or from profile load).
  const settingsActiveProvider = context.settingsService.get('activeProvider');
  const resolvedSettings = normalizeExplicitProvider(settingsActiveProvider);
  if (resolvedSettings !== undefined) {
    return resolvedSettings;
  }

  // 3. User-settings file activeProvider or defaultProvider.
  if (userSettings) {
    const userActiveProvider = userSettings['activeProvider'];
    const resolvedUserActive = normalizeExplicitProvider(userActiveProvider);
    if (resolvedUserActive !== undefined) {
      return resolvedUserActive;
    }
    const userDefaultProvider = userSettings['defaultProvider'];
    const resolvedUserDefault = normalizeExplicitProvider(userDefaultProvider);
    if (resolvedUserDefault !== undefined) {
      return resolvedUserDefault;
    }
  }

  return undefined;
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
  oauthManager.attachAddItemToProviders(addItem);
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
  settingsService: RuntimeContextShape['settingsService'],
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

  // Read from the runtime context's OWN settings service — never ambient
  // global state (issue #2300).
  const serviceValue = settingsService.get('authOnly');
  if (serviceValue !== undefined) {
    const coerced = coerceAuthOnly(serviceValue);
    if (typeof coerced === 'boolean') {
      return coerced;
    }
  }

  return false;
}

/** Registers OAuth providers for authentication support. */
function registerOAuthProviders(
  oauthManager: OAuthManager,
  tokenStore: ReturnType<typeof createTokenStore>,
  addItem: ProviderManagerFactoryOptions['addItem'],
): void {
  registerStandardOAuthProviders(oauthManager, tokenStore, addItem);
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

/**
 * Activates the explicitly-configured provider on the manager. Only
 * activates when a provider was explicitly configured (config.getProvider() or
 * a settings activeProvider/defaultProvider). When nothing is configured, the
 * manager starts with no active provider, and the CLI gates non-interactive
 * runs and guides interactive users to /setup.
 *
 * When a provider name IS explicitly configured but is invalid (e.g. a typo
 * like "geminii"), this throws a structured error preserving the requested
 * name so the user sees actionable config feedback rather than a silently
 * unconfigured start.
 */
function activateExplicitProvider(
  manager: ProviderManager,
  config: Config | undefined,
  context: RuntimeContextShape,
  userSettings: UserSettingsView | undefined,
): void {
  const explicitProvider = resolveExplicitProvider(
    config,
    context,
    userSettings,
  );
  if (explicitProvider === undefined) {
    return;
  }
  try {
    manager.setActiveProvider(explicitProvider);
  } catch (error) {
    throw new Error(
      `Could not activate explicitly-configured provider '${explicitProvider}': ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Short-circuit: when LLXPRT_FAKE_RESPONSES is set, register only FakeProvider
 * and return immediately. This avoids real provider registration (which may
 * require valid API keys) and ensures FakeProvider stays active even after the
 * bootstrap calls switchActiveProvider().
 */
function tryActivateFakeProvider(
  manager: ProviderManager,
  config: Config | undefined,
): { manager: ProviderManager } | null {
  const fakeResponsesPath = process.env.LLXPRT_FAKE_RESPONSES;
  if (!fakeResponsesPath) {
    return null;
  }
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
  return { manager };
}

export function createProviderManager(
  context: RuntimeContextShape,
  options: ProviderManagerFactoryOptions = {},
): { manager: ProviderManager; oauthManager: OAuthManager } {
  const fs = getFileSystem();
  const userSettings = resolveUserSettings(fs);
  const manager = new ProviderManager(context);

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

  const {
    config,
    allowBrowserEnvironment = false,
    activateConfiguredProvider = true,
    addItem,
  } = options;

  const fakeResult = tryActivateFakeProvider(manager, config);
  if (fakeResult) {
    return { manager: fakeResult.manager, oauthManager };
  }

  logger.debug('createProviderManager config check', {
    hasConfig: config !== undefined,
    configType: config?.constructor.name,
  });

  if (config) {
    manager.setConfig(config);
    configureProviderRuntimeFactories(config, manager);
  }

  const authOnlyEnabled = resolveAuthOnlyFlag(
    context.settingsService,
    config,
    userSettings,
  );
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

  if (activateConfiguredProvider) {
    activateExplicitProvider(manager, config, context, userSettings);
  }
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
