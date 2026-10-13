/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { createProviderCommand } from '../ui/commands/providerCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';

/**
 * Binds /provider to one real Agent. Alias persistence is parameterised so a
 * test can supply the alias document and observe the write.
 */
export function createAgentProviderCommand(
  agent: Agent,
  aliases: {
    resolve: () => ReturnType<
      Parameters<
        typeof createProviderCommand
      >[0]['resolveActiveProviderAliasConfig']
    >;
    write: (alias: string, config: ProviderAliasConfig) => void;
    refresh: () => Promise<void>;
  },
): SlashCommand {
  return createProviderCommand({
    getActiveProviderName: () => agent.getProvider(),
    getActiveModelName: () => agent.getModel(),
    switchProvider: (providerName, options) =>
      agent.setProvider(providerName, undefined, options),
    recordProviderSwitch: (provider, model) =>
      agent.session.recordRecordingEvent({
        type: 'provider_switch',
        provider,
        model,
      }),
    resolveActiveProviderAliasConfig: aliases.resolve,
    writeProviderAlias: aliases.write,
    refreshProviderAliases: aliases.refresh,
  });
}
