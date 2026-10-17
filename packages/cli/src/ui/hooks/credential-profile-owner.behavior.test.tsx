/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { renderHook } from '../../__tests__/render.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createProfileRegistration } from './credentialCommandRegistration.js';

describe('credential profile registration', () => {
  const makeOwner = useCommandOwners();
  it('keeps profile mutations on the captured owner after a sibling retires', async () => {
    const owner = await makeOwner(
      'credential-profile-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'credential-profile-peer',
      undefined,
      undefined,
      true,
    );
    const context = createMockCommandContext({ services: { agent: peer } });
    const hook = renderHook(() =>
      createProfileRegistration(
        owner.workspace.profileDefinitions.listProfiles.bind(
          owner.workspace.profileDefinitions,
        ),
        owner.getProvider.bind(owner),
        async () => [],
        () => true,
        owner.saveProfileSnapshot.bind(owner),
        owner.workspace.profileDefinitions.listProfiles.bind(
          owner.workspace.profileDefinitions,
        ),
        owner.getEphemeralSettings.bind(owner),
        owner.workspace.profileWrites.saveProfile.bind(
          owner.workspace.profileWrites,
        ),
        owner.profiles.load.bind(owner.profiles),
        owner.mcp.refresh.bind(owner.mcp),
        owner.getProvider.bind(owner),
        owner.getModel.bind(owner),
        owner.deleteProfileByName.bind(owner),
        async (name) => {
          owner.setDefaultProfileName(name);
        },
      )(async () => {}),
    );
    try {
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            {
              ...createUnconfiguredBuiltinOwners(),
              profileCommand: hook.result.current,
            },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const command = registry
        .getCommands()
        .find((item) => item.name === 'profile');
      const save = command?.subCommands?.find(
        (item) => item.name === 'save',
      )?.action;
      const remove = command?.subCommands?.find(
        (item) => item.name === 'delete',
      )?.action;
      if (!save || !remove) throw new Error('Profile commands unavailable');
      owner.setModelParam('temperature', 0.375);
      expect(await save(context, 'model isolated')).toMatchObject({
        messageType: 'info',
      });
      expect(
        await owner.workspace.profileDefinitions.loadProfile('isolated'),
      ).toMatchObject({ modelParams: { temperature: 0.375 } });
      expect(
        await peer.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual([]);
      await peer.dispose();
      expect(await remove(context, 'isolated')).toMatchObject({
        messageType: 'info',
      });
      expect(
        await owner.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual([]);
    } finally {
      hook.unmount();
    }
  });
});
