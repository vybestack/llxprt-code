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

import { afterEach, describe, it, expect, vi, beforeEach } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';

import { restoreGlobals } from '@vybestack/llxprt-code-test-utils';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { MockFileSystem } from './IFileSystem.js';
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
     * Behavioral tests for the unconfigured-provider architecture (#2481).
     *
     * These tests exercise REAL createProviderManager + ProviderManager instances
     * (no mock theater) to verify that an unconfigured start leaves no provider
     * active and issues no implicit requests.
     */

    /**
     * Builds a minimal Config stub sufficient for createProviderManager when the
     * `config` option is passed. Only the methods called by ProviderManager.setConfig
     * and the composition layer are provided.
     */

    describe('createProviderManager: unconfigured state (#2481)', () => {
      it('activates the provider from separately selected settings instead of the runtime settings', async () => {
        const settings = new SettingsService();
        settings.set('activeProvider', 'anthropic');
        const foreign = new SettingsService();
        foreign.set('activeProvider', 'openai');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings = settings;
        const selectedContext = runtime;
        const selectedConfig = undefined;
        const selectedAuthority = fallbackCredentials().authority;
        const manager = new ProviderManager(
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
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
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
          manager,
          selectedSettings,
        );
        managerReleases.push(() => oauthManager.dispose());
        transferredTokens = true;
        populateProviderManager(
          manager,
          oauthManager,
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
        try {
          expect(manager.getActiveProviderName()).toBe('anthropic');
          expect(foreign.get('activeProvider')).toBe('openai');
        } finally {
          manager.dispose();
          await oauthManager.dispose();
        }
      });

      beforeEach(() => {
        vi.restoreAllMocks();
      });

      afterEach(() => {
        restoreGlobals();
      });

      function buildUnconfiguredManager() {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings2 = settingsService;
        const selectedContext2 = runtime;
        const selectedConfig2 = undefined;
        const selectedAuthority2 = fallbackCredentials().authority;
        const manager = new ProviderManager(
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
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority2.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
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
          manager,
          selectedSettings2,
        );
        managerReleases.push(() => ownedOAuth2.dispose());
        transferredTokens2 = true;
        populateProviderManager(
          manager,
          ownedOAuth2,
          tokens2,
          selectedSettings2,
          new MockFileSystem(),
          selectedConfig2,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );
        return manager;
      }

      it('has no active provider when no config provider is set', () => {
        const manager = buildUnconfiguredManager();

        expect(manager.hasActiveProvider()).toBe(false);
        expect(manager.getActiveProviderName()).toBeUndefined();
      });

      it('still registers providers for explicit selection', () => {
        const manager = buildUnconfiguredManager();

        // Providers are registered (available for explicit selection) but none active.
        expect(manager.listProviders().length).toBeGreaterThan(0);
        expect(manager.hasActiveProvider()).toBe(false);
      });

      it('issues no network request while unconfigured', () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(new Response('{}', { status: 200 }));
        const savedFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        try {
          const manager = buildUnconfiguredManager();

          expect(manager.hasActiveProvider()).toBe(false);
          expect(manager.listProviders().length).toBeGreaterThan(0);
          expect(fetchMock).not.toHaveBeenCalled();
        } finally {
          globalThis.fetch = savedFetch;
        }
      });
    });

    describe('createProviderManager: explicit provider activation unchanged (#2481)', () => {
      beforeEach(() => {
        vi.restoreAllMocks();
      });

      it('activates openai when explicitly set via setActiveProvider after creation', () => {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings3 = settingsService;
        const selectedContext3 = runtime;
        const selectedConfig3 = undefined;
        const selectedAuthority3 = fallbackCredentials().authority;
        const manager = new ProviderManager(
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
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority3.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
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
          manager,
          selectedSettings3,
        );
        managerReleases.push(() => ownedOAuth3.dispose());
        transferredTokens3 = true;
        populateProviderManager(
          manager,
          ownedOAuth3,
          tokens3,
          selectedSettings3,
          new MockFileSystem(),
          selectedConfig3,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        // No provider should be active initially (#2481).
        expect(manager.hasActiveProvider()).toBe(false);

        // Explicit openai activation must still work.
        manager.setActiveProvider('openai');
        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      });

      it('auto-activates openai from explicit settingsService activeProvider (no manual setActiveProvider)', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'openai');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings4 = settingsService;
        const selectedContext4 = runtime;
        const selectedConfig4 = undefined;
        const selectedAuthority4 = fallbackCredentials().authority;
        const manager = new ProviderManager(
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
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority4.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens4 = selectedAuthority4.createTokenStore();
        let transferredTokens4 = false;
        const closeTokens4 = createOwnedTokenStoreClose(tokens4);
        managerReleases.push(() =>
          transferredTokens4 ? undefined : closeTokens4(),
        );
        const ownedOAuth4 = createOwnedOAuthManager(
          tokens4,
          undefined,
          undefined,
          selectedConfig4,
          manager,
          selectedSettings4,
        );
        managerReleases.push(() => ownedOAuth4.dispose());
        transferredTokens4 = true;
        populateProviderManager(
          manager,
          ownedOAuth4,
          tokens4,
          selectedSettings4,
          new MockFileSystem(),
          selectedConfig4,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        // When settingsService has activeProvider='openai',
        // createProviderManager must auto-activate it without needing a manual
        // setActiveProvider call (same path as CLI profile/env resolution).
        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      });
    });
  });
});
