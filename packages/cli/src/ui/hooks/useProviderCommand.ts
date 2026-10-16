/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { SlashCommand } from '../commands/types.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { createProviderCommand } from '../commands/providerCommand.js';
import { bindProviderCommandOperations } from '../commands/providerCommandHost.js';
export function useProviderCommand(
  agent: Agent | null,
  refreshProviderAliases: () => Promise<void>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): SlashCommand {
  const api = useRuntimeApi();
  return useMemo(
    () =>
      createProviderCommand(
        bindProviderCommandOperations(
          api,
          async (name, options) => {
            if (agent === null)
              throw new Error(
                'Cannot switch provider: the interactive Agent is not available. Restart the session.',
              );
            return agent.setProvider(name, undefined, options);
          },
          refreshProviderAliases,
          recordProviderSwitch,
        ),
      ),
    [api, agent, recordProviderSwitch, refreshProviderAliases],
  );
}
