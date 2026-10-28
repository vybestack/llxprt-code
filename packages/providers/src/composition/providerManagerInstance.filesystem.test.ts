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

import { Storage, SettingsService } from '@vybestack/llxprt-code-settings';

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

    describe('public provider-manager filesystem injection', () => {
      it('uses the supplied filesystem to select the user-configured provider', () => {
        const fileSystem = new MockFileSystem();
        fileSystem.setMockFile(
          Storage.getGlobalSettingsPath(),
          JSON.stringify({ defaultProvider: 'anthropic' }),
        );

        const selectedSettings = new SettingsService();
        const selectedContext = {
          runtimeId: 'filesystem-injection-test',
          metadata: { stage: 'test' },
        };
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
          fileSystem,
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

        expect(manager.getActiveProvider()?.name).toBe('anthropic');
      });
    });
  });
});
