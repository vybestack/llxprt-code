/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import {
  bindBaseurlCommandOperations,
  bindKeyCommandOperations,
  bindKeyfileCommandOperations,
  bindLogoutCommandOperations,
  bindQuotaCommandOperations,
  bindMcpAuthCommandOperations,
} from '../ui/commands/credentialCommandHost.js';
import { createAuthCommand } from '../ui/commands/authCommand.js';
import { createBaseurlCommand } from '../ui/commands/baseurlCommand.js';
import {
  createKeyCommand,
  type KeyCommandOperations,
} from '../ui/commands/keyCommand.js';
import { createKeyfileCommand } from '../ui/commands/keyfileCommand.js';
import { createLogoutCommand } from '../ui/commands/logoutCommand.js';
import { createQuotaCommand } from '../ui/commands/quotaCommand.js';
import { createMcpAuthCommand } from '../ui/commands/mcpAuth.js';
import { createMcpCommand } from '../ui/commands/mcpCommand.js';
import { bindMcpCommand } from '../ui/commands/mcpCommandHost.js';
import type { SlashCommand } from '../ui/commands/types.js';

/**
 * Registers the credential commands over the owners a fixture context carries,
 * the way the slash-command host binds them for a live session.
 */
export function registerKeyCommand(
  owners: Pick<CommandOwnerFixture, 'runtimeApi'> & {
    services: Pick<CommandOwnerFixture['services'], 'config'>;
  },
  overrides: Partial<KeyCommandOperations> = {},
): SlashCommand {
  return createKeyCommand({
    ...bindKeyCommandOperations(owners.runtimeApi, owners.services.config),
    ...overrides,
  });
}

export function registerKeyfileCommand(
  owners: Pick<CommandOwnerFixture, 'runtimeApi'> & {
    services: Pick<CommandOwnerFixture['services'], 'settings'>;
  },
): SlashCommand {
  return createKeyfileCommand(
    bindKeyfileCommandOperations(
      () => owners.runtimeApi.providerStatus().providerName ?? null,
      (key) => owners.runtimeApi.updateActiveProviderApiKey(key),
      (key, value) => owners.runtimeApi.setEphemeralSetting(key, value),
      (provider, path) =>
        owners.services.settings.setProviderKeyfile(provider, path),
      (provider) => owners.services.settings.removeProviderKeyfile(provider),
    ),
  );
}

export function registerBaseurlCommand(
  owners: Pick<CommandOwnerFixture, 'runtimeApi'> & {
    services: Pick<CommandOwnerFixture['services'], 'agent'>;
  },
): SlashCommand {
  const agent = owners.services.agent;
  const api = owners.runtimeApi;
  return createBaseurlCommand(
    agent === null
      ? {
          activeProviderName: () =>
            api.providerStatus().providerName ?? 'unknown',
          updateBaseUrl: async (baseUrl) =>
            (await api.updateActiveProviderBaseUrl(baseUrl)).message,
        }
      : bindBaseurlCommandOperations(
          () => agent.getProvider(),
          (baseUrl) => agent.auth.setBaseUrl(baseUrl),
        ),
  );
}

export function registerLogoutCommand(
  owners: Pick<CommandOwnerFixture, 'oauthControl'> & {
    services: Pick<CommandOwnerFixture['services'], 'agent'>;
  },
): SlashCommand {
  const agent = owners.services.agent;
  const oauth = owners.oauthControl;
  return createLogoutCommand(
    bindLogoutCommandOperations(
      agent === null
        ? () => oauth.getSupportedProviders()
        : () => agent.listProviders().map((provider) => provider.name),
      agent === null
        ? (provider) => oauth.isAuthenticated(provider)
        : (provider) => agent.auth.status(provider) === 'authenticated',
      agent === null
        ? (provider) => oauth.logout(provider)
        : (provider) => agent.auth.logout(provider),
      agent === null ? 'Supported providers' : 'Supported',
    ),
  );
}

export function registerAuthCommand(
  owners: Pick<CommandOwnerFixture, 'oauthControl' | 'services'>,
): SlashCommand {
  return createAuthCommand(
    owners.oauthControl,
    () => owners.services.settings.merged.enableFuzzyFiltering ?? true,
  );
}

export function registerQuotaCommand(
  owners: Pick<CommandOwnerFixture, 'oauthControl' | 'runtimeApi'>,
): SlashCommand {
  return createQuotaCommand(
    bindQuotaCommandOperations(owners.runtimeApi, owners.oauthControl),
  );
}

export function registerMcpCommand(context: CommandOwnerFixture): SlashCommand {
  const agent = context.services.agent;
  return createMcpCommand(
    createMcpAuthCommand(
      bindMcpAuthCommandOperations(agent, context.services.config),
      () => context.services.settings.merged.enableFuzzyFiltering ?? true,
      (...input) => context.ui.addItem(...input),
      () => context.ui.reloadCommands(),
    ),
    bindMcpCommand(
      context.services.config !== null,
      agent === null
        ? null
        : {
            listServers: () => agent.mcp.listServers(),
            listBlockedServers: () => agent.mcp.listBlockedServers(),
            discoveryState: () => agent.mcp.discoveryState(),
            readDetails: () =>
              agent.mcp.details({
                includeTools: true,
                includePrompts: true,
                includeResources: true,
              }),
          },
      context.ui.addItem,
      context.ui.reloadCommands,
      async () => {
        if (agent === null) throw new Error('Session agent is unavailable');
        await agent.mcp.reload();
      },
      async () => {
        if (agent === null) throw new Error('Session agent is unavailable');
        await agent.mcp.refresh();
      },
    ),
  );
}
