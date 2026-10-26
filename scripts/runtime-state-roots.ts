/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Derives the directories whose module-level state the audit inspects.
 *
 * The hand-maintained root lists this replaces went stale the moment the
 * runtime modules moved out of `packages/providers/src/runtime` and
 * `packages/core/src/runtime` into `packages/agents/src/api` and
 * `packages/settings/src/settings`: the scanner kept reporting clean because
 * it no longer looked at the code. A list that has to be edited whenever a
 * module moves will always lag behind the move.
 *
 * Discovery follows the repository layout instead. Every production directory
 * named `runtime`, `api` or `settings` holds runtime state by convention:
 * those are the barrels and operation modules that own session, provider and
 * settings state. Explicit files cover state that lives outside such a
 * directory (the CLI runtime context). Async-local-storage roots are the
 * package source scopes that contain those directories, because an ALS
 * declaration belongs to a package's runtime rather than to one subdirectory.
 *
 * The derivation is fail-closed. A workspace with no matching directory is an
 * error, not a clean scan, so renaming or deleting the state trees without
 * revisiting this convention cannot silently disable the check.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { workspacePath } from './runtime-state-scan.js';

export interface StateRootDiscovery {
  /** Directory names that hold runtime state, anywhere under a source root. */
  readonly directoryNames: readonly string[];
  /** Files that hold runtime state outside such a directory. */
  readonly files?: readonly string[];
}

export interface StateRoots {
  readonly mutableRoots: readonly string[];
  readonly alsRoots: readonly string[];
}

/**
 * The parts of an audit policy that determine which files hold runtime state.
 * A policy either declares explicit roots (fixtures) or the discovery
 * convention (production), never both; the two would silently union and one of
 * them would stop being the source of truth.
 */
export interface StateRootPolicy {
  readonly sourceRoots: readonly string[];
  readonly mutableRoots?: readonly string[];
  readonly alsRoots?: readonly string[];
  readonly stateRootDiscovery?: StateRootDiscovery;
}

/**
 * Resolves the effective roots for a policy. Production derives them from the
 * workspace layout; a fixture declares them explicitly.
 */
export function resolveStateRoots(
  workspace: string,
  policy: StateRootPolicy,
): StateRoots {
  if (policy.stateRootDiscovery !== undefined) {
    if (
      (policy.mutableRoots?.length ?? 0) > 0 ||
      (policy.alsRoots?.length ?? 0) > 0
    )
      throw new Error(
        'Runtime state policy declares both explicit roots and a discovery convention',
      );
    return deriveStateRoots(
      workspace,
      policy.sourceRoots,
      policy.stateRootDiscovery,
    );
  }
  return {
    mutableRoots: policy.mutableRoots ?? [],
    alsRoots: policy.alsRoots ?? [],
  };
}

const excludedDirectories = new Set([
  'node_modules',
  'dist',
  '__tests__',
  '__fixtures__',
  'fixtures',
  '__mocks__',
  'test-utils',
  'tests',
]);

function walk(
  workspace: string,
  directory: string,
  names: ReadonlySet<string>,
  found: Set<string>,
): void {
  for (const entry of readdirSync(workspacePath(workspace, directory), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || excludedDirectories.has(entry.name)) continue;
    const child = `${directory}/${entry.name}`;
    if (names.has(entry.name)) found.add(child);
    walk(workspace, child, names, found);
  }
}

/**
 * The package source scope that owns a state root, as
 * `<package>/src`. ALS declarations are recorded per package scope, so a root
 * inside `packages/agents/src/api` widens to `packages/agents/src`. The
 * shallowest `src` ancestor wins, which covers both `packages/<name>/src` and
 * the plugin layout `plugins/<name>/src`.
 */
function packageSourceScope(workspace: string, root: string): string {
  const resolved = resolve(workspace, root);
  let current = existsSync(resolved) ? resolved : dirname(resolved);
  let scope: string | undefined;
  while (current !== workspace && dirname(current) !== current) {
    const parts = relative(workspace, current).split(sep);
    if (parts[parts.length - 1] === 'src') scope = parts.join('/');
    current = dirname(current);
  }
  if (scope === undefined)
    throw new Error(
      `Runtime state root is outside a package source directory: ${root}`,
    );
  return scope;
}
/**
 * Resolves the mutable and ALS roots for a workspace. `directoryNames` must be
 * non-empty and at least one directory or file must match; otherwise the
 * discovery convention no longer describes the repository and the audit fails
 * instead of scanning nothing.
 */
export function deriveStateRoots(
  workspace: string,
  sourceRoots: readonly string[],
  discovery: StateRootDiscovery,
): StateRoots {
  if (!discovery.directoryNames.length)
    throw new Error('Runtime state discovery names no directory');
  const names = new Set(discovery.directoryNames);
  const directories = new Set<string>();
  for (const sourceRoot of sourceRoots)
    if (existsSync(workspacePath(workspace, sourceRoot)))
      walk(workspace, sourceRoot, names, directories);
  const files = discovery.files ?? [];
  for (const file of files)
    if (!existsSync(workspacePath(workspace, file)))
      throw new Error(`Runtime state file does not exist: ${file}`);
  const mutableRoots = [...directories, ...files].sort();
  if (!mutableRoots.length)
    throw new Error(
      `Runtime state discovery found no ${[...names].join('/')} directory under ${sourceRoots.join(', ')}`,
    );
  const alsRoots = [
    ...new Set(mutableRoots.map((root) => packageSourceScope(workspace, root))),
  ].sort();
  return { mutableRoots, alsRoots };
}
