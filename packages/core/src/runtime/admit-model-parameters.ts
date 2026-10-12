/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { separateSettings } from '@vybestack/llxprt-code-settings';
import { SETTINGS_REGISTRY } from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';
import {
  ownModelParameters,
  type AdmittedModelParameters,
} from './admittedModelParameters.js';

export function buildProviderSettingsSnapshot(
  globalSettings: Readonly<Record<string, unknown>>,
  providerSettings: Readonly<Record<string, unknown>>,
  providerName: string,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(globalSettings).filter(
        ([key]) =>
          !SETTINGS_REGISTRY.some(
            (setting) =>
              setting.key === key && setting.category === 'provider-config',
          ),
      ),
    ),
    [providerName]: { ...providerSettings },
  };
}

export function admitModelParameters(
  globalSettings: Readonly<Record<string, unknown>>,
  providerSettings: Readonly<Record<string, unknown>>,
  providerName: string,
): AdmittedModelParameters {
  const classified = separateSettings(
    buildProviderSettingsSnapshot(
      globalSettings,
      providerSettings,
      providerName,
    ),
    providerName,
  );
  const rawMaxOutput = globalSettings['maxOutputTokens'];
  const genericMaxOutputTokens =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  return Object.freeze({
    providerName,
    modelParams: ownModelParameters(classified.modelParams),
    genericMaxOutputTokens,
  });
}
