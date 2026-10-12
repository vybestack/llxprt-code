/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SettingsService } from '@vybestack/llxprt-code-settings';

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

export interface AgentModelParametersControl {
  set(key: string, value: unknown): void;
  clear(key: string): void;
}

export function assembleModelParameterControl(
  readSettings: () => Pick<SettingsService, 'setProviderSetting'>,
  readProvider: () => string | undefined,
  readParameters: () => Record<string, unknown>,
  assertAdmission: () => void,
): AgentModelParametersControl {
  return {
    set: (key, value) => {
      assertAdmission();
      setActiveModelParam(key, value, readSettings(), readProvider());
      readParameters()[key] = value;
    },
    clear: (key) => {
      assertAdmission();
      clearActiveModelParam(key, readSettings(), readProvider());
      delete readParameters()[key];
    },
  };
}
