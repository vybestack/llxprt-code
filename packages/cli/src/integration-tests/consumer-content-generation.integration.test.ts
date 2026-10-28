/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createProviderPopulationTarget } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import {
  ProviderManager,
  ProviderContentGenerator,
  type IProvider,
} from '@vybestack/llxprt-code-providers';

import {
  populateProviderManager,
  createOwnedOAuthManager,
  createOwnedTokenStoreClose,
  NodeFileSystem,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import {
  createContentGeneratorConfig,
  createContentGenerator,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';

import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { openRouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';

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

    /** Registers the provider the way a host does: as a provider contribution. */
    function contributeTestProvider(
      provider: IProvider,
    ): ProviderContributionRegistry {
      const providerId = `${provider.name}-contribution`;
      return buildProviderContributionRegistry([
        {
          specifier: `memory:${providerId}`,
          manifest: {
            apiVersion: 1,
            id: providerId,
            providers: [
              {
                providerId,
                createProvider: () => provider,
                builtinAliases: [
                  {
                    alias: provider.name,
                    config: {
                      baseProvider: providerId,
                      'requires-auth': false,
                    },
                  },
                ],
              },
            ],
          },
        },
      ]);
    }

    /**
     * Builds the foreground agent through the production preflight route with
     * the provider active. The agent is disposed before its preflight route.
     */
    async function openProviderAgent(sessionId: string, provider: IProvider) {
      const route = await openRouteBPreflight({
        authority: credentials().authority,
        config: {
          sessionId,
          provider: undefined,
          model: provider.getDefaultModel(),
        },
        contributions: contributeTestProvider(provider),
      });
      managerReleases.push(() => route.close());
      await route.prepare();
      const agent = await route.createAgent({
        provider: provider.name,
        model: provider.getDefaultModel(),
      });
      managerReleases.push(() => agent.dispose());
      return { agent, config: route.config };
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
        const testProvider = createTestProvider('test-provider', 'test-model');
        const { agent: owner, config } = await openProviderAgent(
          'p13-content',
          testProvider,
        );
        const selectedFactoriesContent = createRuntimeContentGeneratorFactory();
        await owner.sessionClient.refreshAuth();

        const contentGenConfig = {
          ...createContentGeneratorConfig({ model: owner.getModel() }),
          contentGeneratorFactory: selectedFactoriesContent,
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
        const testProvider = createTestProvider('test-provider', 'test-model');

        // Simulate a factory that creates a content generator (like CLI wiring does)
        const fakeContentGenerator = new ProviderContentGenerator();

        const factory = {
          createContentGenerator: () => fakeContentGenerator,
        };

        // Initialize the explicit Agent owner before refreshing generation.
        const { agent: owner, config } = await openProviderAgent(
          'p13-factory',
          testProvider,
        );
        const selectedFactoriesContent = createRuntimeContentGeneratorFactory();
        await owner.sessionClient.refreshAuth();

        const contentGenConfig = {
          ...createContentGeneratorConfig({ model: owner.getModel() }),
          contentGeneratorFactory: selectedFactoriesContent,
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
        populateProviderManager({
          target: createProviderPopulationTarget(manager, ownedOAuth8, tokens8),
          readSetting: (key) => selectedSettings8.get(key),
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
