/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderManager } from './providerManagerInstance.js';

function createContext(settingsService: SettingsService) {
  return {
    settingsService,
    metadata: { scope: 'test' },
  };
}

function createRegistrationObservers() {
  const registerAliasProviders = vi.fn(
    (manager: { registerProvider(provider: unknown): void }) => {
      manager.registerProvider({
        name: 'gemini',
        getDefaultModel: () => 'gemini-2.5-pro',
        getModels: async () => [],
        getServerTools: () => [],
      });
    },
  );
  return { registerAliasProviders, registerOAuthProviders: vi.fn() };
}

describe('Anthropic OAuth registration with environment key', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.clearAllMocks();
  });

  it('registers standard OAuth providers even when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const { registerAliasProviders, registerOAuthProviders } =
      createRegistrationObservers();

    const { oauthManager } = createProviderManager(
      createContext(settingsService),
      {
        allowBrowserEnvironment: false,
        loadAliasEntries: () => [],
        registerAliasProviders,
        registerOAuthProviders,
      },
    );

    expect(registerOAuthProviders).toHaveBeenCalledTimes(1);
    expect(registerOAuthProviders.mock.calls[0]?.[0]).toBe(oauthManager);
    expect(registerOAuthProviders.mock.calls[0]?.[1]).toBeTruthy();
  });

  it('ignores API keys when authOnly is enabled', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    settingsService.set('authOnly', true);
    const { registerAliasProviders, registerOAuthProviders } =
      createRegistrationObservers();

    createProviderManager(createContext(settingsService), {
      allowBrowserEnvironment: false,
      loadAliasEntries: () => [],
      registerAliasProviders,
      registerOAuthProviders,
    });

    expect(registerAliasProviders).toHaveBeenCalledTimes(1);
    const call = registerAliasProviders.mock.calls[0];
    expect(call?.[2]).toBeUndefined();
    expect(call?.[5]).toBeTruthy();
    expect(call?.[7]).toBe(true);
  });

  it('threads the OAuth manager through alias and OAuth registration', () => {
    const { registerAliasProviders, registerOAuthProviders } =
      createRegistrationObservers();

    const { oauthManager } = createProviderManager(
      createContext(settingsService),
      {
        allowBrowserEnvironment: false,
        loadAliasEntries: () => [],
        registerAliasProviders,
        registerOAuthProviders,
      },
    );

    expect(registerAliasProviders).toHaveBeenCalledTimes(1);
    expect(registerAliasProviders.mock.calls[0]?.[5]).toBe(oauthManager);
    expect(registerOAuthProviders.mock.calls[0]?.[0]).toBe(oauthManager);
  });
});
