/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps workspace package specifiers to their implementation sources.
 *
 * The state scan builds its own program from the files inside the runtime
 * state roots. Those files import runtime helpers through package names
 * (`@vybestack/llxprt-code-core/runtime/...js`), and TypeScript resolves such
 * a specifier through the package `exports` map. Every workspace package here
 * names `types` first, which points at emitted declarations, and a declaration
 * carries no function body. An imported mutator therefore had no body to
 * follow and cross-package mutation of module state went unseen.
 *
 * This module reads each workspace package manifest and returns the source
 * target behind the `bun` condition, which is the shipped TypeScript. When an
 * entry has no `bun` condition, the emitted path is mapped back to source
 * (`dist/src/x.js` and `dist/src/x.d.ts` both name `src/x.ts`) and only used
 * if that source exists. The scan host uses the map for workspace specifiers
 * and TypeScript's own resolution for everything else, so no package `exports`
 * map and no tsconfig `paths` entry changes to make the scan see the code.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export interface WorkspaceModuleMap {
  /**
   * Absolute implementation source for a workspace package specifier, or
   * undefined when the specifier is not a workspace package entry with a
   * source target. Callers then fall back to TypeScript's own resolution.
   */
  sourceFor(specifier: string): string | undefined;
}

interface Manifest {
  readonly name?: unknown;
  readonly exports?: unknown;
}

function manifestAt(directory: string): Manifest | undefined {
  const path = join(directory, 'package.json');
  try {
    if (!statSync(path).isFile()) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

/**
 * Workspace package directories, in the order the repository declares them.
 * Only directories that carry a manifest participate.
 */
export function workspacePackageDirectories(workspace: string): string[] {
  const directories: string[] = [];
  for (const group of ['packages', 'plugins']) {
    const root = join(workspace, group);
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries)
      if (manifestAt(join(root, entry)) !== undefined)
        directories.push(join(root, entry));
  }
  return directories;
}

function conditionTarget(
  value: unknown,
  condition: string,
): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const target = (value as Record<string, unknown>)[condition];
  return typeof target === 'string' ? target : undefined;
}

/**
 * Maps an emitted path back to the source file that produces it. The build
 * layout is `dist/src/<path>.js` (or `.d.ts`) for `src/<path>.ts`, so the
 * mapping is a prefix rewrite rather than a search, and a source that does not
 * exist yields undefined instead of a guess.
 */
function sourceFromEmitted(
  packageDirectory: string,
  emitted: string,
): string | undefined {
  const mapped = emitted
    .replace(/^\.\/dist\//, './src/')
    .replace(/\.d\.ts$/, '.ts')
    .replace(/\.js$/, '.ts');
  if (mapped === emitted) return undefined;
  const path = resolve(packageDirectory, mapped);
  if (existsSync(path)) return path;
  const tsx = path.replace(/\.ts$/, '.tsx');
  return existsSync(tsx) ? tsx : undefined;
}

interface Entry {
  readonly specifier: string;
  readonly source: string;
}

function entries(
  packageDirectory: string,
  name: string,
  exportsField: unknown,
): Entry[] {
  const table =
    typeof exportsField === 'object' &&
    exportsField !== null &&
    !Array.isArray(exportsField)
      ? (exportsField as Record<string, unknown>)
      : { '.': exportsField };
  const resolved: Entry[] = [];
  for (const [subpath, target] of Object.entries(table)) {
    const source =
      conditionTarget(target, 'bun') ??
      sourceFromEmitted(
        packageDirectory,
        conditionTarget(target, 'types') ?? '',
      ) ??
      sourceFromEmitted(
        packageDirectory,
        conditionTarget(target, 'import') ?? '',
      );
    if (source === undefined) continue;
    const suffix = subpath === '.' ? '' : subpath.slice(2);
    resolved.push({
      specifier: `${name}/${suffix}`,
      source: resolve(packageDirectory, source),
    });
  }
  return resolved;
}

/**
 * Builds the workspace package map once per scan. A duplicate specifier keeps
 * the first package that declares it; two manifests claiming one specifier is
 * a repository conflict, not a resolution preference.
 */
export function workspaceModuleMap(workspace: string): WorkspaceModuleMap {
  const sources = new Map<string, string>();
  for (const directory of workspacePackageDirectories(workspace)) {
    const manifest = manifestAt(directory);
    if (!manifest || typeof manifest.name !== 'string') continue;
    for (const entry of entries(directory, manifest.name, manifest.exports))
      if (!sources.has(entry.specifier))
        sources.set(entry.specifier, entry.source);
  }
  const lookup = (specifier: string): string | undefined => {
    const exact = sources.get(specifier);
    if (exact !== undefined) return exact;
    // `exports` keys carry the emitted `.js` extension; a source import may
    // name the same subpath without it.
    return /\.js$/.test(specifier) ? undefined : sources.get(`${specifier}.js`);
  };
  return { sourceFor: lookup };
}

function extensionOf(source: string): ts.Extension {
  if (source.endsWith('.tsx')) return ts.Extension.Tsx;
  if (source.endsWith('.mts')) return ts.Extension.Mts;
  if (source.endsWith('.cts')) return ts.Extension.Cts;
  return ts.Extension.Ts;
}

/**
 * Wraps a compiler host so a specifier naming a workspace package resolves to
 * that package's implementation source and every other specifier resolves
 * exactly as it would have without the wrapper.
 */
export function withWorkspaceModules(
  host: ts.CompilerHost,
  modules: WorkspaceModuleMap,
): ts.CompilerHost {
  const resolveLiterals = host.resolveModuleNameLiterals?.bind(host);
  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
    reusedNames,
  ) =>
    moduleLiterals.map((literal) => {
      const source = modules.sourceFor(literal.text);
      if (source !== undefined)
        return {
          resolvedModule: {
            resolvedFileName: source,
            extension: extensionOf(source),
            isExternalLibraryImport: false,
          },
        };
      return resolveLiterals
        ? resolveLiterals(
            [literal],
            containingFile,
            redirectedReference,
            options,
            containingSourceFile,
            reusedNames,
          )[0]
        : {
            resolvedModule: ts.resolveModuleName(
              literal.text,
              containingFile,
              options,
              host,
            ).resolvedModule,
          };
    });
  return host;
}

export function compilerHostWithWorkspaceModules(
  workspace: string,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  return withWorkspaceModules(
    ts.createCompilerHost(options, true),
    workspaceModuleMap(workspace),
  );
}

export function packageDirectoryOf(directory: string): string | undefined {
  let current = resolve(directory);
  while (dirname(current) !== current) {
    if (manifestAt(current) !== undefined) return current;
    current = dirname(current);
  }
  return undefined;
}
