/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Profile settings rollback at the owner', () => {
  const owner = useProfileOwner();

  it('restores pre-application settings state when a mid-cascade step fails and rethrows the original error', async () => {
    const { config, settings, manager, switchProvider, store } = owner();
    settings.setProviderSetting('openai', 'auth-key', 'keep-me');
    settings.setProviderSetting('openai', 'model', 'gpt-4');
    settings.setCurrentProfileName('previous-profile');
    const before = settings.exportForStateSnapshot();
    const ephemeralBefore = structuredClone(
      owner().settingsOwner.captureNamedParameters(),
    );
    const activeBefore = manager.getActiveProvider();
    const failure = new Error('injected cascade failure');
    const application = assembleProfileApplication(
      config,
      settings,
      manager,
      null,
      async (name, options) => {
        await switchProvider(name, options);
        expect(manager.getActiveProviderName()).toBe('anthropic');
        expect(settings.getProviderSettings('anthropic')['base-url']).toBe(
          'https://injected.example',
        );
        throw failure;
      },
      owner().settingsOwner,
      store,
    );
    await expect(
      application.applySnapshot(
        standardProfile({ 'base-url': 'https://injected.example' }),
      ),
    ).rejects.toBe(failure);
    expect(settings.exportForStateSnapshot()).toStrictEqual(before);
    expect(owner().settingsOwner.captureNamedParameters()).toStrictEqual(
      ephemeralBefore,
    );
    expect(manager.getActiveProvider()).toBe(activeBefore);
    expect(settings.getProviderSettings('anthropic')).toStrictEqual({});
    expect(settings.getCurrentProfileName()).toBe('previous-profile');
  });

  it('rolls back profile tool policy imported mid-cascade when a later step fails', async () => {
    const { config, settings, manager, store, switchProvider } = owner();
    await settings.importFromProfile({
      providers: { openai: { model: 'gpt-4', 'auth-key': 'keep-me' } },
      tools: { allowed: ['read_file', 'glob'], disabled: [] },
    });
    settings.setCurrentProfileName('previous-profile');
    const before = settings.exportForStateSnapshot();
    const failure = new Error('injected post-import failure');
    const application = assembleProfileApplication(
      config,
      settings,
      manager,
      null,
      async (name, options) => {
        await switchProvider(name, options);
        await settings.importFromProfile({
          providers: { anthropic: { model: 'claude-3' } },
          tools: { allowed: [], disabled: ['write_file', 'run_shell_command'] },
        });
        expect(settings.get('tools')).toStrictEqual({
          allowed: [],
          disabled: ['write_file', 'run_shell_command'],
        });
        throw failure;
      },
      owner().settingsOwner,
      store,
    );
    await expect(application.applySnapshot(standardProfile())).rejects.toBe(
      failure,
    );
    expect(settings.exportForStateSnapshot()).toStrictEqual(before);
    expect(settings.get('tools')).toStrictEqual({
      allowed: ['read_file', 'glob'],
      disabled: [],
    });
    expect(settings.getProviderSettings('anthropic')).toStrictEqual({});
    expect(settings.getProviderSettings('openai')).toStrictEqual({
      model: 'gpt-4',
      'auth-key': 'keep-me',
    });
    expect(settings.getCurrentProfileName()).toBe('previous-profile');
  });

  it('keeps applied state on the success path (no spurious rollback)', async () => {
    const { settings, application } = owner();
    settings.setProviderSetting('openai', 'auth-key', 'old-key');
    await application.applySnapshot(
      standardProfile({ 'base-url': 'https://injected.example' }),
    );
    expect(settings.getProviderSettings('anthropic')['base-url']).toBe(
      'https://injected.example',
    );
    expect(settings.getProviderSettings('openai')).toStrictEqual({
      'auth-key': 'old-key',
    });
  });
});
