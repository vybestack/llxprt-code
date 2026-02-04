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
  ProfileManager,
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  getProfilePersistableKeys,
  resolveAlias,
  getProviderConfigKeys,
  isLoadBalancerProfile,
} from '@vybestack/llxprt-code-core';
import type {
  ProviderManager,
  Profile,
  ModelParams,
  RuntimeAuthScopeFlushResult,
  LoadBalancerProfile,
  HydratedModel,
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
import {
  applyProfileWithGuards,
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
} from './profileApplication.js';
import {
  formatMissingRuntimeMessage,
  formatNormalizationFailureMessage,
} from './messages.js';
import { ensureOAuthProviderRegistered } from '../providers/oauth-provider-registration.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasConfig,
} from '../providers/providerAliases.js';

type ProfileApplicationResult = Awaited<
  ReturnType<typeof applyProfileWithGuards>
>;

// @plan PLAN-20251027-STATELESS5.P06
// NOTE: Adapter stub exists but not integrated until Phase 08
// Verified to compile successfully via: import type { AgentRuntimeAdapter } from './agentRuntimeAdapter.js';

export { createIsolatedRuntimeContextInternal as createIsolatedRuntimeContext };
export type {
  IsolatedRuntimeActivationOptions,
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeContextOptions,
} from './runtimeContextFactory.js';

// Load balancer stats exports
export {
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
};

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP-005
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 * @pseudocode:cli-runtime.md lines 5-15
 *
 * Runtime helper bundle that provides a stable API for CLI commands, hooks,
 * and components to interact with the active provider runtime context without
 * touching singletons directly.
 *
 * P08 stateless hardening ensures all runtime helpers supply explicit
 * stateless provider context (settings/config/userMemory) per invocation,
 * eliminating singleton fallbacks and enforcing runtime isolation.
 */

const logger = new DebugLogger('llxprt:runtime:settings');
const STATELESS_METADATA_KEYS = [
  'statelessHardening',
  'statelessProviderMode',
  'statelessGuards',
  'statelessMode',
] as const;

export type StatelessHardeningPreference = 'legacy' | 'strict';

let statelessHardeningPreferenceOverride: StatelessHardeningPreference | null =
  null;

function normalizeStatelessPreference(
  value: unknown,
): StatelessHardeningPreference | null {
  if (typeof value === 'boolean') {
    return value ? 'strict' : 'legacy';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'strict' ||
      normalized === 'enabled' ||
      normalized === 'true' ||
      normalized === 'on'
    ) {
      return 'strict';
    }
    if (
      normalized === 'legacy' ||
      normalized === 'disabled' ||
      normalized === 'false' ||
      normalized === 'off'
    ) {
      return 'legacy';
    }
  }
  return null;
}

function readStatelessPreferenceFromMetadata(
  metadata: Record<string, unknown> | undefined,
): StatelessHardeningPreference | null {
  if (!metadata) {
    return null;
  }
  for (const key of STATELESS_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      const value = metadata[key];
      const preference = normalizeStatelessPreference(value);
      if (preference) {
        return preference;
      }
    }
  }
  return null;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 */
function resolveStatelessHardeningPreference(): StatelessHardeningPreference {
  const scope = getCurrentRuntimeScope();
  const scopePreference = readStatelessPreferenceFromMetadata(scope?.metadata);
  if (scopePreference) {
    return scopePreference;
  }

  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(runtimeId);
  const entryPreference = readStatelessPreferenceFromMetadata(entry?.metadata);
  if (entryPreference) {
    return entryPreference;
  }

  if (statelessHardeningPreferenceOverride) {
    return statelessHardeningPreferenceOverride;
  }

  return 'strict';
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Configure the global CLI stateless guard preference. Tests and CLI bootstrap
 * can call this to opt into strict guards without environment toggles.
 */
export function configureCliStatelessHardening(
  preference: StatelessHardeningPreference | null,
): void {
  statelessHardeningPreferenceOverride = preference;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 */
export function getCliStatelessHardeningOverride(): StatelessHardeningPreference | null {
  return statelessHardeningPreferenceOverride;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Reports the currently resolved stateless hardening preference.
 */
export function getCliStatelessHardeningPreference(): StatelessHardeningPreference {
  return resolveStatelessHardeningPreference();
}

function isStatelessProviderIntegrationEnabled(): boolean {
  return resolveStatelessHardeningPreference() === 'strict';
}

export function isCliStatelessProviderModeEnabled(): boolean {
  return isStatelessProviderIntegrationEnabled();
}

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
  profileManager: ProfileManager | null;
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
    profileManager: Object.prototype.hasOwnProperty.call(
      update,
      'profileManager',
    )
      ? (update.profileManager ?? null)
      : (current?.profileManager ?? null),
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

  const hint = isStatelessProviderIntegrationEnabled()
    ? 'Stateless hardening requires explicit runtime registration.'
    : 'Ensure setCliRuntimeContext() was called before consuming CLI helpers.';

  throw new Error(
    formatMissingRuntimeMessage({
      runtimeId,
      missingFields: ['runtime registration'],
      hint,
    }),
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
  profileManager?: ProfileManager;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 *
 * Acquire the active provider runtime context that CLI bootstrap registered.
 * Throws if the runtime has not yet been initialised.
 *
 * When stateless hardening is enabled, this enforces that all required
 * services (settingsService, config) are present in the runtime registry
 * before allowing provider operations.
 */
export function getCliRuntimeContext(): ProviderRuntimeContext {
  const identity = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(identity.runtimeId);

  if (entry && entry.config) {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08
    // @requirement:REQ-SP4-004 - Remove singleton fallbacks when stateless hardening is enabled
    const settingsService = entry.settingsService;

    if (isStatelessProviderIntegrationEnabled() && !settingsService) {
      throw new Error(
        formatMissingRuntimeMessage({
          runtimeId: identity.runtimeId,
          missingFields: ['SettingsService'],
          hint: 'Stateless hardening disables SettingsService fallbacks.',
        }),
      );
    }

    // Fallback path for legacy compatibility (disabled under stateless hardening)
    const resolvedSettings =
      settingsService ??
      entry.config.getSettingsService() ??
      new SettingsService();

    return createProviderRuntimeContext({
      settingsService: resolvedSettings,
      config: entry.config,
      runtimeId: identity.runtimeId,
      metadata: identity.metadata,
    });
  }

  if (isStatelessProviderIntegrationEnabled()) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId: identity.runtimeId,
        missingFields: ['runtime registration'],
        hint: 'Register the runtime via activateIsolatedRuntimeContext() and registerCliProviderInfrastructure() before invoking CLI helpers.',
      }),
    );
  }

  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // Legacy fallback to global context (should not be used under stateless hardening)
  const context = getActiveProviderRuntimeContext();

  if (!context.config) {
    throw new Error(
      '[cli-runtime] Active provider runtime context is missing Config instance. ' +
        'Ensure gemini bootstrap initialised runtime before invoking helpers.',
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
      formatNormalizationFailureMessage({
        runtimeId,
        missingFields: ['Config'],
        hint: 'registerCliProviderInfrastructure() must supply Config before CLI helpers run.',
      }),
    );
  }
  const settingsService = entry.settingsService ?? context.settingsService;
  if (!settingsService) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId,
        missingFields: ['SettingsService'],
        hint: 'Call activateIsolatedRuntimeContext() or inject a runtime-specific SettingsService for tests.',
      }),
    );
  }
  const providerManager = entry.providerManager;
  if (!providerManager) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId,
        missingFields: ['ProviderManager'],
        hint: 'Ensure registerCliProviderInfrastructure() runs inside the runtime activation scope.',
      }),
    );
  }
  const profileManager = entry.profileManager ?? undefined;
  return { settingsService, config, providerManager, profileManager };
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

export function isCliRuntimeStatelessReady(): boolean {
  if (!isStatelessProviderIntegrationEnabled()) {
    return true;
  }
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(runtimeId);
  if (!entry) {
    return false;
  }
  return Boolean(
    entry.settingsService && entry.config && entry.providerManager,
  );
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 *
 * Ensure the active provider runtime context is normalized and pushed into
 * ProviderManager before any provider invocation. This function enforces
 * stateless provider guarantees by requiring explicit runtime-scoped services
 * (settings, config, userMemory) before execution.
 *
 * When stateless hardening is enabled (runtime metadata/global preference),
 * this helper normalizes the current runtime context and registers it with
 * ProviderManager so downstream providers always receive call-scoped
 * configuration without relying on singleton fallbacks.
 */
export function ensureStatelessProviderReady(): void {
  if (!isStatelessProviderIntegrationEnabled()) {
    return;
  }

  const { runtimeId, metadata } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const settingsService = entry.settingsService;
  const config = entry.config;
  const providerManager = entry.providerManager;

  const missingFields: string[] = [];
  if (!settingsService) {
    missingFields.push('SettingsService');
  }
  if (!config) {
    missingFields.push('Config');
  }
  if (!providerManager) {
    missingFields.push('ProviderManager');
  }

  if (missingFields.length > 0) {
    throw new Error(
      formatNormalizationFailureMessage({
        runtimeId,
        missingFields,
        hint: 'Call registerCliProviderInfrastructure() inside activateIsolatedRuntimeContext() before invoking providers.',
      }),
    );
  }

  const runtimeContext = createProviderRuntimeContext({
    settingsService: settingsService!,
    config: config!,
    runtimeId,
    metadata,
  });

  providerManager!.prepareStatelessProviderInvocation(runtimeContext);

  logger.debug(
    () =>
      `[cli-runtime] Stateless provider ready for runtime ${runtimeId} (REQ-SP4-004, REQ-SP4-005)`,
  );
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
    manager.setConfig(config);
    // Set message bus getter on OAuthManager for interactive TUI prompts
    // This enables the bucket auth confirmation dialog to work via message bus
    // @plan PLAN-20251213issue490
    oauthManager.setMessageBus(() => config.getMessageBus());
    oauthManager.setConfigGetter(() => config);
    logger.debug(
      () =>
        `[cli-runtime] ProviderManager#setConfig applied (loggingEnabled=${config.getConversationLoggingEnabled?.() ?? false})`,
    );
    logger.debug(
      () => `[cli-runtime] OAuthManager message bus getter configured`,
    );
    upsertRuntimeEntry(runtimeId, { config });
  }
}

export function resetCliProviderInfrastructure(runtimeId?: string): void {
  let targetRuntimeId = runtimeId;
  if (!targetRuntimeId) {
    try {
      targetRuntimeId = resolveActiveRuntimeIdentity().runtimeId;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'MissingProviderRuntimeError' ||
          /No active provider runtime context/i.test(error.message) ||
          /MissingProviderRuntimeError/.test(error.message))
      ) {
        return;
      }
      throw error;
    }
  }
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

const RESERVED_PROVIDER_SETTING_KEYS = new Set(getProviderConfigKeys());

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
  ensureStatelessProviderReady();
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

  try {
    const provider = providerManager.getActiveProvider();
    const displayLabel = modelName
      ? `${provider.name}:${modelName}`
      : provider.name;

    // Try to get baseURL from provider if it has the method
    let baseURL: string | undefined;
    try {
      if (
        'getBaseURL' in provider &&
        typeof (provider as { getBaseURL?: () => string | undefined })
          .getBaseURL === 'function'
      ) {
        baseURL = (
          provider as { getBaseURL: () => string | undefined }
        ).getBaseURL();
      }
    } catch {
      baseURL = undefined;
    }

    return {
      providerName: provider.name,
      modelName,
      displayLabel,
      isPaidMode: provider.isPaidMode?.(),
      baseURL,
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
    };
  }
}

export async function listAvailableModels(
  providerName?: string,
): Promise<HydratedModel[]> {
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

// Use centralized settings registry for profile-persistable keys
export const PROFILE_EPHEMERAL_KEYS: readonly string[] =
  getProfilePersistableKeys();

const SENSITIVE_MODEL_PARAM_KEYS = new Set([
  'auth-key',
  'authKey',
  'auth-keyfile',
  'authKeyfile',
  'apiKey',
  'api-key',
  'apiKeyfile',
  'api-keyfile',
  'base-url',
  'baseUrl',
  'baseURL',
]);

function stripSensitiveModelParams<T extends Record<string, unknown>>(
  params: T,
): T {
  for (const key of SENSITIVE_MODEL_PARAM_KEYS) {
    if (key in params) {
      delete params[key as keyof T];
    }
  }
  return params;
}

/**
 * Gets a value from an object using a dot-notation key path.
 * For example, getNestedValue({ reasoning: { enabled: true } }, 'reasoning.enabled') returns true.
 * Falls back to direct key lookup for non-nested keys.
 */
function getNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
): unknown {
  // First try direct lookup (for flat keys like 'streaming')
  if (keyPath in obj) {
    return obj[keyPath];
  }

  // Handle dot-notation keys (e.g., 'reasoning.enabled')
  const parts = keyPath.split('.');
  if (parts.length === 1) {
    return undefined;
  }

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

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
  const ephemeralRecord = ephemeralSettings as Record<string, unknown>;
  const hasAuthKeyfile =
    ephemeralRecord['auth-keyfile'] !== undefined &&
    ephemeralRecord['auth-keyfile'] !== null;

  for (const key of PROFILE_EPHEMERAL_KEYS) {
    if (key === 'auth-key' && hasAuthKeyfile) {
      continue;
    }
    // Use getNestedValue to handle dot-notation keys like 'reasoning.enabled'
    let value = getNestedValue(ephemeralRecord, key);
    if (value === undefined) {
      // Settings may be stored under alias keys (e.g., 'max-tokens' instead of 'max_tokens').
      // Check all alias variants for this canonical key.
      for (const [aliasKey, aliasValue] of Object.entries(ephemeralRecord)) {
        if (aliasValue !== undefined && resolveAlias(aliasKey) === key) {
          value = aliasValue;
          break;
        }
      }
    }
    if (value !== undefined) {
      snapshot[key] = value;
    }
  }

  const snapshotHasAuthKeyfile =
    snapshot['auth-keyfile'] !== undefined && snapshot['auth-keyfile'] !== null;

  if (!snapshotHasAuthKeyfile && snapshot['auth-key'] === undefined) {
    const authKey =
      ephemeralRecord['auth-key'] ??
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

  if (snapshot['GOOGLE_CLOUD_PROJECT'] === undefined) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (typeof project === 'string' && project.trim().length > 0) {
      snapshot['GOOGLE_CLOUD_PROJECT'] = project;
    }
  }

  if (snapshot['GOOGLE_CLOUD_LOCATION'] === undefined) {
    const location = process.env.GOOGLE_CLOUD_LOCATION;
    if (typeof location === 'string' && location.trim().length > 0) {
      snapshot['GOOGLE_CLOUD_LOCATION'] = location;
    }
  }

  const modelParams = stripSensitiveModelParams(
    extractModelParams(providerSettings) as ModelParams,
  );

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

  const oauthManager = getCliOAuthManager();
  if (oauthManager) {
    void oauthManager
      .configureProactiveRenewalsForProfile(profile)
      .catch((error) => {
        logger.debug(
          () =>
            `[cli-runtime] Failed to configure proactive OAuth renewals: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      });

    // @fix issue1151 - Proactively wire the failover handler BEFORE any API calls
    // This ensures the handler is available when the first 403 error occurs.
    // Without this, the handler is only created inside getOAuthToken() which may
    // be too late if the 403 happens on the first request.
    // Only applies to StandardProfile (not LoadBalancerProfile)
    const standardProfile = profile as {
      auth?: { type?: string; buckets?: string[] };
    };
    const authConfig = standardProfile.auth;
    if (
      authConfig?.type === 'oauth' &&
      authConfig.buckets &&
      authConfig.buckets.length > 1
    ) {
      const bucketCount = authConfig.buckets.length;
      // Touch getOAuthToken to ensure handler is wired to config
      void oauthManager.getOAuthToken(profile.provider).catch((error) => {
        logger.debug(
          () =>
            `[issue1151] Failed to proactively wire failover handler: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      });
      logger.debug(
        () =>
          `[issue1151] Proactively wired failover handler for ${profile.provider} with ${bucketCount} buckets`,
      );
    }

    // @fix issue1250 - Proactively wire the failover handler for LoadBalancer sub-profiles
    // This is a follow-up to issue #1151 which only handled StandardProfile.
    // For LoadBalancer profiles, we need to iterate through all sub-profiles and
    // proactively wire failover handlers for any OAuth multi-bucket sub-profiles.
    if (isLoadBalancerProfile(profile)) {
      const subProfileNames = profile.profiles || [];
      logger.debug(
        () =>
          `[issue1250] LoadBalancer profile detected with ${subProfileNames.length} sub-profile(s)`,
      );

      for (const subProfileName of subProfileNames) {
        try {
          const subProfile = await new ProfileManager().loadProfile(
            subProfileName,
          );
          const subProfileAuth = (
            subProfile as { auth?: { type?: string; buckets?: string[] } }
          ).auth;

          if (
            subProfileAuth?.type === 'oauth' &&
            subProfileAuth.buckets &&
            subProfileAuth.buckets.length > 1
          ) {
            const subBucketCount = subProfileAuth.buckets.length;
            // Touch getOAuthToken to ensure handler is wired to config
            void oauthManager
              .getOAuthToken(subProfile.provider)
              .catch((error) => {
                logger.debug(
                  () =>
                    `[issue1250] Failed to proactively wire failover handler for sub-profile '${subProfileName}': ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                );
              });
            logger.debug(
              () =>
                `[issue1250] Proactively wired failover handler for sub-profile '${subProfileName}' (${subProfile.provider}) with ${subBucketCount} buckets`,
            );
          }
        } catch (error) {
          logger.debug(
            () =>
              `[issue1250] Failed to load sub-profile '${subProfileName}': ${
                error instanceof Error ? error.message : String(error)
              }`,
          );
        }
      }
    }
  }

  return {
    profileName: options.profileName,
    providerName: applicationResult.providerName,
    modelName: applicationResult.modelName,
    infoMessages: applicationResult.infoMessages,
    warnings: applicationResult.warnings,
    providerChanged: applicationResult.providerChanged,
    baseUrl: applicationResult.baseUrl,
    didFallback: applicationResult.didFallback,
    requestedProvider: applicationResult.requestedProvider,
  };
}

export async function saveProfileSnapshot(
  profileName: string,
  additionalConfig?: Partial<Profile>,
): Promise<Profile> {
  const manager = new ProfileManager();
  const snapshot = buildRuntimeProfileSnapshot();

  // Apply additional config if provided
  let finalProfile: Profile = snapshot;
  if (additionalConfig) {
    finalProfile = { ...snapshot, ...additionalConfig } as Profile;
  }

  await manager.saveProfile(profileName, finalProfile);
  return finalProfile;
}

/**
 * @deprecated This function saves old-style load balancer profiles (type='loadbalancer').
 * The old architecture did round-robin at profile-load time (selecting a profile once).
 * Use the new subProfiles architecture instead which does per-request load balancing.
 * This function is kept for backward compatibility only.
 */
export async function saveLoadBalancerProfile(
  profileName: string,
  profile: LoadBalancerProfile,
): Promise<void> {
  const manager = new ProfileManager();
  await manager.saveLoadBalancerProfile(profileName, profile);
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

export async function getProfileByName(profileName: string): Promise<Profile> {
  const manager = new ProfileManager();
  return manager.loadProfile(profileName);
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
    profileManager?: ProfileManager;
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
    profileManager: options.profileManager,
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

export interface ProviderSwitchResult {
  changed: boolean;
  previousProvider: string | null;
  nextProvider: string;
  defaultModel?: string;
  infoMessages: string[];
}

export interface ApiKeyUpdateResult {
  changed: boolean;
  providerName: string;
  message: string;
  isPaidMode?: boolean;
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
  | 'kimi'
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
  baseURL?: string;
}

/**
 * Switch the active provider using the runtime context, updating Config and
 * SettingsService consistently.
 *
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @requirement:REQ-SP-005
 * @pseudocode:cli-runtime.md lines 9-10
 */
function normalizeProviderBaseUrl(baseUrl?: string | null): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return undefined;
  }
  return trimmed;
}

function extractProviderBaseUrl(
  provider: unknown,
  visited = new Set<unknown>(),
): string | undefined {
  if (!provider) {
    return undefined;
  }

  if (typeof provider === 'object' && provider !== null) {
    if (visited.has(provider)) {
      return undefined;
    }
    visited.add(provider);
  }

  if (
    provider &&
    typeof provider === 'object' &&
    'wrappedProvider' in provider &&
    (provider as { wrappedProvider?: unknown }).wrappedProvider
  ) {
    const unwrapped = (provider as { wrappedProvider?: unknown })
      .wrappedProvider;
    const candidate = extractProviderBaseUrl(unwrapped, visited);
    if (candidate) {
      return candidate;
    }
  }

  const direct =
    normalizeProviderBaseUrl(
      (provider as { baseUrl?: string | null }).baseUrl ??
        (provider as { baseURL?: string | null }).baseURL,
    ) ??
    normalizeProviderBaseUrl(
      (provider as { BaseUrl?: string | null }).BaseUrl ??
        (provider as { BaseURL?: string | null }).BaseURL,
    );
  if (direct) {
    return direct;
  }

  const configCandidate = (
    provider as {
      providerConfig?: { baseUrl?: string; baseURL?: string };
    }
  ).providerConfig;
  if (configCandidate) {
    const fromConfig = normalizeProviderBaseUrl(
      configCandidate.baseUrl ?? configCandidate.baseURL,
    );
    if (fromConfig) {
      return fromConfig;
    }
  }

  const baseProviderConfig = (
    provider as {
      baseProviderConfig?: { baseURL?: string; baseUrl?: string };
    }
  ).baseProviderConfig;
  if (baseProviderConfig) {
    const baseProviderUrl = normalizeProviderBaseUrl(
      baseProviderConfig.baseURL ?? baseProviderConfig.baseUrl,
    );
    if (baseProviderUrl) {
      return baseProviderUrl;
    }
  }

  if (
    'getBaseURL' in (provider as Record<string, unknown>) &&
    typeof (provider as { getBaseURL?: () => string | undefined })
      .getBaseURL === 'function'
  ) {
    try {
      const reported = (
        provider as { getBaseURL: () => string | undefined }
      ).getBaseURL();
      const normalized = normalizeProviderBaseUrl(reported);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore provider errors when probing for base URL hints
    }
  }

  return undefined;
}

/**
 * Default ephemeral settings to preserve across provider switches.
 * These are context-related settings that should not be cleared when
 * switching providers, as they represent user preferences for the session.
 *
 * @requirement Issue #974 - Provider switching improperly clears context
 * @plan PLAN-20251023-STATELESS-HARDENING
 */
const DEFAULT_PRESERVE_EPHEMERALS = [
  'context-limit',
  'max_tokens',
  'streaming',
];

export async function switchActiveProvider(
  providerName: string,
  options: {
    autoOAuth?: boolean;
    preserveEphemerals?: string[];
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number;
  } = {},
): Promise<ProviderSwitchResult> {
  const autoOAuth = options.autoOAuth ?? false;
  // Merge default preserved ephemerals with any caller-specified ones
  const preserveEphemerals = [
    ...DEFAULT_PRESERVE_EPHEMERALS,
    ...(options.preserveEphemerals ?? []),
  ];
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
      infoMessages: [],
    };
  }

  logger.debug(
    () =>
      `[cli-runtime] Switching provider from ${currentProvider ?? 'none'} to ${name}`,
  );

  if (currentProvider) {
    const previousSettings =
      getProviderSettingsSnapshot(settingsService, currentProvider) || {};
    for (const key of Object.keys(previousSettings)) {
      settingsService.setProviderSetting(currentProvider, key, undefined);
    }
  }

  // @requirement:Issue-181 - Capture authOnly and user-set OAuth defaults before clearing
  const existingEphemerals =
    typeof config.getEphemeralSettings === 'function'
      ? config.getEphemeralSettings()
      : {};
  const authOnlyBeforeSwitch = existingEphemerals.authOnly;
  const contextLimitBeforeSwitch = existingEphemerals['context-limit'];
  const maxTokensBeforeSwitch = existingEphemerals.max_tokens;

  const keysBeforeClearing = Object.keys(existingEphemerals);
  for (const key of keysBeforeClearing) {
    const shouldPreserve =
      key === 'activeProvider' || preserveEphemerals.includes(key);
    if (shouldPreserve) {
      continue;
    }
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

  await settingsService.switchProvider(name);
  logger.debug(
    () =>
      `[cli-runtime] settingsService activeProvider now=${settingsService.get('activeProvider')}`,
  );

  const unwrapProvider = (provider: unknown) => {
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
      getAuthMethodName?: () => Promise<string | null>;
    };
  };

  const baseProvider = unwrapProvider(activeProvider);

  const providerSettingsBefore = providerSettings ?? {};
  const normalizeSetting = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'none') {
      return undefined;
    }
    return trimmed;
  };

  let aliasConfig: ProviderAliasConfig | undefined;
  try {
    aliasConfig = loadProviderAliasEntries().find(
      (entry) => entry.alias === name,
    )?.config;
  } catch {
    aliasConfig = undefined;
  }
  const storedModelSetting = normalizeSetting(providerSettingsBefore.model);
  const storedBaseUrlSetting =
    normalizeSetting(providerSettingsBefore.baseUrl) ??
    normalizeSetting(
      (providerSettingsBefore as Record<string, unknown>).baseURL,
    );
  const hadCustomBaseUrl = Boolean(storedBaseUrlSetting);
  const explicitConfigModel =
    currentProvider === name
      ? normalizeSetting(
          typeof config.getModel === 'function' ? config.getModel() : undefined,
        )
      : undefined;
  const explicitConfigBaseUrl =
    currentProvider === name || preserveEphemerals.includes('base-url')
      ? normalizeSetting(
          typeof config.getEphemeralSetting === 'function'
            ? (config.getEphemeralSetting('base-url') as string | undefined)
            : undefined,
        )
      : undefined;

  for (const key of Object.keys(providerSettingsBefore)) {
    settingsService.setProviderSetting(name, key, undefined);
  }

  let providerBaseUrl: string | undefined;
  if (name === 'qwen') {
    providerBaseUrl = 'https://portal.qwen.ai/v1';
  }
  if (!providerBaseUrl) {
    const providerForBaseUrl =
      typeof providerManager.getProviderByName === 'function'
        ? providerManager.getProviderByName(name)
        : null;
    providerBaseUrl = extractProviderBaseUrl(
      providerForBaseUrl ?? activeProvider,
    );
  }
  const explicitBaseUrl =
    explicitConfigBaseUrl ??
    (currentProvider === name ? storedBaseUrlSetting : undefined);
  const finalBaseUrl = explicitBaseUrl ?? providerBaseUrl ?? undefined;

  if (finalBaseUrl) {
    config.setEphemeralSetting('base-url', finalBaseUrl);
    settingsService.setProviderSetting(name, 'baseUrl', finalBaseUrl);
    settingsService.setProviderSetting(name, 'baseURL', finalBaseUrl);
  } else {
    config.setEphemeralSetting('base-url', undefined);
    settingsService.setProviderSetting(name, 'baseUrl', undefined);
    settingsService.setProviderSetting(name, 'baseURL', undefined);
  }

  const aliasDefaultModel = normalizeSetting(aliasConfig?.defaultModel);
  const defaultModel =
    aliasDefaultModel ?? normalizeSetting(activeProvider.getDefaultModel?.());
  let modelToApply =
    explicitConfigModel ??
    (currentProvider === name &&
    storedModelSetting &&
    storedModelSetting !== defaultModel
      ? storedModelSetting
      : undefined) ??
    defaultModel ??
    '';

  let availableModels: HydratedModel[] = [];
  if (typeof providerManager.getAvailableModels === 'function') {
    try {
      availableModels = (await providerManager.getAvailableModels(name)) ?? [];
    } catch (error) {
      logger.debug(
        () =>
          `[cli-runtime] Failed to list models for provider '${name}': ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  const firstAvailableModelId = (() => {
    for (const model of availableModels) {
      if (typeof model?.id === 'string' && model.id.trim() !== '') {
        return model.id.trim();
      }
      if (typeof model?.name === 'string' && model.name.trim() !== '') {
        return model.name.trim();
      }
    }
    return undefined;
  })();

  let autoSelectedModel: string | undefined;

  if (!modelToApply || modelToApply.trim() === '') {
    if (firstAvailableModelId) {
      modelToApply = firstAvailableModelId;
      autoSelectedModel = firstAvailableModelId;
    }
  }

  modelToApply = modelToApply?.trim() ?? '';

  settingsService.setProviderSetting(name, 'model', modelToApply || undefined);
  config.setModel(modelToApply);

  const infoMessages: string[] = [];

  if (name === 'anthropic') {
    const oauthManager = getCliOAuthManager();
    if (oauthManager) {
      ensureOAuthProviderRegistered(
        'anthropic',
        oauthManager,
        undefined,
        options.addItem,
      );
      if (autoOAuth) {
        try {
          const hasNonOAuth =
            typeof baseProvider.hasNonOAuthAuthentication === 'function'
              ? await baseProvider.hasNonOAuthAuthentication()
              : true;
          if (!hasNonOAuth) {
            logger.debug(
              () =>
                `[cli-runtime] Anthropic OAuth check: hasNonOAuth=${hasNonOAuth} manager=${Boolean(oauthManager)}`,
            );
            if (!oauthManager.isOAuthEnabled('anthropic')) {
              await oauthManager.toggleOAuthEnabled('anthropic');
            }
            logger.debug(() => '[cli-runtime] Initiating Anthropic OAuth flow');
            await oauthManager.authenticate('anthropic');
            infoMessages.push(
              'Anthropic OAuth authentication completed. Use /auth anthropic to view status.',
            );
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          infoMessages.push(
            `Anthropic OAuth authentication failed: ${message}`,
          );
          logger.warn(
            () =>
              `[cli-runtime] Anthropic OAuth authentication failed: ${message}`,
          );
        }
      }
    }
  }

  // @requirement:Issue-181 - Apply sensible defaults for Anthropic OAuth (subscription mode)
  if (name === 'anthropic') {
    const oauthManager = getCliOAuthManager();
    const authOnlyEnabled =
      authOnlyBeforeSwitch === true || authOnlyBeforeSwitch === 'true';
    const oauthIsEnabled = oauthManager?.isOAuthEnabled('anthropic') ?? false;

    // Apply defaults when OAuth is being used (either explicitly enabled or via authOnly)
    if (authOnlyEnabled || oauthIsEnabled) {
      // Set context_limit default if not already set by user (restore user value or use default)
      if (contextLimitBeforeSwitch !== undefined) {
        config.setEphemeralSetting('context-limit', contextLimitBeforeSwitch);
        logger.debug(
          () =>
            `[cli-runtime] Preserved user-set context-limit=${contextLimitBeforeSwitch} for Anthropic OAuth mode (Issue #181)`,
        );
      } else {
        config.setEphemeralSetting('context-limit', 190000);
        logger.debug(
          () =>
            '[cli-runtime] Set default context-limit=190000 for Anthropic OAuth mode (Issue #181)',
        );
      }

      // Set max_tokens default if not already set by user (restore user value or use default)
      if (maxTokensBeforeSwitch !== undefined) {
        config.setEphemeralSetting('max_tokens', maxTokensBeforeSwitch);
        logger.debug(
          () =>
            `[cli-runtime] Preserved user-set max_tokens=${maxTokensBeforeSwitch} for Anthropic OAuth mode (Issue #181)`,
        );
      } else {
        config.setEphemeralSetting('max_tokens', 10000);
        logger.debug(
          () =>
            '[cli-runtime] Set default max_tokens=10000 for Anthropic OAuth mode (Issue #181)',
        );
      }

      // Restore authOnly setting
      if (authOnlyBeforeSwitch !== undefined) {
        config.setEphemeralSetting('authOnly', authOnlyBeforeSwitch);
      }
    }
  }

  // Apply alias-specific ephemeral settings (defaults) after the switch.
  const aliasEphemeralSettings = aliasConfig?.ephemeralSettings;
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

    for (const [rawKey, rawValue] of Object.entries(aliasEphemeralSettings)) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }

      const normalizedKey = key.toLowerCase();
      if (protectedAliasEphemeralKeys.has(normalizedKey)) {
        logger.warn(
          () =>
            `[cli-runtime] Skipping protected alias ephemeral setting '${key}' for provider '${name}'.`,
        );
        continue;
      }

      if (config.getEphemeralSetting(key) !== undefined) {
        continue;
      }

      if (
        rawValue === null ||
        rawValue === undefined ||
        Array.isArray(rawValue)
      ) {
        logger.warn(
          () =>
            `[cli-runtime] Skipping non-scalar alias ephemeral setting '${key}' for provider '${name}'.`,
        );
        continue;
      }

      if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
        logger.warn(
          () =>
            `[cli-runtime] Skipping non-finite alias ephemeral setting '${key}' for provider '${name}'.`,
        );
        continue;
      }

      const isScalar =
        typeof rawValue === 'string' ||
        typeof rawValue === 'number' ||
        typeof rawValue === 'boolean';
      if (!isScalar) {
        logger.warn(
          () =>
            `[cli-runtime] Skipping non-scalar alias ephemeral setting '${key}' for provider '${name}'.`,
        );
        continue;
      }

      config.setEphemeralSetting(key, rawValue);
    }
  }

  if (hadCustomBaseUrl) {
    const baseUrlChanged =
      !finalBaseUrl || finalBaseUrl === providerBaseUrl || !explicitBaseUrl;
    if (baseUrlChanged) {
      infoMessages.push(
        `Cleared custom base URL for provider '${name}'; default endpoint restored.`,
      );
    } else if (finalBaseUrl && finalBaseUrl !== providerBaseUrl) {
      infoMessages.push(
        `Preserved custom base URL '${finalBaseUrl}' for provider '${name}'.`,
      );
    }
  } else if (providerBaseUrl && finalBaseUrl === providerBaseUrl) {
    infoMessages.push(
      `Base URL set to '${providerBaseUrl}' for provider '${name}'.`,
    );
  }

  if (autoSelectedModel) {
    infoMessages.push(
      `Model set to '${autoSelectedModel}' for provider '${name}'.`,
    );
  } else if (modelToApply) {
    infoMessages.push(
      `Active model is '${modelToApply}' for provider '${name}'.`,
    );
  }

  if (name !== 'gemini') {
    infoMessages.push('Use /key to set API key if needed.');
  }

  if (
    typeof (
      config as Config & {
        initializeContentGeneratorConfig?: () => Promise<void>;
      }
    ).initializeContentGeneratorConfig === 'function'
  ) {
    try {
      await (
        config as Config & {
          initializeContentGeneratorConfig: () => Promise<void>;
        }
      ).initializeContentGeneratorConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        () =>
          `[cli-runtime] Failed to initialize content generator config: ${message}`,
      );
    }
  }

  return {
    changed: true,
    previousProvider: currentProvider,
    nextProvider: name,
    defaultModel: modelToApply || undefined,
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
    return `[runtime] updateActiveProviderApiKey provider='${providerName}' value=${masked} CALLED`;
  });

  if (!trimmed) {
    settingsService.setProviderSetting(providerName, 'apiKey', undefined);
    settingsService.setProviderSetting(providerName, 'auth-key', undefined);
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', undefined);

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
          ? '\n[OK] You are now using OAuth (no paid usage).'
          : ''),
      isPaidMode,
    };
  }

  settingsService.setProviderSetting(providerName, 'apiKey', trimmed);
  config.setEphemeralSetting('auth-key', trimmed);
  config.setEphemeralSetting('auth-keyfile', undefined);

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
    settingsService.setProviderSetting(providerName, 'baseURL', undefined);
    config.setEphemeralSetting('base-url', trimmed ?? undefined);
    return {
      changed: true,
      providerName,
      message: `Base URL cleared; provider '${providerName}' now uses the default endpoint.`,
    };
  }

  settingsService.setProviderSetting(providerName, 'baseUrl', trimmed);
  settingsService.setProviderSetting(providerName, 'baseURL', trimmed);
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

  // When auto-detecting, call the provider's getToolFormat() to get the actual detected format
  // This shows users what format will actually be used based on the model name
  const detectedFormat = isAutoDetected
    ? (provider.getToolFormat?.() ?? null)
    : null;

  return {
    providerName: provider.name,
    currentFormat: isAutoDetected ? detectedFormat : override,
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

  const authRefreshed = false;
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

  return {
    providerName: activeProvider.name,
    previousModel,
    nextModel: modelName,
    authRefreshed,
  };
}

/**
 * Apply CLI argument overrides to configuration.
 * Must be called AFTER provider manager creation (so getCliRuntimeServices() works)
 * but BEFORE provider switching (so auth is ready).
 *
 * This function applies CLI arguments in the correct order to ensure they override
 * profile settings:
 * 1. Apply --key (overrides profile auth-key)
 * 2. Apply --keyfile (overrides profile auth-keyfile)
 * 3. Apply --set arguments (overrides profile ephemerals)
 * 4. Apply --baseurl (overrides profile base-url)
 *
 * @param argv - CLI arguments
 * @param bootstrapArgs - Bootstrap parsed arguments (used for bundle compatibility)
 */
export async function applyCliArgumentOverrides(
  argv: {
    key?: string;
    keyfile?: string;
    set?: string[];
    baseurl?: string;
  },
  bootstrapArgs?: {
    keyOverride?: string | null;
    keyfileOverride?: string | null;
    setOverrides?: string[] | null;
    baseurlOverride?: string | null;
  },
): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { applyCliSetArguments } = await import(
    '../config/cliEphemeralSettings.js'
  );

  const { config } = getCliRuntimeServices();

  // 1. Apply --key (bootstrap override takes precedence, then argv)
  const keyToUse = bootstrapArgs?.keyOverride ?? argv.key;
  logger.debug(
    () =>
      `[runtime] applyCliArgumentOverrides keyToUse=${keyToUse ? '***' : 'null'}`,
  );
  if (keyToUse) {
    logger.debug(() => '[runtime] Calling updateActiveProviderApiKey');
    await updateActiveProviderApiKey(keyToUse);
    logger.debug(() => '[runtime] updateActiveProviderApiKey completed');
  }

  // 2. Apply --keyfile (bootstrap override takes precedence, then argv)
  const keyfileToUse = bootstrapArgs?.keyfileOverride ?? argv.keyfile;
  if (keyfileToUse) {
    const resolvedPath = keyfileToUse.replace(/^~/, homedir());
    const keyContent = await readFile(resolvedPath, 'utf-8');
    await updateActiveProviderApiKey(keyContent.trim());
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', resolvedPath);
  }

  // 3. Apply --set arguments (bootstrap override takes precedence, then argv)
  const setArgsToUse = bootstrapArgs?.setOverrides ?? argv.set;
  if (setArgsToUse && Array.isArray(setArgsToUse) && setArgsToUse.length > 0) {
    applyCliSetArguments(config, setArgsToUse);
  }

  // 4. Apply --baseurl (bootstrap override takes precedence, then argv)
  const baseurlToUse = bootstrapArgs?.baseurlOverride ?? argv.baseurl;
  if (baseurlToUse) {
    await updateActiveProviderBaseUrl(baseurlToUse);
  }
}
