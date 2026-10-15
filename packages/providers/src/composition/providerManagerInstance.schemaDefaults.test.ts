/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderManager } from '../ProviderManager.js';

import {
  populateProviderManager,
  createOwnedOAuthManager,
} from './providerManagerInstance.js';

import { createOwnedTokenStoreClose } from './index.js';

import { afterEach, describe, it, expect, vi, mock } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';
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
     * Regression coverage for issue #2033 Phase 2 relocation.
     *
     * Before the relocation, `providerManagerInstance` read provider settings from
     * the CLI's merged-settings view (`LoadedSettings.merged`), which layered the
     * SETTINGS_SCHEMA defaults on top of the raw user file. After the relocation
     * the composition self-loads the RAW user settings file directly. These tests
     * pin the behavior-preserving requirement that, when a settings field is absent
     * from the user file, the OpenAI provider still receives the schema default
     * (enableTextToolCallParsing=false, textToolCallModels=[],
     * providerToolFormatOverrides={}, openaiResponsesEnabled=false) rather than
     * `undefined`.
     */

    // Self-load reads run through strip-json-comments; keep them passthrough.
    void vi.mock('strip-json-comments', () => ({
      default: (content: string) => content,
    }));

    // Shared mutable mock state — Bun cannot reset modules between tests, so the
    // mock factories use wrapper functions that read mutable variables at call
    // time. Each test updates these variables before running its assertions.
    let openaiCtorState: new (...args: unknown[]) => unknown = class {};

    function makeWrapper(
      get: () => new (...args: unknown[]) => unknown,
    ): new (...args: unknown[]) => unknown {
      return function (...args: unknown[]) {
        return Reflect.construct(get(), args, new.target);
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
      OpenAIResponsesProvider: class {},
    }));

    void mock.module('../openai-vercel/index.js', () => ({
      OpenAIVercelProvider: class {},
    }));

    void mock.module('../anthropic/AnthropicProvider.js', () => ({
      AnthropicProvider: class {},
    }));

    void mock.module('./oauth-provider-registration.js', () => ({
      ensureOAuthProviderRegistered: vi.fn(),
      registerStandardOAuthProviders: vi.fn(),
      isOAuthProviderRegistered: vi.fn(),
    }));

    describe('providerManagerInstance schema-default behavior (issue #2033)', () => {
      afterEach(() => {
        delete process.env.OPENAI_API_KEY;
        vi.clearAllMocks();
      });

      it('supplies SETTINGS_SCHEMA defaults to OpenAIProvider when the user settings file is absent', async () => {
        const openaiCtor = vi.fn(() => ({}));
        openaiCtorState = openaiCtor as unknown as new (
          ...args: unknown[]
        ) => unknown;

        const { MockFileSystem } = await import('./IFileSystem.js');

        // Empty mock file system => no user settings file on disk.

        const activeContext = {
          settingsService: new SettingsService(),
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
        const ownedOAuth = createOwnedOAuthManager(
          tokens,
          undefined,
          undefined,
          selectedConfig,
          ownedManager,
          selectedSettings,
        );
        managerReleases.push(() => ownedOAuth.dispose());
        transferredTokens = true;
        populateProviderManager(
          ownedManager,
          ownedOAuth,
          tokens,
          selectedSettings,
          new MockFileSystem(),
          selectedConfig,
          undefined,
          undefined,
          false,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        expect(openaiCtor).toHaveBeenCalled();
        const ctorArgs = openaiCtor.mock.calls[0] as unknown[];
        // new OpenAIProvider(apiKey, baseUrl, providerConfig, oauthManager)
        const providerConfig = ctorArgs[2] as Record<string, unknown>;

        expect(providerConfig.enableTextToolCallParsing).toBe(false);
        expect(providerConfig.textToolCallModels).toStrictEqual([]);
        expect(providerConfig.providerToolFormatOverrides).toStrictEqual({});
        expect(providerConfig.openaiResponsesEnabled).toBe(false);
      });

      it('honors explicit user-file values over the schema defaults', async () => {
        const openaiCtor = vi.fn(() => ({}));
        openaiCtorState = openaiCtor as unknown as new (
          ...args: unknown[]
        ) => unknown;

        const { MockFileSystem } = await import('./IFileSystem.js');

        const { Storage } = await import('@vybestack/llxprt-code-settings');

        const fs = new MockFileSystem();
        fs.setMockFile(
          Storage.getGlobalSettingsPath(),
          JSON.stringify({
            enableTextToolCallParsing: true,
            textToolCallModels: ['some-model'],
            providerToolFormatOverrides: { openai: 'hermes' },
            openaiResponsesEnabled: true,
          }),
        );

        const activeContext = {
          settingsService: new SettingsService(),
          metadata: { scope: 'test' },
        };
        const selectedSettings2 = activeContext.settingsService;
        const selectedContext2 = activeContext;
        const selectedConfig2 = undefined;
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
        populateProviderManager(
          ownedManager2,
          ownedOAuth2,
          tokens2,
          selectedSettings2,
          fs,
          selectedConfig2,
          undefined,
          undefined,
          false,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        expect(openaiCtor).toHaveBeenCalled();
        const ctorArgs = openaiCtor.mock.calls[0] as unknown[];
        const providerConfig = ctorArgs[2] as Record<string, unknown>;

        expect(providerConfig.enableTextToolCallParsing).toBe(true);
        expect(providerConfig.textToolCallModels).toStrictEqual(['some-model']);
        expect(providerConfig.providerToolFormatOverrides).toStrictEqual({
          openai: 'hermes',
        });
        expect(providerConfig.openaiResponsesEnabled).toBe(true);
      });
    });
  });
});
