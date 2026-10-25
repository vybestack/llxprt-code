/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type IProvider } from '@vybestack/llxprt-code-providers';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';

import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';

import { cleanupAfterFailure } from '../../../agents/src/core/subagent-cleanup.js';

import { type Agent } from '@vybestack/llxprt-code-agents';

import { type ProviderSwitcher } from '@vybestack/llxprt-code-core';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

describe('explicit provider primitive owners', () => {
  const credentials = useOwnedCredentials();
  describe('provider behavior', () => {
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
      let root: ProviderSwitchingRoot;
      let preflight: RouteBPreflight['preflight'];
      let switchProvider: ProviderSwitcher;

      beforeEach(async () => {
        root = await openProviderSwitchingRoot(credentials().authority, [
          createTestProvider('provider-a', 'model-a'),
          createTestProvider('provider-b', 'model-b'),
        ]);
        preflight = root.route.preflight;
        switchProvider = root.switchProvider;
      });

      afterEach(async () => {
        await root.close();
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * switchActiveProvider from the CLI runtime settings module
       * successfully changes the active provider.
       */
      it('switchActiveProvider changes active provider through CLI runtime path', async () => {
        const agent = await root.openAgent();
        await preflight.setActiveProvider('provider-a');
        expect(agent.providerReads.getActiveProviderName()).toBe('provider-a');

        const result = await switchProvider('provider-b', {});
        expect(result.changed).toBe(true);
        expect(result.nextProvider).toBe('provider-b');
        expect(agent.providerReads.getActiveProviderName()).toBe('provider-b');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * listProviders through the CLI runtime accessor returns all
       * registered providers.
       */
      it('listProviders returns registered providers through CLI runtime path', async () => {
        const agent = await root.openAgent();
        const providers = agent.providerReads.listProviders();
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
        const agent = await root.openAgent();
        await preflight.setActiveProvider('provider-a');

        await switchProvider('provider-b', {});
        const status = agent.providerReads.providerStatus();
        expect(status.providerName).toBe('provider-b');
      });

      /**
       * @plan:PLAN-20260603-ISSUE1584.P13
       * @requirement:REQ-API-001
       *
       * Switching to the same provider is idempotent through the CLI path.
       */
      it('switchActiveProvider is idempotent when switching to same provider', async () => {
        await preflight.setActiveProvider('provider-a');

        const result = await switchProvider('provider-a', {});
        expect(result.changed).toBe(false);
      });
    });
  });
});

/** Registers each provider the way a host registers one: as a contribution. */
function contributeProviders(providers: readonly IProvider[]) {
  return buildProviderContributionRegistry(
    providers.map((provider) => {
      const providerId = `${provider.name}-test-provider`;
      return {
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
      };
    }),
  );
}

interface ProviderSwitchingRoot {
  readonly route: RouteBPreflight;
  /** The production provider switch of the prepared preflight. */
  readonly switchProvider: ProviderSwitcher;
  /** Builds the foreground Agent with `provider-a` active. */
  readonly openAgent: () => Promise<Agent>;
  readonly close: () => Promise<void>;
}

async function openProviderSwitchingRoot(
  authority: RouteBPreflight['authority'],
  providers: readonly IProvider[],
): Promise<ProviderSwitchingRoot> {
  const route = await openRouteBPreflight({
    authority,
    runtimeId: 'p13-switch-test',
    contributions: contributeProviders(providers),
    config: {
      sessionId: 'p13-switch',
      provider: undefined,
      model: 'test-model',
    },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  let agent: Agent | undefined;
  const close = async (): Promise<void> => {
    try {
      await agent?.dispose();
    } finally {
      try {
        await route.close();
      } finally {
        await settingsOwner.dispose();
      }
    }
  };
  try {
    for (const [key, value] of Object.entries(
      route.config.getInitialSettings(),
    ))
      route.settings.set(key, value);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    return {
      route,
      switchProvider: route.preflight.captureSwitchOperation(),
      openAgent: async () => {
        agent = await route.createAgent({
          provider: 'provider-a',
          model: 'model-a',
        });
        return agent;
      },
      close,
    };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
