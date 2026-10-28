import { afterEach, describe, expect, it } from 'bun:test';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { join, parse } from 'node:path';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2758: an installed plugin package is
 * discovered, loaded once, and the resulting registry actually reaches
 * provider composition through the same `prepareAgentPreflight` seam the
 * CLI uses for its pre-Config acquisition and post-Config attachment.
 *
 * Without this, the `providerContributions` threading through
 * cliSessionBootstrap -> loadCliConfig -> profileBootstrap /
 * postConfigRuntime -> prepareAgentPreflight could be deleted and every
 * other runtime-plugin test would still pass.
 *
 * The only stubbed boundaries are the filesystem (discovery) and module
 * resolution (loading). The discovery logic, loader, registry, assembly
 * helper, and ProviderManager are all real.
 */

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Behavioral coverage for issue #2758: an installed plugin package is
 * discovered, loaded once, and the resulting registry actually reaches
 * provider composition through the same `prepareAgentPreflight` seam the
 * CLI uses for its pre-Config acquisition and post-Config attachment.
 *
 * Without this, the `providerContributions` threading through
 * cliSessionBootstrap -> loadCliConfig -> profileBootstrap /
 * postConfigRuntime -> prepareAgentPreflight could be deleted and every
 * other runtime-plugin test would still pass.
 *
 * The only stubbed boundaries are the filesystem (discovery) and module
 * resolution (loading). The discovery logic, loader, registry, assembly
 * helper, and ProviderManager are all real.
 */
import {
  discoverRuntimePluginPackages,
  loadRuntimePlugins,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  ProviderContributionRegistry,
  RuntimePluginDiscoveryDeps,
} from '@vybestack/llxprt-code-providers/composition.js';

const PLUGIN_PACKAGE = 'llxprt-wiring-provider';
const PLUGIN_PROVIDER_ID = 'wiring-provider';
const CONTRIBUTED_ALIAS = 'wiring-alias';
const RUNTIME_ID = 'issue2758-wiring-test';

// Discovery walks these paths with the native path module, so every key is
// built with it too: a hard-coded POSIX spelling never matches on Windows.
const NODE_MODULES = join(
  parse(process.cwd()).root,
  'g',
  'lib',
  'node_modules',
);
const HOST_FILE = join(
  NODE_MODULES,
  '@vybestack',
  'llxprt-code-providers',
  'dist',
  'x.js',
);

/**
 * A node_modules layout containing the CLI's own package plus one installed
 * package that declares the runtime-plugin marker, and one that does not.
 */
function discoveryDeps(): RuntimePluginDiscoveryDeps {
  const dirs: Record<string, string[]> = {
    [NODE_MODULES]: ['@vybestack', PLUGIN_PACKAGE, 'unrelated-package'],
    [join(NODE_MODULES, '@vybestack')]: ['llxprt-code-providers'],
  };
  const files: Record<string, string> = {
    [join(NODE_MODULES, PLUGIN_PACKAGE, 'package.json')]: JSON.stringify({
      name: PLUGIN_PACKAGE,
      llxprt: { runtimePlugin: true },
    }),
    [join(NODE_MODULES, 'unrelated-package', 'package.json')]: JSON.stringify({
      name: 'unrelated-package',
    }),
    [join(NODE_MODULES, '@vybestack', 'llxprt-code-providers', 'package.json')]:
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

describe('runtime plugin startup wiring', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
  });

  /**
   * The production foreground route a host takes: `prepareAgentPreflight`
   * with the registry as contributions, `preparePostConfiguration`, then the
   * foreground agent. Without a registry the built-in `openai` provider is
   * active (as in the CLI's default configuration); with one, the plugin alias.
   */
  async function assembleAgent(
    registry: ProviderContributionRegistry | undefined,
    suffix: string,
  ): Promise<Agent> {
    const intent =
      registry === undefined
        ? { provider: 'openai', model: 'test-model' }
        : { provider: CONTRIBUTED_ALIAS, model: 'wiring-model' };
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      runtimeId: RUNTIME_ID + '-' + suffix,
      contributions: registry,
      config: intent,
    });
    cleanups.push(() => route.close());
    await route.prepare();
    const agent = await route.createAgent(intent);
    cleanups.push(() => agent.dispose());
    return agent;
  }

  function providerNames(agent: Agent): string[] {
    return agent.listProviders().map((provider) => provider.name);
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

    const agent = await assembleAgent(registry, 'with-plugins');

    expect(providerNames(agent)).toContain(CONTRIBUTED_ALIAS);
    const models = await agent.listAvailableModels(CONTRIBUTED_ALIAS);
    expect(models.map((model) => model.id)).toStrictEqual([
      `${PLUGIN_PROVIDER_ID}:${CONTRIBUTED_ALIAS}`,
    ]);
  });

  it('does not expose the plugin alias when no registry is threaded through', async () => {
    const agent = await assembleAgent(undefined, 'without-plugins');

    expect(providerNames(agent)).not.toContain(CONTRIBUTED_ALIAS);
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
    const first = await assembleAgent(registry, 'recomposition');
    const second = await assembleAgent(registry, 'recomposition');

    expect(providerNames(first)).toContain(CONTRIBUTED_ALIAS);
    expect(providerNames(second)).toContain(CONTRIBUTED_ALIAS);
    expect(imported).toStrictEqual([PLUGIN_PACKAGE]);
  });
});
