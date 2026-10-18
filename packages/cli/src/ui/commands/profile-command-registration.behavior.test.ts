/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { CommandKind, type SlashCommand } from './types.js';

describe('profile command registration', () => {
  it('registers the profile command supplied by its owning session', async () => {
    const ownedCommand: SlashCommand = {
      name: 'profile',
      description: 'owned profile command',
      kind: CommandKind.BUILT_IN,
      action: async () => ({
        type: 'message',
        messageType: 'info',
        content: 'owned',
      }),
    };
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            profileCommand: ownedCommand,
          },
          null,
        ),
      ],
      new AbortController().signal,
    );

    const registered = registry
      .getCommands()
      .find((command) => command.name === 'profile');
    if (registered?.action === undefined)
      throw new Error('Profile command was not registered');

    const result = await registered.action(
      createMockCommandContext({
        services: { agent: null, config: null },
      }),
      '',
    );
    expect(result).toMatchObject({ content: 'owned' });
  });
});
