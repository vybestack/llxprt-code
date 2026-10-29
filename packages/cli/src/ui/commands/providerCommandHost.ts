/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderCommandOperations } from './providerCommand.js';

export function bindProviderCommandOperations(
  readProvider: () => string,
  readModel: ProviderCommandOperations['getActiveModelName'],
  resolveAlias: ProviderCommandOperations['resolveActiveProviderAliasConfig'],
  switchProvider: ProviderCommandOperations['switchProvider'],
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): ProviderCommandOperations {
  return {
    getActiveProviderName: readProvider,
    getActiveModelName: readModel,
    switchProvider,
    recordProviderSwitch,
    resolveActiveProviderAliasConfig: resolveAlias,
    writeProviderAlias: writeProviderAliasConfig,
    refreshProviderAliases,
  };
}
