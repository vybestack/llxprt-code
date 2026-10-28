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

import { createOwnedTokenStoreClose, type IProvider } from './index.js';

import { afterEach, describe, it, expect } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import { NodeFileSystem } from './IFileSystem.js';

import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';

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

    function createManager() {
      const settingsService = new SettingsService();
      const runtime = createProviderRuntimeContext({});
      const selectedSettings = settingsService;
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
      const ownedOAuth = createOwnedOAuthManager(
        tokens,
        undefined,
        undefined,
        selectedConfig,
        manager,
        selectedSettings,
      );
      managerReleases.push(() => ownedOAuth.dispose());
      transferredTokens = true;
      populateProviderManager({
        target: createProviderPopulationTarget(manager, ownedOAuth, tokens),
        readSetting: (key) => selectedSettings.get(key),
        fileSystem: new NodeFileSystem(),
        configuration: { kind: 'pre-config' },
        contributions: { kind: 'none' },
        messages: { kind: 'none' },
        allowBrowser: true,
        activateConfiguredProvider: true,
        fakeResponses:
          process.env.LLXPRT_FAKE_RESPONSES === undefined
            ? { kind: 'disabled' }
            : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
      });
      return manager;
    }

    function createMockProvider(name: string): IProvider {
      return {
        name,
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: `${name}-response` }],
          };
        },
        getDefaultModel() {
          return `${name}-model`;
        },
      };
    }

    describe('Provider Switching Integration', () => {
      it('supports switching between providers and back to Gemini', () => {
        const manager = createManager();

        manager.clearActiveProvider();
        expect(manager.hasActiveProvider()).toBe(false);

        manager.registerProvider(createMockProvider('test-provider'));
        manager.setActiveProvider('test-provider');
        expect(manager.getActiveProviderName()).toBe('test-provider');

        manager.clearActiveProvider();
        expect(manager.hasActiveProvider()).toBe(false);
        expect(manager.getActiveProviderName()).toBeUndefined();
      });

      it('maintains custom providers in list without auto-registering gemini', () => {
        const manager = createManager();

        manager.registerProvider(createMockProvider('provider1'));
        manager.registerProvider(createMockProvider('provider2'));

        const providers = manager.listProviders();
        expect(providers).toContain('provider1');
        expect(providers).toContain('provider2');
        const customProviders = providers.filter((name) =>
          name.startsWith('provider'),
        );
        expect(customProviders).toStrictEqual(['provider1', 'provider2']);

        manager.setActiveProvider('provider1');
        expect(manager.getActiveProviderName()).toBe('provider1');

        manager.clearActiveProvider();
        expect(manager.hasActiveProvider()).toBe(false);
      });
    });
  });
});
