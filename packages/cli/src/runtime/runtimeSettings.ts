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
import {
  formatMissingRuntimeMessage,
  formatNormalizationFailureMessage,
} from './messages.js';
import { ensureOAuthProviderRegistered } from '../providers/oauth-provider-registration.js';

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

  // @plan:PLAN-20251023-STATELESS-HARDENING.P08
  // Legacy fallback to global context (should not be used under stateless hardening)
  const context = getActiveProviderRuntimeContext();

  if (isStatelessProviderIntegrationEnabled()) {
    throw new Error(
      formatMissingRuntimeMessage({
        runtimeId: identity.runtimeId,
        missingFields: ['runtime registration'],
        hint: 'Register the runtime via activateIsolatedRuntimeContext() and registerCliProviderInfrastructure() before invoking CLI helpers.',
      }),
    );
  }

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

const RESERVED_PROVIDER_SETTING_KEYS = new Set([
  'model',
  'enabled',
  'apiKey',
  'api-key',
  'apiKeyfile',
  'api-keyfile',
  'baseUrl',
  'baseURL',
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
  const authType = config.getContentGeneratorConfig()?.authType;

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
      authType,
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
  'dumponerror',
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
  const preserveEphemerals = options.preserveEphemerals ?? [];
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

  if (currentProvider) {
    const previousSettings =
      getProviderSettingsSnapshot(settingsService, currentProvider) || {};
    for (const key of Object.keys(previousSettings)) {
      settingsService.setProviderSetting(currentProvider, key, undefined);
    }
  }

  const existingEphemerals =
    typeof config.getEphemeralSettings === 'function'
      ? config.getEphemeralSettings()
      : {};
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

  const defaultModel = normalizeSetting(activeProvider.getDefaultModel?.());
  let modelToApply =
    explicitConfigModel ??
    (currentProvider === name &&
    storedModelSetting &&
    storedModelSetting !== defaultModel
      ? storedModelSetting
      : undefined) ??
    defaultModel ??
    '';

  let availableModels: IModel[] = [];
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
            await config.refreshAuth(authType);
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

  return {
    changed: true,
    previousProvider: currentProvider,
    nextProvider: name,
    defaultModel: modelToApply || undefined,
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
 */
export async function applyCliArgumentOverrides(argv: {
  key?: string;
  keyfile?: string;
  set?: string[];
  baseurl?: string;
}): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { applyCliSetArguments } = await import(
    '../config/cliEphemeralSettings.js'
  );

  const { config } = getCliRuntimeServices();

  // 1. Apply --key (overrides profile auth-key)
  if (argv.key) {
    await updateActiveProviderApiKey(argv.key);
  }

  // 2. Apply --keyfile (overrides profile auth-keyfile)
  if (argv.keyfile) {
    const resolvedPath = argv.keyfile.replace(/^~/, homedir());
    const keyContent = await readFile(resolvedPath, 'utf-8');
    await updateActiveProviderApiKey(keyContent.trim());
    config.setEphemeralSetting('auth-keyfile', resolvedPath);
  }

  // 3. Apply --set arguments (overrides profile ephemerals)
  if (argv.set && Array.isArray(argv.set) && argv.set.length > 0) {
    applyCliSetArguments(config, argv.set);
  }

  // 4. Apply --baseurl (overrides profile base-url)
  if (argv.baseurl) {
    await updateActiveProviderBaseUrl(argv.baseurl);
  }
}
