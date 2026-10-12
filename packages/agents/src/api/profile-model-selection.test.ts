/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService, type Profile } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { resolveRequestedModel } from './profile-model-selection.js';

const profile: Profile = {
  version: 1,
  provider: 'openai',
  model: '',
  modelParams: {},
  ephemeralSettings: {},
};
const manager = { getActiveProvider: () => undefined };

async function withOwners(
  scenario: (
    first: SessionSettingsOwner,
    peer: SessionSettingsOwner,
    settings: SettingsService,
  ) => void,
): Promise<void> {
  const settings = new SettingsService();
  const peerSettings = new SettingsService();
  const first = new SessionSettingsOwner(settings);
  const peer = new SessionSettingsOwner(peerSettings);
  first.initializeProviderSelection('openai', 'first-model');
  peer.initializeProviderSelection('openai', 'peer-model');
  try {
    scenario(first, peer, settings);
  } finally {
    await first.dispose();
    await peer.dispose();
  }
}

describe('Profile model resolution from the adopted owner', () => {
  it('uses current selected models independently when no provider default is available', async () => {
    await withOwners((first, peer, settings) => {
      const resolve = (owner: SessionSettingsOwner) =>
        resolveRequestedModel(
          profile,
          profile,
          undefined,
          { readModel: () => owner.readSelectedModel() },
          manager,
        );
      expect([resolve(first), resolve(peer)]).toStrictEqual([
        'first-model',
        'peer-model',
      ]);
      settings.setProviderSetting('openai', 'model', 'updated-model');
      expect([resolve(first), resolve(peer)]).toStrictEqual([
        'updated-model',
        'peer-model',
      ]);
    });
  });
  it('retains explicit model precedence and provider default precedence over owner selection', async () => {
    await withOwners((first) => {
      const selection = { readModel: () => first.readSelectedModel() };
      const provider = { getDefaultModel: () => 'provider-model' };
      expect(
        resolveRequestedModel(profile, profile, provider, selection, manager),
      ).toBe('provider-model');
      const explicit = { ...profile, model: 'profile-model' };
      expect(
        resolveRequestedModel(explicit, explicit, provider, selection, manager),
      ).toBe('profile-model');
    });
  });
  it('rejects profiles without a selected model or provider default', () => {
    expect(() =>
      resolveRequestedModel(
        profile,
        profile,
        undefined,
        { readModel: () => undefined },
        manager,
      ),
    ).toThrow('no default is available');
  });
});
