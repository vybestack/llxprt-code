/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeProviderManager,
  HydratedModel,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { MissingProviderRuntimeError } from './messages.js';
import {
  loadProviderAliasEntries,
  computeUnallowedParameters,
} from '../composition/index.js';
export interface ProviderSelectionRead {
  readSelectedProvider(): string | undefined;
  readSelectedModel(): string | undefined;
}

function requireOwner(owner?: ProviderSelectionRead): ProviderSelectionRead {
  if (!owner) {
    throw new MissingProviderRuntimeError({
      providerKey: 'provider-runtime',
      missingFields: ['session selection'],
      stage: 'runtimeAccessor',
    });
  }
  return owner;
}

/**
 * #2534 Domain C3: the ONE active-provider resolution. Order: the settings
 * global 'activeProvider' store (the authoritative owner since C1), then the
 * ProviderManager runtime cache as fallback. The store can be momentarily
 * ahead of the manager cache during identity resolution (e.g. a resolved
 * codex identity while the manager still runs gemini), which is why the
 * store wins — the pinned contract in runtimeAccessors.spec.
 */
export function resolveActiveProviderName(
  owner: ProviderSelectionRead,
  manager: Pick<RuntimeProviderManager, 'getActiveProviderName'> | undefined,
): string | null {
  const config = requireOwner(owner);
  const selected = config.readSelectedProvider();
  return selected ?? manager?.getActiveProviderName() ?? null;
}

export function readActiveProviderName(
  settingsService: Pick<SettingsService, 'get'>,
  manager: Pick<RuntimeProviderManager, 'getActiveProviderName'> | undefined,
): string | null {
  const stored = settingsService.get('activeProvider');
  if (typeof stored === 'string' && stored.trim() !== '') {
    return stored;
  }
  // The cache fallback is best-effort: consumers of this resolution
  // UI status deliberately degrades when the manager itself
  // is broken, so a throwing cache read must not escape.
  try {
    const cached = manager?.getActiveProviderName();
    if (cached !== undefined && cached.trim() !== '') {
      return cached;
    }
  } catch {
    // fall through to null
  }
  return null;
}

function getActiveProviderOrThrow(
  manager: Pick<RuntimeProviderManager, 'getActiveProvider'>,
) {
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

export function getActiveModelName(
  owner: ProviderSelectionRead,
  manager?: Pick<
    RuntimeProviderManager,
    'getActiveProviderName' | 'getActiveProvider'
  >,
): string {
  const config = requireOwner(owner);
  const selected = config.readSelectedModel();
  if (selected !== undefined && selected.trim() !== '') return selected;

  try {
    const provider =
      manager === undefined ? undefined : getActiveProviderOrThrow(manager);
    return provider?.getDefaultModel?.() ?? '';
  } catch {
    return '';
  }
}

export async function listAvailableModels(
  providerName: string | undefined,
  manager: Pick<RuntimeProviderManager, 'getAvailableModels'>,
): Promise<HydratedModel[]> {
  return manager.getAvailableModels(providerName);
}

export function getActiveProviderMetrics(
  manager: Pick<RuntimeProviderManager, 'getProviderMetrics'>,
): ReturnType<RuntimeProviderManager['getProviderMetrics']> {
  return manager.getProviderMetrics();
}

export function getSessionTokenUsage(
  manager: Pick<RuntimeProviderManager, 'getSessionTokenUsage'>,
): {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
} {
  return manager.getSessionTokenUsage();
}

/**
 * Parameters the active model does not accept, declared via the active
 * provider alias's modelDefaults unallowedParameters rules. Returns an empty
 * array when the provider/model has no alias rules or no alias config.
 */
export function getUnallowedParametersForActiveModel(
  owner: ProviderSelectionRead,
  manager?: Pick<
    RuntimeProviderManager,
    'getActiveProviderName' | 'getActiveProvider'
  >,
): string[] {
  const providerName = resolveActiveProviderName(owner, manager);
  if (!providerName) {
    return [];
  }
  const modelName = getActiveModelName(owner, manager);
  if (!modelName) {
    return [];
  }
  const aliasConfig = loadProviderAliasEntries().find(
    (entry) => entry.alias === providerName,
  )?.config;
  if (!aliasConfig?.modelDefaults) {
    return [];
  }
  return [...computeUnallowedParameters(modelName, aliasConfig.modelDefaults)];
}

export function listProviders(
  manager?: Pick<RuntimeProviderManager, 'listProviders'>,
): string[] {
  if (manager === undefined)
    throw new MissingProviderRuntimeError({
      providerKey: 'provider-listing',
      missingFields: ['provider listing owner'],
      stage: 'listProviders',
      message: 'Provider listing requires an explicit owner',
    });
  return manager.listProviders();
}

/**
 * The documented empty-state signal thrown by getActiveProviderName() when no
 * provider is active. Exported so consumers can distinguish this expected
 * condition from genuine runtime failures without matching raw strings.
 */
export const NO_ACTIVE_PROVIDER_ERROR_MESSAGE =
  'No active provider is configured.';

export function getActiveProviderName(
  owner: ProviderSelectionRead,
  manager?: Pick<RuntimeProviderManager, 'getActiveProviderName'>,
): string {
  const providerName = resolveActiveProviderName(owner, manager);
  if (providerName === null) {
    throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
  }
  return providerName;
}
