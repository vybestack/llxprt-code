/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProviderKeyStorage } from '@vybestack/llxprt-code-providers/auth.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Profile credential clearing at the transaction owner', () => {
  const owner = useProfileOwner();

  for (const key of ['auth-key', 'auth-key-name', 'auth-keyfile', 'base-url']) {
    it(`clears stale ${key} when switching to a profile without ${key}`, async () => {
      const { settings, application } = owner();
      owner().settingsOwner.writeUserParameter(key, 'stale-value');
      settings.setProviderSetting('anthropic', key, 'stale-value');
      await application.applySnapshot(standardProfile());
      expect(owner().settingsOwner.readNamedParameter(key)).toBeUndefined();
      expect(settings.getProviderSettings('anthropic')[key]).toBeUndefined();
    });
  }

  it('clears all stale auth state simultaneously when switching profiles', async () => {
    const { settings, application } = owner();
    for (const key of [
      'auth-key',
      'auth-key-name',
      'auth-keyfile',
      'base-url',
    ]) {
      owner().settingsOwner.writeUserParameter(key, 'stale-value');
      settings.setProviderSetting('anthropic', key, 'stale-value');
    }
    await application.applySnapshot(standardProfile());
    for (const key of [
      'auth-key',
      'auth-key-name',
      'auth-keyfile',
      'base-url',
    ]) {
      expect(owner().settingsOwner.readNamedParameter(key)).toBeUndefined();
      expect(settings.getProviderSettings('anthropic')[key]).toBeUndefined();
    }
  });

  it('preserves explicit auth-key on the newly loaded profile', async () => {
    const { settings, application } = owner();
    owner().settingsOwner.writeUserParameter('auth-key', 'stale-key');
    await application.applySnapshot(
      standardProfile({ 'auth-key': 'new-glm-key' }),
    );
    expect(owner().settingsOwner.readNamedParameter('auth-key')).toBe(
      'new-glm-key',
    );
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'new-glm-key',
    );
  });

  it('preserves explicit auth-keyfile on the newly loaded profile', async () => {
    const { settings, application, directory } = owner();
    const keyfile = join(directory, 'key.txt');
    await writeFile(keyfile, ' new-file-key\n');
    owner().settingsOwner.writeUserParameter('auth-key-name', 'stale-name');
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    expect(
      owner().settingsOwner.readNamedParameter('auth-key-name'),
    ).toBeUndefined();
    expect(
      owner().settingsOwner.readNamedParameter('auth-key'),
    ).toBeUndefined();
    expect(owner().settingsOwner.readNamedParameter('auth-keyfile')).toBe(
      keyfile,
    );
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'new-file-key',
    );
  });

  it('preserves explicit auth-key-name on the newly loaded profile', async () => {
    const { settings, application } = owner();
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(' resolved-new-key ');
    try {
      owner().settingsOwner.writeUserParameter('auth-keyfile', 'stale-file');
      await application.applySnapshot(
        standardProfile({ 'auth-key-name': 'new-name' }),
      );
      expect(owner().settingsOwner.readNamedParameter('auth-key-name')).toBe(
        'new-name',
      );
      expect(
        owner().settingsOwner.readNamedParameter('auth-key'),
      ).toBeUndefined();
      expect(
        owner().settingsOwner.readNamedParameter('auth-keyfile'),
      ).toBeUndefined();
      expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
        'resolved-new-key',
      );
    } finally {
      storage.mockRestore();
    }
  });
});
