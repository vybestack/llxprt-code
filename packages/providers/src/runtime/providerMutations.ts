/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * @requirement:REQ-1575-003
 * Provider mutations: model, API key, base URL, and tool format changes.
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { ModelDefaultRule } from '../composition/index.js';
import { getProviderSettingsSnapshot } from './providerModelParameters.js';

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:providerMutations');
}

/**
 * Compute merged ephemeral settings from modelDefaults rules that match a model name.
 * Rules are applied in order — later rules override earlier for the same key.
 * Returns a flat Record of the merged settings.
 */
export function computeModelDefaults(
  modelName: string,
  modelDefaultRules: readonly ModelDefaultRule[],
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
  if (wrappedProvider == null) {
    return undefined;
  }
  return extractProviderBaseUrl(wrappedProvider, visited);
}

function extractDirectProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  return normalizeProviderBaseUrl(
    (provider as { baseURL?: string | null }).baseURL,
  );
}

function extractConfiguredProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const configCandidate = (
    provider as { providerConfig?: { baseURL?: string } }
  ).providerConfig;
  if (!configCandidate) {
    return undefined;
  }
  return normalizeProviderBaseUrl(configCandidate.baseURL);
}

function extractBaseProviderConfigUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const baseProviderConfig = (
    provider as { baseProviderConfig?: { baseURL?: string } }
  ).baseProviderConfig;
  if (!baseProviderConfig) {
    return undefined;
  }
  return normalizeProviderBaseUrl(baseProviderConfig.baseURL);
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
 * Extract base URL from a provider object by checking the canonical baseURL
 * field on the provider, its providerConfig/baseProviderConfig containers,
 * and the getBaseURL() accessor, following wrapped providers. Provider
 * objects are LLxprt-owned IProvider instances; legacy spellings are
 * migrated at settings load and never appear here (issue #2533).
 */
export function extractProviderBaseUrl(
  provider: unknown,
  visited = new Set<unknown>(),
): string | undefined {
  if (!isInspectableProvider(provider) || visited.has(provider)) {
    return undefined;
  }
  visited.add(provider);

  for (const extractor of [
    () => extractWrappedProviderBaseUrl(provider, visited),
    () => extractDirectProviderBaseUrl(provider),
    () => extractConfiguredProviderBaseUrl(provider),
    () => extractBaseProviderConfigUrl(provider),
    () => extractProviderGetBaseUrl(provider),
  ]) {
    const baseUrl = extractor();
    if (baseUrl !== undefined) {
      return baseUrl;
    }
  }

  return undefined;
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

export interface ModelSelectionOperations {
  readModel(): string | undefined;
  selectModel(model: string, rules: readonly ModelDefaultRule[]): void;
}

export function assembleModelSelection(
  owner: SessionSettingsOwner,
): ModelSelectionOperations {
  return {
    readModel: () => owner.readSelectedModel(),
    selectModel: (model, rules) => {
      const previous = owner.readSelectedModel();
      owner.selectModel(model, {
        departing:
          previous === undefined ? {} : computeModelDefaults(previous, rules),
        arriving: computeModelDefaults(model, rules),
      });
    },
  };
}

export async function updateActiveProviderApiKey(
  apiKey: string | null,
  config: { setEphemeralSetting(key: string, value: unknown): void },
  settingsService: Pick<SettingsService, 'setProviderSetting'>,
  provider:
    | Pick<
        NonNullable<ReturnType<RuntimeProviderManager['getActiveProvider']>>,
        'name' | 'isPaidMode'
      >
    | undefined,
): Promise<ApiKeyUpdateResult> {
  if (!provider) throw new Error('No active provider is available.');
  const providerName = provider.name;
  const trimmed = apiKey?.trim();

  logger().debug(() => {
    const masked = trimmed ? `***redacted*** (len=${trimmed.length})` : 'null';
    return `[runtime] updateActiveProviderApiKey provider='${providerName}' value=${masked} CALLED`;
  });

  if (!trimmed) {
    settingsService.setProviderSetting(providerName, 'auth-key', undefined);
    settingsService.setProviderSetting(providerName, 'auth-keyfile', undefined);
    config.setEphemeralSetting('auth-key', undefined);
    config.setEphemeralSetting('auth-keyfile', undefined);
    config.setEphemeralSetting('auth-key-name', undefined);

    const isPaidMode = provider.isPaidMode?.();
    logger().debug(
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

  settingsService.setProviderSetting(providerName, 'auth-key', trimmed);
  settingsService.setProviderSetting(providerName, 'auth-keyfile', undefined);
  config.setEphemeralSetting('auth-key', trimmed);
  config.setEphemeralSetting('auth-keyfile', undefined);
  config.setEphemeralSetting('auth-key-name', undefined);

  const isPaidMode = provider.isPaidMode?.();
  logger().debug(
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
  config: { setEphemeralSetting(key: string, value: unknown): void },
  settingsService: Pick<SettingsService, 'setProviderSetting'>,
  providerName: string | undefined,
): Promise<BaseUrlUpdateResult> {
  if (!providerName) throw new Error('No active provider is available.');
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

export async function getActiveToolFormatState(
  owner: Pick<SessionSettingsOwner, 'readToolFormat' | 'writeToolFormat'>,
  provider:
    | Pick<
        NonNullable<ReturnType<RuntimeProviderManager['getActiveProvider']>>,
        'name' | 'getToolFormat'
      >
    | undefined,
): Promise<ToolFormatState> {
  if (!provider) throw new Error('No active provider is configured.');

  const rawOverride = owner.readToolFormat();
  const override = typeof rawOverride === 'string' ? rawOverride : 'auto';

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
  owner: Pick<SessionSettingsOwner, 'readToolFormat' | 'writeToolFormat'>,
  provider:
    | Pick<
        NonNullable<ReturnType<RuntimeProviderManager['getActiveProvider']>>,
        'name' | 'getToolFormat'
      >
    | undefined,
): Promise<ToolFormatState> {
  if (!provider) throw new Error('No active provider is configured.');

  if (!formatName || formatName === 'auto') {
    await owner.writeToolFormat('auto');
    return getActiveToolFormatState(owner, provider);
  }

  await owner.writeToolFormat(formatName);
  return getActiveToolFormatState(owner, provider);
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
  selection: ModelSelectionOperations,
  settingsService: Pick<SettingsService, 'getProviderSettings'>,
  activeProvider:
    | Pick<
        NonNullable<ReturnType<RuntimeProviderManager['getActiveProvider']>>,
        'name' | 'getDefaultModel'
      >
    | undefined,
): Promise<ModelChangeResult> {
  if (!activeProvider) {
    throw new Error('No active provider is available.');
  }

  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    activeProvider.name,
  );
  // #2534 Domain C2: read the previous model from the store this
  // transition owns (Config.getModel reads providers[P].model first, the
  // same store Config.setModel writes). Preferring the provider settings
  // snapshot goes stale across consecutive transitions because the
  // collapsed flow no longer duplicates the model write through
  // SettingsService.updateSettings; a stale previous model skips the
  // leaving-model default restoration in recomputeAndApplyModelDefaultsDiff.
  const previousModel =
    selection.readModel() ??
    (typeof providerSettings.model === 'string'
      ? providerSettings.model
      : undefined);

  const authRefreshed = false;
  // #2534 Domain C2: one transition. Config.setModel performs the single
  // provider-scoped store write (providers[P].model) and maintains the
  // contentGeneratorConfig.model projection. The removed duplicates
  // (settingsService.set('activeProvider') + updateSettings) wrote the same
  // store keys this transition owns.

  // Load alias config for the current provider to apply model defaults
  const { loadProviderAliasEntries } = await import('../composition/index.js');
  let aliasConfig;
  try {
    aliasConfig = loadProviderAliasEntries().find(
      (entry) => entry.alias === activeProvider.name,
    )?.config;
  } catch {
    aliasConfig = undefined;
  }

  selection.selectModel(modelName, aliasConfig?.modelDefaults ?? []);

  return {
    providerName: activeProvider.name,
    previousModel,
    nextModel: modelName,
    authRefreshed,
  };
}
