/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { discoverRuntimePluginPackages } from './discoverRuntimePlugins.js';
import { parseRuntimePluginManifest } from './manifest.js';
import { buildProviderContributionRegistry } from './registry.js';
import type {
  LoadedRuntimePlugin,
  ProviderContributionRegistry,
} from './types.js';

const RUNTIME_PLUGIN_EXPORT_NAME = 'llxprtRuntimePlugin';

/**
 * Loads the configured runtime plugin packages in order and returns the local immutable
 * provider contribution registry (built-ins already present when no plugins are
 * configured). Each specifier must export the named `llxprtRuntimePlugin`
 * binding. The loader performs no scanning, no module-level registry, no hot reload,
 * and no filesystem access; `deps.importModule` is the injected module-resolution
 * boundary.
 *
 * Specifier trust is the CALLER's responsibility. This function resolves whatever
 * `deps.importModule` resolves and does not constrain specifier shape, because the
 * caller owns module resolution. The CLI enforces the bare-package-root and
 * provenance rules in `packages/cli/src/config/runtimePlugins.ts` before calling
 * here; any other consumer must apply an equivalent policy, since importing a
 * specifier executes its module body with full process privileges.
 */
export async function loadRuntimePlugins(
  specifiers: readonly string[],
  deps: {
    importModule: (specifier: string) => Promise<unknown>;
  } = { importModule: importPluginPackage },
): Promise<ProviderContributionRegistry> {
  const loaded: LoadedRuntimePlugin[] = [];
  let registry = buildProviderContributionRegistry(loaded);

  for (const specifier of specifiers) {
    const module = await importPluginModule(specifier, deps);
    const raw = getNamedExport(module, RUNTIME_PLUGIN_EXPORT_NAME);
    if (raw === undefined) {
      throw new Error(
        `Runtime plugin '${specifier}' must export a named ${RUNTIME_PLUGIN_EXPORT_NAME} binding, but none was found.`,
      );
    }
    // Manifest validation errors (malformed / incompatible) name the specifier
    // themselves and propagate unchanged so `instanceof` checks keep working.
    const manifest = parseRuntimePluginManifest(specifier, raw);
    loaded.push({ specifier, manifest });
    // Rebuild after every plugin so a duplicate id or alias collision fails
    // before the next configured package is imported. Importing a package runs
    // its module body, so a known-bad configuration must not execute more code
    // than it already has.
    registry = buildProviderContributionRegistry(loaded);
  }

  return registry;
}

/**
 * Default module resolution: a real dynamic import of the configured package.
 * The specifier is necessarily computed — resolving a user-configured package
 * is the entire feature — so this is the one place the loader performs it, and
 * callers are responsible for having validated the specifier first.
 */
async function importPluginPackage(specifier: string): Promise<unknown> {
  return import(specifier);
}

/**
 * Startup entry point: discover the installed plugin packages and load them.
 *
 * Installing a package is the only way to add a provider, so there is nothing
 * to configure and no list to maintain. Discovery is deterministic
 * (alphabetical by package name), which fixes plugin order and therefore
 * contributed-alias order.
 */
export async function loadInstalledRuntimePlugins(): Promise<ProviderContributionRegistry> {
  return loadRuntimePlugins(discoverRuntimePluginPackages());
}

async function importPluginModule(
  specifier: string,
  deps: { importModule: (specifier: string) => Promise<unknown> },
): Promise<unknown> {
  try {
    return await deps.importModule(specifier);
  } catch (error) {
    throw new Error(
      `Runtime plugin '${specifier}' failed to import: ` +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
}

function getNamedExport(moduleValue: unknown, exportName: string): unknown {
  if (typeof moduleValue !== 'object' || moduleValue === null) {
    return undefined;
  }
  return (moduleValue as Record<string, unknown>)[exportName];
}
