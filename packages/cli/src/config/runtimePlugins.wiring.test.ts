/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2758: an installed plugin package is
 * discovered, loaded once, and the resulting registry actually reaches
 * provider composition through the same `assembleCliProviderRuntime` seam the
 * CLI uses for both its pre-Config and post-Config assemblies.
 *
 * Without this, the `providerContributions` threading through
 * cliSessionBootstrap -> loadCliConfig -> profileBootstrap /
 * postConfigRuntime -> assembleCliProviderRuntime could be deleted and every
 * other runtime-plugin test would still pass.
 *
 * The only stubbed boundaries are the filesystem (discovery) and module
 * resolution (loading). The discovery logic, loader, registry, assembly
 * helper, and ProviderManager are all real.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  discoverRuntimePluginPackages,
  loadRuntimePlugins,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  ProviderContributionRegistry,
  RuntimePluginDiscoveryDeps,
} from '@vybestack/llxprt-code-providers/composition.js';
import {
  assembleCliProviderRuntime,
  disposeCliRuntime,
} from '@vybestack/llxprt-code-providers/runtime.js';

const PLUGIN_PACKAGE = 'llxprt-wiring-provider';
const PLUGIN_PROVIDER_ID = 'wiring-provider';
const CONTRIBUTED_ALIAS = 'wiring-alias';
const RUNTIME_ID = 'issue2758-wiring-test';

const NODE_MODULES = '/g/lib/node_modules';
const HOST_FILE = `${NODE_MODULES}/@vybestack/llxprt-code-providers/dist/x.js`;

/**
 * A node_modules layout containing the CLI's own package plus one installed
 * package that declares the runtime-plugin marker, and one that does not.
 */
function discoveryDeps(): RuntimePluginDiscoveryDeps {
  const dirs: Record<string, string[]> = {
    [NODE_MODULES]: ['@vybestack', PLUGIN_PACKAGE, 'unrelated-package'],
    [`${NODE_MODULES}/@vybestack`]: ['llxprt-code-providers'],
  };
  const files: Record<string, string> = {
    [`${NODE_MODULES}/${PLUGIN_PACKAGE}/package.json`]: JSON.stringify({
      name: PLUGIN_PACKAGE,
      llxprt: { runtimePlugin: true },
    }),
    [`${NODE_MODULES}/unrelated-package/package.json`]: JSON.stringify({
      name: 'unrelated-package',
    }),
    [`${NODE_MODULES}/@vybestack/llxprt-code-providers/package.json`]:
      JSON.stringify({ name: '@vybestack/llxprt-code-providers' }),
  };
  return {
    fromPath: HOST_FILE,
    exists: (path) => path in files || path in dirs,
    listDir: (path) => dirs[path] ?? [],
    readFile: (path) => files[path] ?? '',
  };
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

  afterEach(async () => {
    while (assembledRuntimeIds.length > 0) {
      const id = assembledRuntimeIds.pop();
      if (id !== undefined) {
        await disposeCliRuntime(id);
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

  it('discovers only the installed package that declares the plugin marker', () => {
    expect(discoverRuntimePluginPackages(discoveryDeps())).toStrictEqual([
      PLUGIN_PACKAGE,
    ]);
  });

  it('imports each discovered package exactly once', async () => {
    const imported: string[] = [];
    const discovered = discoverRuntimePluginPackages(discoveryDeps());

    await loadRegistry(discovered, (specifier) => imported.push(specifier));

    expect(imported).toStrictEqual([PLUGIN_PACKAGE]);
  });

  it('makes a plugin-contributed alias available on the assembled provider manager', async () => {
    const registry = await loadRegistry(
      discoverRuntimePluginPackages(discoveryDeps()),
    );

    const { providerManager } = assembleTracked(registry, 'with-plugins');

    expect(providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    const provider = providerManager.getProviderByName(CONTRIBUTED_ALIAS);
    if (!provider) {
      throw new Error(`expected '${CONTRIBUTED_ALIAS}' to be registered`);
    }
    const models = await provider.getModels();
    expect(models.map((model) => model.id)).toStrictEqual([
      `${PLUGIN_PROVIDER_ID}:${CONTRIBUTED_ALIAS}`,
    ]);
  });

  it('does not expose the plugin alias when no registry is threaded through', () => {
    const { providerManager } = assembleTracked(undefined, 'without-plugins');

    expect(providerManager.listProviders()).not.toContain(CONTRIBUTED_ALIAS);
  });

  it('re-assembling with the same registry keeps the plugin alias, matching the post-Config recomposition', async () => {
    // One startup load, reused by both assemblies. The plugin package is NOT
    // imported a second time for the post-Config recomposition.
    const imported: string[] = [];
    const registry = await loadRegistry(
      discoverRuntimePluginPackages(discoveryDeps()),
      (specifier) => imported.push(specifier),
    );

    // The CLI recomposes under the SAME foreground runtime id (issue #2300),
    // so both assemblies use one id here as well.
    const first = assembleTracked(registry, 'recomposition');
    const second = assembleTracked(registry, 'recomposition');

    expect(first.providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    expect(second.providerManager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    expect(imported).toStrictEqual([PLUGIN_PACKAGE]);
  });
});
