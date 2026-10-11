/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RuntimeProvider,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:settings');
}

type ProviderStatusSettings = Pick<
  SettingsService,
  'get' | 'getProviderSettings'
>;

export interface ProviderRuntimeStatus {
  providerName: string | null;
  modelName: string | null;
  displayLabel: string;
  isPaidMode?: boolean;
  baseURL?: string;
}

function safeCall<T>(operation: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    logger().debug(() => `Unable to ${operation}: ${String(error)}`);
    return undefined;
  }
}

export function resolveProviderName(
  settings: Pick<SettingsService, 'get'>,
  manager: Pick<RuntimeProviderManager, 'getActiveProviderName'> | null,
): string | null {
  const stored = settings.get('activeProvider');
  if (typeof stored === 'string' && stored.trim() !== '') return stored;
  const cached = manager
    ? safeCall('resolve active provider name', () =>
        manager.getActiveProviderName(),
      )
    : undefined;
  return cached && cached.trim() !== '' ? cached : null;
}

export function readProviderModel(
  settings: ProviderStatusSettings,
  manager: RuntimeProviderManager | null,
  configuredModel: string,
): string {
  const providerName = resolveProviderName(settings, manager);
  if (providerName) {
    const model = settings.getProviderSettings(providerName).model;
    if (typeof model === 'string' && model.trim() !== '') return model;
  }
  if (configuredModel) return configuredModel;
  return manager
    ? (safeCall('resolve default model', () =>
        manager.getActiveProvider()?.getDefaultModel?.(),
      ) ?? '')
    : '';
}

type BaseURLProvider = RuntimeProvider & {
  getBaseURL: () => string | undefined;
};

function hasBaseURL(provider: RuntimeProvider): provider is BaseURLProvider {
  return 'getBaseURL' in provider && typeof provider.getBaseURL === 'function';
}

function readProviderBaseURL(
  provider: RuntimeProvider | undefined,
): string | undefined {
  if (!provider || !hasBaseURL(provider)) return undefined;
  return safeCall('read provider base URL', () => provider.getBaseURL());
}

function readPaidMode(
  provider: RuntimeProvider | undefined,
): boolean | undefined {
  return provider
    ? safeCall('read provider paid-mode status', () => provider.isPaidMode?.())
    : undefined;
}

function resolveStatusProvider(
  manager: RuntimeProviderManager | null,
  name: string | null,
): RuntimeProvider | undefined {
  if (!manager) return undefined;
  if (name) {
    return safeCall('resolve configured provider', () =>
      manager.getProviderByName(name),
    );
  }
  return safeCall('resolve active provider', () => manager.getActiveProvider());
}

function providerDisplayLabel(
  providerName: string | null,
  modelName: string | null,
): string {
  if (providerName && modelName) return `${providerName}:${modelName}`;
  return providerName ?? modelName ?? 'unknown';
}

export function readProviderStatus(
  settings: ProviderStatusSettings,
  manager: RuntimeProviderManager | null,
  configuredModel: string,
): ProviderRuntimeStatus {
  const resolvedModel = readProviderModel(settings, manager, configuredModel);
  const modelName = resolvedModel.trim() !== '' ? resolvedModel : null;
  const resolvedName = resolveProviderName(settings, manager);
  const provider = resolveStatusProvider(manager, resolvedName);
  const providerName = resolvedName ?? provider?.name ?? null;
  return {
    providerName,
    modelName,
    displayLabel: providerDisplayLabel(providerName, modelName),
    isPaidMode: readPaidMode(provider),
    baseURL: readProviderBaseURL(provider),
  };
}
