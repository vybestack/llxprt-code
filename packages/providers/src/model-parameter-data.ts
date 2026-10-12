/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProviderConfigKeys } from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';

const RESERVED_PROVIDER_SETTING_KEYS: readonly string[] = Object.freeze(
  getProviderConfigKeys(),
);

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
