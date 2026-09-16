/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * #2534 review Finding 6 (#2300 edge): Config constructor seeding of the
 * activeProvider store is ownership-scoped. A Config-OWNED settings service
 * (created fresh by applySettingsService) may be seeded with the requested
 * provider + model; a SHARED/injected service is never mutated — even when
 * it merely lacks an activeProvider key, because absence of that key is not
 * proof of freshness for a service carrying other injected state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Config } from './config.js';
import {
  SettingsService,
  resetSettingsService,
} from '@vybestack/llxprt-code-settings';
import process from 'process';

const actual = { ...(await import('fs')) };
void vi.mock('fs', () => ({
  ...actual,
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

function baseParams(): ConstructorParameters<typeof Config>[0] {
  return {
    sessionId: 'test-seeding',
    targetDir: process.cwd(),
    debugMode: false,
    model: 'seed-model',
    cwd: process.cwd(),
  };
}

describe('Config activeProvider seeding ownership (#2534 review Finding 6)', () => {
  beforeEach(() => {
    resetSettingsService();
  });

  afterEach(() => {
    resetSettingsService();
    vi.clearAllMocks();
  });

  it('seeds activeProvider + model into a Config-owned (fresh) settings service', () => {
    const config = new Config({
      ...baseParams(),
      provider: 'openai',
    });
    const owned = config.getSettingsService();
    expect(owned.get('activeProvider')).toBe('openai');
    expect(owned.getProviderSettings('openai').model).toBe('seed-model');
  });

  it('never seeds a shared/injected service that lacks activeProvider but carries other state', () => {
    // The #2300 edge: "no activeProvider key" used to be read as "fresh
    // service", so a shared service carrying profile/provider state still
    // got activeProvider + model seeded into it by construction.
    const shared = new SettingsService();
    shared.set('currentProfile', 'work');
    shared.setProviderSetting('openai', 'auth-key', 'sk-existing');

    const config = new Config({
      ...baseParams(),
      provider: 'gemini',
      settingsService: shared,
    });

    expect(config.getSettingsService()).toBe(shared);
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
      settingsService: bootstrapOwned,
      settingsServiceOwnership: 'delegated',
    });

    expect(config.getSettingsService()).toBe(bootstrapOwned);
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
      settingsService: bootstrapOwned,
      settingsServiceOwnership: 'delegated',
    });

    // Delegation authorizes mutation; it does not clobber resolved state.
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
      settingsService: shared,
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
