/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ApiErrorRuntimeInfo {
  getProviderManager?():
    | { getActiveProviderName?(): string | undefined }
    | undefined;
  getProvider?(): string | undefined;
  getSettingsService?(): { get(key: string): unknown };
  getModel?(): string;
}

export function getActiveProviderNameForApiError(
  config: ApiErrorRuntimeInfo,
): string | undefined {
  const activeProvider = getActiveProviderNameFromProviderManager(config);
  if (activeProvider !== undefined) {
    return activeProvider;
  }

  const configuredProvider = getProviderNameFromConfig(config);
  if (configuredProvider !== undefined) {
    return configuredProvider;
  }

  return getActiveProviderNameFromSettings(config);
}

export function getErrorFallbackModel(
  config: ApiErrorRuntimeInfo,
  providerName: string | undefined,
): string | undefined {
  const trimmedProviderName = providerName?.trim().toLowerCase();
  const normalizedProviderName =
    trimmedProviderName === '' ? undefined : trimmedProviderName;
  if (
    normalizedProviderName !== undefined &&
    normalizedProviderName !== 'gemini'
  ) {
    return undefined;
  }

  try {
    return config.getModel?.();
  } catch {
    return undefined;
  }
}

function getActiveProviderNameFromProviderManager(
  config: ApiErrorRuntimeInfo,
): string | undefined {
  try {
    const providerManager = config.getProviderManager?.();
    const activeProvider = providerManager?.getActiveProviderName?.();
    return normalizeProviderName(activeProvider);
  } catch {
    return undefined;
  }
}

function getProviderNameFromConfig(
  config: ApiErrorRuntimeInfo,
): string | undefined {
  try {
    return normalizeProviderName(config.getProvider?.());
  } catch {
    return undefined;
  }
}

function getActiveProviderNameFromSettings(
  config: ApiErrorRuntimeInfo,
): string | undefined {
  try {
    const settingsService = config.getSettingsService?.();
    const configuredProvider = settingsService?.get('activeProvider');
    return normalizeProviderName(configuredProvider);
  } catch {
    return undefined;
  }
}

function normalizeProviderName(providerName: unknown): string | undefined {
  if (typeof providerName !== 'string') {
    return undefined;
  }
  const trimmed = providerName.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
