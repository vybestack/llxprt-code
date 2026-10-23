/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderManager } from '../ProviderManager.js';

import {
  populateProviderManager,
  createOwnedOAuthManager,
} from './providerManagerInstance.js';

import { createOwnedTokenStoreClose } from './index.js';

import { afterEach, describe, expect, it } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';

import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';

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

    describe('provider manager filesystem ownership', () => {
      it('keeps settings isolated across same-label owners when one owner is disposed', async () => {
        const firstSettings = new SettingsService();
        const secondSettings = new SettingsService();
        const firstConfig = new Config({
          sessionId: 'shared-provider-label',
          cwd: process.cwd(),
          targetDir: process.cwd(),
          debugMode: false,
          model: 'test-model',
        });
        const secondConfig = new Config({
          sessionId: 'shared-provider-label',
          cwd: process.cwd(),
          targetDir: process.cwd(),
          debugMode: false,
          model: 'test-model',
        });
        const firstFiles = new MockFileSystem();
        const secondFiles = new MockFileSystem();
        firstFiles.setMockFile(
          Storage.getGlobalSettingsPath(),
          JSON.stringify({ defaultProvider: 'openai' }),
        );
        secondFiles.setMockFile(
          Storage.getGlobalSettingsPath(),
          JSON.stringify({ defaultProvider: 'anthropic' }),
        );
        try {
          const selectedSettings = firstSettings;
          const selectedContext = {
            runtimeId: 'shared-provider-label',
          };
          const selectedConfig = firstConfig;
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
          populateProviderManager(
            ownedManager,
            ownedOAuth,
            tokens,
            selectedSettings,
            firstFiles,
            selectedConfig,
            undefined,
            undefined,
            false,
            true,
            process.env.LLXPRT_FAKE_RESPONSES,
          );
          const selectedSettings2 = secondSettings;
          const selectedContext2 = {
            runtimeId: 'shared-provider-label',
          };
          const selectedConfig2 = secondConfig;
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
          populateProviderManager(
            ownedManager2,
            ownedOAuth2,
            tokens2,
            selectedSettings2,
            secondFiles,
            selectedConfig2,
            undefined,
            undefined,
            false,
            true,
            process.env.LLXPRT_FAKE_RESPONSES,
          );
          expect(ownedManager.getActiveProviderName()).toBe('openai');
          expect(ownedManager2.getActiveProviderName()).toBe('anthropic');
          await firstConfig.dispose();
          expect(ownedManager2.getActiveProviderName()).toBe('anthropic');
        } finally {
          await firstConfig.dispose();
          await secondConfig.dispose();
        }
      });
    });
  });
});
