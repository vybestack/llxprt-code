/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { assembleProfileDefinitions } from './profileDefinitions.js';
import { buildRuntimeProfileSnapshot } from './profileSnapshot.js';
import { assembleProfilePersistence } from './profilePersistenceAssembly.js';

describe('owner profile documents', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'profile-definitions-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists detached snapshots and reads member details from the owning repository', async () => {
    const repository = new ProfileManager(join(directory, 'first'));
    const otherRepository = new ProfileManager(join(directory, 'second'));
    const first = assembleProfileDefinitions(repository, repository);
    const second = assembleProfileDefinitions(otherRepository, otherRepository);
    const parameters = { temperature: 0.25 };
    const snapshot = buildRuntimeProfileSnapshot({
      providerName: 'openai',
      modelName: 'first-model',
      providerSettings: parameters,
      ephemeralSettings: {
        'reasoning.enabled': null,
        'auth-key-name': 'named',
      },
    });
    await first.saveProfileDefinition('member', snapshot);
    parameters.temperature = 0.9;
    await first.saveLoadBalancerProfile('balanced', {
      version: 1,
      type: 'loadbalancer',
      policy: 'failover',
      profiles: ['member'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    });
    expect(await first.getProfileByName('member')).toMatchObject({
      modelParams: { temperature: 0.25 },
      ephemeralSettings: {
        'reasoning.enabled': null,
        'auth-key-name': 'named',
      },
    });
    expect(await first.getProfileByName('balanced')).toMatchObject({
      loadBalancerProfileDetails: [
        { name: 'member', provider: 'openai', model: 'first-model' },
      ],
    });
    expect((await first.listSavedProfiles()).sort()).toStrictEqual([
      'balanced',
      'member',
    ]);
    expect(await second.listSavedProfiles()).toStrictEqual([]);
  });
  it('joins admitted document saves and closes only its own persistence lifetime', async () => {
    const repository = new ProfileManager(directory);
    const snapshot = {
      providerName: 'openai',
      modelName: 'saved-model',
      providerSettings: {},
      ephemeralSettings: { 'reasoning.enabled': null },
    };
    const settings = new SettingsService();
    settings.setCurrentProfileName('saved');
    const persistence = assembleProfilePersistence(
      () => snapshot.modelName,
      () => snapshot.providerName,
      settings,
      {
        getActiveProviderName: () => snapshot.providerName,
        getProviderByName: () => undefined,
      },
      () => snapshot.ephemeralSettings,
      repository,
    );
    const saved = persistence.saveProfileSnapshot('saved');
    persistence.closeAdmission();
    await persistence.join();
    expect(await saved).toMatchObject({
      ephemeralSettings: { 'reasoning.enabled': null },
    });
    expect(await repository.loadProfile('saved')).toMatchObject({
      model: 'saved-model',
    });
    await expect(persistence.deleteProfileByName('saved')).rejects.toThrow(
      'closed',
    );
    expect(settings.getCurrentProfileName()).toBe('saved');
  });
});
