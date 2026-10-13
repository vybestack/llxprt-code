/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  bindBaseurlCommandOperations,
  bindKeyCommandOperations,
  bindKeyfileCommandOperations,
  bindLogoutCommandOperations,
} from '../ui/commands/credentialCommandHost.js';
import { createBaseurlCommand } from '../ui/commands/baseurlCommand.js';
import {
  createKeyCommand,
  type KeyCommandOperations,
} from '../ui/commands/keyCommand.js';
import { createKeyfileCommand } from '../ui/commands/keyfileCommand.js';
import { createLogoutCommand } from '../ui/commands/logoutCommand.js';
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';

/**
 * Registers the credential commands over the owners a fixture context carries,
 * the way the slash-command host binds them for a live session.
 */
export function registerKeyCommand(
  owners: Pick<CommandContext, 'runtimeApi'> & {
    services: Pick<CommandContext['services'], 'config'>;
  },
  overrides: Partial<KeyCommandOperations> = {},
): SlashCommand {
  return createKeyCommand({
    ...bindKeyCommandOperations(owners.runtimeApi, owners.services.config),
    ...overrides,
  });
}

export function registerKeyfileCommand(
  owners: Pick<CommandContext, 'runtimeApi'> & {
    services: Pick<CommandContext['services'], 'settings'>;
  },
): SlashCommand {
  return createKeyfileCommand(
    bindKeyfileCommandOperations(owners.runtimeApi, owners.services.settings),
  );
}

export function registerBaseurlCommand(
  owners: Pick<CommandContext, 'runtimeApi'> & {
    services: Pick<CommandContext['services'], 'agent'>;
  },
): SlashCommand {
  return createBaseurlCommand(
    bindBaseurlCommandOperations(owners.runtimeApi, owners.services.agent),
  );
}

export function registerLogoutCommand(
  owners: Pick<CommandContext, 'oauthControl'> & {
    services: Pick<CommandContext['services'], 'agent'>;
  },
): SlashCommand {
  return createLogoutCommand(
    bindLogoutCommandOperations(owners.services.agent, owners.oauthControl),
  );
}
