/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleModelSelection } from '../providerMutations.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProviderKeyStorage } from '@vybestack/llxprt-code-providers/auth.js';
import { writeProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import {
  standardProfile,
  useProfileOwner,
  workflowApplication,
} from './profile-workflow-owner-fixture.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { applyProfileCascade } from '@vybestack/llxprt-code-providers/runtime/profileApplication.js';

describe('Profile cascade workflow at the owner', () => {
  const owner = useProfileOwner();

  it('sets keyfile ephemeral and provider credential before switching', async () => {
    const { directory, settings, switchProvider } = owner();
    const keyfile = join(directory, 'key');
    await writeFile(keyfile, ' file-key\n');
    const observed: unknown[] = [];
    const application = workflowApplication(owner(), async (name, options) => {
      observed.push({
        keyfile: owner().settingsOwner.readNamedParameter('auth-keyfile'),
        key: settings.getProviderSettings(name)['auth-key'],
      });
      return switchProvider(name, options);
    });
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    expect(observed).toStrictEqual([{ keyfile, key: 'file-key' }]);
  });

  it('sets base-url in ephemeral and provider settings before switching', async () => {
    const { settings, switchProvider } = owner();
    const observed: unknown[] = [];
    const application = workflowApplication(owner(), async (name, options) => {
      observed.push([
        owner().settingsOwner.readNamedParameter('base-url'),
        settings.getProviderSettings(name)['base-url'],
      ]);
      return switchProvider(name, options);
    });
    await application.applySnapshot(
      standardProfile({ 'base-url': 'https://custom.api.com/v1' }),
    );
    expect(observed).toStrictEqual([
      ['https://custom.api.com/v1', 'https://custom.api.com/v1'],
    ]);
  });

  it('resolves auth-key-name from secure storage and preserves the reference', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(' named-credential ');
    try {
      await owner().application.applySnapshot(
        standardProfile({ 'auth-key-name': 'chutes' }),
      );
      expect(owner().settingsOwner.readNamedParameter('auth-key-name')).toBe(
        'chutes',
      );
      expect(
        owner().settingsOwner.readNamedParameter('auth-key'),
      ).toBeUndefined();
      expect(
        owner().settings.getProviderSettings('anthropic')['auth-key'],
      ).toBe('named-credential');
    } finally {
      storage.mockRestore();
    }
  });

  it('applies the issue 2477 Z.ai profile without Gemini fallback', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(' zai-key ');
    try {
      const result = await owner().application.applySnapshot({
        ...standardProfile({
          'auth-key-name': 'zai',
          'base-url': 'https://api.z.ai/api/anthropic',
        }),
        model: 'glm-5.2',
      });
      expect(result).toMatchObject({
        providerName: 'anthropic',
        modelName: 'glm-5.2',
        baseUrl: 'https://api.z.ai/api/anthropic',
      });
      expect(owner().manager.getActiveProviderName()).toBe('anthropic');
      expect(owner().settingsOwner.readSelectedModel()).toBe('glm-5.2');
      expect(owner().settingsOwner.readNamedParameter('auth-key-name')).toBe(
        'zai',
      );
      expect(
        owner().settings.getProviderSettings('anthropic')['auth-key'],
      ).toBe('zai-key');
      expect(
        result.warnings.some((warning) => warning.includes('fallback')),
      ).toBe(false);
    } finally {
      storage.mockRestore();
    }
  });

  it('sets GCP project and location as ephemerals and environment variables', async () => {
    await owner().application.applySnapshot(
      standardProfile({
        GOOGLE_CLOUD_PROJECT: 'my-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      }),
    );
    for (const [key, value] of Object.entries({
      GOOGLE_CLOUD_PROJECT: 'my-project',
      GOOGLE_CLOUD_LOCATION: 'us-central1',
    })) {
      expect(owner().settingsOwner.readNamedParameter(key)).toBe(value);
      expect(process.env[key]).toBe(value);
    }
  });

  it('falls back to the direct key when the keyfile is empty', async () => {
    const keyfile = join(owner().directory, 'empty');
    await writeFile(keyfile, ' \n');
    await owner().application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile, 'auth-key': 'fallback-key' }),
    );
    expect(owner().settingsOwner.readNamedParameter('auth-key')).toBe(
      'fallback-key',
    );
    expect(owner().settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'fallback-key',
    );
  });

  it('applies non-auth ephemeral settings after provider switching', async () => {
    await owner().application.applySnapshot(
      standardProfile({
        'context-limit': 200000,
        streaming: 'enabled',
        'custom-setting': 'value',
      }),
    );
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
    expect(owner().settingsOwner.readNamedParameter('streaming')).toBe(
      'enabled',
    );
    expect(owner().settingsOwner.readNamedParameter('custom-setting')).toBe(
      'value',
    );
  });

  it('keeps explicit context-limit after real model default recomputation', async () => {
    writeProviderAliasConfig('anthropic', {
      baseProvider: 'anthropic',
      modelDefaults: [
        {
          pattern: '^default-model$',
          ephemeralSettings: { 'context-limit': 4096 },
        },
      ],
    });
    await owner().application.applySnapshot({
      ...standardProfile({ 'context-limit': 200000 }),
      model: 'default-model',
    });
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
  });

  it('does not reinstall sensitive auth ephemerals during non-auth application', async () => {
    const keyfile = join(owner().directory, 'secret');
    await writeFile(keyfile, 'private-key');
    await owner().application.applySnapshot(
      standardProfile({
        'auth-keyfile': keyfile,
        'context-limit': 100000,
        'base-url': 'https://example.invalid',
        GOOGLE_CLOUD_PROJECT: 'project',
        GOOGLE_CLOUD_LOCATION: 'location',
      }),
    );
    expect(
      owner().settingsOwner.readNamedParameter('auth-key'),
    ).toBeUndefined();
    expect(owner().settingsOwner.readNamedParameter('auth-keyfile')).toBe(
      keyfile,
    );
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(owner().settingsOwner.readNamedParameter('base-url')).toBe(
      'https://example.invalid',
    );
    expect(process.env.GOOGLE_CLOUD_PROJECT).toBe('project');
    expect(process.env.GOOGLE_CLOUD_LOCATION).toBe('location');
  });

  it('clears old ephemerals omitted from the next profile', async () => {
    await owner().application.applySnapshot(
      standardProfile({ 'old-setting': 'stale', 'context-limit': 200000 }),
    );
    await owner().application.applySnapshot(
      standardProfile({ streaming: 'enabled' }),
    );
    expect(
      owner().settingsOwner.readNamedParameter('old-setting'),
    ).toBeUndefined();
    expect(
      owner().settingsOwner.readNamedParameter('context-limit'),
    ).toBeUndefined();
    expect(owner().settingsOwner.readNamedParameter('streaming')).toBe(
      'enabled',
    );
  });

  it('sets the requested model and returns it', async () => {
    const result = await owner().application.applySnapshot({
      ...standardProfile(),
      model: 'gpt-4o-mini',
    });
    expect(result.modelName).toBe('gpt-4o-mini');
    expect(owner().settingsOwner.readSelectedModel()).toBe('gpt-4o-mini');
  });

  it('falls back to the provider default when the profile model is empty', async () => {
    const result = await owner().application.applySnapshot({
      ...standardProfile(),
      model: '',
    });
    expect(result.modelName).toBe('fake-model');
    expect(result.modelName.length).toBeGreaterThan(0);
    expect(owner().settingsOwner.readSelectedModel()).toBe(result.modelName);
  });

  it('applies model parameters and clears stale parameters', async () => {
    await owner().application.applySnapshot({
      ...standardProfile(),
      modelParams: { temperature: 0.5, max_tokens: 1000, 'old-param': 'stale' },
    });
    await owner().application.applySnapshot({
      ...standardProfile(),
      modelParams: { temperature: 0.9, 'top-p': 0.95 },
    });
    const settings = owner().settings.getProviderSettings('anthropic');
    expect(settings).toMatchObject({ temperature: 0.9, 'top-p': 0.95 });
    expect(settings.max_tokens).toBeUndefined();
    expect(settings['old-param']).toBeUndefined();
  });

  it('includes the selected model info message', async () => {
    const result = await owner().application.applySnapshot({
      ...standardProfile(),
      model: 'gpt-4o-mini',
      provider: 'openai',
    });
    expect(result.infoMessages).toContain(
      "Model set to 'gpt-4o-mini' for provider 'openai'.",
    );
  });

  it('rejects a missing model when neither the provider nor config supplies a default', async () => {
    const { config, settings, store, providers } = owner();
    const provider = providers.get('anthropic');
    if (!provider) throw new Error('Missing fixture provider');
    provider.name = 'no-default';
    provider.getDefaultModel = () => '';
    const manager = new ProviderManager({ settingsService: owner().settings });
    manager.registerProvider(provider);
    manager.setActiveProvider('no-default');
    configureProviderRuntimeFactories(config, manager);
    settings.set('activeProvider', 'no-default');
    owner().settingsOwner.chooseModel('');
    await expect(
      applyProfileCascade(
        { ...standardProfile(), provider: 'no-default', model: '' },
        {},
        config,
        settings,
        manager,
        store,
        async () => ({
          changed: false,
          infoMessages: [],
          previousProvider: 'no-default',
          nextProvider: 'no-default',
        }),
        assembleModelSelection(owner().settingsOwner),
        {
          readEndpoint: () => owner().settingsOwner.readSelectedEndpoint(),
          applyParameter: (key, value) =>
            owner().settingsOwner.writeUserParameter(key, value),
        },
      ),
    ).rejects.toThrow('does not specify a model');
  });

  it('rejects an unregistered active provider at the explicit manager boundary', async () => {
    const manager = new ProviderManager({ settingsService: owner().settings });
    expect(() => manager.setActiveProvider('unregistered')).toThrow(
      "Provider 'unregistered' not found",
    );
    expect(manager.hasActiveProvider()).toBe(false);
  });
});
