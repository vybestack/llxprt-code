/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { type ProviderActivationIntent } from '../config-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They run the foreground preflight route a host takes, wired to the
 * FakeProvider replay seam.
 */
describe('provider-or-oauth preserves profile-auth ephemerals across switch (#2374 finding 5)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('ephemerals set + provider switch in provider-or-oauth mode → overrides still applied', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      settingsOwner.writeUserParameter('base-url', 'https://custom.example/v1');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'provider-or-oauth',
      };
      const result = await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      // The base-url ephemeral must survive the switch (switchActiveProvider
      // clears ephemerals; the executor snapshots+reapplies).
      expect(settingsOwner.readNamedParameter('base-url')).toBe(
        'https://custom.example/v1',
      );
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });
});
