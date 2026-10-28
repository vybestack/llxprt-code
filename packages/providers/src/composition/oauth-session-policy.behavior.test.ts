/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderManager } from '../ProviderManager.js';

import {
  createProviderPopulationTarget,
  populateProviderManager,
  createOwnedOAuthManager,
} from './providerManagerInstance.js';

import { createOwnedTokenStoreClose } from './index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { NodeFileSystem } from './IFileSystem.js';
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

    describe('Composed OAuth session policy', () => {
      it('reads browser policy live from each exact store while sharing static Config', async () => {
        const config = new Config({
          sessionId: 'same-label',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          model: 'test-model',
        });
        const firstStore = new SettingsService();
        const secondStore = new SettingsService();
        firstStore.set('auth.noBrowser', true);
        const options = {
          credentialAuthority: fallbackCredentials().authority,
          fileSystem: new NodeFileSystem(),
          activateConfiguredProvider: false,
        };
        const selectedSettings = firstStore;
        const selectedContext = { runtimeId: 'same-label' };
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
        managerReleases.push(() => ownedManager.dispose());
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
        populateProviderManager({
          target: createProviderPopulationTarget(
            ownedManager,
            ownedOAuth,
            tokens,
          ),
          readSetting: (key) => selectedSettings.get(key),
          fileSystem: options.fileSystem,
          configuration: { kind: 'pre-config' },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: options.activateConfiguredProvider,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });
        const selectedSettings2 = secondStore;
        const selectedContext2 = { runtimeId: 'same-label' };
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
        managerReleases.push(() => ownedManager2.dispose());
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
          fileSystem: options.fileSystem,
          configuration: { kind: 'pre-config' },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: false,
          activateConfiguredProvider: options.activateConfiguredProvider,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });
        try {
          expect([
            ownedOAuth.isBrowserDisabled(),
            ownedOAuth2.isBrowserDisabled(),
          ]).toStrictEqual([true, false]);
          firstStore.set('auth.noBrowser', false);
          secondStore.set('auth.noBrowser', true);
          expect([
            ownedOAuth.isBrowserDisabled(),
            ownedOAuth2.isBrowserDisabled(),
          ]).toStrictEqual([false, true]);
        } finally {
          ownedManager.dispose();
          ownedManager2.dispose();
          await config.dispose();
        }
      });
    });
  });
});
