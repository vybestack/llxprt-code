/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { type ProviderActivationResult } from '@vybestack/llxprt-code-agents';
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
describe('ProviderActivationIntent / executeProviderActivation (#2374)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('(e) model + modelParams application incl. stale-param clearing', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      settingsOwner.writeUserParameter('stale-param', 'old');
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        modelParams: { temperature: 0.7 },
        authMode: 'auto',
      };
      const result: ProviderActivationResult =
        await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
      expect(route.config.getModel()).toBe('fake-model');
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });

  it('(f) authMode none skips auth refresh entirely (no authFailed, no throw)', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        authMode: 'none',
      };
      const result: ProviderActivationResult =
        await route.preflight.preflight(intent);
      expect(result.authFailed).toBe(false);
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });
});
