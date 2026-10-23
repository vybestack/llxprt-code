/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderManager } from '@vybestack/llxprt-code-providers';

const { ProviderManager: ConcreteProviderManager } = await import(
  '@vybestack/llxprt-code-providers'
);

const {
  populateProviderManager,
  createOwnedOAuthManager,
  createOwnedTokenStoreClose,
} = await import('@vybestack/llxprt-code-providers/composition.js');

import { afterEach, describe, it, expect, beforeEach } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import * as os from 'os';

import * as fs from 'fs';

import * as path from 'path';

// This integration test exercises the real alias config files, so it opts
// out of the preload's providerAliases stub (see bun-test-setup.ts).

// Loaded with top-level await rather than a static import so the modules that
// consume providerAliases are evaluated AFTER the unmock above. Static imports
// are hoisted, so they would otherwise capture the globally mocked entries.

const { NodeFileSystem } = await import(
  '@vybestack/llxprt-code-providers/composition/IFileSystem.js'
);

// Also deferred: this barrel transitively pulls in the alias consumers, and a
// static import would be hoisted above the re-registration above.
const { createProviderRuntimeContext } = await import(
  '@vybestack/llxprt-code-core'
);

const { SettingsService } = await import('@vybestack/llxprt-code-settings');
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

    describe('Provider alias integration', () => {
      let tempDir: string;
      let providerManager: ProviderManager;
      let originalOpenAIApiKey: string | undefined;
      let originalHome: string | undefined;
      let originalUserProfile: string | undefined;
      let originalConfigHome: string | undefined;
      let originalDataHome: string | undefined;

      beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-alias-test-'));
        const llxprtDir = path.join(tempDir, '.llxprt');
        const providersDir = path.join(llxprtDir, 'providers');

        fs.mkdirSync(providersDir, { recursive: true });

        // Minimal settings file to satisfy provider manager initialization
        fs.writeFileSync(
          path.join(llxprtDir, 'settings.json'),
          JSON.stringify({}),
          'utf-8',
        );

        const aliasConfig = {
          baseProvider: 'openai',
          'base-url': 'https://myotherprovider.com:123/v1/',
          defaultModel: 'my-test-model',
          description: 'Test alias config',
        };

        fs.writeFileSync(
          path.join(providersDir, 'myotherprovider.config'),
          JSON.stringify(aliasConfig, null, 2),
          'utf-8',
        );

        originalOpenAIApiKey = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'test-key';
        originalHome = process.env.HOME;
        originalUserProfile = process.env.USERPROFILE;
        originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
        originalDataHome = process.env['LLXPRT_DATA_HOME'];
        process.env.HOME = tempDir;
        process.env.USERPROFILE = tempDir;
        process.env['LLXPRT_CONFIG_HOME'] = llxprtDir;
        // User alias configs are read from <dataDir>/providers; the global
        // test-storage isolation sets LLXPRT_DATA_HOME, so point it at this
        // test's own root too.
        process.env['LLXPRT_DATA_HOME'] = llxprtDir;

        // After DI migration, set up runtime context and create ProviderManager
        // Issue #2616: the runtime context carries its settings service
        // explicitly (no ambient install or teardown).
        const settingsService = new SettingsService();
        const runtimeContext = createProviderRuntimeContext({});
        const selectedSettings = settingsService;
        const selectedContext = runtimeContext;
        const selectedConfig = undefined;
        const selectedAuthority = fallbackCredentials().authority;
        const ownedManager = new ConcreteProviderManager(
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
          new NodeFileSystem(),
          selectedConfig,
          undefined,
          undefined,
          false,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );
        providerManager = ownedManager;
      });

      afterEach(() => {
        if (originalOpenAIApiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalOpenAIApiKey;
        }
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
        if (originalUserProfile === undefined) {
          delete process.env.USERPROFILE;
        } else {
          process.env.USERPROFILE = originalUserProfile;
        }
        if (originalConfigHome === undefined) {
          delete process.env['LLXPRT_CONFIG_HOME'];
        } else {
          process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
        }
        if (originalDataHome === undefined) {
          delete process.env['LLXPRT_DATA_HOME'];
        } else {
          process.env['LLXPRT_DATA_HOME'] = originalDataHome;
        }

        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('registers user-defined alias providers from the canonical data providers directory (<dataDir>/providers)', () => {
        expect(providerManager.listProviders()).toContain('myotherprovider');

        const aliasProvider =
          providerManager.getProviderByName('myotherprovider');
        // Provider is wrapped - check the innermost provider via wrappedProvider chain
        let innerProvider = aliasProvider;
        while (
          innerProvider &&
          'wrappedProvider' in innerProvider &&
          innerProvider.wrappedProvider
        ) {
          innerProvider = innerProvider.wrappedProvider as typeof innerProvider;
        }
        expect(innerProvider?.constructor.name).toBe('OpenAIProvider');
        expect(
          Object.prototype.hasOwnProperty.call(
            innerProvider ?? {},
            'providerConfig',
          ),
        ).toBe(true);
        const providerConfig = (
          innerProvider as unknown as {
            providerConfig?: { defaultModel?: string };
          }
        ).providerConfig;
        expect(providerConfig?.defaultModel).toBe('my-test-model');
        expect(aliasProvider?.getDefaultModel()).toBe('my-test-model');
        // Strengthen: the alias was read from the canonical data providers
        // directory (LLXPRT_DATA_HOME/providers), not a packaged builtin. The
        // alias name 'myotherprovider' and its defaultModel are user-supplied
        // values that exist only in the on-disk myotherprovider.config file we
        // wrote under <dataDir>/providers. Verify that file is the source.
        const aliasConfigPath = path.join(
          tempDir,
          '.llxprt',
          'providers',
          'myotherprovider.config',
        );
        expect(fs.existsSync(aliasConfigPath)).toBe(true);
        const onDiskConfig = JSON.parse(
          fs.readFileSync(aliasConfigPath, 'utf-8'),
        ) as { baseProvider: string; defaultModel: string };
        expect(onDiskConfig.baseProvider).toBe('openai');
        expect(onDiskConfig.defaultModel).toBe(
          aliasProvider?.getDefaultModel(),
        );
      });

      it('includes packaged provider aliases by default', () => {
        expect(providerManager.listProviders()).toContain('Fireworks');
        expect(providerManager.listProviders()).toContain('OpenRouter');
      });
    });
  });
});
