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

import { afterEach, describe, it, expect, vi, beforeEach } from 'bun:test';

import { useOwnedCredentials } from '../__tests__/helpers/owned-credential-fixture.js';

import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';

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

    function captureThrown(fn: () => unknown): { error: unknown } {
      try {
        fn();
      } catch (error) {
        return { error };
      }
      throw new Error('expected the call to throw, but it did not');
    }

    describe('createProviderManager: invalid configured provider (#2481)', () => {
      beforeEach(() => {
        vi.restoreAllMocks();
      });

      it('throws when an explicitly-configured provider name is invalid (typo)', () => {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});

        // Build a valid unconfigured manager first, then test that a typo'd
        // explicit provider name surfaces as a structured error.
        const selectedSettings5 = settingsService;
        const selectedContext5 = runtime;
        const selectedConfig5 = undefined;
        const selectedAuthority5 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings5,
          selectedConfig5,
          selectedContext5,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority5.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens5 = selectedAuthority5.createTokenStore();
        let transferredTokens5 = false;
        const closeTokens5 = createOwnedTokenStoreClose(tokens5);
        managerReleases.push(() =>
          transferredTokens5 ? undefined : closeTokens5(),
        );
        const ownedOAuth5 = createOwnedOAuthManager(
          tokens5,
          undefined,
          undefined,
          selectedConfig5,
          manager,
          selectedSettings5,
        );
        managerReleases.push(() => ownedOAuth5.dispose());
        transferredTokens5 = true;
        populateProviderManager(
          manager,
          ownedOAuth5,
          tokens5,
          selectedSettings5,
          new MockFileSystem(),
          selectedConfig5,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        // The manager has real providers registered. A typo'd name must throw
        // with the requested name preserved (not silently swallowed).
        expect(() => manager.setActiveProvider('geminii')).toThrow(/geminii/);
      });

      it('activateExplicitProvider does not swallow invalid provider errors', () => {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings6 = settingsService;
        const selectedContext6 = runtime;
        const selectedConfig6 = undefined;
        const selectedAuthority6 = fallbackCredentials().authority;
        const manager = new ProviderManager(
          undefined,
          undefined,
          undefined,
          undefined,
          selectedSettings6,
          selectedConfig6,
          selectedContext6,
          undefined,
          undefined,
        );
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority6.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
        }
        const tokens6 = selectedAuthority6.createTokenStore();
        let transferredTokens6 = false;
        const closeTokens6 = createOwnedTokenStoreClose(tokens6);
        managerReleases.push(() =>
          transferredTokens6 ? undefined : closeTokens6(),
        );
        const ownedOAuth6 = createOwnedOAuthManager(
          tokens6,
          undefined,
          undefined,
          selectedConfig6,
          manager,
          selectedSettings6,
        );
        managerReleases.push(() => ownedOAuth6.dispose());
        transferredTokens6 = true;
        populateProviderManager(
          manager,
          ownedOAuth6,
          tokens6,
          selectedSettings6,
          new MockFileSystem(),
          selectedConfig6,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        // Verify the error preserves the requested name.
        const captured = captureThrown(() =>
          manager.setActiveProvider('nonexistent-provider'),
        );
        expect(captured.error).toBeInstanceOf(Error);
        expect((captured.error as Error).message).toContain(
          'nonexistent-provider',
        );
      });

      it('preserves the original error cause when activation fails', () => {
        const settingsService = new SettingsService();
        // Set a whitespace-padded invalid provider name in the settingsService
        // so createProviderManager → activateExplicitProvider is exercised.
        settingsService.set('activeProvider', 'nonexistent-provider');
        const runtime = createProviderRuntimeContext({});

        const captured = captureThrown(() => {
          const selectedSettings7 = settingsService;
          const selectedContext7 = runtime;
          const selectedConfig7 = undefined;
          const selectedAuthority7 = fallbackCredentials().authority;
          const ownedManager7 = new ProviderManager(
            undefined,
            undefined,
            undefined,
            undefined,
            selectedSettings7,
            selectedConfig7,
            selectedContext7,
            undefined,
            undefined,
          );
          managerReleases.push(() => ownedManager7.dispose());
          if (ownedManager7.peekProviderKeyStorage() === undefined) {
            const keys = selectedAuthority7.createProviderKeyStorage();
            managerReleases.push(() => keys.close());
            ownedManager7.bindProviderKeyStorage(keys);
          }
          const tokens7 = selectedAuthority7.createTokenStore();
          let transferredTokens7 = false;
          const closeTokens7 = createOwnedTokenStoreClose(tokens7);
          managerReleases.push(() =>
            transferredTokens7 ? undefined : closeTokens7(),
          );
          const ownedOAuth7 = createOwnedOAuthManager(
            tokens7,
            undefined,
            undefined,
            selectedConfig7,
            ownedManager7,
            selectedSettings7,
          );
          managerReleases.push(() => ownedOAuth7.dispose());
          transferredTokens7 = true;
          populateProviderManager(
            ownedManager7,
            ownedOAuth7,
            tokens7,
            selectedSettings7,
            new MockFileSystem(),
            selectedConfig7,
            undefined,
            undefined,
            true,
            true,
            process.env.LLXPRT_FAKE_RESPONSES,
          );
        });
        expect(captured.error).toBeInstanceOf(Error);
        // The original underlying error must be preserved as `cause`.
        expect((captured.error as Error).cause).toBeDefined();
      });
    });
  });
});
