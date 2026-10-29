/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useState } from 'react';
import { createCommandRegistryFixture } from '../../__tests__/command-registry-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { CommandKind, type SlashCommand } from '../commands/types.js';
import { useCommandReload } from './slashCommandProcessorSupport.js';

describe('registered slash command loading', () => {
  it('loads slash commands via BuiltinCommandLoader', async () => {
    const owners = createUnconfiguredBuiltinOwners();
    const registry = createCommandRegistryFixture(null);
    const { result, unmount } = renderHook(() => {
      const [commands, setCommands] = useState<readonly SlashCommand[]>([]);
      useCommandReload(
        owners,
        registry.loadRegisteredCommands,
        registry.subscribeCommandChanges,
        0,
        true,
        () => {},
        setCommands,
      );
      return { slashCommands: commands };
    });

    const expectedCommands = registry
      .readBuiltinCommands(owners)
      .map((command) => ({ name: command.name, kind: command.kind }));
    await waitFor(() =>
      expect(
        result.current.slashCommands.map((command) => ({
          name: command.name,
          kind: command.kind,
        })),
      ).toStrictEqual(expectedCommands),
    );
    expect(
      result.current.slashCommands
        .filter(
          (command) => command.name === 'subagent' || command.name === 'about',
        )
        .map((command) => ({ name: command.name, kind: command.kind })),
    ).toStrictEqual([
      { name: 'about', kind: CommandKind.BUILT_IN },
      { name: 'subagent', kind: CommandKind.BUILT_IN },
    ]);
    unmount();
  });
});
