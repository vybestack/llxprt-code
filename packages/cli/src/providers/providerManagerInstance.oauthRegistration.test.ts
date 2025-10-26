/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Anthropic OAuth registration with environment key', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registers Anthropic OAuth provider even when ANTHROPIC_API_KEY is set', async () => {
    const ensureOAuthProviderRegisteredMock = vi.fn();

    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    vi.doMock('./oauth-provider-registration.js', () => ({
      ensureOAuthProviderRegistered: ensureOAuthProviderRegisteredMock,
      isOAuthProviderRegistered: vi.fn(),
      resetRegisteredProviders: vi.fn(),
    }));

    const anthropicCtor = vi.fn(() => ({}) as unknown);

    vi.doMock('@vybestack/llxprt-code-core', async () => {
      const actual = await vi.importActual<
        typeof import('@vybestack/llxprt-code-core')
      >('@vybestack/llxprt-code-core');

      class MockProviderManager {
        setConfig() {}
        setActiveProvider() {}
        registerProvider() {}
      }

      class MockGeminiProvider {
        setConfig() {}
      }

      class MockConfig {
        setProviderManager() {}
        getEphemeralSettings() {
          return {};
        }
      }

      class MockProvider {}

      return {
        ...actual,
        ProviderManager: MockProviderManager,
        Config: MockConfig,
        GeminiProvider: MockGeminiProvider,
        OpenAIProvider: MockProvider,
        OpenAIResponsesProvider: MockProvider,
        AnthropicProvider: anthropicCtor,
      };
    });

    const { getProviderManager, resetProviderManager } = await import(
      './providerManagerInstance.js'
    );

    resetProviderManager();
    getProviderManager(undefined, false, undefined);

    const registeredAnthropic =
      ensureOAuthProviderRegisteredMock.mock.calls.some(
        ([provider]) => provider === 'anthropic',
      );
    expect(registeredAnthropic).toBe(true);

    // Ensure anthropic provider constructor received oauthManager even when API key exists
    const ctorCalls = anthropicCtor.mock.calls;
    expect(ctorCalls).toHaveLength(1);
    const firstCall = ctorCalls[0] as unknown[] | undefined;
    const oauthManagerArg = firstCall ? firstCall[3] : undefined;
    expect(oauthManagerArg).toBeTruthy();
  });
});
