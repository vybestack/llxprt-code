/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderManager } from '../ProviderManager.js';

import {
  createProviderPopulationTarget,
  populateProviderManager,
  createOwnedOAuthManager,
} from './providerManagerInstance.js';

import { createOwnedTokenStoreClose } from './index.js';

import { afterEach, describe, it, expect, vi, mock } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import { NodeFileSystem } from './IFileSystem.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { type Config } from '@vybestack/llxprt-code-core';
describe('explicit provider primitive owners', () => {
  const fallbackCredentials = useOwnedCredentials();
  describe('provider behavior', () => {
    const managerReleases: Array<() => void | Promise<void>> = [];

    afterEach(async () => {
      const failures: unknown[] = [];
      for (const release of managerReleases.splice(0).reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Provider owner cleanup failed');
    });

    /**
     * @plan:PLAN-20260603-ISSUE1584.P12
     * @requirement:REQ-API-001
     * @pseudocode consumer-migration.md lines 10-15
     */

    // This test tests provider registration behavior, needs real providerAliases

    // Shared mutable mock state — Bun cannot reset modules between tests, so the
    // mock factories use wrapper functions that read mutable variables at call
    // time. Each test updates these variables before running its assertions.
    let openaiCtorState: new (...args: unknown[]) => unknown = class {};

    let openaiResponsesCtorState: new (...args: unknown[]) => unknown =
      class {};

    let openaiVercelCtorState: new (...args: unknown[]) => unknown = class {};

    let anthropicCtorState: new (...args: unknown[]) => unknown = class {};

    // Wrapper constructors so each test can swap the target without needing
    // vi.resetModules (unsupported in Bun).
    function makeWrapper(
      get: () => new (...args: unknown[]) => unknown,
    ): new (...args: unknown[]) => unknown {
      return class {
        constructor(...args: unknown[]) {
          const instance = Reflect.construct(get(), args, new.target);
          if (typeof instance !== 'object' || instance === null)
            throw new Error('Provider constructor did not create an instance');
          return instance;
        }
      };
    }

    void mock.module('../ProviderManager.js', () => {
      class MockProviderManager {
        peekProviderKeyStorage(): undefined {
          return undefined;
        }
        bindProviderKeyStorage(): void {}
        setRetryOperationsFactory(): void {}
        setConfig(): void {}
        setActiveProvider(): void {}
        registerProvider(): void {}
        registerAliasRefresher(): void {}
      }
      return { ProviderManager: MockProviderManager };
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
      ) =>
        registerStandardOAuthProvidersState(oauthManager, tokenStore, addItem),
      isOAuthProviderRegistered: (...args: unknown[]) =>
        isOAuthProviderRegisteredState(...args),
    }));

    // Mutable state for the oauth-provider-registration mock
    let ensureOAuthProviderRegisteredState: (
      ...args: unknown[]
    ) => void = () => {};

    let registerStandardOAuthProvidersState: (
      oauthManager: unknown,
      tokenStore?: unknown,
      addItem?: unknown,
    ) => void = () => {};

    let isOAuthProviderRegisteredState: (...args: unknown[]) => boolean = () =>
      false;

    function createRegisterStandardOAuthProvidersMock(
      ensureMock: ReturnType<typeof vi.fn>,
    ): (
      oauthManager: unknown,
      tokenStore?: unknown,
      addItem?: unknown,
    ) => void {
      return (oauthManager, tokenStore, addItem) => {
        for (const provider of ['gemini', 'claudecode', 'codex'] as const) {
          ensureMock(provider, oauthManager, tokenStore, addItem);
        }
      };
    }

    /**
     * Collects the API keys a provider constructor received across EVERY alias it
     * was used for. Asserting on a single call would only cover whichever alias
     * happened to be registered first, and alias registration order follows
     * `fs.readdirSync` of the alias directory, which differs per filesystem.
     */
    function apiKeysPassedTo(ctor: ReturnType<typeof vi.fn>): unknown[] {
      return ctor.mock.calls
        .map((call) => (call as unknown[])[0])
        .filter((apiKey) => apiKey !== undefined);
    }

    describe('claudecode OAuth registration with environment key', () => {
      afterEach(() => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        vi.clearAllMocks();
      });

      it('registers claudecode OAuth provider even when ANTHROPIC_API_KEY is set', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-test-key';

        const ensureOAuthProviderRegisteredMock = vi.fn();
        const anthropicCtor = vi.fn((..._args: unknown[]) => ({}));

        // Wire mutable state for this test
        ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
        registerStandardOAuthProvidersState =
          createRegisterStandardOAuthProvidersMock(
            ensureOAuthProviderRegisteredMock,
          );
        isOAuthProviderRegisteredState = vi.fn();
        openaiCtorState = class {} as new (...args: unknown[]) => unknown;
        openaiResponsesCtorState = class {} as new (
          ...args: unknown[]
        ) => unknown;
        anthropicCtorState = class {
          constructor(...args: unknown[]) {
            return anthropicCtor(...args);
          }
        };

        const mockSettingsService = new SettingsService();
        const activeContext = {
          settingsService: mockSettingsService,
          metadata: { scope: 'test' },
        };

        const selectedSettings = activeContext.settingsService;
        const selectedContext = activeContext;
        const selectedConfig = undefined;
        const selectedAuthority = fallbackCredentials().authority;
        const ownedManager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings,
          selectedConfig,
          selectedContext,
          undefined,
          undefined,
        );

        if (ownedManager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          ownedManager.bindProviderKeyStorage(keys);
        }
        const tokens = selectedAuthority.createTokenStore();
        let transferredTokens = false;
        const closeTokens = createOwnedTokenStoreClose(tokens);
        managerReleases.push(() =>
          transferredTokens ? undefined : closeTokens(),
        );
        const oauthManager = createOwnedOAuthManager(
          tokens,
          undefined,
          undefined,
          selectedConfig,
          ownedManager,
          selectedSettings,
        );
        managerReleases.push(() => oauthManager.dispose());
        transferredTokens = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            ownedManager,
            oauthManager,
            tokens,
          ),
          readSetting: (key) => selectedSettings.get(key),
          fileSystem: new NodeFileSystem(),
          configuration: { kind: 'pre-config' },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

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
          (call) => call[3] !== undefined,
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
        const anthropicCtor = vi.fn((..._args: unknown[]) => ({}));

        // Wire mutable state for this test
        ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
        registerStandardOAuthProvidersState =
          createRegisterStandardOAuthProvidersMock(
            ensureOAuthProviderRegisteredMock,
          );
        isOAuthProviderRegisteredState = vi.fn();
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
        mockSettingsService.set('authOnly', true);
        const activeContext = {
          settingsService: mockSettingsService,
          metadata: { scope: 'test' },
        };

        const mockConfig = {
          getEphemeralSettings() {
            return { authOnly: true };
          },
          getSettingsService() {
            return mockSettingsService;
          },
        } as unknown as Config;

        const selectedSettings2 = activeContext.settingsService;
        const selectedContext2 = activeContext;
        const selectedConfig2 = mockConfig;
        const selectedAuthority2 = fallbackCredentials().authority;
        const ownedManager2 = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings2,
          selectedConfig2,
          selectedContext2,
          undefined,
          undefined,
        );

        if (ownedManager2.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority2.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          ownedManager2.bindProviderKeyStorage(keys);
        }
        const tokens2 = selectedAuthority2.createTokenStore();
        let transferredTokens2 = false;
        const closeTokens2 = createOwnedTokenStoreClose(tokens2);
        managerReleases.push(() =>
          transferredTokens2 ? undefined : closeTokens2(),
        );
        const ownedOAuth2 = createOwnedOAuthManager(
          tokens2,
          undefined,
          undefined,
          selectedConfig2,
          ownedManager2,
          selectedSettings2,
        );
        managerReleases.push(() => ownedOAuth2.dispose());
        transferredTokens2 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            ownedManager2,
            ownedOAuth2,
            tokens2,
          ),
          readSetting: (key) => selectedSettings2.get(key),
          fileSystem: new NodeFileSystem(),
          configuration: { kind: 'configured', config: selectedConfig2 },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

        // No alias may receive an API key while authOnly is on — not the alias
        // that happens to be registered first, and not the ones that declare
        // their own `apiKeyEnv` (openai, openai-responses, openai-vercel). The
        // gemini family moved to the google-gemini plugin (#2763).
        expect(openaiCtor).toHaveBeenCalled();
        expect(apiKeysPassedTo(openaiCtor)).toStrictEqual([]);

        expect(openaiResponsesCtor).toHaveBeenCalled();
        expect(apiKeysPassedTo(openaiResponsesCtor)).toStrictEqual([]);

        expect(openaivercelCtor).toHaveBeenCalled();
        expect(apiKeysPassedTo(openaivercelCtor)).toStrictEqual([]);

        expect(anthropicCtor).toHaveBeenCalled();
        expect(apiKeysPassedTo(anthropicCtor)).toStrictEqual([]);
      });

      it('still binds alias environment keys when authOnly is disabled', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-test-key';

        const ensureOAuthProviderRegisteredMock = vi.fn();
        const anthropicCtor = vi.fn((..._args: unknown[]) => ({}));

        // Wire mutable state for this test
        ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
        registerStandardOAuthProvidersState =
          createRegisterStandardOAuthProvidersMock(
            ensureOAuthProviderRegisteredMock,
          );
        isOAuthProviderRegisteredState = vi.fn();
        openaiCtorState = class {} as new (...args: unknown[]) => unknown;
        openaiResponsesCtorState = class {} as new (
          ...args: unknown[]
        ) => unknown;
        openaiVercelCtorState = class {} as new (...args: unknown[]) => unknown;
        anthropicCtorState = anthropicCtor as unknown as new (
          ...args: unknown[]
        ) => unknown;

        const mockSettingsService = new SettingsService();
        const activeContext = {
          settingsService: mockSettingsService,
          metadata: { scope: 'test' },
        };

        const mockConfig = {
          getEphemeralSettings() {
            return {};
          },
          getSettingsService() {
            return mockSettingsService;
          },
        } as unknown as Config;

        const selectedSettings3 = activeContext.settingsService;
        const selectedContext3 = activeContext;
        const selectedConfig3 = mockConfig;
        const selectedAuthority3 = fallbackCredentials().authority;
        const ownedManager3 = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings3,
          selectedConfig3,
          selectedContext3,
          undefined,
          undefined,
        );

        if (ownedManager3.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority3.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          ownedManager3.bindProviderKeyStorage(keys);
        }
        const tokens3 = selectedAuthority3.createTokenStore();
        let transferredTokens3 = false;
        const closeTokens3 = createOwnedTokenStoreClose(tokens3);
        managerReleases.push(() =>
          transferredTokens3 ? undefined : closeTokens3(),
        );
        const ownedOAuth3 = createOwnedOAuthManager(
          tokens3,
          undefined,
          undefined,
          selectedConfig3,
          ownedManager3,
          selectedSettings3,
        );
        managerReleases.push(() => ownedOAuth3.dispose());
        transferredTokens3 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            ownedManager3,
            ownedOAuth3,
            tokens3,
          ),
          readSetting: (key) => selectedSettings3.get(key),
          fileSystem: new NodeFileSystem(),
          configuration: { kind: 'configured', config: selectedConfig3 },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

        // Without authOnly, an alias still receives the key its own `apiKeyEnv`
        // names. The family below resolves its key ONLY from that alias-level
        // environment read — it does not fall back to the shared OpenAI key — so
        // this fails if the authOnly gate is applied unconditionally. (The gemini
        // family moved to the google-gemini plugin, #2763.)
        expect(apiKeysPassedTo(anthropicCtor)).toContain('sk-test-key');
      });

      it('threads OAuth manager only into OAuth-capable alias providers', async () => {
        const ensureOAuthProviderRegisteredMock = vi.fn();
        const openaiCtor = vi.fn(() => ({}));
        const openaiResponsesCtor = vi.fn(() => ({}));
        const openaivercelCtor = vi.fn(() => ({}));
        const anthropicCtor = vi.fn((..._args: unknown[]) => ({}));

        // Wire mutable state for this test
        ensureOAuthProviderRegisteredState = ensureOAuthProviderRegisteredMock;
        registerStandardOAuthProvidersState =
          createRegisterStandardOAuthProvidersMock(
            ensureOAuthProviderRegisteredMock,
          );
        isOAuthProviderRegisteredState = vi.fn();
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

        const selectedSettings4 = activeContext.settingsService;
        const selectedContext4 = activeContext;
        const selectedConfig4 = undefined;
        const selectedAuthority4 = fallbackCredentials().authority;
        const ownedManager4 = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings4,
          selectedConfig4,
          selectedContext4,
          undefined,
          undefined,
        );

        if (ownedManager4.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority4.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          ownedManager4.bindProviderKeyStorage(keys);
        }
        const tokens4 = selectedAuthority4.createTokenStore();
        let transferredTokens4 = false;
        const closeTokens4 = createOwnedTokenStoreClose(tokens4);
        managerReleases.push(() =>
          transferredTokens4 ? undefined : closeTokens4(),
        );
        const oauthManager = createOwnedOAuthManager(
          tokens4,
          undefined,
          undefined,
          selectedConfig4,
          ownedManager4,
          selectedSettings4,
        );
        managerReleases.push(() => oauthManager.dispose());
        transferredTokens4 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            ownedManager4,
            oauthManager,
            tokens4,
          ),
          readSetting: (key) => selectedSettings4.get(key),
          fileSystem: new NodeFileSystem(),
          configuration: { kind: 'pre-config' },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

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

        expect(openaiArgs).toHaveLength(4);
        expect(openaivercelArgs).toHaveLength(3);
        expect(openaiResponsesArgs?.[3]).toBe(oauthManager);
        expect(Array.isArray(openaiResponsesArgs?.[4])).toBe(true);
      });
    });
  });
});
