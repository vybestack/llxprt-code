/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';

import { describe, expect, it } from 'bun:test';
import {
  writeProviderAliasConfig,
  loadProviderAliasEntries,
} from '@vybestack/llxprt-code-providers/composition.js';
import { setActiveModel } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Profile alias default ownership', () => {
  const owner = useProfileOwner();

  it('resolves profile values over shipped Opus 5 alias defaults', async () => {
    const shipped = loadProviderAliasEntries().find(
      (entry) => entry.alias === 'anthropic' && entry.source === 'builtin',
    );
    if (!shipped) throw new Error('Missing builtin anthropic alias');
    writeProviderAliasConfig('anthropic', shipped.config);
    const values = {
      'reasoning.effortWireFormat': 'openai',
      'reasoning.enabledWireFormat': 'openrouter',
      'reasoning.effortMap': { low: 'profile-low' },
      'reasoning.enabledMap': { false: null },
    };
    await owner().application.applySnapshot({
      ...standardProfile(values),
      model: 'claude-opus-5',
    });
    for (const [key, value] of Object.entries(values))
      expect(owner().settingsOwner.readNamedParameter(key)).toStrictEqual(
        value,
      );
  });

  it('applies target model defaults without leaking old provider values', async () => {
    const { application } = owner();
    owner().settingsOwner.writeUserParameter(
      'reasoning.effortWireFormat',
      'openai-responses',
    );
    owner().settingsOwner.writeUserParameter(
      'reasoning.enabledWireFormat',
      'thinking',
    );
    owner().settingsOwner.writeUserParameter('reasoning.effortMap', {
      low: 'old-provider-low',
    });
    owner().settingsOwner.writeUserParameter('reasoning.enabledMap', {
      false: null,
    });
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: {
        'reasoning.effortWireFormat': 'openrouter',
        'reasoning.enabledWireFormat': 'openrouter',
      },
      modelDefaults: [
        {
          pattern: '^claude-opus-4-6$',
          ephemeralSettings: {
            'reasoning.effortWireFormat': 'anthropic',
            'reasoning.effortMap': { high: 'model-high' },
          },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile(),
      model: 'claude-opus-4-6',
    });
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.effortWireFormat'),
    ).toBe('anthropic');
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('openrouter');
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({
      high: 'model-high',
    });
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.enabledMap'),
    ).toBeUndefined();
  });

  it('keeps an explicit profile selector equal to the old default through later model changes', async () => {
    const { settings, application } = owner();
    writeProviderAliasConfig('zai', {
      baseProvider: 'anthropic',
      modelDefaults: [
        {
          pattern: '^glm-5\\.2$',
          ephemeralSettings: { 'reasoning.effortWireFormat': 'anthropic' },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile({ 'reasoning.effortWireFormat': 'anthropic' }),
      provider: 'zai',
      model: 'glm-5.2',
    });
    await setActiveModel(
      'glm-5.4',
      assembleModelSelection(owner().settingsOwner),
      settings,
      owner().manager.getActiveProvider(),
    );
    expect(owner().settingsOwner.readSelectedModel()).toBe('glm-5.4');
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.effortWireFormat'),
    ).toBe('anthropic');
  });

  it('keeps an explicit profile selector through a later provider switch', async () => {
    const { application, switchProvider } = owner();
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: { 'reasoning.enabledWireFormat': 'thinking' },
    });
    writeProviderAliasConfig('openrouter', {
      baseProvider: 'openai',
      ephemeralSettings: { 'reasoning.enabledWireFormat': 'openrouter' },
    });
    await application.applySnapshot(
      standardProfile({ 'reasoning.enabledWireFormat': 'thinking' }),
    );
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('thinking');
    await switchProvider('openrouter');
    expect(owner().manager.getActiveProviderName()).toBe('openrouter');
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
    ).toBe('thinking');
  });

  it('keeps explicit profile maps equal to provider defaults through model changes', async () => {
    const { settings, application } = owner();
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      ephemeralSettings: { 'reasoning.effortMap': { high: 'provider-high' } },
      modelDefaults: [
        {
          pattern: '^claude-opus-4-6$',
          ephemeralSettings: { 'reasoning.effortMap': { high: 'model-high' } },
        },
      ],
    });
    await application.applySnapshot({
      ...standardProfile({ 'reasoning.effortMap': { high: 'provider-high' } }),
      model: 'claude-sonnet-4-5-20250929',
    });
    await setActiveModel(
      'claude-opus-4-6',
      assembleModelSelection(owner().settingsOwner),
      settings,
      owner().manager.getActiveProvider(),
    );
    expect(
      owner().settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({
      high: 'provider-high',
    });
  });
});
