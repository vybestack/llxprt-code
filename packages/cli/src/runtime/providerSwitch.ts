/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, DebugLogger } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../ui/types.js';
import {
  getCliOAuthManager,
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
} from '../providers/providerAliases.js';
import { ensureOAuthProviderRegistered } from '../providers/oauth-provider-registration.js';

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
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
}

interface ProviderSwitchContext {
  name: string;
  currentProvider: string | null;
  autoOAuth: boolean;
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
  infoMessages: string[];
  addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;
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

function unwrapProvider(provider: unknown): {
  hasNonOAuthAuthentication?: () => Promise<boolean>;
} {
  const visited = new Set<unknown>();
  let current = provider as {
    wrappedProvider?: unknown;
  };

  while (
    current &&
    typeof current === 'object' &&
    'wrappedProvider' in current &&
    current.wrappedProvider
  ) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    current = current.wrappedProvider as {
      wrappedProvider?: unknown;
    };
  }

  return current as {
    hasNonOAuthAuthentication?: () => Promise<boolean>;
  };
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
  const previousSettings =
    getProviderSettingsSnapshot(settingsService, currentProvider) || {};
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
  preAliasEphemeralKeys: Set<string>;
} {
  const existingEphemerals =
    typeof context.config.getEphemeralSettings === 'function'
      ? context.config.getEphemeralSettings()
      : {};

  const authOnlyBeforeSwitch = existingEphemerals.authOnly;
  const contextLimitBeforeSwitch = existingEphemerals['context-limit'];
  const maxTokensBeforeSwitch = existingEphemerals.max_tokens;

  for (const key of Object.keys(existingEphemerals)) {
    const shouldPreserve =
      key === 'activeProvider' || context.preserveEphemerals.includes(key);
    if (!shouldPreserve) {
      context.config.setEphemeralSetting(key, undefined);
    }
  }

  return {
    authOnlyBeforeSwitch,
    contextLimitBeforeSwitch,
    maxTokensBeforeSwitch,
    preAliasEphemeralKeys: new Set(
      Object.keys(context.config.getEphemeralSettings()),
    ),
  };
}

function activateProviderContext(context: ProviderSwitchContext): void {
  const { name, config, providerManager } = context;
  providerManager.setActiveProvider(name);
  config.setProviderManager(providerManager);
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
  context.baseProvider = unwrapProvider(activeProvider);
}

function getProviderSettingsAndStoredValues(context: ProviderSwitchContext): {
  providerSettingsBefore: Record<string, unknown>;
  storedModelSetting: string | undefined;
  storedBaseUrlSetting: string | undefined;
} {
  const providerSettingsBefore =
    getProviderSettingsSnapshot(context.settingsService, context.name) ?? {};
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
    return 'https://portal.qwen.ai/v1';
  }
  return extractProviderBaseUrl(
    context.providerManager.getProviderByName(context.name) ??
      context.activeProvider,
  );
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
    normalizeSetting(context.activeProvider.getDefaultModel?.());
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

async function handleAnthropicOAuth(
  context: ProviderSwitchContext,
): Promise<void> {
  if (context.name !== 'anthropic') {
    return;
  }

  const oauthManager = getCliOAuthManager();
  if (!oauthManager) {
    return;
  }

  ensureOAuthProviderRegistered(
    'anthropic',
    oauthManager,
    undefined,
    context.addItem,
  );

  if (!context.autoOAuth) {
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
      () =>
        `[cli-runtime] Anthropic OAuth check: hasNonOAuth=${hasNonOAuth} manager=${Boolean(oauthManager)}`,
    );

    if (!oauthManager.isOAuthEnabled('anthropic')) {
      await oauthManager.toggleOAuthEnabled('anthropic');
    }

    logger.debug(() => '[cli-runtime] Initiating Anthropic OAuth flow');
    await oauthManager.authenticate('anthropic');
    context.infoMessages.push(
      'Anthropic OAuth authentication completed. Use /auth anthropic to view status.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.infoMessages.push(
      `Anthropic OAuth authentication failed: ${message}`,
    );
    logger.warn(
      () => `[cli-runtime] Anthropic OAuth authentication failed: ${message}`,
    );
  }
}

function applyAnthropicOAuthDefaults(context: ProviderSwitchContext): void {
  if (context.name !== 'anthropic') {
    return;
  }

  const oauthManager = getCliOAuthManager();
  const authOnlyEnabled =
    context.authOnlyBeforeSwitch === true ||
    context.authOnlyBeforeSwitch === 'true';
  const oauthIsEnabled = oauthManager?.isOAuthEnabled('anthropic') ?? false;

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
        `[cli-runtime] Preserved user-set context-limit=${context.contextLimitBeforeSwitch} for Anthropic OAuth mode (Issue #181)`,
    );
  } else {
    context.config.setEphemeralSetting('context-limit', 190000);
    logger.debug(
      () =>
        '[cli-runtime] Set default context-limit=190000 for Anthropic OAuth mode (Issue #181)',
    );
  }

  if (context.maxTokensBeforeSwitch !== undefined) {
    context.config.setEphemeralSetting(
      'max_tokens',
      context.maxTokensBeforeSwitch,
    );
    logger.debug(
      () =>
        `[cli-runtime] Preserved user-set max_tokens=${context.maxTokensBeforeSwitch} for Anthropic OAuth mode (Issue #181)`,
    );
  } else {
    context.config.setEphemeralSetting('max_tokens', 10000);
    logger.debug(
      () =>
        '[cli-runtime] Set default max_tokens=10000 for Anthropic OAuth mode (Issue #181)',
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
  const aliasEphemeralSettings = context.aliasConfig?.ephemeralSettings;
  if (
    !aliasEphemeralSettings ||
    typeof aliasEphemeralSettings !== 'object' ||
    Array.isArray(aliasEphemeralSettings)
  ) {
    return;
  }

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

  for (const [rawKey, rawValue] of Object.entries(aliasEphemeralSettings)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    if (protectedAliasEphemeralKeys.has(normalizedKey)) {
      logger.warn(
        () =>
          `[cli-runtime] Skipping protected alias ephemeral setting '${key}' for provider '${context.name}'.`,
      );
      continue;
    }

    if (context.config.getEphemeralSetting(key) !== undefined) {
      continue;
    }

    const isNullish = rawValue === null || rawValue === undefined;
    const isScalar =
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean';

    if (Array.isArray(rawValue) || isNullish || !isScalar) {
      logger.warn(
        () =>
          `[cli-runtime] Skipping non-scalar alias ephemeral setting '${key}' for provider '${context.name}'.`,
      );
      continue;
    }

    if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
      logger.warn(
        () =>
          `[cli-runtime] Skipping non-finite alias ephemeral setting '${key}' for provider '${context.name}'.`,
      );
      continue;
    }

    context.config.setEphemeralSetting(key, rawValue);
  }
}

function applyModelDefaults(context: ProviderSwitchContext): void {
  if (
    context.skipModelDefaults ||
    !context.modelToApply ||
    !context.aliasConfig?.modelDefaults
  ) {
    return;
  }

  const modelDefaults = computeModelDefaults(
    context.modelToApply,
    context.aliasConfig.modelDefaults,
  );

  for (const [key, value] of Object.entries(modelDefaults)) {
    if (!context.preAliasEphemeralKeys.has(key)) {
      context.config.setEphemeralSetting(key, value);
    }
  }
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
  const currentProvider = providerManager.getActiveProviderName() || null;

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
    autoOAuth: options.autoOAuth ?? false,
    skipModelDefaults: options.skipModelDefaults ?? false,
    preserveEphemerals,
    config,
    settingsService,
    providerManager,
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
    infoMessages: [],
    addItem: options.addItem,
  };

  const ephemeralSnapshot = clearEphemeralsForSwitch(context);
  context.authOnlyBeforeSwitch = ephemeralSnapshot.authOnlyBeforeSwitch;
  context.contextLimitBeforeSwitch = ephemeralSnapshot.contextLimitBeforeSwitch;
  context.maxTokensBeforeSwitch = ephemeralSnapshot.maxTokensBeforeSwitch;
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

  context.config.setBucketFailoverHandler?.(undefined);
  logger.debug(
    () =>
      `[cli-runtime] Switching provider from ${context.currentProvider ?? 'none'} to ${context.name}`,
  );

  clearPreviousProviderSettings(context);
  activateProviderContext(context);
  await switchSettingsProvider(context);
  resolveProviderBaseUrl(context);
  await handleAnthropicOAuth(context);
  applyAnthropicOAuthDefaults(context);
  applyAliasEphemeralSettings(context);
  applyModelDefaults(context);
  addProviderInfoMessages(context);
  await initializeContentGeneratorConfigIfSupported(context.config);

  return {
    changed: true,
    previousProvider: context.currentProvider,
    nextProvider: context.name,
    defaultModel: context.modelToApply || undefined,
    infoMessages: context.infoMessages,
  };
}
