/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { applyProfileCascade } from './profileApplication.js';
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import { buildCliStyleConfig } from './__tests__/helpers/buildCliStyleConfig.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import type { Profile } from '@vybestack/llxprt-code-settings';

describe('profile candidate operations', () => {
  it('holds named-key preparation without changing either root and leaves its sibling usable after failure', async () => {
    const first = await buildCliStyleConfig('plain-text.jsonl', {
      model: 'first',
      sessionId: 'same-label',
    });
    const second = await buildCliStyleConfig('plain-text.jsonl', {
      model: 'second',
      sessionId: 'same-label',
    });
    let release: (value: string | null) => void = () => {
      throw new Error('Gate is not initialized');
    };
    const held = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {
      throw new Error('Gate is not initialized');
    };
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const apply = (
      owner: typeof first,
      profile: Profile,
      readKey: (name: string) => Promise<string | null>,
    ): ReturnType<typeof applyProfileCascade> =>
      applyProfileCascade(
        profile,
        {},
        owner.settingsService,
        owner.providerManager,
        owner.mcpRuntime.profileDefinitions,
        assembleProviderSwitch(
          owner.config,
          owner.settingsService,
          owner.providerManager,
          null,
          () => undefined,
          () => owner.sessionClient.refreshAuth(),
          owner.settingsOwner,
        ),
        assembleModelSelection(owner.settingsOwner),
        {
          readEndpoint: () => owner.settingsOwner.readSelectedEndpoint(),
          applyParameter: (key, value) =>
            owner.settingsOwner.writeUserParameter(key, value),
        },
        readKey,
      );
    try {
      const before = first.settingsService.exportForStateSnapshot();
      const profile: Profile = {
        version: 1,
        provider: 'fake',
        model: 'replacement',
        modelParams: {},
        ephemeralSettings: { 'auth-key-name': 'first-key' },
      };
      const pending = apply(first, profile, async () => {
        entered();
        return held;
      });
      const observed = pending.catch((error: unknown) => error);
      await started;
      expect(first.settingsService.exportForStateSnapshot()).toStrictEqual(
        before,
      );
      await apply(
        second,
        {
          ...profile,
          model: 'sibling-selected',
          ephemeralSettings: {
            'base-url': 'https://sibling.example',
          },
        },
        async () => {
          throw new Error('Unexpected key read');
        },
      );
      expect(second.settingsOwner.readSelectedModel()).toBe('sibling-selected');
      release(null);
      expect(await observed).toBeInstanceOf(Error);
      expect(first.settingsService.exportForStateSnapshot()).toStrictEqual(
        before,
      );
      expect(second.settingsOwner.readSelectedEndpoint()).toBe(
        'https://sibling.example',
      );
      await first.cleanup();
      expect(second.settingsOwner.readSelectedModel()).toBe('sibling-selected');
    } finally {
      release(null);
      await first.cleanup();
      await second.cleanup();
    }
  });
});
