/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * @requirement:REQ-1575-003
 * Provider mutations: model, API key, base URL, and tool format changes.
 * Depends on runtimeAccessors.ts for runtime services access.
 */

import type { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { ModelDefaultRule } from '../providers/providerAliases.js';
import { getCliRuntimeServices, _internal } from './runtimeAccessors.js';

const logger = new DebugLogger('llxprt:runtime:providerMutations');

/**
 * Compute merged ephemeral settings from modelDefaults rules that match a model name.
 * Rules are applied in order — later rules override earlier for the same key.
 * Returns a flat Record of the merged settings.
 */
export function computeModelDefaults(
  modelName: string,
  modelDefaultRules: ModelDefaultRule[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const rule of modelDefaultRules) {
    const regex = new RegExp(rule.pattern, 'i');
    if (regex.test(modelName)) {
      for (const [key, value] of Object.entries(rule.ephemeralSettings)) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

/**
 * Normalize a provider base URL by trimming whitespace and handling 'none' keyword.
 * Returns undefined for empty/none URLs.
 */
export function normalizeProviderBaseUrl(
  baseUrl?: string | null,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return undefined;
  }
  return trimmed;
}

function isInspectableProvider(
  provider: unknown,
): provider is Record<string, unknown> {
  return (
    (typeof provider === 'object' || typeof provider === 'function') &&
    provider !== null
  );
}

function extractWrappedProviderBaseUrl(
  provider: Record<string, unknown>,
  visited: Set<unknown>,
): string | undefined {
  const wrappedProvider = (provider as { wrappedProvider?: unknown })
    .wrappedProvider;
  if (!wrappedProvider) {
    return undefined;
  }
  return extractProviderBaseUrl(wrappedProvider, visited);
}

function extractDirectProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  return (
    normalizeProviderBaseUrl(
      (provider as { baseUrl?: string | null }).baseUrl ??
        (provider as { baseURL?: string | null }).baseURL,
    ) ??
    normalizeProviderBaseUrl(
      (provider as { BaseUrl?: string | null }).BaseUrl ??
        (provider as { BaseURL?: string | null }).BaseURL,
    )
  );
}

function extractConfiguredProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const configCandidate = (
    provider as {
      providerConfig?: { baseUrl?: string; baseURL?: string };
    }
  ).providerConfig;
  if (!configCandidate) {
    return undefined;
  }
  return normalizeProviderBaseUrl(
    configCandidate.baseUrl ?? configCandidate.baseURL,
  );
}

function extractBaseProviderConfigUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const baseProviderConfig = (
    provider as {
      baseProviderConfig?: { baseURL?: string; baseUrl?: string };
    }
  ).baseProviderConfig;
  if (!baseProviderConfig) {
    return undefined;
  }
  return normalizeProviderBaseUrl(
    baseProviderConfig.baseURL ?? baseProviderConfig.baseUrl,
  );
}

function extractProviderGetBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const getter = (provider as { getBaseURL?: () => string | undefined })
    .getBaseURL;
  if (typeof getter !== 'function') {
    return undefined;
  }
  try {
    return normalizeProviderBaseUrl(getter());
  } catch {
    return undefined;
  }
}

/**
 * Extract base URL from a provider object by checking various properties.
 * Handles wrapped providers and multiple naming conventions (baseUrl/baseURL).
 */
export function extractProviderBaseUrl(
  provider: unknown,
  visited = new Set<unknown>(),
): string | undefined {
  if (!isInspectableProvider(provider) || visited.has(provider)) {
    return undefined;
  }
  visited.add(provider);

  return (
    extractWrappedProviderBaseUrl(provider, visited) ??
    extractDirectProviderBaseUrl(provider) ??
    extractConfiguredProviderBaseUrl(provider) ??
    extractBaseProviderConfigUrl(provider) ??
    extractProviderGetBaseUrl(provider)
  );
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

export interface ModelChangeResult {
  providerName: string;
  previousModel?: string;
  nextModel: string;
  authRefreshed: boolean;
}

/**
 * Helper for setActiveModel: recomputes and applies model defaults diff.
 * Clears stale defaults (old but not new) and applies new defaults,
 * protecting user-set values that differ from old defaults.
 */
function recomputeAndApplyModelDefaultsDiff(
  config: Config,
  previousModel: string | undefined,
  newModel: string,
  modelDefaultRules: ModelDefaultRule[],
): void {
  const oldDefaults = previousModel
    ? computeModelDefaults(previousModel, modelDefaultRules)
    : {};

  const newDefaults = computeModelDefaults(newModel, modelDefaultRules);

  // Clear keys in old defaults but NOT in new defaults,
  // only if current value matches the old default (model-defaulted, not user-set).
  for (const [key, oldValue] of Object.entries(oldDefaults)) {
    if (!(key in newDefaults)) {
      const currentValue = config.getEphemeralSetting(key);
      if (currentValue === oldValue) {
        config.setEphemeralSetting(key, undefined);
      }
    }
  }

  // Apply new defaults: only if key is undefined or current value matches old default.
  for (const [key, newValue] of Object.entries(newDefaults)) {
    const currentValue = config.getEphemeralSetting(key);
    if (currentValue === undefined) {
      config.setEphemeralSetting(key, newValue);
    } else if (key in oldDefaults && currentValue === oldDefaults[key]) {
      config.setEphemeralSetting(key, newValue);
    }
  }
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
    settingsService.setProviderSetting(providerName, 'apiKeyfile', undefined);
    settingsService.setProviderSetting(providerName, 'auth-keyfile', undefined);
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', undefined);
    config.setEphemeralSetting('auth-key-name', undefined);

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
          ? '\n✓ You are now using OAuth (no paid usage).'
          : ''),
      isPaidMode,
    };
  }

  settingsService.setProviderSetting(providerName, 'apiKey', trimmed);
  settingsService.setProviderSetting(providerName, 'apiKeyfile', undefined);
  settingsService.setProviderSetting(providerName, 'auth-keyfile', undefined);
  config.setEphemeralSetting('auth-key', trimmed);
  config.setEphemeralSetting('auth-keyfile', undefined);
  config.setEphemeralSetting('auth-key-name', undefined);

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
  const provider = _internal.getActiveProviderOrThrow();
  const providerName = provider.name;
  const trimmed = baseUrl?.trim();

  const normalizedBaseUrl =
    trimmed && trimmed.toLowerCase() === 'none' ? '' : trimmed;

  if (!normalizedBaseUrl) {
    settingsService.setProviderSetting(providerName, 'base-url', undefined);
    config.setEphemeralSetting('base-url', undefined);
    return {
      changed: true,
      providerName,
      message: `Base URL cleared; provider '${providerName}' now uses the default endpoint.`,
    };
  }

  settingsService.setProviderSetting(
    providerName,
    'base-url',
    normalizedBaseUrl,
  );
  config.setEphemeralSetting('base-url', normalizedBaseUrl);
  return {
    changed: true,
    providerName,
    message: `Base URL updated to '${normalizedBaseUrl}' for provider '${providerName}'.`,
    baseUrl: normalizedBaseUrl,
  };
}

export async function getActiveToolFormatState(): Promise<ToolFormatState> {
  const { settingsService } = getCliRuntimeServices();
  const provider = _internal.getActiveProviderOrThrow();

  const providerSettings = _internal.getProviderSettingsSnapshot(
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
  const provider = _internal.getActiveProviderOrThrow();

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

  const providerSettings = _internal.getProviderSettingsSnapshot(
    settingsService,
    activeProvider.name,
  );
  const previousModel =
    (providerSettings.model as string | undefined) ?? config.getModel();

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

  // Load alias config for the current provider to apply model defaults
  const { loadProviderAliasEntries } = await import(
    '../providers/providerAliases.js'
  );
  let aliasConfig;
  try {
    aliasConfig = loadProviderAliasEntries().find(
      (entry) => entry.alias === activeProvider.name,
    )?.config;
  } catch {
    aliasConfig = undefined;
  }

  // Stateless recomputation of model defaults.
  if (aliasConfig?.modelDefaults) {
    recomputeAndApplyModelDefaultsDiff(
      config,
      previousModel,
      modelName,
      aliasConfig.modelDefaults,
    );
  }

  return {
    providerName: activeProvider.name,
    previousModel,
    nextModel: modelName,
    authRefreshed,
  };
}
