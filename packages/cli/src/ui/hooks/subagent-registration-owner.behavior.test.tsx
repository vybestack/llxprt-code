/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import type { SlashCommand } from '../commands/types.js';
import { useSubagentCommand } from './useSubagentCommand.js';

async function save(command: SlashCommand, name: string): Promise<void> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), subagentCommand: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((item) => item.name === 'subagent')
    ?.subCommands?.find((item) => item.name === 'save')?.action;
  if (!action) throw new Error('Subagent save unavailable');
  expect(
    await action(
      createMockCommandContext(),
      `${name} registered manual "Review owned state"`,
    ),
  ).toMatchObject({ messageType: 'info' });
}

describe('subagent registration domain ownership', () => {
  const makeOwner = useCommandOwners();
  it('saves to captured definitions and follows mounted replacement after retirement', async () => {
    const owner = await makeOwner(
      'subagent-registration-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'subagent-registration-peer',
      undefined,
      undefined,
      true,
    );
    const active = owner.workspace;
    const decoy = peer.workspace;
    await active.profileWrites.saveProfile(
      'registered',
      owner.captureProfile(),
    );
    await decoy.profileWrites.saveProfile('registered', peer.captureProfile());
    const hook = renderHook(
      ({ workspace, attached }) =>
        useSubagentCommand(
          Object.assign(
            { ...workspace.subagentDefinitions },
            { workspace: attached },
          ),
          workspace.subagentWrites,
          () => workspace.profileDefinitions.listProfiles(),
          () => true,
          async () => {
            throw new Error('Manual save must not generate a prompt');
          },
          true,
          () => 0,
        ),
      { initialProps: { workspace: active, attached: decoy } },
    );
    try {
      await save(hook.result.current, 'reviewer');
      expect(
        await active.subagentDefinitions.loadSubagent('reviewer'),
      ).toMatchObject({
        systemPrompt: 'Review owned state',
        profile: 'registered',
      });
      expect(await decoy.subagentDefinitions.listSubagents()).toStrictEqual([]);
      await owner.dispose();
      hook.rerender({ workspace: decoy, attached: active });
      await save(hook.result.current, 'survivor');
      expect(
        await decoy.subagentDefinitions.loadSubagent('survivor'),
      ).toMatchObject({ systemPrompt: 'Review owned state' });
    } finally {
      hook.unmount();
    }
  });
});
