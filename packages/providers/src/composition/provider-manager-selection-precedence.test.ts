import {
  installOwnedConfig,
  installBorrowedConfigSettings,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/configTypes.js';
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

import { afterEach, describe, it, expect, vi, beforeEach } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import {
  type Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';

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
    function makeMinimalConfig(provider: string): Config {
      return buildConfiguredConfig({
        provider,
        sessionId: 'unconfigured-provider-authority',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'placeholder-model',
        debugMode: false,
      });
    }

    describe('createProviderManager: explicit provider trimming (#2481)', () => {
      beforeEach(() => {
        vi.restoreAllMocks();
      });

      it('trims whitespace from settingsService activeProvider', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', '  openai  ');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings8 = settingsService;
        const selectedContext8 = runtime;
        const selectedConfig8 = undefined;
        const selectedAuthority8 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings8,
          selectedConfig8,
          selectedContext8,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority8.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens8 = selectedAuthority8.createTokenStore();
        let transferredTokens8 = false;
        const closeTokens8 = createOwnedTokenStoreClose(tokens8);
        managerReleases.push(() =>
          transferredTokens8 ? undefined : closeTokens8(),
        );
        const ownedOAuth8 = createOwnedOAuthManager(
          tokens8,
          undefined,
          undefined,
          selectedConfig8,
          manager,
          selectedSettings8,
        );
        managerReleases.push(() => ownedOAuth8.dispose());
        transferredTokens8 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(manager, ownedOAuth8, tokens8),
          readSetting: (key) => selectedSettings8.get(key),
          fileSystem: new MockFileSystem(),
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

        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      });

      it('treats whitespace-only activeProvider as unconfigured', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', '   ');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings9 = settingsService;
        const selectedContext9 = runtime;
        const selectedConfig9 = undefined;
        const selectedAuthority9 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings9,
          selectedConfig9,
          selectedContext9,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority9.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens9 = selectedAuthority9.createTokenStore();
        let transferredTokens9 = false;
        const closeTokens9 = createOwnedTokenStoreClose(tokens9);
        managerReleases.push(() =>
          transferredTokens9 ? undefined : closeTokens9(),
        );
        const ownedOAuth9 = createOwnedOAuthManager(
          tokens9,
          undefined,
          undefined,
          selectedConfig9,
          manager,
          selectedSettings9,
        );
        managerReleases.push(() => ownedOAuth9.dispose());
        transferredTokens9 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(manager, ownedOAuth9, tokens9),
          readSetting: (key) => selectedSettings9.get(key),
          fileSystem: new MockFileSystem(),
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

        expect(manager.hasActiveProvider()).toBe(false);
      });

      it('getActiveProviderName returns undefined for whitespace-only configuration', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', '   ');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings10 = settingsService;
        const selectedContext10 = runtime;
        const selectedConfig10 = undefined;
        const selectedAuthority10 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings10,
          selectedConfig10,
          selectedContext10,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority10.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens10 = selectedAuthority10.createTokenStore();
        let transferredTokens10 = false;
        const closeTokens10 = createOwnedTokenStoreClose(tokens10);
        managerReleases.push(() =>
          transferredTokens10 ? undefined : closeTokens10(),
        );
        const ownedOAuth10 = createOwnedOAuthManager(
          tokens10,
          undefined,
          undefined,
          selectedConfig10,
          manager,
          selectedSettings10,
        );
        managerReleases.push(() => ownedOAuth10.dispose());
        transferredTokens10 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            manager,
            ownedOAuth10,
            tokens10,
          ),
          readSetting: (key) => selectedSettings10.get(key),
          fileSystem: new MockFileSystem(),
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

        expect(manager.getActiveProviderName()).toBeUndefined();
      });

      it('getActiveProvider returns undefined for whitespace-only configuration', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', '   ');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings11 = settingsService;
        const selectedContext11 = runtime;
        const selectedConfig11 = undefined;
        const selectedAuthority11 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings11,
          selectedConfig11,
          selectedContext11,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority11.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens11 = selectedAuthority11.createTokenStore();
        let transferredTokens11 = false;
        const closeTokens11 = createOwnedTokenStoreClose(tokens11);
        managerReleases.push(() =>
          transferredTokens11 ? undefined : closeTokens11(),
        );
        const ownedOAuth11 = createOwnedOAuthManager(
          tokens11,
          undefined,
          undefined,
          selectedConfig11,
          manager,
          selectedSettings11,
        );
        managerReleases.push(() => ownedOAuth11.dispose());
        transferredTokens11 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            manager,
            ownedOAuth11,
            tokens11,
          ),
          readSetting: (key) => selectedSettings11.get(key),
          fileSystem: new MockFileSystem(),
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

        expect(manager.getActiveProvider()).toBeUndefined();
      });
    });

    describe('createProviderManager: UNCONFIGURED_PROVIDER sentinel precedence (#2481)', () => {
      beforeEach(() => {
        vi.restoreAllMocks();
      });

      it('treats UNCONFIGURED_PROVIDER sentinel in settingsService as absent', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'unconfigured');
        const runtime = createProviderRuntimeContext({});
        const selectedSettings12 = settingsService;
        const selectedContext12 = runtime;
        const selectedConfig12 = undefined;
        const selectedAuthority12 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings12,
          selectedConfig12,
          selectedContext12,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority12.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens12 = selectedAuthority12.createTokenStore();
        let transferredTokens12 = false;
        const closeTokens12 = createOwnedTokenStoreClose(tokens12);
        managerReleases.push(() =>
          transferredTokens12 ? undefined : closeTokens12(),
        );
        const ownedOAuth12 = createOwnedOAuthManager(
          tokens12,
          undefined,
          undefined,
          selectedConfig12,
          manager,
          selectedSettings12,
        );
        managerReleases.push(() => ownedOAuth12.dispose());
        transferredTokens12 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            manager,
            ownedOAuth12,
            tokens12,
          ),
          readSetting: (key) => selectedSettings12.get(key),
          fileSystem: new MockFileSystem(),
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

        // The sentinel must NOT activate a provider named 'unconfigured'.
        expect(manager.hasActiveProvider()).toBe(false);
      });

      it('falls through sentinel config provider to a real lower-precedence provider', () => {
        // config.getProvider() returns the sentinel; settingsService has a real
        // provider. resolveExplicitProvider must skip the sentinel and continue
        // to the settingsService source, activating the real provider.
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'openai');
        const runtime = createProviderRuntimeContext({});
        const config = makeMinimalConfig('unconfigured');
        const selectedSettings13 = settingsService;
        const selectedContext13 = runtime;
        const selectedConfig13 = config;
        const selectedAuthority13 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings13,
          selectedConfig13,
          selectedContext13,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority13.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens13 = selectedAuthority13.createTokenStore();
        let transferredTokens13 = false;
        const closeTokens13 = createOwnedTokenStoreClose(tokens13);
        managerReleases.push(() =>
          transferredTokens13 ? undefined : closeTokens13(),
        );
        const ownedOAuth13 = createOwnedOAuthManager(
          tokens13,
          undefined,
          undefined,
          selectedConfig13,
          manager,
          selectedSettings13,
        );
        managerReleases.push(() => ownedOAuth13.dispose());
        transferredTokens13 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            manager,
            ownedOAuth13,
            tokens13,
          ),
          readSetting: (key) => selectedSettings13.get(key),
          fileSystem: new MockFileSystem(),
          configuration: { kind: 'configured', config: selectedConfig13 },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: true,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      });

      it('falls through whitespace-only config provider to a real settingsService provider', () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'openai');
        const runtime = createProviderRuntimeContext({});
        const config = makeMinimalConfig('   ');
        const selectedSettings14 = settingsService;
        const selectedContext14 = runtime;
        const selectedConfig14 = config;
        const selectedAuthority14 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings14,
          selectedConfig14,
          selectedContext14,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority14.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens14 = selectedAuthority14.createTokenStore();
        let transferredTokens14 = false;
        const closeTokens14 = createOwnedTokenStoreClose(tokens14);
        managerReleases.push(() =>
          transferredTokens14 ? undefined : closeTokens14(),
        );
        const ownedOAuth14 = createOwnedOAuthManager(
          tokens14,
          undefined,
          undefined,
          selectedConfig14,
          manager,
          selectedSettings14,
        );
        managerReleases.push(() => ownedOAuth14.dispose());
        transferredTokens14 = true;
        populateProviderManager({
          target: createProviderPopulationTarget(
            manager,
            ownedOAuth14,
            tokens14,
          ),
          readSetting: (key) => selectedSettings14.get(key),
          fileSystem: new MockFileSystem(),
          configuration: { kind: 'configured', config: selectedConfig14 },
          contributions: { kind: 'none' },
          messages: { kind: 'none' },
          allowBrowser: true,
          activateConfiguredProvider: true,
          fakeResponses:
            process.env.LLXPRT_FAKE_RESPONSES === undefined
              ? { kind: 'disabled' }
              : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
        });

        expect(manager.hasActiveProvider()).toBe(true);
        expect(manager.getActiveProviderName()).toBe('openai');
      });
    });
  });
});

function buildConfiguredConfig(parameters: ConfigParameters): Config {
  const config = acquireConfig(parameters);
  const settings = new SettingsService();
  const owner = acquireSettings(config, settings);
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  owner.initializeProviderSelection(config.getProvider(), config.getModel());
  return config;
}
