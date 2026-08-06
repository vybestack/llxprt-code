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

import { describe, it, expect, vi, afterEach, mock } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core';

// This test tests provider registration behavior, needs real providerAliases

// Shared mutable mock state — Bun cannot reset modules between tests, so the
// mock factories use wrapper functions that read mutable variables at call
// time. Each test updates these variables before running its assertions.
let openaiCtorState: new (...args: unknown[]) => unknown = class {};
let openaiResponsesCtorState: new (...args: unknown[]) => unknown = class {};
let openaiVercelCtorState: new (...args: unknown[]) => unknown = class {};
let anthropicCtorState: new (...args: unknown[]) => unknown = class {};

// Wrapper constructors so each test can swap the target without needing
// vi.resetModules (unsupported in Bun).
function makeWrapper(
  get: () => new (...args: unknown[]) => unknown,
): new (...args: unknown[]) => unknown {
  return function (...args: unknown[]) {
    return Reflect.construct(get(), args, new.target);
  };
}

void mock.module('../ProviderManager.js', () => {
  class MockProviderManager {
    setConfig(): void {}
    setActiveProvider(): void {}
    registerProvider(): void {}
  }
  return { ProviderManager: MockProviderManager };
});
void mock.module('../gemini/GeminiProvider.js', () => {
  class MockGeminiProvider {
    setConfig(): void {}
  }
  return { GeminiProvider: MockGeminiProvider };
});
void mock.module('../openai/OpenAIProvider.js', () => ({
  OpenAIProvider: makeWrapper(() => openaiCtorState),
}));
void mock.module('../openai-responses/OpenAIResponsesProvider.js', () => ({
  OpenAIResponsesProvider: makeWrapper(() => openaiResponsesCtorState),
}));
void mock.module('../openai-vercel/index.js', () => ({
  OpenAIVercelProvider: makeWrapper(() => openaiVercelCtorState),
}));
void mock.module('../anthropic/AnthropicProvider.js', () => ({
  AnthropicProvider: makeWrapper(() => anthropicCtorState),
}));
void mock.module('./oauth-provider-registration.js', () => ({
  ensureOAuthProviderRegistered: (...args: unknown[]) =>
    ensureOAuthProviderRegisteredState(...args),
  registerStandardOAuthProviders: (
    oauthManager: unknown,
    tokenStore?: unknown,
    addItem?: unknown,
  ) => registerStandardOAuthProvidersState(oauthManager, tokenStore, addItem),
  isOAuthProviderRegistered: (...args: unknown[]) =>
    isOAuthProviderRegisteredState(...args),
  resetRegisteredProviders: (...args: unknown[]) =>
    resetRegisteredProvidersState(...args),
}));

// Mutable state for the oauth-provider-registration mock
let ensureOAuthProviderRegisteredState: (...args: unknown[]) => void = () => {};
let registerStandardOAuthProvidersState: (
  oauthManager: unknown,
  tokenStore?: unknown,
  addItem?: unknown,
) => void = () => {};
let isOAuthProviderRegisteredState: (...args: unknown[]) => boolean = () =>
  false;
let resetRegisteredProvidersState: (...args: unknown[]) => void = () => {};

function createRegisterStandardOAuthProvidersMock(
  ensureMock: ReturnType<typeof vi.fn>,
): (oauthManager: unknown, tokenStore?: unknown, addItem?: unknown) => void {
  return (oauthManager, tokenStore, addItem) => {
    for (const provider of ['gemini', 'claudecode', 'codex'] as const) {
      ensureMock(provider, oauthManager, tokenStore, addItem);
    }
  };
}

describe('claudecode OAuth registration with environment key', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.clearAllMocks();
  });

  it('registers claudecode OAuth provider even when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const ensureOAuthProviderRegisteredMock = vi.fn();
    const anthropicCtor = vi.fn(() => ({}));

    // Wire mutable state for this test
    ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
    registerStandardOAuthProvidersState =
      createRegisterStandardOAuthProvidersMock(
        ensureOAuthProviderRegisteredMock,
      );
    isOAuthProviderRegisteredState = vi.fn();
    resetRegisteredProvidersState = vi.fn();
    openaiCtorState = class {} as new (...args: unknown[]) => unknown;
    openaiResponsesCtorState = class {} as new (...args: unknown[]) => unknown;
    anthropicCtorState = anthropicCtor;

    const mockSettingsService = new SettingsService();
    const activeContext = {
      settingsService: mockSettingsService,
      metadata: { scope: 'test' },
    };

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

    const registeredClaudecode =
      ensureOAuthProviderRegisteredMock.mock.calls.some(
        ([provider]) => provider === 'claudecode',
      );
    expect(registeredClaudecode).toBe(true);

    const ctorCalls = anthropicCtor.mock.calls;
    expect(ctorCalls.length).toBeGreaterThanOrEqual(1);
    // Exactly one AnthropicProvider constructor call receives the OAuth
    // manager (the claudecode alias); the API-key-only anthropic alias does
    // not. The primary behavioral A7 proof remains the real alias test.
    const callsWithOAuthManager = ctorCalls.filter(
      (call) => (call as unknown[])[3] !== undefined,
    );
    expect(callsWithOAuthManager).toHaveLength(1);
    expect(callsWithOAuthManager[0]?.[3]).toBe(oauthManager);
  });

  it('ignores API keys when authOnly is enabled', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.OPENAI_API_KEY = 'sk-test-openai';

    const ensureOAuthProviderRegisteredMock = vi.fn();
    const openaiCtor = vi.fn(() => ({}));
    const openaiResponsesCtor = vi.fn(() => ({}));
    const openaivercelCtor = vi.fn(() => ({}));
    const anthropicCtor = vi.fn(() => ({}));

    // Wire mutable state for this test
    ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
    registerStandardOAuthProvidersState =
      createRegisterStandardOAuthProvidersMock(
        ensureOAuthProviderRegisteredMock,
      );
    isOAuthProviderRegisteredState = vi.fn();
    resetRegisteredProvidersState = vi.fn();
    openaiCtorState = openaiCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    openaiResponsesCtorState = openaiResponsesCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    openaiVercelCtorState = openaivercelCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    anthropicCtorState = anthropicCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;

    const mockSettingsService = new SettingsService();
    const activeContext = {
      settingsService: mockSettingsService,
      metadata: { scope: 'test' },
    };

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

  it('threads OAuth manager only into OAuth-capable alias providers', async () => {
    const ensureOAuthProviderRegisteredMock = vi.fn();
    const openaiCtor = vi.fn(() => ({}));
    const openaiResponsesCtor = vi.fn(() => ({}));
    const openaivercelCtor = vi.fn(() => ({}));
    const anthropicCtor = vi.fn(() => ({}));

    // Wire mutable state for this test
    ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
    registerStandardOAuthProvidersState =
      createRegisterStandardOAuthProvidersMock(
        ensureOAuthProviderRegisteredMock,
      );
    isOAuthProviderRegisteredState = vi.fn();
    resetRegisteredProvidersState = vi.fn();
    openaiCtorState = openaiCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    openaiResponsesCtorState = openaiResponsesCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    openaiVercelCtorState = openaivercelCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;
    anthropicCtorState = anthropicCtor as unknown as new (
      ...args: unknown[]
    ) => unknown;

    const mockSettingsService = new SettingsService();
    const activeContext = {
      settingsService: mockSettingsService,
      metadata: { scope: 'test' },
    };

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

    expect(openaiCtor).toHaveBeenCalled();
    expect(openaivercelCtor).toHaveBeenCalled();
    expect(openaiResponsesCtor).toHaveBeenCalled();

    const openaiArgs = openaiCtor.mock.calls[0] as unknown[] | undefined;
    const openaivercelArgs = openaivercelCtor.mock.calls[0] as
      | unknown[]
      | undefined;
    const openaiResponsesArgs = openaiResponsesCtor.mock.calls[0] as
      | unknown[]
      | undefined;

    expect(openaiArgs).toHaveLength(3);
    expect(openaivercelArgs).toHaveLength(3);
    expect(openaiResponsesArgs?.[3]).toBe(oauthManager);
  });
});
