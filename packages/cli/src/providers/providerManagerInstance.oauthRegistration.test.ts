/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';

// This test tests provider registration behavior, needs real providerAliases
vi.unmock('./providerAliases.js');

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

    vi.doMock('@vybestack/llxprt-code-core', async () => {
      const actual = await vi.importActual<
        typeof import('@vybestack/llxprt-code-core')
      >('@vybestack/llxprt-code-core');

      class MockProviderManager {
        setConfig(): void {}
        setActiveProvider(): void {}
        registerProvider(): void {}
      }

      class MockGeminiProvider {
        setConfig(): void {}
      }

      class MockProvider {}

      return {
        ...actual,
        ProviderManager: MockProviderManager,
        GeminiProvider: MockGeminiProvider,
        OpenAIProvider: MockProvider,
        OpenAIResponsesProvider: MockProvider,
        OpenAIVercelProvider: openaivercelCtor,
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

    const ctorCalls = anthropicCtor.mock.calls;
    expect(ctorCalls).toHaveLength(1);
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

    vi.doMock('@vybestack/llxprt-code-core', async () => {
      const actual = await vi.importActual<
        typeof import('@vybestack/llxprt-code-core')
      >('@vybestack/llxprt-code-core');

      class MockProviderManager {
        setConfig(): void {}
        setActiveProvider(): void {}
        registerProvider(): void {}
      }

      class MockGeminiProvider {
        setConfig(): void {}
      }

      return {
        ...actual,
        ProviderManager: MockProviderManager,
        GeminiProvider: MockGeminiProvider,
        OpenAIProvider: openaiCtor as unknown as typeof actual.OpenAIProvider,
        OpenAIResponsesProvider:
          openaiResponsesCtor as unknown as typeof actual.OpenAIResponsesProvider,
        OpenAIVercelProvider:
          openaivercelCtor as unknown as typeof actual.OpenAIVercelProvider,
        AnthropicProvider:
          anthropicCtor as unknown as typeof actual.AnthropicProvider,
      };
    });

    const { getProviderManager, resetProviderManager } = await import(
      './providerManagerInstance.js'
    );

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

    getProviderManager(mockConfig, false, undefined);

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

    vi.doMock('@vybestack/llxprt-code-core', async () => {
      const actual = await vi.importActual<
        typeof import('@vybestack/llxprt-code-core')
      >('@vybestack/llxprt-code-core');

      class MockProviderManager {
        setConfig(): void {}
        setActiveProvider(): void {}
        registerProvider(): void {}
      }

      class MockGeminiProvider {
        setConfig(): void {}
      }

      return {
        ...actual,
        ProviderManager: MockProviderManager,
        GeminiProvider: MockGeminiProvider,
        OpenAIProvider: openaiCtor as unknown as typeof actual.OpenAIProvider,
        OpenAIResponsesProvider:
          openaiResponsesCtor as unknown as typeof actual.OpenAIResponsesProvider,
        OpenAIVercelProvider:
          openaivercelCtor as unknown as typeof actual.OpenAIVercelProvider,
        AnthropicProvider:
          anthropicCtor as unknown as typeof actual.AnthropicProvider,
      };
    });

    const { getProviderManager, resetProviderManager } = await import(
      './providerManagerInstance.js'
    );

    resetProviderManager();
    getProviderManager(undefined, false, undefined);

    expect(openaivercelCtor).toHaveBeenCalled();
    const openaivercelArgs = openaivercelCtor.mock.calls[0] as
      | unknown[]
      | undefined;
    expect(openaivercelArgs?.[3]).toBeTruthy();
  });
});
