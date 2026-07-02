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

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP-005
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 *
 * Runtime accessor module - provides read-side access to runtime state,
 * ephemeral settings, and model parameters.
 *
 * @plan:PLAN-20260320-ISSUE1575.P02 - Extracted from runtimeSettings.ts
 */

import {
  type Config,
  DebugLogger,
  type RuntimeProviderManager,
  peekActiveProviderRuntimeContext,
  type HydratedModel,
} from '@vybestack/llxprt-code-core';
import { createSettingsProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { getProviderConfigKeys } from '@vybestack/llxprt-code-settings';
import { type OAuthManager } from '../auth/index.js';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import { getCurrentRuntimeScope } from './runtimeContextFactory.js';
import {
  runtimeRegistry,
  resolveActiveRuntimeIdentity,
  requireRuntimeEntry,
} from './runtimeRegistry.js';
import { isMissingRuntimeError } from './runtimeLifecycle.js';
import { isStatelessProviderIntegrationEnabled } from './statelessHardening.js';
import {
  formatMissingRuntimeMessage,
  formatNormalizationFailureMessage,
} from './messages.js';

const logger = new DebugLogger('llxprt:runtime:settings');

export interface CliRuntimeServices {
  settingsService: SettingsService;
  config: Config;
  providerManager: RuntimeProviderManager;
  profileManager?: ProfileManager;
}

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P06
 * @requirement REQ-D01-003.3
 * @requirement REQ-D01-004.3
 * @pseudocode lines 73-82
 */
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
export function getCliRuntimeContext() {
  const identity = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(identity.runtimeId);

  if (!entry?.config) {
    const registeredIds = Array.from(runtimeRegistry.keys());
    const scope = getCurrentRuntimeScope();
    const activeCtx = peekActiveProviderRuntimeContext();
    logger.debug(
      () =>
        `[getCliRuntimeContext] MISS: runtimeId=${identity.runtimeId}, hasEntry=${!!entry}, hasConfig=${!!entry?.config}, registered=[${registeredIds.join(', ')}], scope=${JSON.stringify(scope)}, activeCtx.runtimeId=${activeCtx?.runtimeId}`,
    );
  }

  if (entry?.config) {
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
      settingsService ?? entry.config.getSettingsService();
    return createSettingsProviderRuntimeContext({
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

  throw new Error(
    formatMissingRuntimeMessage({
      runtimeId: identity.runtimeId,
      missingFields: ['runtime registration'],
      hint: 'Register the runtime via setCliRuntimeContext() before invoking CLI runtime helpers.',
    }),
  );
}

/**
 * Obtain the services that CLI surfaces through the runtime context.
 */
export function getCliRuntimeServices(): CliRuntimeServices {
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const context = getCliRuntimeContext();
  const config = entry.config;
  if (!config) {
    throw new Error(
      formatNormalizationFailureMessage({
        runtimeId,
        missingFields: ['Config'],
        hint: 'registerCliProviderInfrastructure() must supply Config before CLI helpers run.',
      }),
    );
  }
  const settingsService = context.settingsService as SettingsService;
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

function registerAddItemCallback(
  oauthManager: unknown,
  addItem: OAuthUICallback,
): void {
  const providersMap = (
    oauthManager as {
      providers?: Map<string, unknown>;
    }
  ).providers;
  if (!(providersMap instanceof Map)) return;
  for (const provider of providersMap.values()) {
    const p = provider as {
      name?: string;
      setAddItem?: (callback: OAuthUICallback) => void;
    };
    if (p.name && typeof p.setAddItem === 'function') {
      p.setAddItem(addItem);
    }
  }
}

export function getCliProviderManager(
  options: {
    allowBrowserEnvironment?: boolean;
    settings?: { get: (key: string) => unknown };
    addItem?: OAuthUICallback;
  } = {},
): RuntimeProviderManager {
  const services = getCliRuntimeServices();
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = requireRuntimeEntry(runtimeId);
  const oauthManager = entry.oauthManager;

  if (options.addItem && oauthManager) {
    registerAddItemCallback(oauthManager, options.addItem);
  }
  return services.providerManager;
}

export function isCliRuntimeStatelessReady(): boolean {
  if (!isStatelessProviderIntegrationEnabled()) {
    return true;
  }

  let runtimeId: string;
  try {
    runtimeId = resolveActiveRuntimeIdentity().runtimeId;
  } catch (error) {
    if (isMissingRuntimeError(error)) {
      return false;
    }
    throw error;
  }

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
 * RuntimeProviderManager before any provider invocation. This function enforces
 * stateless provider guarantees by requiring explicit runtime-scoped services
 * (settings, config, userMemory) before execution.
 *
 * When stateless hardening is enabled (runtime metadata/global preference),
 * this helper normalizes the current runtime context and registers it with
 * RuntimeProviderManager so downstream providers always receive call-scoped
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

  const runtimeContext = createSettingsProviderRuntimeContext({
    settingsService: settingsService!,
    config: config!,
    runtimeId,
    metadata,
  });

  const runtimeProviderManager = providerManager!;
  if (
    typeof runtimeProviderManager.prepareStatelessProviderInvocation !==
    'function'
  ) {
    throw new Error(
      formatNormalizationFailureMessage({
        runtimeId,
        missingFields: ['prepareStatelessProviderInvocation'],
        hint: 'RuntimeProviderManager must expose stateless invocation preparation when stateless hardening is enabled.',
      }),
    );
  }

  runtimeProviderManager.prepareStatelessProviderInvocation(runtimeContext);
}

export function getCliOAuthManager(): OAuthManager | null {
  const { runtimeId } = resolveActiveRuntimeIdentity();
  const oauthManager = runtimeRegistry.get(runtimeId)?.oauthManager ?? null;
  logger.debug(
    () =>
      `[getCliOAuthManager] resolved runtimeId=${runtimeId}, registeredRuntimeCount=${runtimeRegistry.size}, hasOAuthManager=${!!oauthManager}`,
  );
  return oauthManager;
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

function getProviderManagerOrThrow(): RuntimeProviderManager {
  ensureStatelessProviderReady();
  const { providerManager } = getCliRuntimeServices();
  return providerManager;
}

function getActiveProviderOrThrow() {
  const manager = getProviderManagerOrThrow();
  try {
    const provider = manager.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider is configured.');
    }
    return provider;
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
    return provider?.getDefaultModel?.() ?? '';
  } catch {
    return '';
  }
}

export interface ProviderRuntimeStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  baseURL?: string;
}

export function getActiveProviderStatus(): ProviderRuntimeStatus {
  const { config, settingsService, providerManager } = getCliRuntimeServices();
  const resolvedModel = getActiveModelName();
  const modelName =
    resolvedModel && resolvedModel.trim() !== '' ? resolvedModel : null;

  try {
    const provider = providerManager.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider is configured.');
    }
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
    let fallbackLabel: string;
    if (providerName && modelName) {
      fallbackLabel = `${providerName}:${modelName}`;
    } else if (providerName) {
      fallbackLabel = providerName;
    } else {
      fallbackLabel = modelName ?? 'unknown';
    }
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
  RuntimeProviderManager['getProviderMetrics']
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

export function listProviders(): string[] {
  return getCliRuntimeServices().providerManager.listProviders();
}

export function getActiveProviderName(): string {
  const { providerManager } = getCliRuntimeServices();
  const providerName = providerManager.getActiveProviderName();
  if (providerName === undefined) {
    throw new Error('No active provider is configured.');
  }
  return providerName;
}

// Export private helpers for internal use by other runtime modules
export const _internal = {
  RESERVED_PROVIDER_SETTING_KEYS,
  resolveActiveProviderName,
  getProviderSettingsSnapshot,
  extractModelParams,
  getProviderManagerOrThrow,
  getActiveProviderOrThrow,
};
