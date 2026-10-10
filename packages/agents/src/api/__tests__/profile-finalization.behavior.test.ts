/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { assembleAgentProfiles } from '../profileApplicationAssembly.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { createAgentAuthState } from '../control/authState.js';
import type { AgentProviderState } from '../agentImpl.js';
import { buildRuntimeProfileSnapshot } from '@vybestack/llxprt-code-providers/runtime.js';

describe('Profile finalization', () => {
  it('keeps facade and owner state unchanged when the final loop rebuild fails', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const settings = built.settingsService;
      const manager = built.providerManager;

      const providerState: AgentProviderState = {
        provider: 'fake',
        model: config.getModel(),
        modelParams: {},
      };
      const authState = createAgentAuthState();
      const before = structuredClone({ providerState, authState });
      const settingsBefore = settings.exportForStateSnapshot();
      const ephemeralsBefore = structuredClone(
        built.settingsOwner.captureNamedParameters(),
      );
      const failure = new Error('loop rebuild failed');
      let failRebuild = true;
      const profiles = assembleAgentProfiles(
        config,
        settings,
        manager,
        null,
        assembleProviderSwitch(
          config,
          settings,
          manager,
          null,
          () => undefined,
          () => built.sessionClient.refreshAuth(),
          built.settingsOwner,
        ),
        built.settingsOwner,
        providerState,
        authState,
        () =>
          buildRuntimeProfileSnapshot({
            providerName: manager.getActiveProviderName() ?? '',
            modelName: config.getModel(),
            providerSettings: settings.getProviderSettings('fake'),
            ephemeralSettings: built.settingsOwner.captureNamedParameters(),
          }),
        async () => {
          if (failRebuild) throw failure;
          return {
            publish: () => {},
            retire: async () => {},
            discard: async () => {},
          };
        },
        built.mcpRuntime.profileDefinitions,
      );
      const profile: Profile = {
        version: 1,
        provider: 'fake',
        model: 'replacement-model',
        modelParams: { temperature: 0.25 },
        ephemeralSettings: {
          'auth-key': 'replacement-key',
          'base-url': 'https://replacement.example',
        },
      };

      await expect(profiles.applySnapshot(profile)).rejects.toBe(failure);
      expect({ providerState, authState }).toStrictEqual(before);
      expect(settings.exportForStateSnapshot()).toStrictEqual(settingsBefore);
      expect(built.settingsOwner.captureNamedParameters()).toStrictEqual(
        ephemeralsBefore,
      );
      expect(config.getModel()).toBe(before.providerState.model);
      expect(profiles.isApplying()).toBe(false);

      failRebuild = false;
      await profiles.applySnapshot(profile);
      expect(providerState).toMatchObject({
        model: 'replacement-model',
        modelParams: { temperature: 0.25 },
      });
      expect(authState).toMatchObject({
        rawKeyPresent: true,
        baseUrl: 'https://replacement.example',
      });
    } finally {
      await built.cleanup();
    }
  });
});
