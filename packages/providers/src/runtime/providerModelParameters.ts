/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function getProviderSettingsSnapshot(
  settings: Pick<SettingsService, 'getProviderSettings'>,
  providerName: string,
): Record<string, unknown> {
  return settings.getProviderSettings(providerName);
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
