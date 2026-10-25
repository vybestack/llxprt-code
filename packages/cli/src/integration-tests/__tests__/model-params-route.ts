/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { cleanupAfterFailure } from '../../../../agents/src/core/subagent-cleanup.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../../agents/src/api/__tests__/helpers/route-b-preflight.js';

/** Stub provider that answers `<name>-model` and clears nothing. */
export function createModelParamsStubProvider(
  name: string,
): IProvider & { clearState(): void } {
  return {
    name,
    async getModels() {
      return [
        {
          id: `${name}-model`,
          name: `${name}-model`,
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    getDefaultModel() {
      return `${name}-model`;
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `response-from-${name}` }],
      };
    },
    clearState() {
      // Intentionally blank; runtime helpers manage state in SettingsService.
    },
  };
}

/** Registers each stub the way a host registers a provider: as a contribution. */
function contributeStubProviders(
  providers: readonly IProvider[],
): ProviderContributionRegistry {
  return buildProviderContributionRegistry(
    providers.map((provider) => {
      const providerId = `${provider.name}-stub-provider`;
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

export interface ModelParamsRoot {
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  /** The production provider switch of the prepared preflight. */
  readonly switchProvider: ProviderSwitcher;
  /** The foreground Agent, activated on the first provider and its default model. */
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

/**
 * Opens the foreground preflight route over contributed stub providers and
 * builds the foreground Agent on the first provider with `<name>-model`.
 */
export async function openModelParamsRoot(
  authority: RouteBPreflight['authority'],
  sessionId: string,
  runtimeId: string,
  providers: readonly [IProvider, ...IProvider[]],
): Promise<ModelParamsRoot> {
  const [first] = providers;
  const model = `${first.name}-model`;
  const route = await openRouteBPreflight({
    authority,
    runtimeId,
    config: { sessionId, provider: undefined, model },
    contributions: contributeStubProviders(providers),
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
    const switchProvider = route.preflight.captureSwitchOperation();
    agent = await route.createAgent({ provider: first.name, model });
    return { route, settingsOwner, switchProvider, agent, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
