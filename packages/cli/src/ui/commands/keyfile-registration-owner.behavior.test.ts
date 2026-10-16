/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { LoadedSettings } from '../../config/settings.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createKeyfileCommand } from './keyfileCommand.js';
import { bindKeyfileCommandOperations } from './credentialCommandHost.js';

function settings(root: string): LoadedSettings {
  const file = (name: string) => ({ settings: {}, path: join(root, name) });
  return new LoadedSettings(
    file('system.json'),
    file('defaults.json'),
    { path: join(root, 'user.json'), settings: { providerKeyfiles: {} } },
    file('workspace.json'),
    true,
  );
}

describe('keyfile registration operations', () => {
  const makeOwner = useCommandOwners();
  it('persists and clears captured keyfile settings without consulting attached runtime methods', async () => {
    const owner = await makeOwner('keyfile-registration-owner');
    const peer = await makeOwner('keyfile-registration-peer');
    const root = owner.workspace.getWorkingDirectory();
    const ownedSettings = settings(root);
    const otherSettings = settings(peer.workspace.getWorkingDirectory());
    const keyfile = join(root, 'provider.key');
    await writeFile(keyfile, 'sk-owned-registration\n');
    const command = createKeyfileCommand(
      bindKeyfileCommandOperations(
        Object.assign(() => owner.getProvider(), {
          providerStatus: () => ({ providerName: peer.getProvider() }),
          updateActiveProviderApiKey: async () => {
            throw new Error('Attached runtime must not mutate credentials');
          },
        }),
        (key: string | null) => owner.auth.keys.setRaw(key),
        (key: string, value: unknown) => owner.setEphemeralSetting(key, value),
        ownedSettings.setProviderKeyfile.bind(ownedSettings),
        ownedSettings.removeProviderKeyfile.bind(ownedSettings),
      ),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), keyfileCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((item) => item.name === 'keyfile')?.action;
    if (!action) throw new Error('Keyfile command unavailable');
    expect(await action(createMockCommandContext(), keyfile)).toMatchObject({
      messageType: 'info',
    });
    expect(ownedSettings.getProviderKeyfile(owner.getProvider())).toBe(keyfile);
    expect(
      otherSettings.getProviderKeyfile(peer.getProvider()),
    ).toBeUndefined();
    expect(
      JSON.parse(await readFile(join(root, 'user.json'), 'utf8')),
    ).toMatchObject({ providerKeyfiles: { fake: keyfile } });
    await action(createMockCommandContext(), 'none');
    expect(
      ownedSettings.getProviderKeyfile(owner.getProvider()),
    ).toBeUndefined();
    expect(owner.getEphemeralSetting('auth-keyfile')).toBeUndefined();
  });
});
