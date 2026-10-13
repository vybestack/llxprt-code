/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
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

/**
 * Binds /provider to one session's runtime API and Agent. The Agent is
 * nullable because the interactive UI mounts before bootstrap hands it over;
 * switching then fails visibly instead of reaching another session.
 */
export function bindProviderCommandOperations(
  api: RuntimeApi,
  agent: Agent | null,
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): ProviderCommandOperations {
  return {
    getActiveProviderName: () => readActiveProviderName(api),
    getActiveModelName: () => api.getActiveModelName(),
    switchProvider: (providerName, options) => {
      if (agent === null)
        throw new Error(
          'Cannot switch provider: the interactive Agent is not available. Restart the session.',
        );
      return agent.setProvider(providerName, undefined, options);
    },
    recordProviderSwitch,
    resolveActiveProviderAliasConfig: () => api.getActiveProviderAliasConfig(),
    writeProviderAlias: writeProviderAliasConfig,
    refreshProviderAliases,
  };
}
