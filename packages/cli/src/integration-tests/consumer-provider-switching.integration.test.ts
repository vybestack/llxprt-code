import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type IProvider } from '@vybestack/llxprt-code-providers';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import {
  initializeTestAgent,
  createTempDirectory,
  cleanupTempDirectory,
} from './test-utils.js';

import {
  type Agent,
  type AgentProfilePreflight,
  switchActiveProvider,
} from '@vybestack/llxprt-code-agents';

import { type RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/index.js';

import { Config } from '@vybestack/llxprt-code-core';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { prepareIntegrationPreflight } from './__tests__/prepare-preflight.js';

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
    // Requirement 2: Provider switching through CLI/runtime flow
    // ─────────────────────────────────────────────────────────────────

    /**
     * @plan:PLAN-20260603-ISSUE1584.P13
     * @requirement:REQ-API-001
     *
     * Provider switching remains reachable through existing CLI/runtime paths.
     * This tests the switchActiveProvider CLI runtime helper and the
     * provider command's use of runtime APIs.
     */
    describe('Provider switching reachable through CLI/runtime flow', () => {
      let tempDir: string;
      let config: Config;
      let settingsOwner: SessionSettingsOwner;
      let sessionRoot: Awaited<ReturnType<typeof initializeTestAgent>>;
      let providerManager: RuntimeProviderManager;
      let settingsService: SettingsService;
      let preflight: AgentProfilePreflight;
      let sessionClient: Pick<Agent['sessionClient'], 'refreshAuth'>;

      beforeEach(async () => {
        tempDir = await createTempDirectory();
        config = new Config({
          sessionId: 'p13-switch',
          targetDir: tempDir,
          debugMode: false,
          cwd: tempDir,
          model: 'test-model',
        });
        settingsService = new SettingsService();
        preflight = await prepareIntegrationPreflight(
          config,
          settingsService,
          credentials().authority,
          'p13-switch-test',
          (manager) => {
            providerManager = manager;
          },
        );
        settingsOwner = new SessionSettingsOwner(settingsService);
        sessionRoot = await initializeTestAgent(
          config,
          providerManager,
          settingsService,
          settingsOwner,
        );
        sessionClient = sessionRoot.sessionClient;

        // Register test providers
        const providerA = createTestProvider('provider-a', 'model-a');
        const providerB = createTestProvider('provider-b', 'model-b');
        providerManager.registerProvider(providerA);
        providerManager.registerProvider(providerB);
      });

      afterEach(async () => {
        await preflight.dispose();
        await cleanupTempDirectory(tempDir);
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * switchActiveProvider from the CLI runtime settings module
       * successfully changes the active provider.
       */
      it('switchActiveProvider changes active provider through CLI runtime path', async () => {
        await providerManager.setActiveProvider('provider-a');
        expect(sessionRoot.providerReads.getActiveProviderName()).toBe(
          'provider-a',
        );

        const result = await switchActiveProvider(
          'provider-b',
          {},
          config,
          settingsService,
          providerManager,
          null,
          undefined,
          () => sessionClient.refreshAuth(),
          settingsOwner,
        );
        expect(result.changed).toBe(true);
        expect(result.nextProvider).toBe('provider-b');
        expect(sessionRoot.providerReads.getActiveProviderName()).toBe(
          'provider-b',
        );
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * listProviders through the CLI runtime accessor returns all
       * registered providers.
       */
      it('listProviders returns registered providers through CLI runtime path', () => {
        const providers = sessionRoot.providerReads.listProviders();
        expect(providers).toContain('provider-a');
        expect(providers).toContain('provider-b');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * providerStatus provides status info through the CLI
       * runtime path after switching.
       */
      it('providerStatus reflects current provider after switch', async () => {
        await providerManager.setActiveProvider('provider-a');

        await switchActiveProvider(
          'provider-b',
          {},
          config,
          settingsService,
          providerManager,
          null,
          undefined,
          () => sessionClient.refreshAuth(),
          settingsOwner,
        );
        const status = sessionRoot.providerReads.providerStatus();
        expect(status.providerName).toBe('provider-b');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Switching to the same provider is idempotent through the CLI path.
       */
      it('switchActiveProvider is idempotent when switching to same provider', async () => {
        await providerManager.setActiveProvider('provider-a');

        const result = await switchActiveProvider(
          'provider-a',
          {},
          config,
          settingsService,
          providerManager,
          null,
          undefined,
          () => sessionClient.refreshAuth(),
          settingsOwner,
        );
        expect(result.changed).toBe(false);
      });
    });
  });
});
