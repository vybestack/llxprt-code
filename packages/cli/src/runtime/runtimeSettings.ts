/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  DebugLogger,
  ProviderRuntimeContext,
  SettingsService,
  AuthType,
  ProfileManager,
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import type {
  ProviderManager,
  Profile,
  IModel,
  ModelParams,
  RuntimeAuthScopeFlushResult,
} from '@vybestack/llxprt-code-core';
import { OAuthManager } from '../auth/oauth-manager.js';
import type { HistoryItemWithoutId } from '../ui/types.js';
import type { LoadedSettings } from '../config/settings.js';
import {
  createIsolatedRuntimeContext as createIsolatedRuntimeContextInternal,
  registerIsolatedRuntimeBindings,
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
  getCurrentRuntimeScope,
  enterRuntimeScope,
} from './runtimeContextFactory.js';
// @plan:PLAN-20251020-STATELESSPROVIDER3.P07
import { applyProfileWithGuards } from './profileApplication.js';

type ProfileApplicationResult = Awaited<
  ReturnType<typeof applyProfileWithGuards>
>;

export { createIsolatedRuntimeContextInternal as createIsolatedRuntimeContext };
export type {
  IsolatedRuntimeActivationOptions,
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeContextOptions,
} from './runtimeContextFactory.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md lines 5-15
 *
 * Runtime helper bundle that provides a stable API for CLI commands, hooks,
 * and components to interact with the active provider runtime context without
 * touching singletons directly.
 */

const logger = new DebugLogger('llxprt:runtime:settings');

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 1-3
 * Runtime registry that scopes Config/SettingsService/ProviderManager instances per runtimeId.
 */
interface RuntimeRegistryEntry {
  runtimeId: string;
  settingsService: SettingsService | null;
  config: Config | null;
  providerManager: ProviderManager | null;
  oauthManager: OAuthManager | null;
  metadata: Record<string, unknown>;
}

const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();
const LEGACY_RUNTIME_ID = 'legacy-singleton';

function resolveActiveRuntimeIdentity(): {
  runtimeId: string;
  metadata: Record<string, unknown>;
} {
  const scope = getCurrentRuntimeScope();
  if (scope) {
    return scope;
  }

  const context = getActiveProviderRuntimeContext();
  const runtimeId =
    typeof context.runtimeId === 'string' && context.runtimeId.trim() !== ''
      ? context.runtimeId
      : LEGACY_RUNTIME_ID;
  const metadata =
    (context.metadata as Record<string, unknown> | undefined) ?? {};

  return { runtimeId, metadata };
}

function upsertRuntimeEntry(
  runtimeId: string,
  update: Partial<Omit<RuntimeRegistryEntry, 'runtimeId'>>,
): RuntimeRegistryEntry {
  const current = runtimeRegistry.get(runtimeId);
  const next: RuntimeRegistryEntry = {
    runtimeId,
    settingsService: Object.prototype.hasOwnProperty.call(
      update,
      'settingsService',
    )
      ? (update.settingsService ?? null)
      : (current?.settingsService ?? null),
    config: Object.prototype.hasOwnProperty.call(update, 'config')
      ? (update.config ?? null)
      : (current?.config ?? null),
    providerManager: Object.prototype.hasOwnProperty.call(
      update,
      'providerManager',
    )
      ? (update.providerManager ?? null)
      : (current?.providerManager ?? null),
    oauthManager: Object.prototype.hasOwnProperty.call(update, 'oauthManager')
      ? (update.oauthManager ?? null)
      : (current?.oauthManager ?? null),
    metadata:
      update.metadata !== undefined
        ? { ...(current?.metadata ?? {}), ...update.metadata }
        : (current?.metadata ?? {}),
  };
  runtimeRegistry.set(runtimeId, next);
  return next;
}

function requireRuntimeEntry(runtimeId: string): RuntimeRegistryEntry {
  const entry = runtimeRegistry.get(runtimeId);
  if (entry) {
    return entry;
  }

  throw new Error(
    `[cli-runtime] Runtime ${runtimeId} has not been initialised. Ensure setCliRuntimeContext() was called before consuming CLI helpers.`,
  );
}

function disposeCliRuntime(
  runtimeId: string,
  context?: RuntimeAuthScopeFlushResult,
): void {
  if (context?.revokedTokens?.length) {
    logger.debug(
      () =>
        `[cli-runtime] Revoked ${context.revokedTokens.length} scoped OAuth token(s) for runtime ${runtimeId}.`,
    );
  }
  runtimeRegistry.delete(runtimeId);
}

export interface CliRuntimeServices {
  settingsService: SettingsService;
  config: Config;
  providerManager: ProviderManager;
}

/**
 * Acquire the active provider runtime context that CLI bootstrap registered.
 * Throws if the runtime has not yet been initialised.
 */
export function getCliRuntimeContext(): ProviderRuntimeContext {
  const identity = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(identity.runtimeId);

  if (entry && entry.config) {
    const settingsService =
      entry.settingsService ??
      entry.config.getSettingsService() ??
      new SettingsService();
    return createProviderRuntimeContext({
      settingsService,
      config: entry.config,
      runtimeId: identity.runtimeId,
      metadata: identity.metadata,
    });
  }

  const context = getActiveProviderRuntimeContext();
  if (!context.config) {
    throw new Error(
      '[cli-runtime] Active provider runtime context is missing Config instance. Ensure gemini bootstrap initialised runtime before invoking helpers.',
    );
  }
  return context;
}

/**
 * Obtain the services that CLI surfaces through the runtime context.
 */
export function getCliRuntimeServices(): CliRuntimeServices {
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const context = getCliRuntimeContext();
  const config = entry.config ?? context.config;
  if (!config) {
    throw new Error(
      `[cli-runtime] Config has not been initialised for runtime ${runtimeId}.`,
    );
  }
  const settingsService = entry.settingsService ?? context.settingsService;
  if (!settingsService) {
    throw new Error(
      `[cli-runtime] Settings service is unavailable for runtime ${runtimeId}.`,
    );
  }
  const providerManager = entry.providerManager;
  if (!providerManager) {
    throw new Error(
      `[cli-runtime] Provider manager has not been registered for runtime ${runtimeId}. Ensure registerCliProviderInfrastructure() ran within the activation scope.`,
    );
  }
  return { settingsService, config, providerManager };
}

export function getCliProviderManager(
  options: {
    allowBrowserEnvironment?: boolean;
    settings?: LoadedSettings;
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number;
  } = {},
): ProviderManager {
  const services = getCliRuntimeServices();
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const oauthManager = entry.oauthManager;

  if (options.addItem && oauthManager) {
    const providersMap = (
      oauthManager as unknown as {
        providers?: Map<string, unknown>;
      }
    ).providers;
    if (providersMap instanceof Map) {
      for (const provider of providersMap.values()) {
        const p = provider as {
          name?: string;
          setAddItem?: (
            callback: (
              itemData: Omit<HistoryItemWithoutId, 'id'>,
              baseTimestamp: number,
            ) => number,
          ) => void;
        };
        if (p.name && p.setAddItem) {
          p.setAddItem(options.addItem);
        }
      }
    }
  }
  return services.providerManager;
}

/**
 * @plan:PLAN-20251018-STATELESSPROVIDER2.P03
 * @requirement:REQ-SP2-002
 * @pseudocode multi-runtime-baseline.md lines 7-7
 * Delegate helper that activates an isolated runtime while merging metadata overrides per Step 6.
 */
export async function activateIsolatedRuntimeContext(
  handle: IsolatedRuntimeContextHandle,
  options: IsolatedRuntimeActivationOptions = {},
): Promise<void> {
  const runtimeId = options.runtimeId ?? handle.runtimeId;
  const mergedMetadata = {
    ...(handle.metadata ?? {}),
    ...(options.metadata ?? {}),
  };
  const overrides: IsolatedRuntimeActivationOptions = {
    ...options,
    runtimeId,
    metadata: mergedMetadata,
  };

  enterRuntimeScope({ runtimeId, metadata: mergedMetadata });
  upsertRuntimeEntry(runtimeId, { metadata: mergedMetadata });

  await handle.activate(overrides);
}

export function registerCliProviderInfrastructure(
  manager: ProviderManager,
  oauthManager: OAuthManager,
): void {
  const { runtimeId, metadata } = resolveActiveRuntimeIdentity();
  const entry = upsertRuntimeEntry(runtimeId, {
    providerManager: manager,
    oauthManager,
    metadata,
  });

  const context = getActiveProviderRuntimeContext();
  const config = entry.config ?? context.config ?? null;
  if (config) {
    config.setProviderManager(manager);
    upsertRuntimeEntry(runtimeId, { config });
  }
}

export function resetCliProviderInfrastructure(runtimeId?: string): void {
  const targetRuntimeId = runtimeId ?? resolveActiveRuntimeIdentity().runtimeId;
  if (!runtimeRegistry.has(targetRuntimeId)) {
    return;
  }

  upsertRuntimeEntry(targetRuntimeId, {
    providerManager: null,
    oauthManager: null,
  });
}

export function getCliOAuthManager(): OAuthManager | null {
  const { runtimeId } = resolveActiveRuntimeIdentity();
  return runtimeRegistry.get(runtimeId)?.oauthManager ?? null;
}

const RESERVED_PROVIDER_SETTING_KEYS = new Set([
  'model',
  'enabled',
  'apiKey',
  'api-key',
  'apiKeyfile',
  'api-keyfile',
  'baseUrl',
  'base-url',
  'toolFormat',
  'tool-format',
  'toolFormatOverride',
  'tool-format-override',
  'defaultModel',
]);

function resolveActiveProviderName(
  settingsService: SettingsService,
  config: Config,
): string | null {
  if (typeof config.getProvider === 'function') {
    const provider = config.getProvider();
    if (provider && provider.trim() !== '') {
      return provider;
    }
  }
  const fromSettings = settingsService.get('activeProvider');
  if (typeof fromSettings === 'string' && fromSettings.trim() !== '') {
    return fromSettings;
  }
  return null;
}

function getProviderSettingsSnapshot(
  settingsService: SettingsService,
  providerName: string,
): Record<string, unknown> {
  return settingsService.getProviderSettings(providerName);
}

function extractModelParams(
  providerSettings: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(providerSettings)) {
    if (
      value === undefined ||
      value === null ||
      RESERVED_PROVIDER_SETTING_KEYS.has(key)
    ) {
      continue;
    }
    params[key] = value;
  }
  return params;
}

/**
 * Accessor for the active CLI Config instance registered with the runtime
 * context. Throws if the bootstrap failed to attach the Config.
 */
export function getCliRuntimeConfig(): Config {
  const { config } = getCliRuntimeServices();
  return config;
}

function getProviderManagerOrThrow(): ProviderManager {
  const { providerManager } = getCliRuntimeServices();
  return providerManager;
}

function getActiveProviderOrThrow() {
  const manager = getProviderManagerOrThrow();
  try {
    return manager.getActiveProvider();
  } catch (error) {
    throw new Error(
      `[cli-runtime] Failed to resolve active provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getActiveModelName(): string {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const providerName = resolveActiveProviderName(settingsService, config);
  if (providerName) {
    const providerSettings = getProviderSettingsSnapshot(
      settingsService,
      providerName,
    );
    const storedModel = providerSettings.model as string | undefined;
    if (storedModel && storedModel.trim() !== '') {
      return storedModel;
    }
  }

  const configModel = config.getModel();
  if (configModel) {
    return configModel;
  }

  try {
    const provider = providerManager.getActiveProvider();
    return provider.getDefaultModel?.() ?? '';
  } catch {
    return '';
  }
}

export function getActiveProviderStatus(): ProviderRuntimeStatus {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const resolvedModel = getActiveModelName();
  const modelName =
    resolvedModel && resolvedModel.trim() !== '' ? resolvedModel : null;
  const authType = config.getContentGeneratorConfig()?.authType;

  try {
    const provider = providerManager.getActiveProvider();
    const displayLabel = modelName
      ? `${provider.name}:${modelName}`
      : provider.name;
    return {
      providerName: provider.name,
      modelName,
      displayLabel,
      isPaidMode: provider.isPaidMode?.(),
      authType,
    };
  } catch {
    const providerName =
      resolveActiveProviderName(settingsService, config) ?? null;
    const fallbackLabel = providerName
      ? modelName
        ? `${providerName}:${modelName}`
        : providerName
      : (modelName ?? 'unknown');
    return {
      providerName,
      modelName,
      displayLabel: fallbackLabel,
      authType,
    };
  }
}

export async function listAvailableModels(
  providerName?: string,
): Promise<IModel[]> {
  const manager = getProviderManagerOrThrow();
  return manager.getAvailableModels(providerName);
}

export function getActiveProviderMetrics(): ReturnType<
  ProviderManager['getProviderMetrics']
> {
  const manager = getProviderManagerOrThrow();
  return manager.getProviderMetrics();
}

export function getSessionTokenUsage(): {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
} {
  const manager = getProviderManagerOrThrow();
  return manager.getSessionTokenUsage();
}

export function getEphemeralSettings(): Record<string, unknown> {
  const { config } = getCliRuntimeServices();
  return config.getEphemeralSettings();
}

export function getEphemeralSetting(key: string): unknown {
  const { config } = getCliRuntimeServices();
  return config.getEphemeralSetting(key);
}

export function setEphemeralSetting(key: string, value: unknown): void {
  const { config } = getCliRuntimeServices();
  config.setEphemeralSetting(key, value);
}

export function clearEphemeralSetting(key: string): void {
  const { config } = getCliRuntimeServices();
  config.setEphemeralSetting(key, undefined);
}

export function getActiveModelParams(): Record<string, unknown> {
  const { config, settingsService } = getCliRuntimeServices();
  const providerName = resolveActiveProviderName(settingsService, config);
  if (!providerName) {
    return {};
  }
  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    providerName,
  );
  return extractModelParams(providerSettings);
}

export function setActiveModelParam(name: string, value: unknown): void {
  const { config, settingsService } = getCliRuntimeServices();
  const providerName = resolveActiveProviderName(settingsService, config);
  if (!providerName) {
    throw new Error('No active provider available to set model parameters.');
  }
  settingsService.setProviderSetting(providerName, name, value);
}

export function clearActiveModelParam(name: string): void {
  const { config, settingsService } = getCliRuntimeServices();
  const providerName = resolveActiveProviderName(settingsService, config);
  if (!providerName) {
    throw new Error('No active provider available to clear model parameters.');
  }
  settingsService.setProviderSetting(providerName, name, undefined);
}

const PROFILE_EPHEMERAL_KEYS: readonly string[] = [
  'auth-key',
  'auth-keyfile',
  'context-limit',
  'compression-threshold',
  'base-url',
  'tool-format',
  'api-version',
  'custom-headers',
  'disabled-tools',
  'tool-output-max-items',
  'tool-output-max-tokens',
  'tool-output-truncate-mode',
  'tool-output-item-size-limit',
  'max-prompt-tokens',
  'shell-replacement',
  'todo-continuation',
  'socket-timeout',
  'socket-keepalive',
  'socket-nodelay',
  'streaming',
  'retries',
  'retrywait',
  'maxTurnsPerPrompt',
];

export function buildRuntimeProfileSnapshot(): Profile {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const providerName =
    resolveActiveProviderName(settingsService, config) ??
    providerManager.getActiveProviderName() ??
    config.getProvider() ??
    'openai';
  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    providerName,
  );
  const currentModel =
    (providerSettings.model as string | undefined) ??
    config.getModel() ??
    providerManager.getProviderByName(providerName)?.getDefaultModel?.() ??
    'unknown';

  const ephemeralSettings = config.getEphemeralSettings();
  const snapshot: Record<string, unknown> = {};

  for (const key of PROFILE_EPHEMERAL_KEYS) {
    const value = (ephemeralSettings as Record<string, unknown>)[key];
    if (value !== undefined) {
      snapshot[key] = value;
    }
  }

  if (!('auth-keyfile' in snapshot) || snapshot['auth-keyfile'] === undefined) {
    const authKey =
      (ephemeralSettings as Record<string, unknown>)['auth-key'] ??
      (settingsService.get('auth-key') as string | undefined);
    if (authKey) {
      snapshot['auth-key'] = authKey;
    }
  }

  if (snapshot['base-url'] === undefined) {
    const baseUrl = providerSettings.baseUrl as string | undefined;
    if (baseUrl) {
      snapshot['base-url'] = baseUrl;
    }
  }

  const modelParams = extractModelParams(providerSettings) as ModelParams;

  return {
    version: 1,
    provider: providerName,
    model: currentModel,
    modelParams,
    ephemeralSettings: snapshot as Profile['ephemeralSettings'],
  };
}

export interface ProfileLoadOptions {
  profileName?: string;
}

export interface ProfileLoadResult {
  profileName?: string;
  providerName: string;
  modelName: string;
  infoMessages: string[];
  warnings: string[];
  providerChanged: boolean;
  authType?: AuthType;
  baseUrl?: string;
  didFallback: boolean;
  requestedProvider: string | null;
}

export interface RuntimeDiagnosticsSnapshot {
  providerName: string | null;
  modelName: string | null;
  profileName: string | null;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
}

export async function applyProfileSnapshot(
  profile: Profile,
  options: ProfileLoadOptions = {},
): Promise<ProfileLoadResult> {
  const { settingsService } = getCliRuntimeServices();

  const applicationResult: ProfileApplicationResult =
    await applyProfileWithGuards(profile, options);

  if (typeof settingsService.setCurrentProfileName === 'function') {
    settingsService.setCurrentProfileName(options.profileName ?? null);
  } else {
    settingsService.set('currentProfile', options.profileName ?? null);
  }

  return {
    profileName: options.profileName,
    providerName: applicationResult.providerName,
    modelName: applicationResult.modelName,
    infoMessages: applicationResult.infoMessages,
    warnings: applicationResult.warnings,
    providerChanged: applicationResult.providerChanged,
    authType: applicationResult.authType,
    baseUrl: applicationResult.baseUrl,
    didFallback: applicationResult.didFallback,
    requestedProvider: applicationResult.requestedProvider,
  };
}

export async function saveProfileSnapshot(
  profileName: string,
): Promise<Profile> {
  const manager = new ProfileManager();
  const snapshot = buildRuntimeProfileSnapshot();
  await manager.saveProfile(profileName, snapshot);
  return snapshot;
}

export async function loadProfileByName(
  profileName: string,
): Promise<ProfileLoadResult> {
  const manager = new ProfileManager();
  const profile = await manager.loadProfile(profileName);
  return applyProfileSnapshot(profile, { profileName });
}

export async function deleteProfileByName(profileName: string): Promise<void> {
  const manager = new ProfileManager();
  await manager.deleteProfile(profileName);
  const { settingsService } = getCliRuntimeServices();
  const currentProfile =
    typeof settingsService.getCurrentProfileName === 'function'
      ? settingsService.getCurrentProfileName()
      : (settingsService.get('currentProfile') as string | null);
  if (currentProfile === profileName) {
    if (typeof settingsService.setCurrentProfileName === 'function') {
      settingsService.setCurrentProfileName(null);
    } else {
      settingsService.set('currentProfile', null);
    }
  }
}

export async function listSavedProfiles(): Promise<string[]> {
  const manager = new ProfileManager();
  return manager.listProfiles();
}

export function getActiveProfileName(): string | null {
  const { settingsService } = getCliRuntimeServices();
  if (typeof settingsService.getCurrentProfileName === 'function') {
    return settingsService.getCurrentProfileName();
  }
  return (settingsService.get('currentProfile') as string | null) ?? null;
}

export function setDefaultProfileName(profileName: string | null): void {
  const { settingsService } = getCliRuntimeServices();
  settingsService.set('defaultProfile', profileName ?? undefined);
}

export function getRuntimeDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
  const { config, settingsService, providerManager } = getCliRuntimeServices();

  const providerName =
    resolveActiveProviderName(settingsService, config) ??
    providerManager.getActiveProviderName() ??
    null;
  const modelValue = getActiveModelName();
  const modelName =
    modelValue && modelValue.trim() !== ''
      ? modelValue
      : (config.getModel() ?? null);

  const profileName = getActiveProfileName();

  const modelParams = getActiveModelParams();
  const ephemeralSettings = config.getEphemeralSettings();

  return {
    providerName,
    modelName,
    profileName,
    modelParams,
    ephemeralSettings,
  };
}

export function listProviders(): string[] {
  return getCliRuntimeServices().providerManager.listProviders();
}

export function getActiveProviderName(): string {
  const { providerManager } = getCliRuntimeServices();
  return providerManager.getActiveProviderName();
}

/**
 * Register or update the active CLI runtime context.
 */
export function setCliRuntimeContext(
  settingsService: SettingsService,
  config?: Config,
  options: {
    metadata?: ProviderRuntimeContext['metadata'];
    runtimeId?: string;
  } = {},
): void {
  const runtimeId =
    options.runtimeId ?? `cli-runtime-${process.pid.toString(16)}`;
  const metadata = { source: 'cli-runtime', ...(options.metadata ?? {}) };
  const nextContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId,
    metadata,
  });
  logger.debug(() => {
    const providerLabel =
      config && typeof config.getProvider === 'function'
        ? ` (provider=${config.getProvider() ?? 'unset'})`
        : '';
    return `[cli-runtime] Registering runtime context ${runtimeId}${providerLabel}`;
  });
  setActiveProviderRuntimeContext(nextContext);

  upsertRuntimeEntry(runtimeId, {
    settingsService,
    config: config ?? null,
    metadata,
  });
}

registerIsolatedRuntimeBindings({
  resetInfrastructure: resetCliProviderInfrastructure,
  setRuntimeContext: setCliRuntimeContext,
  registerInfrastructure: registerCliProviderInfrastructure,
  linkProviderManager: (config, manager) => {
    config.setProviderManager(manager);
  },
  disposeRuntime: disposeCliRuntime,
}); // Step 5 (multi-runtime-baseline.md line 6) wires CLI activation hooks for isolated runtimes.

const PROVIDER_SWITCH_EPHEMERAL_KEYS: readonly string[] = [
  'auth-key',
  'auth-keyfile',
  'base-url',
  'context-limit',
  'compression-threshold',
  'tool-format',
  'api-version',
  'custom-headers',
  'model',
  'stream-options',
];

export interface ProviderSwitchResult {
  changed: boolean;
  previousProvider: string | null;
  nextProvider: string;
  defaultModel?: string;
  authType?: AuthType;
  infoMessages: string[];
}

export interface ApiKeyUpdateResult {
  changed: boolean;
  providerName: string;
  message: string;
  isPaidMode?: boolean;
  authType?: AuthType;
}

export interface BaseUrlUpdateResult {
  changed: boolean;
  providerName: string;
  message: string;
  baseUrl?: string;
}

export interface ToolFormatState {
  providerName: string;
  currentFormat: string | null;
  override: string | null;
  isAutoDetected: boolean;
}

export type ToolFormatOverrideLiteral =
  | 'auto'
  | 'openai'
  | 'qwen'
  | 'hermes'
  | 'xml'
  | 'anthropic'
  | 'deepseek'
  | 'gemma'
  | 'llama';

export interface ProviderRuntimeStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  authType?: AuthType;
}

/**
 * Switch the active provider using the runtime context, updating Config and
 * SettingsService consistently.
 *
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md lines 9-10
 */
export async function switchActiveProvider(
  providerName: string,
): Promise<ProviderSwitchResult> {
  const name = providerName.trim();
  if (!name) {
    throw new Error('Provider name is required.');
  }

  const { config, settingsService, providerManager } = getCliRuntimeServices();

  const currentProvider = providerManager.getActiveProviderName() || null;
  if (currentProvider === name) {
    return {
      changed: false,
      previousProvider: currentProvider,
      nextProvider: name,
      authType:
        config.getContentGeneratorConfig()?.authType ?? AuthType.USE_PROVIDER,
      infoMessages: [],
    };
  }

  logger.debug(
    () =>
      `[cli-runtime] Switching provider from ${currentProvider ?? 'none'} to ${name}`,
  );

  for (const key of PROVIDER_SWITCH_EPHEMERAL_KEYS) {
    config.setEphemeralSetting(key, undefined);
  }

  await providerManager.setActiveProvider(name);

  config.setProviderManager(providerManager);
  config.setProvider(name);
  logger.debug(() => `[cli-runtime] set config provider=${name}`);
  config.setEphemeralSetting('activeProvider', name);
  logger.debug(
    () =>
      `[cli-runtime] config ephemeral activeProvider=${config.getEphemeralSetting('activeProvider')}`,
  );

  const activeProvider = providerManager.getActiveProvider();
  const providerSettings = getProviderSettingsSnapshot(settingsService, name);

  // Clear any cached model parameters for the new provider
  const existingParams = extractModelParams(providerSettings);
  for (const key of Object.keys(existingParams)) {
    settingsService.setProviderSetting(name, key, undefined);
  }

  let resolvedDefaultModel =
    (providerSettings.model as string | undefined) ??
    activeProvider.getDefaultModel?.() ??
    '';

  if (resolvedDefaultModel) {
    settingsService.setProviderSetting(name, 'model', resolvedDefaultModel);
  } else {
    resolvedDefaultModel = '';
    settingsService.setProviderSetting(name, 'model', undefined);
  }

  await settingsService.switchProvider(name);
  logger.debug(
    () =>
      `[cli-runtime] settingsService activeProvider now=${settingsService.get('activeProvider')}`,
  );
  config.setModel(resolvedDefaultModel);

  let providerBaseUrl: string | undefined;
  if (name === 'qwen') {
    providerBaseUrl = 'https://portal.qwen.ai/v1';
  }
  if (providerBaseUrl) {
    config.setEphemeralSetting('base-url', providerBaseUrl);
    settingsService.setProviderSetting(name, 'baseUrl', providerBaseUrl);
  } else {
    settingsService.setProviderSetting(name, 'baseUrl', undefined);
  }

  let authType: AuthType;
  if (name === 'gemini') {
    const currentAuthType = config.getContentGeneratorConfig()?.authType;
    if (
      currentAuthType === AuthType.USE_PROVIDER ||
      currentAuthType === undefined
    ) {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        authType = AuthType.USE_VERTEX_AI;
      } else if (process.env.GEMINI_API_KEY) {
        authType = AuthType.USE_GEMINI;
      } else {
        authType = AuthType.LOGIN_WITH_GOOGLE;
      }
    } else {
      authType = currentAuthType;
    }
  } else {
    authType = AuthType.USE_PROVIDER;
  }

  await config.refreshAuth(authType);

  const infoMessages: string[] = [];
  if (name !== 'gemini') {
    infoMessages.push('Use /key to set API key if needed.');
  }

  return {
    changed: true,
    previousProvider: currentProvider,
    nextProvider: name,
    defaultModel: resolvedDefaultModel || undefined,
    authType,
    infoMessages,
  };
}

export interface ModelChangeResult {
  providerName: string;
  previousModel?: string;
  nextModel: string;
  authRefreshed: boolean;
}

export async function updateActiveProviderApiKey(
  apiKey: string | null,
): Promise<ApiKeyUpdateResult> {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const provider = providerManager.getActiveProvider();
  const providerName = provider.name;
  const trimmed = apiKey?.trim();

  logger.debug(() => {
    const masked = trimmed ? `***redacted*** (len=${trimmed.length})` : 'null';
    return `[runtime] updateActiveProviderApiKey provider='${providerName}' value=${masked}`;
  });

  let authType: AuthType | undefined;
  if (!trimmed) {
    settingsService.setProviderSetting(providerName, 'apiKey', undefined);
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', undefined);

    if (providerName === 'gemini') {
      authType = AuthType.LOGIN_WITH_GOOGLE;
      await config.refreshAuth(authType);
    }

    const isPaidMode = provider.isPaidMode?.();
    logger.debug(
      () =>
        `[runtime] api key removed for '${providerName}', paidMode=${String(isPaidMode)}`,
    );
    return {
      changed: true,
      providerName,
      message:
        `API key removed for provider '${providerName}'` +
        (providerName === 'gemini' && isPaidMode === false
          ? '\n✅ You are now using OAuth (no paid usage).'
          : ''),
      isPaidMode,
      authType,
    };
  }

  settingsService.setProviderSetting(providerName, 'apiKey', trimmed);
  config.setEphemeralSetting('auth-key', trimmed);
  config.setEphemeralSetting('auth-keyfile', undefined);

  if (providerName === 'gemini') {
    authType = AuthType.USE_GEMINI;
    await config.refreshAuth(authType);
  }

  const isPaidMode = provider.isPaidMode?.();
  logger.debug(
    () =>
      `[runtime] api key updated for '${providerName}', paidMode=${String(isPaidMode)}`,
  );
  return {
    changed: true,
    providerName,
    message:
      `API key updated for provider '${providerName}'` +
      (providerName === 'gemini' && isPaidMode !== false
        ? '\nWARNING: Gemini now runs in paid mode.'
        : ''),
    isPaidMode,
    authType,
  };
}

export async function updateActiveProviderBaseUrl(
  baseUrl: string | null,
): Promise<BaseUrlUpdateResult> {
  const { config, settingsService } = getCliRuntimeServices();
  const provider = getActiveProviderOrThrow();
  const providerName = provider.name;
  const trimmed = baseUrl?.trim();

  if (!trimmed || trimmed === '' || trimmed === 'none') {
    settingsService.setProviderSetting(providerName, 'baseUrl', undefined);
    config.setEphemeralSetting('base-url', trimmed ?? undefined);
    return {
      changed: true,
      providerName,
      message: `Base URL cleared; provider '${providerName}' now uses the default endpoint.`,
    };
  }

  settingsService.setProviderSetting(providerName, 'baseUrl', trimmed);
  config.setEphemeralSetting('base-url', trimmed);
  return {
    changed: true,
    providerName,
    message: `Base URL updated to '${trimmed}' for provider '${providerName}'.`,
    baseUrl: trimmed,
  };
}

export async function getActiveToolFormatState(): Promise<ToolFormatState> {
  const { settingsService } = getCliRuntimeServices();
  const provider = getActiveProviderOrThrow();

  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    provider.name,
  );
  const override =
    (providerSettings.toolFormat as string | undefined) ?? 'auto';

  const isAutoDetected = !override || override === 'auto';

  return {
    providerName: provider.name,
    currentFormat: isAutoDetected ? null : override,
    override: isAutoDetected ? null : override,
    isAutoDetected,
  };
}

export async function setActiveToolFormatOverride(
  formatName: ToolFormatOverrideLiteral | null,
): Promise<ToolFormatState> {
  const { settingsService } = getCliRuntimeServices();
  const provider = getActiveProviderOrThrow();

  if (!formatName || formatName === 'auto') {
    await settingsService.updateSettings(provider.name, { toolFormat: 'auto' });
    return getActiveToolFormatState();
  }

  await settingsService.updateSettings(provider.name, {
    toolFormat: formatName,
  });
  return getActiveToolFormatState();
}

/**
 * Update the active model for the current provider while keeping Config and
 * SettingsService in sync.
 *
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md line 10
 */
export async function setActiveModel(
  modelName: string,
): Promise<ModelChangeResult> {
  const { config, settingsService, providerManager } = getCliRuntimeServices();

  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    throw new Error('No active provider is available.');
  }

  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    activeProvider.name,
  );
  const previousModel =
    (providerSettings.model as string | undefined) || config.getModel();

  let authRefreshed = false;
  try {
    settingsService.set('activeProvider', activeProvider.name);
    await settingsService.updateSettings(activeProvider.name, {
      model: modelName,
    });
  } catch (error) {
    logger.warn(
      () =>
        `[cli-runtime] Failed to persist model change via SettingsService: ${error}`,
    );
  }

  config.setModel(modelName);

  if (activeProvider.name === 'anthropic') {
    const providerWithAuth = activeProvider as {
      isAuthenticated?: () => Promise<boolean>;
    };
    if (typeof providerWithAuth.isAuthenticated === 'function') {
      const hasAuth = await providerWithAuth.isAuthenticated();
      if (!hasAuth) {
        const currentAuthType =
          config.getContentGeneratorConfig()?.authType ||
          AuthType.LOGIN_WITH_GOOGLE;
        await config.refreshAuth(currentAuthType);
        authRefreshed = true;
      }
    }
  }

  return {
    providerName: activeProvider.name,
    previousModel,
    nextModel: modelName,
    authRefreshed,
  };
}
