/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { extractModelParams } from '@vybestack/llxprt-code-providers/model-parameter-data.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  loadProviderAliasEntries,
  computeUnallowedParameters,
} from '@vybestack/llxprt-code-providers/composition.js';

export const NO_ACTIVE_PROVIDER_ERROR_MESSAGE =
  'No active provider is configured.';

export interface SessionProviderStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  baseURL?: string;
}

function requireOwner<T>(owner: T | undefined): T {
  if (owner === undefined)
    throw new Error('Provider reads require an explicit session owner');
  return owner;
}

type SelectionReads = Pick<
  SessionSettingsOwner,
  'readSelectedProvider' | 'readSelectedModel'
>;
type ProviderInspection = Pick<
  RuntimeProviderManager,
  | 'getActiveProviderName'
  | 'getActiveProvider'
  | 'getProviderByName'
  | 'getAvailableModels'
  | 'listProviders'
  | 'getProviderMetrics'
  | 'getSessionTokenUsage'
>;

export class SessionProviderReads {
  constructor(
    private readonly selection: SelectionReads,
    private readonly manager: ProviderInspection,
    private readonly readConfiguredModel: () => string,
    private readonly readProviderSettings: (
      provider: string,
    ) => Record<string, unknown>,
  ) {
    requireOwner<SelectionReads>(selection);
    requireOwner<ProviderInspection>(manager);
    requireOwner<() => string>(readConfiguredModel);
    requireOwner<(provider: string) => Record<string, unknown>>(
      readProviderSettings,
    );
  }

  readActiveProviderName(): string | null {
    return (
      this.selection.readSelectedProvider() ??
      this.manager.getActiveProviderName() ??
      null
    );
  }

  getActiveProviderName(): string {
    const name = this.readActiveProviderName();
    if (name === null) throw new Error(NO_ACTIVE_PROVIDER_ERROR_MESSAGE);
    return name;
  }

  getActiveModelName(): string {
    const selected = this.selection.readSelectedModel();
    if (selected !== undefined && selected.trim() !== '') return selected;
    const configured = this.readConfiguredModel();
    if (configured.trim() !== '') return configured;
    return this.manager.getActiveProvider()?.getDefaultModel?.() ?? '';
  }

  getActiveModelParams(): Record<string, unknown> {
    const provider = this.readActiveProviderName();
    return provider === null
      ? {}
      : extractModelParams(this.readProviderSettings(provider));
  }

  listProviders(): string[] {
    return this.manager.listProviders();
  }

  listAvailableModels(
    provider?: string,
  ): ReturnType<RuntimeProviderManager['getAvailableModels']> {
    return this.manager.getAvailableModels(provider);
  }

  getActiveProviderMetrics(): ReturnType<
    RuntimeProviderManager['getProviderMetrics']
  > {
    return this.manager.getProviderMetrics();
  }

  getSessionTokenUsage(): ReturnType<
    RuntimeProviderManager['getSessionTokenUsage']
  > {
    return this.manager.getSessionTokenUsage();
  }

  getUnallowedParametersForActiveModel(): string[] {
    const providerName = this.readActiveProviderName();
    const modelName = this.getActiveModelName();
    if (!providerName || !modelName) return [];
    const alias = loadProviderAliasEntries().find(
      (entry) => entry.alias === providerName,
    )?.config;
    return alias?.modelDefaults
      ? [...computeUnallowedParameters(modelName, alias.modelDefaults)]
      : [];
  }

  providerStatus(): SessionProviderStatus {
    const providerName = this.readActiveProviderName();
    const modelName = this.getActiveModelName() || null;
    const provider =
      providerName === null
        ? this.manager.getActiveProvider()
        : this.manager.getProviderByName(providerName);
    const resolvedName = providerName ?? provider?.name ?? null;
    const emptyLabel = resolvedName ?? modelName ?? 'unknown';
    const displayLabel =
      resolvedName && modelName ? `${resolvedName}:${modelName}` : emptyLabel;
    return {
      providerName: resolvedName,
      modelName,
      displayLabel,
      isPaidMode: provider?.isPaidMode?.(),
      baseURL:
        provider &&
        'getBaseURL' in provider &&
        typeof provider.getBaseURL === 'function'
          ? provider.getBaseURL()
          : undefined,
    };
  }
}
