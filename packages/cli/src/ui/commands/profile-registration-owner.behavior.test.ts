/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { bindProfileCommandOperations } from './profileCommandHost.js';
import { createProfileCommand } from './profileCommand.js';

describe('profile registration operations', () => {
  const makeOwner = useCommandOwners();
  it('saves and deletes captured profiles despite another session attached to the catalog callback', async () => {
    const owner = await makeOwner(
      'profile-registration-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'profile-registration-peer',
      undefined,
      undefined,
      true,
    );
    const context = createMockCommandContext({ services: { agent: peer } });
    const listProfiles = Object.assign(
      owner.workspace.profileDefinitions.listProfiles.bind(
        owner.workspace.profileDefinitions,
      ),
      {
        agent: peer,
        runtimeApi: context.runtimeApi,
        settings: context.services.settings,
        oauthControl: context.oauthControl,
        recordProviderSwitch: async () => {},
      },
    );
    const command = createProfileCommand(
      bindProfileCommandOperations(
        listProfiles,
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
        async () => {},
        owner.deleteProfileByName.bind(owner),
        async (name) => {
          owner.setDefaultProfileName(name);
        },
      ),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), profileCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const profile = registry
      .getCommands()
      .find((item) => item.name === 'profile');
    const save = profile?.subCommands?.find(
      (item) => item.name === 'save',
    )?.action;
    const remove = profile?.subCommands?.find(
      (item) => item.name === 'delete',
    )?.action;
    if (!save || !remove)
      throw new Error('Profile registry actions unavailable');
    owner.setModelParam('temperature', 0.125);
    expect(await save(context, 'model captured')).toMatchObject({
      messageType: 'info',
    });
    expect(
      await owner.workspace.profileDefinitions.loadProfile('captured'),
    ).toMatchObject({ modelParams: { temperature: 0.125 } });
    expect(
      await peer.workspace.profileDefinitions.listProfiles(),
    ).toStrictEqual([]);
    expect(await remove(context, 'captured')).toMatchObject({
      messageType: 'info',
    });
    expect(
      await owner.workspace.profileDefinitions.listProfiles(),
    ).toStrictEqual([]);
  });
});
