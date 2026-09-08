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
 * Only ONE directory is searched: the `node_modules` that contains this
 * package. Those are the packages installed alongside the CLI, which is
 * exactly what `-g` installs produce, and searching one directory keeps
 * startup cost bounded. Nothing is executed during discovery; this module only
 * reads directory entries and manifests.
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

function declaresRuntimePlugin(
  deps: RuntimePluginDiscoveryDeps,
  searchRoot: string,
  packageName: string,
): boolean {
  const manifestPath = join(searchRoot, packageName, 'package.json');
  if (!deps.exists(manifestPath)) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readFile(manifestPath));
  } catch {
    // A neighbouring package with an unreadable manifest is not this feature's
    // problem and must not stop the CLI from starting. It simply is not a
    // plugin, because a plugin has to declare the marker to be one.
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return false;
  }
  const marker = (parsed as Record<string, unknown>)[
    RUNTIME_PLUGIN_MANIFEST_MARKER
  ];
  if (typeof marker !== 'object' || marker === null) {
    return false;
  }
  return (marker as Record<string, unknown>)['runtimePlugin'] === true;
}

/**
 * Discover the installed packages that declare themselves runtime plugins.
 *
 * Returns package names sorted alphabetically so plugin load order, and
 * therefore contributed-alias order, is deterministic across machines and
 * filesystem listing orders.
 */
export function discoverRuntimePluginPackages(
  deps: RuntimePluginDiscoveryDeps = defaultDeps(),
): readonly string[] {
  const searchRoot = resolvePluginSearchRoot(deps);
  if (searchRoot === undefined || !deps.exists(searchRoot)) {
    return [];
  }
  const discovered = packageNamesIn(deps, searchRoot).filter((name) =>
    declaresRuntimePlugin(deps, searchRoot, name),
  );
  return [...discovered].sort((a, b) => a.localeCompare(b));
}
