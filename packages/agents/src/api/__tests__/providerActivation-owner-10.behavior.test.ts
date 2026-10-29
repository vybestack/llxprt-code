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
describe('missing-credentials fallback precedence (#2374 round-3 Fix 4)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('no provider in intent → defaultProvider activated, auth error swallowed, authFailed false, config usable', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      // No provider in intent → the auto path falls back to defaultProvider.
      // Auth errors are swallowed (NOT fatal) in the no-provider branch.
      const intent: ProviderActivationIntent = {
        // No provider field → triggers the no-provider/fallback branch.
        defaultProvider: 'fake',
        authMode: 'auto',
      };
      const result = await route.preflight.preflight(intent);

      // Observable: authFailed is false even if auth had issues (swallowed).
      expect(result.authFailed).toBe(false);
      // The defaultProvider was activated.
      expect(result.activeProvider).toBe('fake');
      expect(route.preflight.getActiveProviderName()).toBe('fake');
      // The config remains usable — no throw, content generator surface intact.
      expect(() => route.config.getContentGeneratorConfig()).not.toThrow();
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });

  it('explicit provider with failing auth → authFailed true with authError populated', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    try {
      await route.prepare({ settingsOwner });
      // An explicitly-requested provider that does not exist triggers the
      // provider branch. Under the FakeProvider seam, switching to an unknown
      // provider resolves the auth failure which the executor maps to
      // authFailed:true. The authError must be populated so fromConfig can
      // include it in the thrown AgentBootstrapError.
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };
      const result = await route.preflight.preflight(intent);

      // Observable: authFailed is true and authError is populated.
      expect(result.authFailed).toBe(true);
      expect(result.authError).toBeDefined();
    } finally {
      await route.close();
      await settingsOwner.dispose();
    }
  });
});
