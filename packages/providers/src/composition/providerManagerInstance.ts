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
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import type { RuntimeSettingsState } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionAuthPolicy } from '../auth/types.js';

import type {
  IOAuthSettingsProvider,
  OAuthUICallback,
} from '@vybestack/llxprt-code-auth';
import {
  DebugLogger,
  type Config,
  type ContentGenerator,
  type MessageBus,
  type RuntimeContentGeneratorFactory,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { UNCONFIGURED_PROVIDER } from '@vybestack/llxprt-code-core/config/models.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import stripJsonComments from 'strip-json-comments';
import { OAuthManager } from '../auth/index.js';
import { createOwnerAuthCacheInvalidator } from '../auth/owner-cache-invalidation.js';
import type { TokenStore } from '../auth/types.js';
import { FakeProvider } from '../fake/FakeProvider.js';
import { ProviderContentGenerator } from '../ProviderContentGenerator.js';
import { ProviderManager } from '../ProviderManager.js';
import type { IFileSystem } from './IFileSystem.js';
import { registerStandardOAuthProviders } from './oauth-provider-registration.js';
import { createRuntimeTokenizerFactory } from './runtimeTokenizerFactory.js';

import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasEntry,
} from './providerAliases.js';

import {
  registerAliasProviders,
  sanitizeApiKey,
} from './aliasProviderFactory.js';
import type { ProviderContributionRegistry } from './runtimePlugins/types.js';

export { bindOpenAIAliasIdentity } from './aliasProviderFactory.js';
export { createRuntimeTokenizerFactory } from './runtimeTokenizerFactory.js';

const logger = new DebugLogger('llxprt:provider:manager:instance');

export function createRuntimeContentGeneratorFactory(): RuntimeContentGeneratorFactory<ContentGenerator> {
  return {
    createContentGenerator: () => new ProviderContentGenerator(),
  };
}

export function configureProviderTokenizer(
  manager: RuntimeProviderManager,
  supplied: RuntimeTokenizerFactory | undefined = undefined,
): RuntimeTokenizerFactory {
  const installed = manager.getTokenizerFactory?.();
  const selected = supplied ?? installed ?? createRuntimeTokenizerFactory();
  if (selected !== installed) manager.setTokenizerFactory?.(selected);
  return selected;
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
  settings: Pick<RuntimeSettingsState, 'get'>,
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
  const settingsActiveProvider = settings.get('activeProvider');
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
  settingsService: Pick<RuntimeSettingsState, 'get'>,
  userSettings?: UserSettingsView,
): boolean {
  const sessionAuthOnly = coerceAuthOnly(settingsService.get('authOnly'));
  if (typeof sessionAuthOnly === 'boolean') return sessionAuthOnly;

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

/** Resolves OpenAI-specific settings from user settings and ephemeral overrides. */
function resolveOpenaiSettings(
  settings: Pick<RuntimeSettingsState, 'get'>,
  userSettings: UserSettingsView | undefined,
  authOnlyEnabled: boolean,
  allowBrowserEnvironment: boolean,
): {
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiProviderConfig: IProviderConfig;
} {
  const settingsData: Record<string, unknown> = userSettings ?? {};
  const readConnectionPolicy = () => ({
    'auth-key': settings.get('auth-key'),
    'base-url': settings.get('base-url'),
    'custom-headers': settings.get('custom-headers'),
    'user-agent': settings.get('user-agent'),
    'socket-timeout': settings.get('socket-timeout'),
    'socket-keepalive': settings.get('socket-keepalive'),
    'socket-nodelay': settings.get('socket-nodelay'),
    openaiResponsesEnabled: settings.get('openaiResponsesEnabled'),
  });
  const ephemeralSettings = readConnectionPolicy();
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
    googleAuthDefaults: Object.freeze({
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
      GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI,
      GOOGLE_APPLICATION_CREDENTIALS:
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    }),
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
    readConnectionPolicy,
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
  tokenStore: TokenStore,
  config: Config | undefined,
  authOnlyEnabled: boolean,
  addItem: OAuthUICallback | undefined,
  providerContributions: ProviderContributionRegistry | undefined,
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
    { providerContributions },
  );

  registerStandardOAuthProviders(
    oauthManager,
    manager.fetchNetwork,
    tokenStore,
    addItem,
  );
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
  settings: Pick<RuntimeSettingsState, 'get'>,
  userSettings: UserSettingsView | undefined,
): void {
  const explicitProvider = resolveExplicitProvider(
    config,
    settings,
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
  fakeResponsesPath: string | undefined,
): boolean {
  if (!fakeResponsesPath) {
    return false;
  }
  if (config) {
    manager.setConfig(config);
    configureProviderTokenizer(manager);
  }
  const fakeProvider = new FakeProvider(fakeResponsesPath, process.cwd());
  manager.registerProvider(fakeProvider);
  manager.setActiveProvider('fake');
  logger.debug(
    () => `FakeProvider active — replaying from ${fakeResponsesPath}`,
  );
  return true;
}

function readOwnerAuthPolicy(
  settings: Pick<RuntimeSettingsState, 'get'>,
): SessionAuthPolicy {
  const baseUrl = settings.get('base-url');
  const profile = settings.get('currentProfile');
  return {
    profileName: typeof profile === 'string' ? profile : null,
    baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
    bucketPrompt: settings.get('auth-bucket-prompt'),
    bucketDelay: settings.get('auth-bucket-delay'),
    interactiveTimeoutMs: settings.get('auth.interactiveTimeoutMs'),
    noBrowser: settings.get('auth.noBrowser') === true,
    authOnly: settings.get('authOnly') === true,
  };
}

export function createOwnedOAuthManager(
  tokenStore: TokenStore,
  settings: IOAuthSettingsProvider | undefined,
  messageBus: MessageBus | undefined,
  config: Config | undefined,
  manager: ProviderManager,
  runtimeSettings: RuntimeSettingsState,
): OAuthManager {
  return new OAuthManager(
    tokenStore,
    settings,
    {
      messageBus,
      config,
      readAuthIdentity: () => manager.getAuthIdentity(),
      readSessionAuthPolicy: () => readOwnerAuthPolicy(runtimeSettings),
      invalidateAuthCaches: createOwnerAuthCacheInvalidator((name) =>
        manager.getProviderByName(name),
      ),
    },
    'owned',
  );
}

interface ProviderRegistrationOptions {
  readonly config: Config | undefined;
  readonly providerContributions: ProviderContributionRegistry | undefined;
  readonly addItem: OAuthUICallback | undefined;
  readonly authOnlyEnabled: boolean;
  readonly openaiApiKey: string | undefined;
  readonly openaiBaseUrl: string | undefined;
  readonly openaiProviderConfig: IProviderConfig;
}

interface ProviderPopulationTarget {
  bindRetryOperations(): void;
  activateReplay(config: Config | undefined, path: string | undefined): boolean;
  configure(config: Config): void;
  registerProviders(options: ProviderRegistrationOptions): void;
  activateConfigured(
    config: Config | undefined,
    settings: Pick<RuntimeSettingsState, 'get'>,
    user: UserSettingsView | undefined,
  ): void;
  attachMessages(callback: OAuthUICallback | undefined): void;
  bindAliasRefresh(options: ProviderRegistrationOptions): void;
}

export function createProviderPopulationTarget(
  manager: ProviderManager,
  oauth: OAuthManager,
  tokens: TokenStore,
): ProviderPopulationTarget {
  return {
    bindRetryOperations: () => bindOwnerRetryOperations(manager, oauth),
    activateReplay: (config, path) =>
      tryActivateFakeProvider(manager, config, path),
    configure: (config) => {
      manager.setConfig(config);
      configureProviderTokenizer(manager);
    },
    registerProviders: (options) =>
      registerAllProviders(
        manager,
        loadProviderAliasEntries(),
        options.openaiApiKey,
        options.openaiBaseUrl,
        options.openaiProviderConfig,
        oauth,
        tokens,
        options.config,
        options.authOnlyEnabled,
        options.addItem,
        options.providerContributions,
      ),
    activateConfigured: (config, settings, user) =>
      activateExplicitProvider(manager, config, settings, user),
    attachMessages: (callback) =>
      attachAddItemToOAuthProviders(oauth, callback),
    bindAliasRefresh: (options) =>
      registerAliasRefresher(
        manager,
        options.openaiApiKey,
        options.openaiBaseUrl,
        options.openaiProviderConfig,
        oauth,
        options.config,
        options.authOnlyEnabled,
        options.providerContributions,
      ),
  };
}

export interface ProviderPopulationInput {
  readonly target: ProviderPopulationTarget;
  readonly readSetting: RuntimeSettingsState['get'];
  readonly fileSystem: IFileSystem;
  readonly configuration:
    | { readonly kind: 'pre-config' }
    | { readonly kind: 'configured'; readonly config: Config };
  readonly contributions:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'supplied';
        readonly registry: ProviderContributionRegistry;
      };
  readonly messages:
    | { readonly kind: 'none' }
    | { readonly kind: 'attached'; readonly callback: OAuthUICallback };
  readonly allowBrowser: boolean;
  readonly activateConfiguredProvider: boolean;
  readonly fakeResponses:
    | { readonly kind: 'disabled' }
    | { readonly kind: 'replay'; readonly path: string };
}

export function populateProviderManager(input: ProviderPopulationInput): void {
  const {
    target,
    readSetting,
    fileSystem,
    allowBrowser,
    activateConfiguredProvider,
  } = input;
  const config =
    input.configuration.kind === 'configured'
      ? input.configuration.config
      : undefined;
  const providerContributions =
    input.contributions.kind === 'supplied'
      ? input.contributions.registry
      : undefined;
  const addItem =
    input.messages.kind === 'attached' ? input.messages.callback : undefined;
  const fakeResponsesPath =
    input.fakeResponses.kind === 'replay'
      ? input.fakeResponses.path
      : undefined;
  const settings = { get: readSetting };
  const user = resolveUserSettings(fileSystem);
  target.bindRetryOperations();
  if (target.activateReplay(config, fakeResponsesPath)) return;
  if (config) target.configure(config);

  const authOnlyEnabled = resolveAuthOnlyFlag(settings, user);
  const { openaiApiKey, openaiBaseUrl, openaiProviderConfig } =
    resolveOpenaiSettings(settings, user, authOnlyEnabled, allowBrowser);

  const registration: ProviderRegistrationOptions = {
    config,
    providerContributions,
    addItem,
    authOnlyEnabled,
    openaiApiKey,
    openaiBaseUrl,
    openaiProviderConfig,
  };
  target.registerProviders(registration);
  if (activateConfiguredProvider)
    target.activateConfigured(config, settings, user);
  target.attachMessages(addItem);
  target.bindAliasRefresh(registration);
}

function bindOwnerRetryOperations(
  manager: ProviderManager,
  oauthManager: OAuthManager,
): void {
  manager.setRetryOperationsFactory((providerName, profileId) =>
    oauthManager.composeRetryOperations(
      providerName,
      profileId ? { profileId } : undefined,
    ),
  );
}

function registerAliasRefresher(
  manager: ProviderManager,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  providerConfig: IProviderConfig,
  oauthManager: OAuthManager,
  config: Config | undefined,
  authOnlyEnabled: boolean,
  providerContributions: ProviderContributionRegistry | undefined,
): void {
  manager.registerAliasRefresher(() => {
    registerAliasProviders(
      manager,
      loadProviderAliasEntries(),
      apiKey,
      baseUrl,
      providerConfig,
      oauthManager,
      config,
      authOnlyEnabled,
      { providerContributions },
    );
  });
}

export function refreshAliasProviders(manager: RuntimeProviderManager): void {
  if (!(manager instanceof ProviderManager)) {
    throw new Error('Alias refresh requires a ProviderManager owner.');
  }

  manager.refreshAliases();
}
