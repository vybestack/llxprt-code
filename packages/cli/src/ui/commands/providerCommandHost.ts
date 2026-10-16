/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { ProviderCommandOperations } from './providerCommand.js';

function readActiveProviderName(api: RuntimeApi): string | null {
  try {
    return api.getActiveProviderName();
  } catch {
    return api.providerStatus().providerName ?? null;
  }
}

export function bindProviderCommandOperations(
  api: RuntimeApi,
  switchProvider: ProviderCommandOperations['switchProvider'],
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): ProviderCommandOperations {
  return {
    getActiveProviderName: () => readActiveProviderName(api),
    getActiveModelName: () => api.getActiveModelName(),
    switchProvider,
    recordProviderSwitch,
    resolveActiveProviderAliasConfig: () => api.getActiveProviderAliasConfig(),
    writeProviderAlias: writeProviderAliasConfig,
    refreshProviderAliases,
  };
}
