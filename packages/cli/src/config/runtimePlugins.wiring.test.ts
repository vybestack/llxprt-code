/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2758 AC7: the registry produced by the single
 * startup load actually reaches provider composition, through the same
 * `assembleCliProviderRuntime` seam the CLI uses for both its pre-Config and
 * post-Config assemblies.
 *
 * Without this, the `providerContributions` threading through
 * cliSessionBootstrap -> loadCliConfig -> profileBootstrap /
 * postConfigRuntime -> assembleCliProviderRuntime could be deleted and every
 * other runtime-plugin test would still pass.
 *
 * The only stubbed boundary is module resolution (`deps.importModule`); the
 * loader, registry, assembly helper, and ProviderManager are all real.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { loadRuntimePlugins } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import {
  assembleCliProviderRuntime,
  disposeCliRuntime,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { resolveRuntimePluginSpecifiers } from './runtimePlugins.js';
import { LoadedSettings, type Settings } from './settings.js';

const PLUGIN_PACKAGE = 'wiring-plugin-pkg';
const PLUGIN_PROVIDER_ID = 'wiring-provider';
const CONTRIBUTED_ALIAS = 'wiring-alias';
const RUNTIME_ID = 'issue2758-wiring-test';

function layer(
  path: string,
  runtimePlugins?: unknown,
): {
  path: string;
  settings: Settings;
} {
  return {
    path,
    settings: (runtimePlugins === undefined
      ? {}
      : { runtimePlugins }) as Settings,
  };
}

function settingsWithUserPlugins(specifiers: string[]): LoadedSettings {
  return new LoadedSettings(
    layer('/system/settings.json'),
    layer('/system/system-defaults.json'),
    layer('/user/settings.json', specifiers),
    layer('/workspace/settings.json'),
    true,
  );
}

/** A plugin module whose provider echoes the alias it was built for. */
function pluginModule(): Record<string, unknown> {
  return {
    llxprtRuntimePlugin: {
      apiVersion: 1,
      id: 'wiring-plugin',
      providers: [
        {
          providerId: PLUGIN_PROVIDER_ID,
          createProvider: (entry: { alias: string }) => ({
            name: entry.alias,
            getModels: () =>
              Promise.resolve([
                {
                  id: `${PLUGIN_PROVIDER_ID}:${entry.alias}`,
                  name: entry.alias,
                  provider: entry.alias,
                  supportedToolFormats: ['openai'],
                },
              ]),
            getServerTools: () => [],
            invokeServerTool: () =>
              Promise.reject(new Error('not exercised by this test')),
          }),
          builtinAliases: [
            {
              alias: CONTRIBUTED_ALIAS,
              config: { baseProvider: PLUGIN_PROVIDER_ID },
            },
          ],
        },
      ],
    },
  };
}

async function loadRegistry(
  specifiers: readonly string[],
  onImport?: (specifier: string) => void,
): Promise<ProviderContributionRegistry> {
  return loadRuntimePlugins(specifiers, {
    importModule: (specifier: string) => {
      onImport?.(specifier);
      return Promise.resolve(pluginModule());
    },
  });
}

function assemble(
  providerContributions: ProviderContributionRegistry | undefined,
  runtimeId: string,
): ReturnType<typeof assembleCliProviderRuntime> {
  return assembleCliProviderRuntime({
    settingsService: new SettingsService(),
    config: undefined,
    runtimeId,
    oauthSettings: null,
    ...(providerContributions === undefined ? {} : { providerContributions }),
  });
}

describe('runtime plugin startup wiring', () => {
  const assembledRuntimeIds: string[] = [];

  afterEach(() => {
    while (assembledRuntimeIds.length > 0) {
      const id = assembledRuntimeIds.pop();
      if (id !== undefined) {
        disposeCliRuntime(id);
      }
    }
  });

  function assembleTracked(
    registry: ProviderContributionRegistry | undefined,
    suffix: string,
  ): ReturnType<typeof assembleCliProviderRuntime> {
    const runtimeId = `${RUNTIME_ID}-${suffix}`;
    if (!assembledRuntimeIds.includes(runtimeId)) {
      assembledRuntimeIds.push(runtimeId);
    }
    return assemble(registry, runtimeId);
  }

  it('resolves the configured package and imports it exactly once', async () => {
    const settings = settingsWithUserPlugins([PLUGIN_PACKAGE]);
    const imported: string[] = [];

    const specifiers = resolveRuntimePluginSpecifiers(settings);
    await loadRegistry(specifiers, (specifier) => imported.push(specifier));

    expect(specifiers).toEqual([PLUGIN_PACKAGE]);
    expect(imported).toEqual([PLUGIN_PACKAGE]);
  });

  it('makes a plugin-contributed alias available on the assembled provider manager', async () => {
    const specifiers = resolveRuntimePluginSpecifiers(
      settingsWithUserPlugins([PLUGIN_PACKAGE]),
    );
    const registry = await loadRegistry(specifiers);

    const { providerManager } = assembleTracked(registry, 'with-plugins');

    expect(providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    const provider = providerManager.getProviderByName(CONTRIBUTED_ALIAS);
    if (!provider) {
      throw new Error(`expected '${CONTRIBUTED_ALIAS}' to be registered`);
    }
    const models = await provider.getModels();
    expect(models.map((model) => model.id)).toEqual([
      `${PLUGIN_PROVIDER_ID}:${CONTRIBUTED_ALIAS}`,
    ]);
  });

  it('does not expose the plugin alias when no registry is threaded through', () => {
    const { providerManager } = assembleTracked(undefined, 'without-plugins');

    expect(providerManager.listProviders()).not.toContain(CONTRIBUTED_ALIAS);
  });

  it('re-assembling with the same registry keeps the plugin alias, matching the post-Config recomposition', async () => {
    const specifiers = resolveRuntimePluginSpecifiers(
      settingsWithUserPlugins([PLUGIN_PACKAGE]),
    );
    // One startup load, reused by both assemblies — the plugin package is NOT
    // imported a second time for the post-Config recomposition.
    const imported: string[] = [];
    const registry = await loadRegistry(specifiers, (specifier) =>
      imported.push(specifier),
    );

    // The CLI recomposes under the SAME foreground runtime id (issue #2300),
    // so both assemblies use one id here as well.
    const first = assembleTracked(registry, 'recomposition');
    const second = assembleTracked(registry, 'recomposition');

    expect(first.providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    expect(second.providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    expect(imported).toEqual([PLUGIN_PACKAGE]);
  });
});
