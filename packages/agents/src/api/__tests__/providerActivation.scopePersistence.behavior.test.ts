/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { PLACEHOLDER_MODEL, UNCONFIGURED_PROVIDER } from '../constants.js';
import type { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * The provider-scoped persistence that `executeProviderActivation` performs
 * (#2534). The test owns the `SettingsService` (Route A: `fromConfig` runs the
 * executor over the settings the caller passed), so the persisted
 * `getProviderSettings(...)` records are readable without any capture.
 *
 * `legacyShape` writes the intent that `createAgent` synthesizes from the
 * legacy `provider`/`model`/`auth` inputs: a best-effort switch, the model
 * unless it is the placeholder sentinel, and the credentials as CLI overrides.
 */
function legacyShape(
  provider: string,
  model: string,
  auth: { readonly apiKey?: string; readonly baseUrl?: string } = {},
): ProviderActivationIntent {
  return {
    provider,
    providerSwitchPolicy: 'best-effort',
    ...(model.trim() !== '' && model !== PLACEHOLDER_MODEL ? { model } : {}),
    ...(auth.apiKey !== undefined || auth.baseUrl !== undefined
      ? {
          cliOverrides: {
            ...(auth.apiKey !== undefined ? { key: auth.apiKey } : {}),
            ...(auth.baseUrl !== undefined ? { baseUrl: auth.baseUrl } : {}),
          },
        }
      : {}),
  };
}

interface ActivatedState {
  readonly activeProvider: string | undefined;
  readonly scopes: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

describe('executeProviderActivation provider-scope persistence (#2534)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  /**
   * Activates `activation` through `fromConfig` over a `Config` seeded with
   * `config`, and returns the active provider and the named provider scopes
   * read from the test's own `SettingsService`.
   */
  async function activate(
    config: Partial<AgentConfig>,
    activation: ProviderActivationIntent,
    scopeNames: readonly string[],
  ): Promise<ActivatedState> {
    const route = await openRouteAAgent({ config, intent: { activation } });
    try {
      // Runs through the session client, so it fails when activation left the
      // agent without one (a turn cannot run in the unconfigured and no-replay
      // modes).
      await route.agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'client-probe' }] },
      ]);
      expect(JSON.stringify(await route.agent.session.getHistory())).toContain(
        'client-probe',
      );
      return {
        activeProvider:
          route.agent.providerReads.inspection.getActiveProviderDetails()?.name,
        scopes: Object.fromEntries(
          scopeNames.map((name) => [
            name,
            { ...route.settings.getProviderSettings(name) },
          ]),
        ),
      };
    } finally {
      await route.close();
    }
  }

  it('persists the intent model into the activated provider scope, same as the legacy shape', async () => {
    const legacy = await activate(
      { provider: 'fake', model: 'chosen-model' },
      legacyShape('fake', 'chosen-model'),
      ['fake'],
    );
    const explicit = await activate(
      { provider: 'fake', model: 'chosen-model' },
      { provider: 'fake', model: 'chosen-model' },
      ['fake'],
    );

    expect(legacy).toStrictEqual(explicit);
    expect(legacy.activeProvider).toBe('fake');
    expect(legacy.scopes.fake.model).toBe('chosen-model');
  });

  it('persists credentials into the activated provider scope, same as CLI overrides', async () => {
    const auth = { apiKey: 'phase2-key', baseUrl: 'https://phase2.example/v1' };
    const legacy = await activate(
      { provider: 'fake', model: 'fake-model' },
      legacyShape('fake', 'fake-model', auth),
      ['fake'],
    );
    const explicit = await activate(
      { provider: 'fake', model: 'fake-model' },
      {
        provider: 'fake',
        model: 'fake-model',
        cliOverrides: { key: auth.apiKey, baseUrl: auth.baseUrl },
      },
      ['fake'],
    );

    expect(legacy).toStrictEqual(explicit);
    expect(legacy.scopes.fake['auth-key']).toBe(auth.apiKey);
    expect(legacy.scopes.fake['base-url']).toBe(auth.baseUrl);
  });

  it('persists a degraded provider switch plus credentials into the post-switch active scope, not the outgoing one (#2534 review)', async () => {
    const auth = { apiKey: 'switch-key', baseUrl: 'https://switch.example/v1' };
    // Under the fake seam only FakeProvider registers, so the switch to
    // 'gemini' degrades best-effort and 'fake' remains the post-switch active
    // provider: the persistence target for the credentials. (The successful
    // real-switch case is covered in providerActivation.behavior.test.ts (h).)
    const config = { provider: 'gemini', model: PLACEHOLDER_MODEL };
    const legacy = await activate(
      config,
      legacyShape('gemini', PLACEHOLDER_MODEL, auth),
      ['fake', 'gemini'],
    );

    expect(legacy.activeProvider).toBe('fake');
    // The scope that the NEXT session loads, not the outgoing provider's.
    expect(legacy.scopes.fake['auth-key']).toBe(auth.apiKey);
    expect(legacy.scopes.fake['base-url']).toBe(auth.baseUrl);
    expect(legacy.scopes.gemini['auth-key']).toBeUndefined();
    expect(legacy.scopes.gemini['base-url']).toBeUndefined();

    // The same switch and credentials without the legacy-only fields produce
    // the same persisted state. The explicit build carries the same Config
    // provider/model so both start from identical pre-switch state.
    const explicit = await activate(
      config,
      {
        provider: 'gemini',
        providerSwitchPolicy: 'best-effort',
        cliOverrides: { key: auth.apiKey, baseUrl: auth.baseUrl },
      },
      ['fake', 'gemini'],
    );
    expect(legacy).toStrictEqual(explicit);
  });

  it('activates the A2A unconfigured shape without writing the placeholder model', async () => {
    const config = {
      provider: UNCONFIGURED_PROVIDER,
      model: PLACEHOLDER_MODEL,
    };
    // Activation resolving is the readiness proof for this shape: the executor
    // refreshes auth on the session client (a failure is reported as
    // authFailed and `fromConfig` rejects), and no turn can run on an
    // unconfigured provider.
    const state = await activate(
      config,
      legacyShape(UNCONFIGURED_PROVIDER, PLACEHOLDER_MODEL),
      ['fake', UNCONFIGURED_PROVIDER],
    );

    expect(state.scopes.fake.model).not.toBe(PLACEHOLDER_MODEL);
    expect(state.scopes[UNCONFIGURED_PROVIDER].model).not.toBe(
      PLACEHOLDER_MODEL,
    );
  });

  it('activates an unregistered legacy provider name without failing under fake responses', async () => {
    const state = await activate(
      { provider: 'gemini', model: PLACEHOLDER_MODEL },
      legacyShape('gemini', PLACEHOLDER_MODEL),
      [],
    );

    expect(state.activeProvider).toBe('fake');
  });

  it.each([
    {
      provider: 'openai',
      model: 'phase2-model',
      explicit: false,
      active: 'openai',
      storedModel: 'phase2-model',
    },
    {
      provider: 'openai',
      model: 'phase2-model',
      explicit: true,
      active: 'openai',
      storedModel: 'phase2-model',
    },
    {
      provider: UNCONFIGURED_PROVIDER,
      model: PLACEHOLDER_MODEL,
      explicit: false,
      active: undefined,
      storedModel: undefined,
    },
  ])(
    'persists the stored model without fake responses: %j',
    async ({ provider, model, explicit, active, storedModel }) => {
      delete process.env.LLXPRT_FAKE_RESPONSES;
      const state = await activate(
        { provider, model },
        explicit ? { provider, model } : legacyShape(provider, model),
        [provider],
      );

      expect(state.activeProvider).toBe(active);
      expect(state.scopes[provider].model).toBe(storedModel);
    },
  );
});
