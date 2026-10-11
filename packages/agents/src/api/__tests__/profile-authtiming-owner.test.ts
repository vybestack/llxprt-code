/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Profile credential timing at the owner', () => {
  const owner = useProfileOwner();

  for (const directive of ['auth-key', 'auth-keyfile', 'base-url']) {
    it(`installs ${directive} in SettingsService before switching providers`, async () => {
      const {
        config,
        settings,
        manager,
        oauth,
        store,
        switchProvider,
        directory,
      } = owner();
      const keyfile = join(directory, 'credential');
      await writeFile(keyfile, ' file-key\n');
      const values: Record<string, string> = {
        'auth-keyfile': keyfile,
        'base-url': 'https://custom.invalid',
        'auth-key': 'direct-key',
      };
      const value = values[directive];
      const observed: unknown[] = [];
      const application = assembleProfileApplication(
        config,
        settings,
        manager,
        oauth,
        async (name, options) => {
          observed.push(
            settings.getProviderSettings(name)[
              directive === 'auth-keyfile' ? 'auth-key' : directive
            ],
          );
          return switchProvider(name, options);
        },
        owner().settingsOwner,
        store,
      );
      await application.applySnapshot(standardProfile({ [directive]: value }));
      expect(observed).toStrictEqual([
        directive === 'auth-keyfile' ? 'file-key' : value,
      ]);
    });
  }

  it('has SettingsService auth available when the switch starts', async () => {
    const { config, settings, manager, oauth, store, switchProvider } = owner();
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      config,
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push(settings.getProviderSettings(name)['auth-key']);
        return switchProvider(name, options);
      },
      owner().settingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-key': 'ready-before-switch' }),
    );
    expect(observed).toStrictEqual(['ready-before-switch']);
  });

  it('hydrates legacy model parameter auth into ephemerals', async () => {
    await owner().application.applySnapshot({
      ...standardProfile(),
      modelParams: {
        authKey: 'legacy-auth-key',
        'base-url': 'https://legacy.invalid',
      },
    });
    expect(owner().settingsOwner.readNamedParameter('auth-key')).toBe(
      'legacy-auth-key',
    );
    expect(owner().settingsOwner.readNamedParameter('base-url')).toBe(
      'https://legacy.invalid',
    );
    expect(owner().settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'legacy-auth-key',
    );
    expect(
      owner().settings.getProviderSettings('anthropic').authKey,
    ).toBeUndefined();
  });

  it('clears provider auth and base-url when omitted', async () => {
    await owner().application.applySnapshot(
      standardProfile({
        'auth-key': 'old-key',
        'base-url': 'https://old.invalid',
      }),
    );
    await owner().application.applySnapshot(standardProfile());
    expect(
      owner().settings.getProviderSettings('anthropic')['auth-key'],
    ).toBeUndefined();
    expect(
      owner().settingsOwner.readNamedParameter('base-url'),
    ).toBeUndefined();
  });

  it('treats explicit null auth and base-url as clear directives', async () => {
    await owner().application.applySnapshot(
      standardProfile({
        'auth-key': 'old-key',
        'base-url': 'https://old.invalid',
      }),
    );
    await owner().application.applySnapshot(
      standardProfile({ 'auth-key': null, 'base-url': null }),
    );
    expect(
      owner().settings.getProviderSettings('anthropic')['auth-key'],
    ).toBeUndefined();
    expect(
      owner().settingsOwner.readNamedParameter('base-url'),
    ).toBeUndefined();
  });

  it('does not trigger OAuth when a keyfile profile is used with model discovery', async () => {
    const {
      application,
      directory,
      oauth,
      authenticationRequests,
      manager,
      settings,
    } = owner();
    await oauth.toggleOAuthEnabled('anthropic');
    const keyfile = join(directory, 'keyfile');
    await writeFile(keyfile, 'discovery-key');
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    await manager.getAvailableModels('anthropic');
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'discovery-key',
    );
    expect(authenticationRequests).toStrictEqual([]);
  });

  it('clears stale state before installing auth and applies remaining settings after switching', async () => {
    const { config, settings, manager, oauth, store, switchProvider } = owner();
    owner().settingsOwner.writeUserParameter('old-setting', 'stale');
    owner().settingsOwner.writeUserParameter('auth-key', 'old-auth');
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      config,
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push({
          old: owner().settingsOwner.readNamedParameter('old-setting'),
          auth: owner().settingsOwner.readNamedParameter('auth-key'),
          context: owner().settingsOwner.readNamedParameter('context-limit'),
        });
        return switchProvider(name, options);
      },
      owner().settingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-key': 'new-auth', 'context-limit': 100000 }),
    );
    expect(observed).toStrictEqual([
      { old: undefined, auth: 'new-auth', context: undefined },
    ]);
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'new-auth',
    );
  });

  it('reports keyfile read failure without blocking the provider switch', async () => {
    const result = await owner().application.applySnapshot(
      standardProfile({ 'auth-keyfile': join(owner().directory, 'absent') }),
    );
    expect(owner().manager.getActiveProviderName()).toBe('anthropic');
    expect(result.warnings).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining('Failed to load keyfile'),
      ]),
    );
  });
});
