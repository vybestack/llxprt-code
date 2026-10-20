import { observeActivationPreparation } from '../../../agents/src/api/__tests__/helpers/activation-acquisition-capture.js';

import { afterEach, describe, expect, it } from 'bun:test';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  prepareAgentPreflight,
  type AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
import {
  Config,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { SettingsService } from '@vybestack/llxprt-code-settings';
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

describe('runtime plugin startup wiring', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
  });

  async function assembleTracked(
    registry: ProviderContributionRegistry | undefined,
    suffix: string,
  ): Promise<AgentProfilePreflight> {
    const operation = await prepareAgentPreflight(
      { runtimeId: RUNTIME_ID + '-' + suffix },
      credentials().authority,
      new SettingsService(),
      undefined,
      registry,
    );
    cleanups.push(() => operation.dispose());
    return operation;
  }

  async function attach(
    operation: AgentProfilePreflight,
    inspect: (manager: RuntimeProviderManager) => void | Promise<void>,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'plugin-preflight-'));
    const config = new Config({
      sessionId: 'plugin-config',
      cwd: root,
      targetDir: root,
      debugMode: false,
      model: 'test-model',
      provider: 'openai',
      mcpEnabled: false,
      skillsSupport: false,
    });
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: root,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    cleanups.unshift(async () => {
      await config.dispose();
      await trust.dispose();
      await filesystem.dispose();
      await memory.dispose();
      await rm(root, { recursive: true, force: true });
    });
    let manager: RuntimeProviderManager | undefined;

    const observation = observeActivationPreparation((activation, state) => {
      manager = state.manager;
    });
    try {
      await operation.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        undefined,
      );
    } finally {
      observation.mockRestore();
    }
    if (manager === undefined) throw new Error('Missing assembled manager');
    await inspect(manager);
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

    const operation = await assembleTracked(registry, 'with-plugins');
    await attach(operation, async (providerManager) => {
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
  });

  it('does not expose the plugin alias when no registry is threaded through', async () => {
    const operation = await assembleTracked(undefined, 'without-plugins');
    await attach(operation, (providerManager) => {
      expect(providerManager.listProviders()).not.toContain(CONTRIBUTED_ALIAS);
    });
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
    const first = await assembleTracked(registry, 'recomposition');
    const second = await assembleTracked(registry, 'recomposition');

    await attach(first, (manager) => {
      expect(manager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    });
    await attach(second, (manager) => {
      expect(manager.listProviders()).toContain(CONTRIBUTED_ALIAS);
    });
    expect(imported).toStrictEqual([PLUGIN_PACKAGE]);
  });
});
