import { afterEach, describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import * as publicApi from '@vybestack/llxprt-code-agents';
import { AgentProfilePreflight } from '../profile-preflight.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('AgentActivationBootstrap @plan:PLAN-20270110-ISSUE2378.P05 @requirement:REQ-2378-005', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();
  const routes: RouteBPreflight[] = [];
  const settingsOwners: SessionSettingsOwner[] = [];

  afterEach(async () => {
    for (const route of routes.splice(0).reverse()) await route.close();
    for (const owner of settingsOwners.splice(0)) await owner.dispose();
  });

  async function openPreparedRoute(): Promise<{
    readonly route: RouteBPreflight;
    readonly settingsOwner: SessionSettingsOwner;
  }> {
    const route = await openRouteBPreflight({
      authority: builtCredentials().authority,
      config: { interactive: true },
    });
    routes.push(route);
    const settingsOwner = new SessionSettingsOwner(route.settings);
    settingsOwners.push(settingsOwner);
    await route.prepare({ settingsOwner });
    return { route, settingsOwner };
  }

  it('activates the configured provider and reports a non-fatal auth outcome', async () => {
    const { route, settingsOwner } = await openPreparedRoute();
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      defaultProvider: 'gemini',
      cliOverrides: { key: 'sk-test-key' },
      authMode: 'auto',
    };

    const result = await route.preflight.preflight(intent);
    const activeProvider = route.preflight.getActiveProviderName();
    await route.disposePreflight();

    expect(result.authFailed).toBe(false);
    expect(result.activeProvider).toBe('fake');
    // Observable auth materialization: the CLI override path applied the key
    // to the active provider and set the auth-key ephemeral.
    expect(settingsOwner.readNamedParameter('auth-key')).toBe('sk-test-key');
    expect(activeProvider).toBe('fake');
  });

  it('reports a fatal auth outcome (authFailed true + authError) for an explicit failing provider', async () => {
    const { route } = await openPreparedRoute();
    const intent: ProviderActivationIntent = {
      provider: 'nonexistent-provider-xyz',
      authMode: 'auto',
    };

    const result = await route.preflight.preflight(intent);
    await route.disposePreflight();

    // The CLI maps authFailed true → FATAL_AUTHENTICATION_ERROR; the typed
    // authError must be populated so the fatal decision carries the cause.
    expect(result.authFailed).toBe(true);
    expect(result.authError).toBeDefined();
  });

  it('does not throw on auth failure — the outcome is returned as data, not raised', async () => {
    const { route } = await openPreparedRoute();
    const intent: ProviderActivationIntent = {
      provider: 'nonexistent-provider-xyz',
      authMode: 'auto',
    };

    // preflight returns the outcome as a typed value (never throws for an
    // auth failure); the CLI observes result.authFailed to decide fatality.
    await expect(route.preflight.preflight(intent)).resolves.toMatchObject({
      authFailed: true,
    });
    await route.disposePreflight();
  });

  it('adopting the same Config after preflight does not re-run a second activation sequence (single sequence)', async () => {
    const { route, settingsOwner } = await openPreparedRoute();
    const intent: ProviderActivationIntent = {
      provider: 'fake',
      cliOverrides: { key: 'sk-test-key' },
      authMode: 'auto',
    };

    const first = await route.preflight.preflight(intent);
    expect(first.authFailed).toBe(false);
    expect(route.preflight.getActiveProviderName()).toBe('fake');

    if (!first.token) throw new Error('Missing token');
    const history = await Array.fromAsync(route.preflight.captureHistory());
    const contentConfig = route.config.getContentGeneratorConfig();
    const agent = await AgentProfilePreflight.createForegroundAgent(
      route.preflight,
      first.token,
      intent,
      {},
    );
    expect(await Array.fromAsync(agent.streamHistory())).toStrictEqual(history);
    expect(route.config.getContentGeneratorConfig()).toBe(contentConfig);
    expect(route.preflight.getActiveProviderName()).toBe('fake');
    await agent.dispose();
    expect(settingsOwner.readNamedParameter('auth-key')).toBe('sk-test-key');
  });

  it('exposes bootstrap assembly without free receipt or activation-preflight APIs', () => {
    expect('assembleAgentActivationBootstrap' in publicApi).toBe(false);
    expect(publicApi.prepareAgentPreflight).toBeFunction();
    for (const name of [
      'preflightAgentActivation',
      'AgentActivationBootstrap',
      'clearCompletedActivationPreflight',
      'recordCompletedActivationPreflight',
      'consumeCompletedActivationPreflight',
      'inspectCompletedActivationPreflight',
    ]) {
      expect(publicApi).not.toHaveProperty(name);
    }
  });
});
