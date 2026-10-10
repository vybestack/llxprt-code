/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import {
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Profile application basics at the owner', () => {
  const owner = useProfileOwner();

  it('preserves reasoning settings during provider switch (issue #890)', async () => {
    const { application } = owner();
    const reasoning = {
      'reasoning.enabled': true,
      'reasoning.budgetTokens': 8192,
      'reasoning.stripFromContext': true,
      'reasoning.includeInContext': false,
    };
    await application.applySnapshot(standardProfile(reasoning));
    for (const [key, value] of Object.entries(reasoning)) {
      expect(owner().settingsOwner.readNamedParameter(key)).toBe(value);
    }
  });

  it('reports the actual profile model instead of the provider default in info messages', async () => {
    const { application } = owner();
    const result = await application.applySnapshot({
      ...standardProfile(),
      model: 'glm-4.6',
    });
    expect(result.infoMessages).toContain(
      "Model set to 'glm-4.6' for provider 'anthropic'.",
    );
    expect(
      result.infoMessages.some((message) =>
        message.startsWith('Active model is'),
      ),
    ).toBe(false);
  });

  it('reads a keyfile before switching and installs the resolved credential', async () => {
    const {
      config,
      settings,
      manager,
      directory,
      oauth,
      switchProvider,
      store,
    } = owner();
    const keyfile = join(directory, 'credential');
    await writeFile(keyfile, ' file-credential\n');
    const observed: unknown[] = [];
    const application = assembleProfileApplication(
      config,
      settings,
      manager,
      oauth,
      async (name, options) => {
        observed.push(settings.getProviderSettings(name)['auth-key']);
        await writeFile(keyfile, 'rotated-after-preflight');
        return switchProvider(name, options);
      },
      owner().settingsOwner,
      store,
    );
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    expect(observed).toStrictEqual(['file-credential']);
    expect(manager.getActiveProviderName()).toBe('anthropic');
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'file-credential',
    );
  });

  it('applies auth ephemerals across the provider switch', async () => {
    const { application, settings } = owner();
    await application.applySnapshot(
      standardProfile({
        'auth-key': 'test-api-key',
        'base-url': 'https://api.example.com',
        'context-limit': 200000,
        streaming: 'enabled',
      }),
    );
    expect(settings.getProviderSettings('anthropic')).toMatchObject({
      'auth-key': 'test-api-key',
      'base-url': 'https://api.example.com',
    });
    expect(owner().settingsOwner.captureNamedParameters()).toMatchObject({
      'context-limit': 200000,
      streaming: 'enabled',
    });
  });

  it('does not trigger OAuth when loading a profile with keyfile', async () => {
    const { application, settings, directory, oauth, authenticationRequests } =
      owner();
    await oauth.toggleOAuthEnabled('anthropic');
    const keyfile = join(directory, 'credential');
    await writeFile(keyfile, 'test-api-key-from-keyfile');
    await application.applySnapshot(
      standardProfile({ 'auth-keyfile': keyfile }),
    );
    expect(settings.getProviderSettings('anthropic')['auth-key']).toBe(
      'test-api-key-from-keyfile',
    );
    expect(owner().settingsOwner.readNamedParameter('auth-keyfile')).toBe(
      keyfile,
    );
    expect(
      owner().settingsOwner.readNamedParameter('auth-key'),
    ).toBeUndefined();
    expect(authenticationRequests).toStrictEqual([]);
  });

  it('registers LoadBalancingProvider for LoadBalancer profiles', async () => {
    const { application, store, manager } = owner();
    await store.saveProfile('first', standardProfile());
    await store.saveProfile('second', {
      ...standardProfile(),
      provider: 'openai',
    });
    const result = await application.applySnapshot({
      ...standardProfile(),
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['first', 'second'],
    });
    expect(result.modelName).toBe('load-balancer');
    expect(owner().settingsOwner.readSelectedModel()).toBe('load-balancer');
    expect(manager.getProviderByName('load-balancer')?.name).toBe(
      'load-balancer',
    );
  });

  it('standard profiles still work unchanged', async () => {
    const { application, manager } = owner();
    const result = await application.applySnapshot({
      ...standardProfile(),
      model: 'gpt-4o',
      provider: 'openai',
    });
    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4o');
    expect(owner().settingsOwner.readSelectedModel()).toBe('gpt-4o');
    expect(manager.getProviderByName('load-balancer')).toBeUndefined();
  });
});
