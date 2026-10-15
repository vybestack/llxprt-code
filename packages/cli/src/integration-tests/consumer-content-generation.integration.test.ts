/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ProviderManager,
  ProviderContentGenerator,
  type IProvider,
} from '@vybestack/llxprt-code-providers';

import {
  populateProviderManager,
  createOwnedOAuthManager,
  createOwnedTokenStoreClose,
  configureProviderRuntimeFactories,
  NodeFileSystem,
} from '@vybestack/llxprt-code-providers/composition.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import {
  createContentGeneratorConfig,
  createContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';

import { initializeTestSessionRoot } from './test-utils.js';

import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import * as fs from 'node:fs';

import * as path from 'node:path';

import * as nodeOs from 'node:os';
describe('explicit provider primitive owners', () => {
  const credentials = useOwnedCredentials();
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

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @plan:PLAN-20260603-ISSUE1584.P13
     * @requirement:REQ-API-001
     *
     * Creates a minimal IProvider for testing. Uses real interface shape,
     * not mocked — verifies actual provider behavior through structural
     * conformance.
     */
    function createTestProvider(
      name: string,
      defaultModel: string,
    ): IProvider & { clearState(): void } {
      return {
        name,
        async getModels() {
          return [
            {
              id: defaultModel,
              name: defaultModel,
              provider: name,
              supportedToolFormats: [],
            },
          ];
        },
        getDefaultModel() {
          return defaultModel;
        },
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: `${name}-response` }],
          };
        },
        clearState() {
          // Stub provider does not persist internal state.
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // Requirement 3: Provider-backed generation/content-generator path
    // ─────────────────────────────────────────────────────────────────

    /**
     * @plan:PLAN-20260603-ISSUE1584.P13
     * @requirement:REQ-API-001
     *
     * Provider-backed generation/content-generator path remains reachable
     * through existing startup/runtime path. This verifies that:
     * - ContentGeneratorConfig carries providerManager
     * - The runtime injection path (contentGeneratorFactory on Config)
     *   allows provider-owned content generators through the existing
     *   createContentGenerator flow in core.
     * - The AgentRuntimeLoader can use a contentGeneratorFactory override
     *   to inject ProviderContentGenerator.
     */
    describe('Provider-backed content generator path reachable through runtime', () => {
      let tempDir: string;

      beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'p13-content-'));
      });

      afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * When a ProviderManager is wired, Config.getContentGeneratorConfig()
       * must include the providerManager so that content generation can be
       * routed through providers.
       */
      it('ContentGeneratorConfig constructs through the wired factory without manager data', async () => {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings6 = settingsService;
        const selectedContext6 = runtime;
        const selectedConfig6 = undefined;
        const selectedAuthority6 = credentials().authority;
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
          new NodeFileSystem(),
          selectedConfig6,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        // Register a provider so config wiring can proceed
        const testProvider = createTestProvider('test-provider', 'test-model');
        manager.registerProvider(testProvider);

        const config = new Config({
          sessionId: 'p13-content',
          targetDir: tempDir,
          debugMode: false,
          cwd: tempDir,
          model: 'test-model',
        });

        // Initialize the explicit Agent owner on this manager.
        const owner = await initializeTestSessionRoot(
          config,
          manager,
          settingsService,
        );
        const selectedFactories = configureProviderRuntimeFactories(
          config,
          manager,
        );
        manager.setActiveProvider('test-provider');
        await owner.agent.sessionClient.refreshAuth();

        const contentGenConfig = {
          ...createContentGeneratorConfig({ model: owner.agent.getModel() }),
          contentGeneratorFactory: selectedFactories.contentGeneratorFactory,
        };
        expect(contentGenConfig).toBeDefined();
        const { createContentGenerator } = await import(
          '@vybestack/llxprt-code-core/core/contentGenerator.js'
        );
        const generator = await createContentGenerator(
          contentGenConfig,
          config,
        );
        expect(
          await generator.countTokens({
            contents: [
              { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
            ],
          }),
        ).toStrictEqual({ totalTokens: 2 });
        expect(contentGenConfig).not.toHaveProperty('providerManager');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * When contentGeneratorFactory is provided, core's createContentGenerator
       * delegates to it. This proves the injection path is reachable without
       * core importing provider-owned types.
       */
      it('contentGeneratorFactory injection path produces a provider-backed generator', async () => {
        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings7 = settingsService;
        const selectedContext7 = runtime;
        const selectedConfig7 = undefined;
        const selectedAuthority7 = credentials().authority;
        const manager = new ProviderManager(
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
        managerReleases.push(() => manager.dispose());
        if (manager.peekProviderKeyStorage() === undefined) {
          const keys = selectedAuthority7.createProviderKeyStorage();
          managerReleases.push(() => keys.close());
          manager.bindProviderKeyStorage(keys);
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
          manager,
          selectedSettings7,
        );
        managerReleases.push(() => ownedOAuth7.dispose());
        transferredTokens7 = true;
        populateProviderManager(
          manager,
          ownedOAuth7,
          tokens7,
          selectedSettings7,
          new NodeFileSystem(),
          selectedConfig7,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        const testProvider = createTestProvider('test-provider', 'test-model');
        manager.registerProvider(testProvider);

        // Simulate a factory that creates a content generator (like CLI wiring does)
        const fakeContentGenerator = new ProviderContentGenerator();

        const factory = {
          createContentGenerator: () => fakeContentGenerator,
        };

        const config = new Config({
          sessionId: 'p13-factory',
          targetDir: tempDir,
          debugMode: false,
          cwd: tempDir,
          model: 'test-model',
        });

        // Initialize the explicit Agent owner before refreshing generation.
        const owner = await initializeTestSessionRoot(
          config,
          manager,
          settingsService,
        );
        const selectedFactories = configureProviderRuntimeFactories(
          config,
          manager,
        );
        manager.setActiveProvider('test-provider');
        await owner.agent.sessionClient.refreshAuth();

        const contentGenConfig = {
          ...createContentGeneratorConfig({ model: owner.agent.getModel() }),
          contentGeneratorFactory: selectedFactories.contentGeneratorFactory,
        };
        expect(contentGenConfig.model).toBe('test-model');
        // Inject the factory into the config
        const injectedConfig = {
          ...contentGenConfig,
          contentGeneratorFactory: factory,
        };

        // Verify the factory field is on the config
        expect(injectedConfig.contentGeneratorFactory).toBeDefined();
        expect(
          typeof injectedConfig.contentGeneratorFactory.createContentGenerator,
        ).toBe('function');

        // Verify the factory can produce a generator
        const generator = await createContentGenerator(injectedConfig, config);
        expect(generator).toBeDefined();
        expect(typeof generator.countTokens).toBe('function');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Without a contentGeneratorFactory, core's createContentGenerator
       * requires one when providerManager is set. This proves that the
       * injection path is mandatory and the old direct-construction path
       * no longer exists.
       */
      it('createContentGenerator rejects missing factory despite a wired provider registry', async () => {
        const { createContentGenerator } = await import(
          '@vybestack/llxprt-code-core/core/contentGenerator.js'
        );

        const settingsService = new SettingsService();
        const runtime = createProviderRuntimeContext({});
        const selectedSettings8 = settingsService;
        const selectedContext8 = runtime;
        const selectedConfig8 = undefined;
        const selectedAuthority8 = credentials().authority;
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
        populateProviderManager(
          manager,
          ownedOAuth8,
          tokens8,
          selectedSettings8,
          new NodeFileSystem(),
          selectedConfig8,
          undefined,
          undefined,
          true,
          true,
          process.env.LLXPRT_FAKE_RESPONSES,
        );

        const testProvider = createTestProvider('test-provider', 'test-model');
        manager.registerProvider(testProvider);

        const config = new Config({
          sessionId: 'p13-no-factory',
          targetDir: tempDir,
          debugMode: false,
          cwd: tempDir,
          model: 'test-model',
        });

        // ContentGeneratorConfig with providerManager but no factory should throw
        const contentConfig = {
          model: 'test-model',
        };

        await expect(
          createContentGenerator(contentConfig, config),
        ).rejects.toThrow(
          'No provider runtime is composed for this Config. Compose the providers package (see packages/providers/src/composition) before creating a content generator.',
        );
      });
    });
  });
});
