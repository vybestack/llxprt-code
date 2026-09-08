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

import type { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import type { IProvider } from '../IProvider.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import type { RuntimeKind } from './runtimeRegistry.js';
import {
  maybeGetCliOAuthManager,
  getActiveRuntimeKind,
  getCliRuntimeServices,
  _internal as runtimeAccessorsInternal,
} from './runtimeAccessors.js';
import {
  computeModelDefaults,
  extractProviderBaseUrl,
} from './providerMutations.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasConfig,
} from '../composition/index.js';
import { ensureOAuthProviderRegistered } from '../composition/index.js';
import { configureProviderRuntimeFactories } from '../composition/index.js';
import { getActiveProfileName } from './profileSnapshot.js';
import {
  isUserOwnedReasoningSetting,
  recordModelDefaultOwnedKeys,
  recordProviderDefaultOwnedEntries,
  REASONING_OBJECT_VALUED_EPHEMERAL_KEYS,
} from './modelDefaultOwnership.js';

const logger = new DebugLogger('llxprt:runtime:settings');

const { getProviderSettingsSnapshot, extractModelParams } =
  runtimeAccessorsInternal;

/**
 * Default ephemeral settings to preserve across provider switches.
 * These are context-related settings that should not be cleared when
 * switching providers, as they represent user preferences for the session.
 */
export const DEFAULT_PRESERVE_EPHEMERALS = [
  'context-limit',
  'max_tokens',
  'streaming',
] as const;

export interface ProviderSwitchResult {
  changed: boolean;
  previousProvider: string | null;
  nextProvider: string;
  defaultModel?: string;
  infoMessages: string[];
}

interface ProviderSwitchOptions {
  autoOAuth?: boolean;
  preserveEphemerals?: string[];
  skipModelDefaults?: boolean;
  addItem?: OAuthUICallback;
}

interface ProviderSwitchContext {
  name: string;
  currentProvider: string | null;
  autoOAuth: boolean | undefined;
  skipModelDefaults: boolean;
  preserveEphemerals: string[];
  config: Config;
  settingsService: ReturnType<typeof getCliRuntimeServices>['settingsService'];
  providerManager: ReturnType<typeof getCliRuntimeServices>['providerManager'];
  activeProvider: ReturnType<
    ReturnType<
      typeof getCliRuntimeServices
    >['providerManager']['getActiveProvider']
  >;
  providerForBaseUrl: IProvider | undefined;

  baseProvider: {
    hasNonOAuthAuthentication?: () => Promise<boolean>;
  };
  aliasConfig?: ProviderAliasConfig;
  modelToApply: string;
  providerBaseUrl?: string;
  finalBaseUrl?: string;
  explicitBaseUrl?: string;
  hadCustomBaseUrl: boolean;
  preAliasEphemeralKeys: Set<string>;
  authOnlyBeforeSwitch: unknown;
  contextLimitBeforeSwitch: unknown;
  maxTokensBeforeSwitch: unknown;
  maxOutputTokensBeforeSwitch: unknown;
  infoMessages: string[];
  addItem?: OAuthUICallback;
}

function normalizeSetting(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') {
    return undefined;
  }
  return trimmed;
}

function getWrappedProvider(provider: unknown): unknown {
  if (typeof provider !== 'object' || provider === null) {
    return undefined;
  }
  if (!('wrappedProvider' in provider)) {
    return undefined;
  }
  return (provider as { wrappedProvider?: unknown }).wrappedProvider;
}

function unwrapProvider(provider: unknown): {
  hasNonOAuthAuthentication?: () => Promise<boolean>;
} {
  const visited = new Set<unknown>();
  let current: unknown = provider;
  let wrappedProvider = getWrappedProvider(current);

  while (wrappedProvider !== undefined && wrappedProvider !== null) {
    if (visited.has(current)) {
      return current as {
        hasNonOAuthAuthentication?: () => Promise<boolean>;
      };
    }

    visited.add(current);
    current = wrappedProvider;
    wrappedProvider = getWrappedProvider(current);
  }

  return current as {
    hasNonOAuthAuthentication?: () => Promise<boolean>;
  };
}

function getProviderForBaseUrl(context: ProviderSwitchContext): IProvider {
  const providerManager =
    context.providerManager as typeof context.providerManager & {
      getProviderByName?: (name: string) => IProvider | undefined;
    };
  const provider =
    providerManager.getProviderByName(context.name) ?? context.activeProvider;
  if (!provider) {
    throw new Error(`Provider '${context.name}' is not available.`);
  }
  return provider as IProvider;
}

function isScalarAliasEphemeralValue(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Alias ephemeral keys that accept object values (issue #3255): the
 * registered reasoning maps. Only these keys may carry objects; a malformed
 * map is not validated here; the provider reasoning config that owns the
 * key rejects invalid shapes at resolution/request time.
 */
function applyAliasEphemeralSetting(
  context: ProviderSwitchContext,
  protectedAliasEphemeralKeys: ReadonlySet<string>,
  rawKey: string,
  rawValue: unknown,
): boolean {
  const key = rawKey.trim();
  if (key === '') {
    return false;
  }

  const normalizedKey = key.toLowerCase();
  if (protectedAliasEphemeralKeys.has(normalizedKey)) {
    logger.warn(
      () =>
        `[cli-runtime] Skipping protected alias ephemeral setting '${key}' for provider '${context.name}'.`,
    );
    return false;
  }

  if (context.config.getEphemeralSetting(key) !== undefined) {
    return false;
  }

  if (isScalarAliasEphemeralValue(rawValue)) {
    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      logger.warn(
        () =>
          `[cli-runtime] Skipping non-finite alias ephemeral setting '${key}' for provider '${context.name}'.`,
      );
      return false;
    }

    context.config.setEphemeralSetting(key, rawValue);
    return true;
  }

  if (
    REASONING_OBJECT_VALUED_EPHEMERAL_KEYS.has(key) &&
    typeof rawValue === 'object' &&
    rawValue !== null
  ) {
    context.config.setEphemeralSetting(key, rawValue);
    return true;
  }

  logger.warn(
    () =>
      `[cli-runtime] Skipping non-scalar alias ephemeral setting '${key}' for provider '${context.name}'.`,
  );
  return false;
}

function resetBucketFailoverHandler(config: Config): void {
  const candidate = config as Config & {
    setBucketFailoverHandler?: (handler: undefined) => void;
  };

  if (typeof candidate.setBucketFailoverHandler !== 'function') {
    return;
  }

  candidate.setBucketFailoverHandler(undefined);
}

function getAliasConfig(providerName: string): ProviderAliasConfig | undefined {
  try {
    return loadProviderAliasEntries().find(
      (entry) => entry.alias === providerName,
    )?.config;
  } catch {
    return undefined;
  }
}

function clearPreviousProviderSettings(context: ProviderSwitchContext): void {
  const { currentProvider, settingsService } = context;
  if (!currentProvider) {
    return;
  }

  // Uniform wipe (#2626, @plan:PLAN-20260826-SERVERTOOLS-DELETE): ALL of the
  // previous provider's provider-scoped settings — including persisted keys
  // such as auth-key — are cleared on switch-away, gemini included, exactly
  // like every other provider. This is the consciously-owned consequence of
  // retiring the serverToolsProvider exemption (supersedes the
  // PLAN-20260603-ISSUE1584.P14 special case this block used to carry).
  const previousSettings = getProviderSettingsSnapshot(
    settingsService,
    currentProvider,
  );
  for (const key of Object.keys(previousSettings)) {
    settingsService.setProviderSetting(currentProvider, key, undefined);
  }
}

function clearEphemeralsForSwitch(
  context: Pick<ProviderSwitchContext, 'config' | 'preserveEphemerals'>,
): {
  authOnlyBeforeSwitch: unknown;
  contextLimitBeforeSwitch: unknown;
  maxTokensBeforeSwitch: unknown;
  maxOutputTokensBeforeSwitch: unknown;
  preAliasEphemeralKeys: Set<string>;
} {
  const existingEphemerals =
    typeof context.config.getEphemeralSettings === 'function'
      ? context.config.getEphemeralSettings()
      : {};

  const authOnlyBeforeSwitch = existingEphemerals.authOnly;
  const contextLimitBeforeSwitch = existingEphemerals['context-limit'];
  const maxTokensBeforeSwitch = existingEphemerals.max_tokens;
  const maxOutputTokensBeforeSwitch = existingEphemerals.maxOutputTokens;

  for (const key of Object.keys(existingEphemerals)) {
    // activeProvider and currentProfile are session-level identity state,
    // not per-provider ephemerals. They must survive a provider switch —
    // clearing currentProfile here would wipe the profile name set by
    // applyProfileSnapshot, causing the UI to lose the active profile
    // identity (issue #2501). A user-owned issue #3255 reasoning setting
    // survives too; default-owned values are cleared so the target
    // provider's defaults apply.
    const shouldPreserve =
      key === 'activeProvider' ||
      key === 'currentProfile' ||
      context.preserveEphemerals.includes(key) ||
      isUserOwnedReasoningSetting(context.config, key);
    if (!shouldPreserve) {
      context.config.setEphemeralSetting(key, undefined);
    }
  }

  return {
    authOnlyBeforeSwitch,
    contextLimitBeforeSwitch,
    maxTokensBeforeSwitch,
    maxOutputTokensBeforeSwitch,
    preAliasEphemeralKeys: new Set(
      Object.keys(context.config.getEphemeralSettings()),
    ),
  };
}

function activateProviderContext(context: ProviderSwitchContext): void {
  const { name, config, providerManager } = context;
  void providerManager.setActiveProvider(name);
  configureProviderRuntimeFactories(config, providerManager);
  config.setProvider(name);
  logger.debug(() => `[cli-runtime] set config provider=${name}`);
  config.setEphemeralSetting('activeProvider', name);
  logger.debug(
    () =>
      `[cli-runtime] config ephemeral activeProvider=${config.getEphemeralSetting('activeProvider')}`,
  );
}

async function switchSettingsProvider(
  context: ProviderSwitchContext,
): Promise<void> {
  const { name, settingsService, providerManager } = context;
  const activeProvider = providerManager.getActiveProvider();
  const providerSettings = getProviderSettingsSnapshot(settingsService, name);
  const existingParams = extractModelParams(providerSettings);
  for (const key of Object.keys(existingParams)) {
    settingsService.setProviderSetting(name, key, undefined);
  }

  await settingsService.switchProvider(name);
  logger.debug(
    () =>
      `[cli-runtime] settingsService activeProvider now=${settingsService.get('activeProvider')}`,
  );

  context.activeProvider = activeProvider;
  context.providerForBaseUrl = getProviderForBaseUrl(context);

  context.baseProvider = unwrapProvider(activeProvider);
}

function getProviderSettingsAndStoredValues(context: ProviderSwitchContext): {
  providerSettingsBefore: Record<string, unknown>;
  storedModelSetting: string | undefined;
  storedBaseUrlSetting: string | undefined;
} {
  const providerSettingsBefore = getProviderSettingsSnapshot(
    context.settingsService,
    context.name,
  );
  return {
    providerSettingsBefore,
    storedModelSetting: normalizeSetting(providerSettingsBefore.model),
    storedBaseUrlSetting: normalizeSetting(providerSettingsBefore['base-url']),
  };
}

function getExplicitConfigOverrides(context: ProviderSwitchContext): {
  explicitConfigModel: string | undefined;
  explicitConfigBaseUrl: string | undefined;
} {
  const explicitConfigModel =
    context.currentProvider === context.name
      ? normalizeSetting(context.config.getModel())
      : undefined;

  const explicitConfigBaseUrl =
    context.currentProvider === context.name ||
    context.preserveEphemerals.includes('base-url')
      ? normalizeSetting(context.config.getEphemeralSetting('base-url'))
      : undefined;

  return { explicitConfigModel, explicitConfigBaseUrl };
}

function clearProviderSettingsForSwitch(
  context: ProviderSwitchContext,
  providerSettingsBefore: Record<string, unknown>,
): void {
  for (const key of Object.keys(providerSettingsBefore)) {
    context.settingsService.setProviderSetting(context.name, key, undefined);
  }
}

function resolveProviderBaseUrlFromProvider(
  context: ProviderSwitchContext,
): string | undefined {
  if (context.name === 'qwen') {
    return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }
  return extractProviderBaseUrl(context.providerForBaseUrl);
}

function applyProviderBaseUrlSettings(
  context: ProviderSwitchContext,
  finalBaseUrl: string | undefined,
): void {
  context.config.setEphemeralSetting('base-url', finalBaseUrl);
  context.settingsService.setProviderSetting(
    context.name,
    'base-url',
    finalBaseUrl,
  );
}

function applyAliasProviderSettings(context: ProviderSwitchContext): void {
  const aliasConfig = context.aliasConfig;
  if (aliasConfig?.['sandbox-base-url']) {
    context.settingsService.setProviderSetting(
      context.name,
      'sandbox-base-url',
      aliasConfig['sandbox-base-url'],
    );
  }
  if (aliasConfig?.['requires-auth'] !== undefined) {
    context.settingsService.setProviderSetting(
      context.name,
      'requires-auth',
      aliasConfig['requires-auth'],
    );
  }
}

function resolveModelToApply(
  context: ProviderSwitchContext,
  storedModelSetting: string | undefined,
  explicitConfigModel: string | undefined,
): string {
  const aliasDefaultModel = normalizeSetting(context.aliasConfig?.defaultModel);
  const defaultModel =
    aliasDefaultModel ??
    normalizeSetting(context.activeProvider?.getDefaultModel?.());
  const maybeStoredModel =
    context.currentProvider === context.name &&
    storedModelSetting &&
    storedModelSetting !== defaultModel
      ? storedModelSetting
      : undefined;
  return (explicitConfigModel ?? maybeStoredModel ?? defaultModel ?? '').trim();
}

function applyModelSettings(
  context: ProviderSwitchContext,
  modelToApply: string,
): void {
  context.settingsService.setProviderSetting(
    context.name,
    'model',
    modelToApply || undefined,
  );
  context.config.setModel(modelToApply);
}

function resolveProviderBaseUrl(context: ProviderSwitchContext): void {
  const { providerSettingsBefore, storedModelSetting, storedBaseUrlSetting } =
    getProviderSettingsAndStoredValues(context);
  const { explicitConfigModel, explicitConfigBaseUrl } =
    getExplicitConfigOverrides(context);

  context.hadCustomBaseUrl = Boolean(storedBaseUrlSetting);
  clearProviderSettingsForSwitch(context, providerSettingsBefore);

  const providerBaseUrl = resolveProviderBaseUrlFromProvider(context);
  const explicitBaseUrl =
    explicitConfigBaseUrl ??
    (context.currentProvider === context.name
      ? storedBaseUrlSetting
      : undefined);
  const finalBaseUrl = explicitBaseUrl ?? providerBaseUrl ?? undefined;

  applyProviderBaseUrlSettings(context, finalBaseUrl);
  applyAliasProviderSettings(context);

  context.modelToApply = resolveModelToApply(
    context,
    storedModelSetting,
    explicitConfigModel,
  );
  applyModelSettings(context, context.modelToApply);

  context.providerBaseUrl = providerBaseUrl;
  context.explicitBaseUrl = explicitBaseUrl;
  context.finalBaseUrl = finalBaseUrl;
}

/**
 * Pure policy: whether the lazy Claude Code OAuth browser flow should be
 * initiated for a provider switch. Tri-state semantics for `explicitAutoOAuth`:
 *  - `true`  → always attempt (explicit opt-in).
 *  - `false` → never attempt (explicit suppression: profile application,
 *              same-provider switch, welcome onboarding).
 *  - `undefined` → derive: attempt only in an interactive, non-agent runtime.
 *
 * Exported so the policy is unit-testable in isolation from the full runtime
 * wiring. Never launches a browser in a headless/agent/subagent context.
 */
export function resolveLazyClaudeCodeOAuthDecision(input: {
  explicitAutoOAuth?: boolean;
  isInteractive: boolean;
  runtimeKind?: RuntimeKind;
}): boolean {
  if (input.explicitAutoOAuth === true) {
    return true;
  }
  if (input.explicitAutoOAuth === false) {
    return false;
  }
  if (!input.isInteractive) {
    return false;
  }
  if (input.runtimeKind === 'agent' || input.runtimeKind === 'subagent') {
    return false;
  }
  return true;
}

function readConfigInteractive(config: Config): boolean {
  const candidate = config as Config & { isInteractive?: () => boolean };
  // Default to NOT interactive when the signal is absent: a browser flow must
  // never auto-launch unless we are certain the session is interactive.
  return typeof candidate.isInteractive === 'function'
    ? candidate.isInteractive()
    : false;
}

async function handleClaudeCodeOAuth(
  context: ProviderSwitchContext,
): Promise<void> {
  if (context.name !== 'claudecode') {
    return;
  }

  const oauthManager = maybeGetCliOAuthManager();
  if (oauthManager == null) {
    return;
  }

  ensureOAuthProviderRegistered(
    'claudecode',
    oauthManager,
    // Intentionally undefined: `ensureOAuthProviderRegistered` resolves the
    // token store from the manager itself (`oauthManager.getTokenStore?.()`),
    // which tolerates managers that do not expose one.
    undefined,
    context.addItem,
  );

  const shouldAttemptLazy = resolveLazyClaudeCodeOAuthDecision({
    explicitAutoOAuth: context.autoOAuth,
    isInteractive: readConfigInteractive(context.config),
    runtimeKind: getActiveRuntimeKind(),
  });

  if (!shouldAttemptLazy) {
    return;
  }

  try {
    const hasNonOAuth =
      typeof context.baseProvider.hasNonOAuthAuthentication === 'function'
        ? await context.baseProvider.hasNonOAuthAuthentication()
        : true;

    if (hasNonOAuth) {
      return;
    }

    logger.debug(
      () => `[cli-runtime] Claude Code OAuth check: hasNonOAuth=${hasNonOAuth}`,
    );

    if (!oauthManager.isOAuthEnabled('claudecode')) {
      await oauthManager.toggleOAuthEnabled('claudecode');
    }

    logger.debug(() => '[cli-runtime] Initiating Claude Code OAuth flow');
    await oauthManager.authenticate('claudecode', undefined, {
      signalAuthCompletion: true,
    });
    context.infoMessages.push(
      'Claude Code OAuth authentication completed. Use /auth claudecode to view status.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.infoMessages.push(
      `Claude Code OAuth authentication failed: ${message}`,
    );
    logger.warn(
      () => `[cli-runtime] Claude Code OAuth authentication failed: ${message}`,
    );
  }
}

function applyClaudeCodeOAuthDefaults(context: ProviderSwitchContext): void {
  if (context.name !== 'claudecode') {
    return;
  }

  const oauthManager = maybeGetCliOAuthManager();
  const authOnlyEnabled =
    context.authOnlyBeforeSwitch === true ||
    context.authOnlyBeforeSwitch === 'true';
  const oauthIsEnabled = oauthManager?.isOAuthEnabled('claudecode') ?? false;

  if (!authOnlyEnabled && !oauthIsEnabled) {
    return;
  }

  if (context.contextLimitBeforeSwitch !== undefined) {
    context.config.setEphemeralSetting(
      'context-limit',
      context.contextLimitBeforeSwitch,
    );
    logger.debug(
      () =>
        `[cli-runtime] Preserved user-set context-limit=${context.contextLimitBeforeSwitch} for Claude Code OAuth mode (Issue #181)`,
    );
  }

  if (context.maxTokensBeforeSwitch !== undefined) {
    context.config.setEphemeralSetting(
      'max_tokens',
      context.maxTokensBeforeSwitch,
    );
    logger.debug(
      () =>
        `[cli-runtime] Preserved user-set max_tokens=${context.maxTokensBeforeSwitch} for Claude Code OAuth mode (Issue #181)`,
    );
  } else if (
    typeof context.maxOutputTokensBeforeSwitch === 'number' &&
    Number.isFinite(context.maxOutputTokensBeforeSwitch) &&
    context.maxOutputTokensBeforeSwitch > 0
  ) {
    context.config.setEphemeralSetting(
      'maxOutputTokens',
      context.maxOutputTokensBeforeSwitch,
    );
    context.preAliasEphemeralKeys.add('maxOutputTokens');
    logger.debug(
      () =>
        `[cli-runtime] Restored maxOutputTokens=${context.maxOutputTokensBeforeSwitch} for Claude Code OAuth mode (Issue #1769)`,
    );
  }

  if (context.authOnlyBeforeSwitch !== undefined) {
    context.config.setEphemeralSetting(
      'authOnly',
      context.authOnlyBeforeSwitch,
    );
  }
}

function applyAliasEphemeralSettings(context: ProviderSwitchContext): void {
  const appliedAliasEntries: Array<[string, unknown]> = [];
  const aliasEphemeralSettings = context.aliasConfig?.ephemeralSettings;
  if (
    aliasEphemeralSettings &&
    typeof aliasEphemeralSettings === 'object' &&
    !Array.isArray(aliasEphemeralSettings)
  ) {
    const protectedAliasEphemeralKeys = new Set([
      'activeprovider',
      'base-url',
      'baseurl',
      'base_url',
      'model',
      'auth-key',
      'auth-keyfile',
      'authkey',
      'authkeyfile',
      'api-key',
      'api-keyfile',
      'api_key',
      'api_keyfile',
      'apikey',
      'apikeyfile',
    ]);

    Object.entries(aliasEphemeralSettings).forEach(([rawKey, rawValue]) => {
      if (
        applyAliasEphemeralSetting(
          context,
          protectedAliasEphemeralKeys,
          rawKey,
          rawValue,
        )
      ) {
        appliedAliasEntries.push([rawKey.trim(), rawValue]);
      }
    });
  }
  // Only alias keys actually applied become provider-owned defaults; a
  // missing or invalid alias surface records the empty set, dropping any
  // ownership left over from the previous provider (issue #3255).
  recordProviderDefaultOwnedEntries(context.config, appliedAliasEntries);
}

function applyModelDefaults(context: ProviderSwitchContext): void {
  if (
    context.skipModelDefaults ||
    !context.modelToApply ||
    !context.aliasConfig?.modelDefaults
  ) {
    // Alias application above is the only default source on this path, and
    // the switch cleared the previous provider's ephemerals, so any earlier
    // model ownership is stale (issue #3255).
    recordModelDefaultOwnedKeys(context.config, []);
    return;
  }

  const modelDefaults = computeModelDefaults(
    context.modelToApply,
    context.aliasConfig.modelDefaults,
  );

  const appliedKeys: string[] = [];
  for (const [key, value] of Object.entries(modelDefaults)) {
    if (!context.preAliasEphemeralKeys.has(key)) {
      context.config.setEphemeralSetting(key, value);
      appliedKeys.push(key);
    }
  }
  recordModelDefaultOwnedKeys(context.config, appliedKeys);
}

function addProviderInfoMessages(context: ProviderSwitchContext): void {
  if (context.hadCustomBaseUrl) {
    const baseUrlChanged =
      !context.finalBaseUrl ||
      context.finalBaseUrl === context.providerBaseUrl ||
      !context.explicitBaseUrl;

    if (baseUrlChanged) {
      context.infoMessages.push(
        `Cleared custom base URL for provider '${context.name}'; default endpoint restored.`,
      );
    } else if (
      context.finalBaseUrl &&
      context.finalBaseUrl !== context.providerBaseUrl
    ) {
      context.infoMessages.push(
        `Preserved custom base URL '${context.finalBaseUrl}' for provider '${context.name}'.`,
      );
    }
  } else if (
    context.providerBaseUrl &&
    context.finalBaseUrl === context.providerBaseUrl
  ) {
    context.infoMessages.push(
      `Base URL set to '${context.providerBaseUrl}' for provider '${context.name}'.`,
    );
  }

  if (context.modelToApply) {
    context.infoMessages.push(
      `Active model is '${context.modelToApply}' for provider '${context.name}'.`,
    );
  }

  if (context.name !== 'gemini') {
    context.infoMessages.push('Use /key to set API key if needed.');
  }
}

async function initializeContentGeneratorConfigIfSupported(
  config: Config,
): Promise<void> {
  const candidate = config as Config & {
    initializeContentGeneratorConfig?: () => Promise<void>;
  };

  if (typeof candidate.initializeContentGeneratorConfig !== 'function') {
    return;
  }

  try {
    await candidate.initializeContentGeneratorConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      () =>
        `[cli-runtime] Failed to initialize content generator config: ${message}`,
    );
  }
}

function createProviderSwitchContext(
  providerName: string,
  options: ProviderSwitchOptions,
): ProviderSwitchContext {
  const name = providerName.trim();
  if (!name) {
    throw new Error('Provider name is required.');
  }

  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const currentProvider = providerManager.getActiveProviderName() ?? null;

  if (currentProvider === name) {
    return {
      name,
      currentProvider,
      autoOAuth: false,
      skipModelDefaults: true,
      preserveEphemerals: [],
      config,
      settingsService,
      providerManager,
      activeProvider: providerManager.getActiveProvider(),
      providerForBaseUrl: undefined,

      baseProvider: {},
      aliasConfig: undefined,
      modelToApply: '',
      providerBaseUrl: undefined,
      finalBaseUrl: undefined,
      explicitBaseUrl: undefined,
      hadCustomBaseUrl: false,
      preAliasEphemeralKeys: new Set<string>(),
      authOnlyBeforeSwitch: undefined,
      contextLimitBeforeSwitch: undefined,
      maxTokensBeforeSwitch: undefined,
      maxOutputTokensBeforeSwitch: undefined,
      infoMessages: [],
      addItem: options.addItem,
    };
  }

  const preserveEphemerals = [
    ...DEFAULT_PRESERVE_EPHEMERALS,
    ...(options.preserveEphemerals ?? []),
  ];

  const context: ProviderSwitchContext = {
    name,
    currentProvider,
    autoOAuth: options.autoOAuth,
    skipModelDefaults: options.skipModelDefaults ?? false,
    preserveEphemerals,
    config,
    settingsService,
    providerManager,
    providerForBaseUrl: undefined,

    activeProvider: providerManager.getActiveProvider(),
    baseProvider: {},
    aliasConfig: getAliasConfig(name),
    modelToApply: '',
    providerBaseUrl: undefined,
    finalBaseUrl: undefined,
    explicitBaseUrl: undefined,
    hadCustomBaseUrl: false,
    preAliasEphemeralKeys: new Set<string>(),
    authOnlyBeforeSwitch: undefined,
    contextLimitBeforeSwitch: undefined,
    maxTokensBeforeSwitch: undefined,
    maxOutputTokensBeforeSwitch: undefined,
    infoMessages: [],
    addItem: options.addItem,
  };

  const ephemeralSnapshot = clearEphemeralsForSwitch(context);
  context.authOnlyBeforeSwitch = ephemeralSnapshot.authOnlyBeforeSwitch;
  context.contextLimitBeforeSwitch = ephemeralSnapshot.contextLimitBeforeSwitch;
  context.maxTokensBeforeSwitch = ephemeralSnapshot.maxTokensBeforeSwitch;
  context.maxOutputTokensBeforeSwitch =
    ephemeralSnapshot.maxOutputTokensBeforeSwitch;
  context.preAliasEphemeralKeys = ephemeralSnapshot.preAliasEphemeralKeys;

  return context;
}

export async function switchActiveProvider(
  providerName: string,
  options: ProviderSwitchOptions = {},
): Promise<ProviderSwitchResult> {
  const context = createProviderSwitchContext(providerName, options);

  if (context.currentProvider === context.name) {
    return {
      changed: false,
      previousProvider: context.currentProvider,
      nextProvider: context.name,
      infoMessages: [],
    };
  }

  resetBucketFailoverHandler(context.config);
  logger.debug(
    () =>
      `[cli-runtime] Switching provider from ${context.currentProvider ?? 'none'} to ${context.name}`,
  );

  clearPreviousProviderSettings(context);
  activateProviderContext(context);
  await switchSettingsProvider(context);
  resolveProviderBaseUrl(context);
  await handleClaudeCodeOAuth(context);
  applyClaudeCodeOAuthDefaults(context);
  applyAliasEphemeralSettings(context);
  applyModelDefaults(context);
  addProviderInfoMessages(context);
  await initializeContentGeneratorConfigIfSupported(context.config);

  const profileName = getActiveProfileName();

  // Context-scoped model resolution (issue #1770): prefer the context-local
  // model sources over the stale global getActiveModelName().
  // Fallback chain: modelToApply → provider-scoped default → config model
  // → provider name. Must NEVER emit empty string for model.
  const providerDefaultModel =
    context.providerManager.getActiveProvider()?.getDefaultModel?.() ?? '';
  const effectiveModel =
    context.modelToApply ||
    providerDefaultModel ||
    context.config.getModel() ||
    context.name;

  // displayLabel: profile → model → provider name. Must NEVER be empty.
  const displayLabel = profileName ?? effectiveModel;

  coreEvents.emitModelProfileChanged({
    model: effectiveModel,
    providerName: context.name,
    profileName,
    displayLabel,
  });

  return {
    changed: true,
    previousProvider: context.currentProvider,
    nextProvider: context.name,
    defaultModel: context.modelToApply || undefined,
    infoMessages: context.infoMessages,
  };
}
