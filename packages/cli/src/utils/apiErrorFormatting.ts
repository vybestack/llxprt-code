/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';

export function getActiveProviderNameForApiError(
  config: Config,
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
  config: Config,
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
    return config.getModel();
  } catch {
    return undefined;
  }
}

function getActiveProviderNameFromProviderManager(
  config: Config,
): string | undefined {
  try {
    const activeProvider = config.getProviderManager()?.getActiveProviderName();
    return normalizeProviderName(activeProvider);
  } catch {
    return undefined;
  }
}

function getProviderNameFromConfig(config: Config): string | undefined {
  try {
    return normalizeProviderName(config.getProvider());
  } catch {
    return undefined;
  }
}

function getActiveProviderNameFromSettings(config: Config): string | undefined {
  try {
    const configuredProvider = config
      .getSettingsService()
      .get('activeProvider');
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
