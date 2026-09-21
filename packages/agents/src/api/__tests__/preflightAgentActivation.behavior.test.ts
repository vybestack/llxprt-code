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
 *
 * Issue #3222 coverage: preflight is an agent-owned runtime-factory assembly
 * entrypoint. The Config arrives before fromConfig/createAgent install the
 * agent runtime factories, and the activation primitive (config.refreshAuth)
 * requires the agent client factory — so preflight installs agent-owned
 * defaults per field when absent, and a factory-less Config must NOT surface
 * that internal requirement as a fatal auth outcome.
 */

import { describe, it, expect } from 'bun:test';
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

describe('preflight agent-owned runtime factory assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  it('installs the agent-owned runtime factories on a factory-less Config and does NOT surface the missing factory as a fatal auth outcome', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      // The CLI-at-preflight state (#3222): a fully-wired Config whose three
      // agent runtime factories were never injected — the CLI stopped
      // injecting them, and fromConfig installs them only AFTER preflight.
      built.config.setAgentClientFactory(undefined);
      built.config.setToolSchedulerFactory(undefined);
      built.config.setTaskToolRegistration(undefined);
      expect(built.config.getAgentClientFactory()).toBeUndefined();
      expect(built.config.getToolSchedulerFactory()).toBeUndefined();
      expect(built.config.getTaskToolRegistration()).toBeUndefined();

      // The 'fake' provider otherwise activates. Before preflight owned the
      // assembly, refreshAuth's agentClientFactory requirement threw inside
      // the no-throw preflight and was converted to authFailed — the CLI
      // mapped that to a silent FATAL_AUTHENTICATION_ERROR (exit 41).
      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result: AgentActivationPreflightResult =
        await preflightAgentActivation(built.config, intent);

      expect(result.authFailed).toBe(false);
      expect(result.activeProvider).toBe('fake');

      // Preflight installed the agent-owned factory defaults per field.
      expect(built.config.getAgentClientFactory()).toBeDefined();
      expect(built.config.getToolSchedulerFactory()).toBeDefined();
      expect(built.config.getTaskToolRegistration()).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });

  it('keeps caller-supplied factories (only-if-absent ensure contract)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerClientFactory = built.config.getAgentClientFactory();
      const callerSchedulerFactory = built.config.getToolSchedulerFactory();
      expect(callerClientFactory).toBeDefined();
      expect(callerSchedulerFactory).toBeDefined();

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        cliOverrides: { key: 'sk-test-key' },
        authMode: 'auto',
      };
      const result: AgentActivationPreflightResult =
        await preflightAgentActivation(built.config, intent);

      expect(result.authFailed).toBe(false);
      // Pre-present factories are never replaced; the absent task-tool
      // registration (buildCliStyleConfig does not inject one) is installed.
      expect(built.config.getAgentClientFactory()).toBe(callerClientFactory);
      expect(built.config.getToolSchedulerFactory()).toBe(
        callerSchedulerFactory,
      );
      expect(built.config.getTaskToolRegistration()).toBeDefined();
    } finally {
      await built.cleanup();
    }
  });
});
