/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { getProviderConfigKeys } from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';

const RESERVED_PROVIDER_SETTING_KEYS: readonly string[] = Object.freeze(
  getProviderConfigKeys(),
);

export function getProviderSettingsSnapshot(
  settings: Pick<SettingsService, 'getProviderSettings'>,
  providerName: string,
): Record<string, unknown> {
  return settings.getProviderSettings(providerName);
}

export function extractModelParams(
  providerSettings: Record<string, unknown>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(providerSettings)) {
    if (
      value === undefined ||
      value === null ||
      RESERVED_PROVIDER_SETTING_KEYS.includes(key)
    )
      continue;
    params[key] = value;
  }
  return params;
}

export function getActiveModelParams(
  settingsService: Pick<SettingsService, 'getProviderSettings'>,
  providerName: string | undefined,
): Record<string, unknown> {
  if (!providerName) {
    return {};
  }
  const providerSettings = getProviderSettingsSnapshot(
    settingsService,
    providerName,
  );
  return extractModelParams(providerSettings);
}

export function setActiveModelParam(
  name: string,
  value: unknown,
  settingsService: Pick<SettingsService, 'setProviderSetting'>,
  providerName: string | undefined,
): void {
  if (!providerName) {
    throw new Error('No active provider available to set model parameters.');
  }
  settingsService.setProviderSetting(providerName, name, value);
}

export function clearActiveModelParam(
  name: string,
  settingsService: Pick<SettingsService, 'setProviderSetting'>,
  providerName: string | undefined,
): void {
  if (!providerName) {
    throw new Error('No active provider available to clear model parameters.');
  }
  settingsService.setProviderSetting(providerName, name, undefined);
}
