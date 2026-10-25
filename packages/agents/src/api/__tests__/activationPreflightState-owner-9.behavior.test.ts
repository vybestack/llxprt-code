/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { createGatedKeyStorage } from './helpers/gated-key-storage.js';
import { OwnedCredentialFixture } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

describe('activation bootstrap ownership and queued work', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  it('does not publish a blocked stale attempt or let it overwrite the latest provider', async () => {
    // The first attempt selects the built-in provider, which the fake replay
    // seam would hide.
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    closers.push(async () => {
      if (previousReplay !== undefined)
        process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    });
    const latest = createRecordingProvider({ alias: 'latest-local' });
    const credentialCheck = await createGatedKeyStorage('held-key', 'secret');
    const credentials = await OwnedCredentialFixture.create(
      undefined,
      credentialCheck.storage,
    );
    closers.push(() => credentials.dispose());
    const route = await openRouteBPreflight({
      authority: credentials.authority,
      contributions: latest.contributions,
      config: {
        interactive: true,
        provider: latest.alias,
        model: 'recording-default',
      },
    });
    closers.push(() => route.close());
    route.settings.set('auth-key-name', 'held-key');
    const settingsOwner = new SessionSettingsOwner(route.settings);
    closers.push(() => settingsOwner.dispose());
    try {
      await route.prepare({ settingsOwner });
      const first = route.preflight.preflight({
        provider: 'claudecode',
        authMode: 'none',
        model: 'first-model',
      });
      await credentialCheck.entered;
      const latestIntent = {
        provider: latest.alias,
        authMode: 'none',
        model: 'second-model',
      } as const;
      const second = route.preflight.preflight(latestIntent);
      credentialCheck.release();
      expect((await first).token).toBeUndefined();
      const result = await second;
      expect(result.token).toBeDefined();
      if (!result.token) throw new Error('Missing receipt');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        latestIntent,
        {},
      );
      closers.push(() => agent.dispose());
      expect(agent.getProvider()).toBe(latest.alias);
      expect(settingsOwner.readSelectedModel()).toBe('second-model');
    } finally {
      credentialCheck.release();
      await route.disposePreflight();
    }
  });
});
