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
  internalConfig,
  type AgentConfig,
} from './helpers/agentHarness.js';

async function activationSnapshot(overrides: Partial<AgentConfig>) {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', overrides);
  try {
    const config = internalConfig(agent);
    return {
      provider: agent.getProvider(),
      model: agent.getModel(),
      activeProvider: config.getProviderManager()?.getActiveProviderName(),
      activeModel: config.getModel(),
      key: config.getEphemeralSetting('auth-key'),
      keyfile: config.getEphemeralSetting('auth-keyfile'),
      baseUrl: config.getEphemeralSetting('base-url'),
      settings: config.getSettingsService().getProviderSettings('fake'),
      clientReady: config.getContentGeneratorConfig() !== undefined,
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
      activeModel: 'chosen-model',
      clientReady: true,
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
      clientReady: true,
    });
    expect(legacy.keyfile).toBeUndefined();
  });

  it('the A2A unconfigured shape remains usable without writing the placeholder model', async () => {
    const result = await activationSnapshot({
      provider: UNCONFIGURED_PROVIDER,
      model: PLACEHOLDER_MODEL,
    });

    expect(result.clientReady).toBe(true);
    expect(result.provider).toBe(UNCONFIGURED_PROVIDER);
    expect(result.settings.model).not.toBe(PLACEHOLDER_MODEL);
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
      clientReady: true,
    });
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
    'constructs an agent without fake responses: %j',
    async ({ provider, model, explicit, active, storedModel }) => {
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
          const config = internalConfig(agent);
          expect(agent.getProvider()).toBe(provider);
          expect(agent.getModel()).toBe(model);
          expect(config.getProviderManager()?.getActiveProviderName()).toBe(
            active,
          );
          expect(config.getAgentClient()).toBeDefined();
          expect(
            config.getSettingsService().getProviderSettings(provider).model,
          ).toBe(storedModel);
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
