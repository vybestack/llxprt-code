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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core';

// This test tests provider registration behavior, needs real providerAliases
vi.unmock('./providerAliases.js');

/**
 * Mock the concrete provider modules (imported relatively by the composition
 * SUT chain) so registration can be observed without constructing real
 * providers. ProviderManager is replaced wholesale, so its internal runtime
 * context dependencies (sourced from core) are never loaded.
 */
function mockProviderModules(opts: {
  openai: unknown;
  openaiResponses: unknown;
  openaiVercel: unknown;
  anthropic: unknown;
}): void {
  vi.doMock('../ProviderManager.js', () => {
    class MockProviderManager {
      setConfig(): void {}
      setActiveProvider(): void {}
      registerProvider(): void {}
    }
    return { ProviderManager: MockProviderManager };
  });
  vi.doMock('../gemini/GeminiProvider.js', () => {
    class MockGeminiProvider {
      setConfig(): void {}
    }
    return { GeminiProvider: MockGeminiProvider };
  });
  vi.doMock('../openai/OpenAIProvider.js', () => ({
    OpenAIProvider: opts.openai,
  }));
  vi.doMock('../openai-responses/OpenAIResponsesProvider.js', () => ({
    OpenAIResponsesProvider: opts.openaiResponses,
  }));
  vi.doMock('../openai-vercel/index.js', () => ({
    OpenAIVercelProvider: opts.openaiVercel,
  }));
  vi.doMock('../anthropic/AnthropicProvider.js', () => ({
    AnthropicProvider: opts.anthropic,
  }));
}

describe('Anthropic OAuth registration with environment key', () => {
  let ensureOAuthProviderRegisteredMock: ReturnType<typeof vi.fn>;
  let anthropicCtor: ReturnType<typeof vi.fn>;
  let openaiCtor: ReturnType<typeof vi.fn>;
  let openaiResponsesCtor: ReturnType<typeof vi.fn>;
  let openaivercelCtor: ReturnType<typeof vi.fn>;
  let mockSettingsService: SettingsService;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    ensureOAuthProviderRegisteredMock = vi.fn();
    anthropicCtor = vi.fn(() => ({}));
    openaiCtor = vi.fn(() => ({}));
    openaiResponsesCtor = vi.fn(() => ({}));
    openaivercelCtor = vi.fn(() => ({}));
    mockSettingsService = new SettingsService();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registers Anthropic OAuth provider even when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    vi.doMock('./oauth-provider-registration.js', () => ({
      ensureOAuthProviderRegistered: ensureOAuthProviderRegisteredMock,
      isOAuthProviderRegistered: vi.fn(),
      resetRegisteredProviders: vi.fn(),
    }));

    const activeContext: Record<string, unknown> = { scope: 'test' };
    class MockProvider {}
    mockProviderModules({
      openai: MockProvider,
      openaiResponses: MockProvider,
      openaiVercel: openaivercelCtor,
      anthropic: anthropicCtor,
    });

    vi.clearAllMocks();

    const {
      createProviderManager,
      resetProviderManager,
      registerProviderManagerSingleton,
    } = await import('./providerManagerInstance.js');

    resetProviderManager();

    const { manager, oauthManager } = createProviderManager(activeContext, {
      config: undefined,
      allowBrowserEnvironment: false,
    });
    registerProviderManagerSingleton(manager, oauthManager);

    const registeredAnthropic =
      ensureOAuthProviderRegisteredMock.mock.calls.some(
        ([provider]) => provider === 'anthropic',
      );
    expect(registeredAnthropic).toBe(true);

    const ctorCalls = anthropicCtor.mock.calls;
    expect(ctorCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = ctorCalls[0] as unknown[] | undefined;
    const oauthManagerArg = firstCall ? firstCall[3] : undefined;
    expect(oauthManagerArg).toBeTruthy();
  });

  it('ignores API keys when authOnly is enabled', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.OPENAI_API_KEY = 'sk-test-openai';

    vi.doMock('./oauth-provider-registration.js', () => ({
      ensureOAuthProviderRegistered: ensureOAuthProviderRegisteredMock,
      isOAuthProviderRegistered: vi.fn(),
      resetRegisteredProviders: vi.fn(),
    }));

    const activeContext: Record<string, unknown> = { scope: 'test' };
    mockProviderModules({
      openai: openaiCtor,
      openaiResponses: openaiResponsesCtor,
      openaiVercel: openaivercelCtor,
      anthropic: anthropicCtor,
    });

    vi.clearAllMocks();

    const {
      createProviderManager,
      resetProviderManager,
      registerProviderManagerSingleton,
    } = await import('./providerManagerInstance.js');

    resetProviderManager();
    const mockConfig = {
      setProviderManager(): void {},
      getEphemeralSettings() {
        return { authOnly: true };
      },
      getSettingsService() {
        return mockSettingsService;
      },
    } as unknown as Config;

    const { manager, oauthManager } = createProviderManager(activeContext, {
      config: mockConfig,
      allowBrowserEnvironment: false,
    });
    registerProviderManagerSingleton(manager, oauthManager);

    expect(openaiCtor).toHaveBeenCalled();
    const firstOpenaiCall = openaiCtor.mock.calls[0] as unknown[] | undefined;
    expect(firstOpenaiCall?.[0]).toBeUndefined();

    expect(openaiResponsesCtor).toHaveBeenCalled();
    const firstResponsesCall = openaiResponsesCtor.mock.calls[0] as
      | unknown[]
      | undefined;
    expect(firstResponsesCall?.[0]).toBeUndefined();

    expect(anthropicCtor).toHaveBeenCalled();
    const anthropicArgs = anthropicCtor.mock.calls[0] as unknown[] | undefined;
    expect(anthropicArgs?.[0]).toBeUndefined();
  });

  it('passes the shared OAuth manager into OpenAIVercelProvider', async () => {
    vi.doMock('./oauth-provider-registration.js', () => ({
      ensureOAuthProviderRegistered: ensureOAuthProviderRegisteredMock,
      isOAuthProviderRegistered: vi.fn(),
      resetRegisteredProviders: vi.fn(),
    }));

    const activeContext: Record<string, unknown> = { scope: 'test' };
    mockProviderModules({
      openai: openaiCtor,
      openaiResponses: openaiResponsesCtor,
      openaiVercel: openaivercelCtor,
      anthropic: anthropicCtor,
    });

    vi.clearAllMocks();

    const {
      createProviderManager,
      resetProviderManager,
      registerProviderManagerSingleton,
    } = await import('./providerManagerInstance.js');

    resetProviderManager();

    const { manager, oauthManager } = createProviderManager(activeContext, {
      config: undefined,
      allowBrowserEnvironment: false,
    });
    registerProviderManagerSingleton(manager, oauthManager);

    expect(openaivercelCtor).toHaveBeenCalled();
    const openaivercelArgs = openaivercelCtor.mock.calls[0] as
      | unknown[]
      | undefined;
    expect(openaivercelArgs?.[3]).toBeTruthy();
  });
});
