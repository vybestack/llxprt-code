/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P05
 * @requirement:REQ-2378-005
 *
 * BEHAVIORAL tests for {@link preflightAgentActivation} (#2378).
 *
 * The interactive CLI bootstrap must observe the provider-activation auth
 * outcome BEFORE the foreground Agent is constructed (the sandbox-hop and
 * FATAL_AUTHENTICATION_ERROR decisions depend on it). Previously the CLI called
 * the runtime primitive `executeProviderActivation` directly — a runtime
 * assembly seam the agents package must own. `preflightAgentActivation` is the
 * public agent-bootstrap entrypoint the CLI calls with a DECLARATIVE intent; it
 * owns the activation primitive internally and returns the typed declarative
 * result (authFailed / activeProvider / authError) the CLI needs.
 *
 * These assertions exercise a REAL CLI-style Config wired to the FakeProvider
 * (buildCliStyleConfig) and observe RESULTING STATE (active provider, authFailed
 * flag, config auth surface) — never mock call counts.
 */

import { describe, it, expect } from 'vitest';
import {
  preflightAgentActivation,
  type ProviderActivationIntent,
  type AgentActivationPreflightResult,
} from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function configActiveProvider(config: {
  getProviderManager():
    | { getActiveProviderName(): string | undefined }
    | undefined;
}): string | undefined {
  return config.getProviderManager()?.getActiveProviderName();
}

describe('preflightAgentActivation @plan:PLAN-20270110-ISSUE2378.P05 @requirement:REQ-2378-005', () => {
  it('activates the configured provider and reports a non-fatal auth outcome', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        defaultProvider: 'gemini',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };

      const result: AgentActivationPreflightResult =
        await preflightAgentActivation(built.config, intent);

      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');
      // Observable auth materialization: the CLI override path applied the key
      // to the active provider and set the auth-key ephemeral.
      expect(built.config.getEphemeralSetting('auth-key')).toBe('sk-test-key');
      expect(configActiveProvider(built.config)).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('reports a fatal auth outcome (authFailed true + authError) for an explicit failing provider', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };

      const result: AgentActivationPreflightResult =
        await preflightAgentActivation(built.config, intent);

      // The CLI maps authFailed true → FATAL_AUTHENTICATION_ERROR; the typed
      // authError must be populated so the fatal decision carries the cause.
      expect(result.authFailed).toBe(true);
      expect(result.authError).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });

  it('does not throw on auth failure — the outcome is returned as data, not raised', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'nonexistent-provider-xyz',
        authMode: 'auto',
      };

      // preflight returns the outcome as a typed value (never throws for an
      // auth failure); the CLI observes result.authFailed to decide fatality.
      await expect(
        preflightAgentActivation(built.config, intent),
      ).resolves.toMatchObject({ authFailed: true });
    } finally {
      await built.cleanup();
    }
  });

  it('adopting the same Config after preflight does not re-run a second activation sequence (single sequence)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };

      const first = await preflightAgentActivation(built.config, intent);
      expect(first.authFailed).toBe(false);
      expect(configActiveProvider(built.config)).toBe('fake');

      // A subsequent pure adoption refresh (already-active, no overrides / model
      // / params) is the fast-path fromConfig uses to ADOPT the preflight state
      // without re-switching or re-applying credentials. It must remain a
      // non-fatal no-op that preserves the active provider + applied key.
      const adopt = await preflightAgentActivation(built.config, {
        provider: 'fake',
        authMode: 'auto',
      });
      expect(adopt.authFailed).toBe(false);
      expect(configActiveProvider(built.config)).toBe('fake');
      expect(built.config.getEphemeralSetting('auth-key')).toBe('sk-test-key');
    } finally {
      await built.cleanup();
    }
  });
});
