/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import {
  saveModelProfile,
  saveLoadBalancerProfile,
} from './profileLoadBalancer.js';

describe('profile save operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('saves the captured snapshot without consulting graph properties on the provider reader', async () => {
    const owner = await makeOwner(
      'profile-save-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'profile-save-peer',
      undefined,
      undefined,
      true,
    );
    owner.setModelParam('temperature', 0.25);
    const provider = Object.assign(() => owner.getProvider(), {
      providerStatus: () => ({ providerName: peer.getProvider() }),
      saveProfileSnapshot: peer.saveProfileSnapshot.bind(peer),
    });
    expect(
      await saveModelProfile(
        ['model', 'owned'],
        provider,
        Object.assign(owner.saveProfileSnapshot.bind(owner), {
          getProvider: peer.getProvider.bind(peer),
          saveProfileSnapshot: peer.saveProfileSnapshot.bind(peer),
        }),
        async () => [],
      ),
    ).toMatchObject({ messageType: 'info' });
    expect(
      await owner.workspace.profileDefinitions.loadProfile('owned'),
    ).toMatchObject({ modelParams: { temperature: 0.25 } });
    expect(
      await peer.workspace.profileDefinitions.listProfiles(),
    ).toStrictEqual([]);
  });
  it('writes load balancer members and ephemeral policy through captured profile operations', async () => {
    const owner = await makeOwner(
      'load-balancer-save-owner',
      undefined,
      undefined,
      true,
    );
    const peer = await makeOwner(
      'load-balancer-save-peer',
      undefined,
      undefined,
      true,
    );
    await owner.saveProfileSnapshot('first');
    await owner.saveProfileSnapshot('second');
    const list = Object.assign(
      () => owner.workspace.profileDefinitions.listProfiles(),
      {
        listSavedProfiles: () =>
          peer.workspace.profileDefinitions.listProfiles(),
      },
    );
    expect(
      await saveLoadBalancerProfile(
        ['loadbalancer', 'balanced', 'roundrobin', 'first', 'second'],
        list,
        () => ({ 'context-limit': 8192, temperature: 0.3 }),
        owner.workspace.profileWrites.saveProfile.bind(
          owner.workspace.profileWrites,
        ),
      ),
    ).toMatchObject({ messageType: 'info' });
    expect(
      await owner.workspace.profileDefinitions.loadProfile('balanced'),
    ).toMatchObject({
      type: 'loadbalancer',
      profiles: ['first', 'second'],
      contextLimit: 8192,
      ephemeralSettings: { temperature: 0.3 },
    });
    expect(
      await peer.workspace.profileDefinitions.listProfiles(),
    ).toStrictEqual([]);
  });
});
