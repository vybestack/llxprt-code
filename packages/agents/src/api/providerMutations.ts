/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ApiKeyUpdateResult,
  BaseUrlUpdateResult,
  ModelChangeResult,
} from '@vybestack/llxprt-code-core';
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
import { loadProviderAliasEntries } from '@vybestack/llxprt-code-providers/composition.js';

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:providerMutations');
}

import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  assembleModelSelection,
  type ModelSelectionOperations,
} from './model-selection.js';

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

  const providerSettings = settingsService.getProviderSettings(
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
  const aliasConfig = loadProviderAliasEntries().find(
    (entry) => entry.alias === activeProvider.name,
  )?.config;

  selection.selectModel(modelName, aliasConfig?.modelDefaults ?? []);

  return {
    providerName: activeProvider.name,
    previousModel,
    nextModel: modelName,
    authRefreshed,
  };
}

export async function applyFacadeAuthBaseUrl(
  baseUrl: string | null,
  state: { baseUrl?: string },
  writeSetting: (key: string, value: unknown) => void,
  settings: SettingsService,
  provider: string,
): Promise<void> {
  state.baseUrl = baseUrl ?? undefined;
  try {
    await updateActiveProviderBaseUrl(
      baseUrl ?? '',
      { setEphemeralSetting: writeSetting },
      settings,
      provider,
    );
  } catch {
    // No-op under the fake seam.
  }
}

export function selectOwnerModel(
  settingsOwner: SessionSettingsOwner,
  settingsService: SettingsService,
  providers: RuntimeProviderManager,
): (model: string) => Promise<void> {
  return async (model) => {
    await setActiveModel(
      model,
      assembleModelSelection(settingsOwner),
      settingsService,
      providers.getActiveProvider(),
    );
  };
}
