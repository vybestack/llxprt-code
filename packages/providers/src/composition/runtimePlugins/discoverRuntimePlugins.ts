/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install-driven discovery of runtime plugin packages (issue #2758).
 *
 * Installing a package is what makes a provider available. There is no setting
 * to edit and no hard-coded list of known packages, so a third-party
 * `llxprt-kookoo-provider` works exactly like a first-party one:
 *
 *   npm i -g llxprt-kookoo-provider     # or: bun add -g
 *
 * A package opts in by declaring a marker in its own `package.json`:
 *
 *   { "llxprt": { "runtimePlugin": true } }
 *
 * The marker is an explicit declaration by the package author rather than a
 * naming convention, so a package cannot be picked up by accident and a plugin
 * may be named anything.
 *
 * Install-driven discovery searches ONE directory: the `node_modules` that
 * contains this package. Those are the packages installed alongside the CLI,
 * which is exactly what `-g` installs produce, and searching one directory
 * keeps startup cost bounded.
 *
 * Running from a source checkout adds exactly one more scan: the checkout's
 * own `plugins/` directory (#2759), whose first-party plugin packages sit
 * outside every `node_modules` and would otherwise be invisible to the
 * install-driven scan even with their dependencies installed. The checkout is
 * recognized by the host's own `packages/providers` tree, so a consumer
 * project that merely has a `plugins/` directory is never scanned.
 *
 * Nothing is executed during discovery; this module only reads directory
 * entries and manifests.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The `package.json` marker a package sets to declare itself a plugin. */
export const RUNTIME_PLUGIN_MANIFEST_MARKER = 'llxprt';

/** Filesystem surface discovery needs, injectable so tests avoid real installs. */
export interface RuntimePluginDiscoveryDeps {
  /** A file path inside this package; the search root is derived from it. */
  readonly fromPath: string;
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => readonly string[];
  readonly readFile: (path: string) => string;
}

function defaultDeps(): RuntimePluginDiscoveryDeps {
  return {
    fromPath: fileURLToPath(import.meta.url),
    exists: existsSync,
    listDir: (path) => readdirSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
  };
}

/**
 * Resolve the single `node_modules` directory to search.
 *
 * When this package is installed, an ancestor directory is literally named
 * `node_modules`, and its siblings are the co-installed packages. When running
 * from a source checkout no such ancestor exists, so the nearest existing
 * `<ancestor>/node_modules` is used instead.
 */
export function resolvePluginSearchRoot(
  deps: RuntimePluginDiscoveryDeps,
): string | undefined {
  let dir = dirname(deps.fromPath);
  for (;;) {
    if (basename(dir) === 'node_modules') {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  dir = dirname(deps.fromPath);
  for (;;) {
    const candidate = join(dir, 'node_modules');
    if (deps.exists(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Expand a `node_modules` listing into package names, unwrapping scopes. */
function packageNamesIn(
  deps: RuntimePluginDiscoveryDeps,
  searchRoot: string,
): string[] {
  const visible = (entries: readonly string[]): string[] =>
    entries.filter((entry) => !entry.startsWith('.'));

  const names: string[] = [];
  for (const entry of visible(deps.listDir(searchRoot))) {
    if (entry.startsWith('@')) {
      const scoped = visible(deps.listDir(join(searchRoot, entry)));
      names.push(...scoped.map((name) => `${entry}/${name}`));
    } else {
      names.push(entry);
    }
  }
  return names;
}

/**
 * Read one candidate package manifest and report whether it declares the
 * runtime-plugin marker, together with the declared package name.
 *
 * A neighbouring package with an unreadable manifest is not this feature's
 * problem and must not stop the CLI from starting. It simply is not a plugin,
 * because a plugin has to declare the marker to be one.
 */
function readMarkerManifest(
  deps: RuntimePluginDiscoveryDeps,
  manifestPath: string,
): { isPlugin: boolean; name: string | undefined } {
  if (!deps.exists(manifestPath)) {
    return { isPlugin: false, name: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFile(manifestPath));
  } catch {
    return { isPlugin: false, name: undefined };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { isPlugin: false, name: undefined };
  }
  const record = parsed as Record<string, unknown>;
  const marker = record[RUNTIME_PLUGIN_MANIFEST_MARKER];
  const isPlugin =
    typeof marker === 'object' &&
    marker !== null &&
    (marker as Record<string, unknown>)['runtimePlugin'] === true;
  return {
    isPlugin,
    name: typeof record['name'] === 'string' ? record['name'] : undefined,
  };
}

function declaresRuntimePlugin(
  deps: RuntimePluginDiscoveryDeps,
  searchRoot: string,
  packageName: string,
): boolean {
  return readMarkerManifest(deps, join(searchRoot, packageName, 'package.json'))
    .isPlugin;
}

/**
 * Resolve the repo-local `plugins/` directory when this module runs from a
 * source checkout of this repository, or undefined in any installed layout.
 *
 * The checkout layout is recognized by the host's own `packages/providers`
 * tree next to a `plugins/` directory. Requiring both keeps this a no-op for
 * installed layouts — including a consumer project that happens to keep a
 * `plugins/` directory but does not host the providers package.
 */
export function resolveRepoCheckoutPluginRoot(
  deps: RuntimePluginDiscoveryDeps,
): string | undefined {
  let dir = dirname(deps.fromPath);
  for (;;) {
    if (
      deps.exists(join(dir, 'packages', 'providers')) &&
      deps.exists(join(dir, 'plugins'))
    ) {
      return join(dir, 'plugins');
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * The specifier a checkout plugin loads from. A checkout executes Bun-native
 * from TypeScript source (#2983) and a plugin's `dist/` build is optional
 * there, so the source entry is preferred when present. Without one, the
 * package directory itself is handed to the loader, which resolves the built
 * entry from the plugin's manifest.
 */
function checkoutPluginSpecifier(
  deps: RuntimePluginDiscoveryDeps,
  pluginDir: string,
): string {
  const sourceEntry = join(pluginDir, 'src', 'index.ts');
  return deps.exists(sourceEntry) ? sourceEntry : pluginDir;
}

/**
 * Discover the packages that declare themselves runtime plugins.
 *
 * Two sources, both deterministic so plugin load order — and therefore
 * contributed-alias order — does not depend on filesystem listing order:
 *
 *   1. the install-driven `node_modules` scan, returned as bare package names
 *      sorted alphabetically;
 *   2. when running from a source checkout, the checkout's own `plugins/`
 *      directory (#2759), returned as importable specifiers sorted by
 *      directory name.
 *
 * A plugin that is both installed and present in the checkout loads once,
 * from its installed package: installing a package is what makes a provider
 * available (#2758), and loading the same plugin twice would collide on its
 * contributed ids and aliases.
 */
export function discoverRuntimePluginPackages(
  deps: RuntimePluginDiscoveryDeps = defaultDeps(),
): readonly string[] {
  const searchRoot = resolvePluginSearchRoot(deps);
  const discovered =
    searchRoot === undefined || !deps.exists(searchRoot)
      ? []
      : packageNamesIn(deps, searchRoot).filter((name) =>
          declaresRuntimePlugin(deps, searchRoot, name),
        );
  const installed = [...discovered].sort((a, b) => a.localeCompare(b));
  const installedNames = new Set(installed);

  const checkoutRoot = resolveRepoCheckoutPluginRoot(deps);
  if (checkoutRoot === undefined || !deps.exists(checkoutRoot)) {
    return installed;
  }

  // One predicate keeps the guard order explicit: a dot-entry is skipped
  // before its manifest is ever read, a marker-declaring checkout plugin is
  // discovered only when it is actually installed, and a plugin already
  // loaded from its installed package is never re-discovered from the
  // checkout.
  const isLoadableCheckoutEntry = (entry: string): boolean => {
    if (entry.startsWith('.')) {
      return false;
    }
    const manifest = readMarkerManifest(
      deps,
      join(checkoutRoot, entry, 'package.json'),
    );
    if (!manifest.isPlugin) {
      return false;
    }
    // A checkout plugin without its own node_modules was never installed,
    // and handing it to the fail-fast loader would crash CLI startup in
    // environments that never installed plugin deps. Installing — a
    // plugin-local install creating node_modules — is what makes a provider
    // available.
    if (!deps.exists(join(checkoutRoot, entry, 'node_modules'))) {
      return false;
    }
    return manifest.name === undefined || !installedNames.has(manifest.name);
  };

  const checkout: Array<{ orderKey: string; specifier: string }> = [];
  for (const entry of deps.listDir(checkoutRoot)) {
    if (!isLoadableCheckoutEntry(entry)) {
      continue;
    }
    checkout.push({
      orderKey: entry,
      specifier: checkoutPluginSpecifier(deps, join(checkoutRoot, entry)),
    });
  }
  checkout.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  return [...installed, ...checkout.map((c) => c.specifier)];
}
