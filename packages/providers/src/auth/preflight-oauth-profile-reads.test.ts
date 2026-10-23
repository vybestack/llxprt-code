/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageBus } from '@vybestack/llxprt-code-core';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  createOwnerOAuthManager,
  createPreflightOAuthProfileReads,
  createSessionAuthPolicyReader,
} from '../composition/index.js';
import { InMemoryTokenStore } from './proxy/__tests__/credential-proxy-server-helpers.js';

async function saveProfile(directory: string, model: string): Promise<void> {
  await new ProfileManager(directory).saveProfile('owner', {
    version: 1,
    provider: 'codex',
    model,
    modelParams: {},
    ephemeralSettings: {},
  });
}

describe('preflight OAuth profile read phases', () => {
  function useProfiles(): () => string {
    let directory: string;
    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'preflight-profiles-'));
    });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));
    return () => directory;
  }
  const directory = useProfiles();

  it('rejects pre-Config reads until its repository is explicitly attached', async () => {
    const reads = createPreflightOAuthProfileReads();
    await expect(reads.loadProfile('owner')).rejects.toThrow(
      'OAuth profile reads require Config attachment; current phase: pre-config',
    );
    await saveProfile(directory(), 'configured');
    reads.attachProfileDirectory(directory());
    expect(await reads.loadProfile('owner')).toMatchObject({
      model: 'configured',
    });
  });

  it('rejects a second attachment and keeps reading its first repository', async () => {
    const reads = createPreflightOAuthProfileReads();
    await saveProfile(directory(), 'original');
    reads.attachProfileDirectory(directory());
    expect(() =>
      reads.attachProfileDirectory(join(directory(), 'other')),
    ).toThrow(
      'OAuth profile repository is already attached; current phase: attached',
    );
    expect(await reads.loadProfile('owner')).toMatchObject({
      model: 'original',
    });
  });

  it('keeps owners isolated and reads current contents through the retained attached repository', async () => {
    const first = createPreflightOAuthProfileReads();
    const second = createPreflightOAuthProfileReads();
    const firstDirectory = join(directory(), 'first');
    const secondDirectory = join(directory(), 'second');
    await saveProfile(firstDirectory, 'first');
    await saveProfile(secondDirectory, 'second');
    first.attachProfileDirectory(firstDirectory);
    const initial = await Promise.all([
      first.loadProfile('owner'),
      first.loadProfile('owner'),
    ]);
    expect(initial.map((profile) => profile.model)).toStrictEqual([
      'first',
      'first',
    ]);
    await expect(second.loadProfile('owner')).rejects.toThrow('pre-config');
    second.attachProfileDirectory(secondDirectory);
    await saveProfile(firstDirectory, 'updated');
    expect(await first.loadProfile('owner')).toMatchObject({
      model: 'updated',
    });
    expect(await second.loadProfile('owner')).toMatchObject({
      model: 'second',
    });
  });

  it('lets the OAuth owner acquired before Config use the attached repository without replacing its bus or tokens', async () => {
    const reads = createPreflightOAuthProfileReads();
    const tokens = new InMemoryTokenStore();
    const settings = new SettingsService();
    settings.setCurrentProfileName('owner');
    const bus = new MessageBus();
    const oauth = createOwnerOAuthManager(
      tokens,
      undefined,
      bus,
      reads,
      createSessionAuthPolicyReader(settings),
      () => ({ runtimeId: 'preflight-owner', runtimeKind: 'agent' }),
      undefined,
      () => {},
      async () => {
        throw new Error('Unexpected network request');
      },
    );
    try {
      await saveProfile(directory(), 'attached');
      reads.attachProfileDirectory(directory());
      await oauth.activateNamedLoginBucket('codex', 'named');
      expect(
        oauth.getSessionBucket('codex', {
          providerId: 'codex',
          profileId: 'owner',
        }),
      ).toBe('named');
      expect(oauth.runtimeMessageBus).toBe(bus);
      await saveProfile(directory(), 'updated');
      expect(await reads.loadProfile('owner')).toMatchObject({
        model: 'updated',
      });
    } finally {
      await oauth.dispose();
    }
  });
});
