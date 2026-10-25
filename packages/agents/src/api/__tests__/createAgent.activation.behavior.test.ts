/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { canonicalProviderActivationIntent } from '../activationPreflightState.js';
import { PLACEHOLDER_MODEL, UNCONFIGURED_PROVIDER } from '../constants.js';
import { ProviderActivationIntentSchema } from '../config-schema.js';
import {
  buildAgent,
  createAgent,
  tempRoot,
  type Agent,
  type AgentConfig,
} from './helpers/agentHarness.js';

function activeProviderName(agent: Agent): string | undefined {
  return agent.providerReads.inspection.getActiveProviderDetails()?.name;
}

/**
 * The Agent-observable halves of a legacy-versus-explicit activation. The
 * provider-scope records (`model`, `auth-key`, `base-url`) are asserted in
 * providerActivation.scopePersistence.behavior.test.ts, where the test owns the
 * `SettingsService`. `withTurn` proves the session client is ready by running
 * a turn; it is omitted for the unconfigured provider, which has no turn.
 */
async function activationSnapshot(
  overrides: Partial<AgentConfig>,
  { withTurn }: { readonly withTurn: boolean } = { withTurn: true },
) {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', overrides);
  try {
    return {
      provider: agent.getProvider(),
      model: agent.getModel(),
      activeProvider: activeProviderName(agent),
      key: agent.getEphemeralSetting('auth-key'),
      keyfile: agent.getEphemeralSetting('auth-keyfile'),
      baseUrl: agent.getEphemeralSetting('base-url'),
      reply: withTurn ? (await agent.chat('hello')).text : undefined,
    };
  } finally {
    await cleanup();
  }
}

describe('createAgent single activation transition (#2534)', () => {
  it('legacy provider and model select the same runtime as an explicit intent', async () => {
    const legacy = await activationSnapshot({
      provider: 'fake',
      model: 'chosen-model',
    });
    const explicit = await activationSnapshot({
      activation: { provider: 'fake', model: 'chosen-model' },
    });

    expect(legacy).toStrictEqual(explicit);
    expect(legacy).toMatchObject({
      provider: 'fake',
      model: 'chosen-model',
      activeProvider: 'fake',
      reply: 'a plain text reply',
    });
  });

  it('legacy credentials have the same persistent and ephemeral effects as CLI overrides', async () => {
    const auth = { apiKey: 'phase2-key', baseUrl: 'https://phase2.example/v1' };
    const legacy = await activationSnapshot({ auth });
    const explicit = await activationSnapshot({
      activation: {
        provider: 'fake',
        model: 'fake-model',
        cliOverrides: { key: auth.apiKey, baseUrl: auth.baseUrl },
      },
    });

    expect(legacy).toStrictEqual(explicit);
    expect(legacy).toMatchObject({
      key: auth.apiKey,
      baseUrl: auth.baseUrl,
      reply: 'a plain text reply',
    });
    expect(legacy.keyfile).toBeUndefined();
  });

  it('legacy provider switch + credentials persist into the post-switch ACTIVE provider scope, matching an explicit intent (#2534 review)', async () => {
    const auth = { apiKey: 'switch-key', baseUrl: 'https://switch.example/v1' };
    // Under the fake seam only FakeProvider registers, so the legacy switch to
    // 'gemini' degrades best-effort and 'fake' remains the post-switch active
    // provider — the persistence target for the credentials. (The successful
    // real-switch case is covered at the executor level in
    // providerActivation.behavior.test.ts (h).)
    const captureScopeState = async (overrides: Partial<AgentConfig>) => {
      const { agent, cleanup } = await buildAgent(
        'plain-text.jsonl',
        overrides,
      );
      try {
        return {
          activeProvider: activeProviderName(agent),
          ephemeralKey: agent.getEphemeralSetting('auth-key'),
          ephemeralBaseUrl: agent.getEphemeralSetting('base-url'),
        };
      } finally {
        await cleanup();
      }
    };

    const legacy = await captureScopeState({
      provider: 'gemini',
      model: PLACEHOLDER_MODEL,
      auth,
    });
    expect(legacy.activeProvider).toBe('fake');
    // The credentials' persistence into the post-switch ACTIVE provider's scope
    // (not the outgoing one's) is asserted in
    // providerActivation.scopePersistence.behavior.test.ts.
    // Session-level overrides identical either way.
    expect(legacy.ephemeralKey).toBe(auth.apiKey);
    expect(legacy.ephemeralBaseUrl).toBe(auth.baseUrl);

    // Legacy synthesis and an equivalent explicit intent produce the SAME
    // persisted + ephemeral state for the switch + credentials shape. The
    // explicit build carries the SAME legacy provider/model fields so the
    // Config constructor seeds identical pre-switch state (the comparison
    // isolates the activation shape; with divergent ctor inputs the
    // switch-time previous-provider wipe would land in different scopes).
    // The explicit intent omits the model, matching what legacy synthesis
    // keeps after filtering the PLACEHOLDER_MODEL sentinel.
    const explicit = await captureScopeState({
      provider: 'gemini',
      model: PLACEHOLDER_MODEL,
      activation: {
        provider: 'gemini',
        providerSwitchPolicy: 'best-effort',
        cliOverrides: { key: auth.apiKey, baseUrl: auth.baseUrl },
      },
    });
    expect(legacy.activeProvider).toBe(explicit.activeProvider);
    expect(legacy.ephemeralKey).toBe(explicit.ephemeralKey);
    expect(legacy.ephemeralBaseUrl).toBe(explicit.ephemeralBaseUrl);
  });

  it('the A2A unconfigured shape remains usable without writing the placeholder model', async () => {
    const result = await activationSnapshot(
      {
        provider: UNCONFIGURED_PROVIDER,
        model: PLACEHOLDER_MODEL,
      },
      { withTurn: false },
    );

    expect(result.provider).toBe(UNCONFIGURED_PROVIDER);
    // The placeholder model's absence from the provider scope is asserted in
    // providerActivation.scopePersistence.behavior.test.ts.
  });

  it('preflight distinguishes auth methods and switch-failure policies', () => {
    const original = canonicalProviderActivationIntent({ provider: 'fake' });
    expect(
      canonicalProviderActivationIntent({
        provider: 'fake',
        authMethod: 'provider',
      }),
    ).not.toBe(original);
    expect(
      canonicalProviderActivationIntent({
        provider: 'fake',
        providerSwitchPolicy: 'best-effort',
      }),
    ).not.toBe(original);
  });

  it('unregistered legacy provider names remain non-fatal under fake responses', async () => {
    const result = await activationSnapshot({
      provider: 'gemini',
      model: PLACEHOLDER_MODEL,
    });
    expect(result).toMatchObject({
      provider: 'gemini',
      activeProvider: 'fake',
      reply: 'a plain text reply',
    });
  });

  it.each([
    {
      provider: 'openai',
      model: 'phase2-model',
      explicit: false,
      active: 'openai',
    },
    {
      provider: 'openai',
      model: 'phase2-model',
      explicit: true,
      active: 'openai',
    },
    {
      provider: UNCONFIGURED_PROVIDER,
      model: PLACEHOLDER_MODEL,
      explicit: false,
      active: undefined,
    },
  ])(
    'constructs an agent without fake responses: %j',
    async ({ provider, model, explicit, active }) => {
      const previous = process.env.LLXPRT_FAKE_RESPONSES;
      delete process.env.LLXPRT_FAKE_RESPONSES;
      try {
        const agent = await createAgent({
          provider,
          model,
          workingDir: tempRoot,
          ...(explicit ? { activation: { provider, model } } : {}),
        });
        try {
          expect(agent.getProvider()).toBe(provider);
          expect(agent.getModel()).toBe(model);
          expect(activeProviderName(agent)).toBe(active);
        } finally {
          await agent.dispose();
        }
      } finally {
        if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = previous;
      }
    },
  );

  it('the activation contract carries the resolved provider auth method', () => {
    expect(
      ProviderActivationIntentSchema.parse({ authMethod: 'provider' }),
    ).toStrictEqual({ authMethod: 'provider' });
  });
});
