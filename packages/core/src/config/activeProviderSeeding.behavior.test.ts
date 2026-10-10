/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { Config } from './config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import process from 'node:process';

function baseParams(): ConstructorParameters<typeof Config>[0] {
  return {
    sessionId: 'test-seeding',
    targetDir: process.cwd(),
    debugMode: false,
    model: 'seed-model',
    cwd: process.cwd(),
  };
}

describe('Explicit session provider seeding ownership', () => {
  it('seeds activeProvider and model only through the fresh session owner', () => {
    const config = new Config({
      ...baseParams(),
      provider: 'openai',
    });
    const owned = new SettingsService();
    const owner = new SessionSettingsOwner(owned);
    owner.initializeProviderSelection(config.getProvider(), config.getModel());
    expect(owned.get('activeProvider')).toBe('openai');
    expect(owned.getProviderSettings('openai').model).toBe('seed-model');
  });

  it('never seeds a shared/injected service that lacks activeProvider but carries other state', async () => {
    // The #2300 edge: "no activeProvider key" used to be read as "fresh
    // service", so a shared service carrying profile/provider state still
    // got activeProvider + model seeded into it by construction.
    const shared = new SettingsService();
    shared.set('currentProfile', 'work');
    shared.setProviderSetting('openai', 'auth-key', 'sk-existing');

    const config = new Config({
      ...baseParams(),
      provider: 'gemini',
      initialSettings: shared.getAllGlobalSettings(),
    });

    expect(config.getProvider()).toBe('gemini');
    const owner = new SessionSettingsOwner(shared);
    owner.assertSettingsIdentity(shared);
    expect(() => owner.assertSettingsIdentity(new SettingsService())).toThrow(
      'Session settings adoption requires the original store',
    );
    await owner.dispose();
    // Neither the provider nor the model was seeded.
    expect(shared.get('activeProvider')).toBeUndefined();
    expect(shared.getProviderSettings('gemini')).toStrictEqual({});
    // The injector-owned state survived construction untouched.
    expect(shared.get('currentProfile')).toBe('work');
    expect(shared.getProviderSettings('openai')).toStrictEqual({
      'auth-key': 'sk-existing',
    });
  });

  it('seeds a delegated injected service the caller created for this Config', () => {
    // The CLI bootstrap path: loadCliConfig ALWAYS injects the settings
    // service, but it is a service the bootstrap itself created for this
    // Config's exclusive use (cliSessionBootstrap new SettingsService() →
    // runtimeOverrides → buildConfig). The caller declares that ownership
    // with settingsServiceOwnership: 'delegated' so the constructor seed —
    // the only writer of activeProvider before the best-effort provider
    // switch — still lands in the single store (Domain C1, #2534 review
    // Finding 6 regression).
    const bootstrapOwned = new SettingsService();

    const config = new Config({
      ...baseParams(),
      provider: 'anthropic',
      initialSettings: bootstrapOwned.getAllGlobalSettings(),
    });

    const owner = new SessionSettingsOwner(bootstrapOwned);
    owner.initializeProviderSelection(config.getProvider(), config.getModel());
    expect(bootstrapOwned.get('activeProvider')).toBe('anthropic');
    expect(bootstrapOwned.getProviderSettings('anthropic').model).toBe(
      'seed-model',
    );
  });

  it('delegated seeding still respects an existing activeProvider', () => {
    const bootstrapOwned = new SettingsService();
    bootstrapOwned.set('activeProvider', 'openai');
    bootstrapOwned.setProviderSetting('openai', 'model', 'gpt-existing');

    const config = new Config({
      ...baseParams(),
      provider: 'anthropic',
      initialSettings: bootstrapOwned.getAllGlobalSettings(),
    });

    const owner = new SessionSettingsOwner(bootstrapOwned);
    owner.initializeProviderSelection(config.getProvider(), config.getModel());
    expect(bootstrapOwned.get('activeProvider')).toBe('openai');
    expect(bootstrapOwned.getProviderSettings('openai').model).toBe(
      'gpt-existing',
    );
    expect(bootstrapOwned.getProviderSettings('anthropic')).toStrictEqual({});
    void config;
  });

  it('keeps an injected service\u2019s existing activeProvider and provider model', () => {
    const shared = new SettingsService();
    shared.set('activeProvider', 'anthropic');
    shared.setProviderSetting('anthropic', 'model', 'claude-existing');

    const config = new Config({
      ...baseParams(),
      provider: 'openai',
      initialSettings: shared.getAllGlobalSettings(),
    });

    expect(shared.get('activeProvider')).toBe('anthropic');
    expect(shared.getProviderSettings('anthropic').model).toBe(
      'claude-existing',
    );
    // The requested provider was not seeded as a side effect either.
    expect(shared.getProviderSettings('openai')).toStrictEqual({});
    void config;
  });
});
