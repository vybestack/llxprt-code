/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderSwitcher } from '../providerSwitch.js';

const PRESERVED_PROFILE_EPHEMERALS = [
  'auth-key',
  'auth-key-name',
  'auth-keyfile',
  'base-url',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'reasoning.enabled',
  'reasoning.budgetTokens',
  'reasoning.stripFromContext',
  'reasoning.includeInContext',
  'reasoning.fieldName',
  'task-default-timeout-seconds',
  'task-max-timeout-seconds',
  'shell-default-timeout-seconds',
  'shell-max-timeout-seconds',
  'shell-output-retention-max-bytes',
];

export async function switchProviderForProfile(
  targetProviderName: string,
  switchProvider: ProviderSwitcher,
): Promise<{
  changed: boolean;
  infoMessages: string[];
}> {
  const providerSwitch = await switchProvider(targetProviderName, {
    publication: 'deferred',
    autoOAuth: false,
    skipModelDefaults: false,
    preserveEphemerals: PRESERVED_PROFILE_EPHEMERALS,
  });
  return {
    changed: providerSwitch.changed,
    infoMessages: providerSwitch.infoMessages.filter(
      (message) =>
        !/^(Model set to|Active model is) '.+?' for provider/.test(message),
    ),
  };
}
