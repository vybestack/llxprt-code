/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Manifest-derived internal package source verification helpers (#2352).
 *
 * Replaces the convention-derived check (which assumed the internal package
 * name suffix maps to the workspace directory and that `index.ts` is always
 * the entry point) with a manifest-derived approach:
 *
 * 1. Build a `Map<packageName, workspaceDir>` by reading each workspace's
 *    `package.json` `name` field. This is the authoritative mapping.
 * 2. For each internal dependency of a shipped workspace, look up the
 *    workspace directory via the map.
 * 3. Require the dependency's packed `package.json` and declared runtime
 *    entry/source tree based on manifest fields (`main`, `exports`, `module`,
 *    `types`), NOT a hardcoded `packages/<suffix>/index.ts`.
 * 4. Verify the transitive closure of static relative runtime imports from
 *    every entry point ships in the packed tarball (#2352 Task C).
 * 5. Verify every exported subpath (exports map keys other than ".") ships
 *    in the packed tarball (#2352 Task C).
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * A recursive exports entry value. Can be:
 * - A string (file path)
 * - A condition object mapping condition names to nested entries
 * - An array of the above
 *
 * Finding4: the exports map can contain arbitrarily nested conditional
 * exports and arrays, all of which must be recursively traversed.
 */
export type ExportsEntry =
  | string
  | ExportsConditionMap
  | readonly ExportsEntry[];
export interface ExportsConditionMap {
  readonly [condition: string]: ExportsEntry;
}

/** A workspace manifest with the fields needed for source verification. */
export interface WorkspaceManifest {
  readonly name: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: ExportsEntry | null;
}

/**
 * Result of verifying an internal workspace dependency's source shipping.
 */
export interface InternalSourceMismatch {
  readonly workspace: string;
  readonly dependency: string;
  readonly dependencyWorkspaceDir: string;
  readonly missingPackedFiles: string[];
  readonly message: string;
}

/**
 * Read and parse a workspace manifest (package.json). Returns null if the
 * file does not exist (a workspace without a package.json is not a published
 * workspace).
 */
export function readWorkspaceManifest(
  workspaceDir: string,
  repoRoot: string,
): WorkspaceManifest | null {
  const path = join(repoRoot, workspaceDir, 'package.json');
  if (!existsSync(path)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot parse ${path}: ${cause}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`package.json at ${path} is not a JSON object`);
  }
  const manifest = parsed as Record<string, unknown>;
  const name = manifest['name'];
  if (typeof name !== 'string') {
    throw new Error(`package.json at ${path} has no string "name" field`);
  }
  return {
    name,
    main: typeof manifest['main'] === 'string' ? manifest['main'] : undefined,
    module:
      typeof manifest['module'] === 'string' ? manifest['module'] : undefined,
    types:
      typeof manifest['types'] === 'string' ? manifest['types'] : undefined,
    exports: (manifest['exports'] ?? undefined) as
      | ExportsEntry
      | null
      | undefined,
  };
}

/**
 * Build a `Map<packageName, workspaceDir>` from the root workspaces list.
 * Each workspace's `package.json` is read to obtain its `name` field.
 * This is the authoritative package-name-to-workspace mapping.
 */
export function buildPackageNameToWorkspaceMap(
  repoRoot: string,
  workspaceDirs: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const wsDir of workspaceDirs) {
    const manifest = readWorkspaceManifest(wsDir, repoRoot);
    if (manifest !== null) {
      map.set(manifest.name, wsDir);
    }
  }
  return map;
}

/**
 * Extract the `bun` condition path from an exports entry, if present.
 * The `bun` condition points to the TypeScript source that Bun runs at
 * runtime (e.g. `./index.ts`). This is the most relevant entry for the
 * published root artifact, which ships TypeScript source.
 *
 * When `exports` is a string (e.g. `"exports": "./index.ts"`), it is the
 * entry point itself and is returned directly so it is validated.
 */
function extractBunCondition(
  exports: WorkspaceManifest['exports'],
): string | undefined {
  if (exports === undefined || exports === null) return undefined;
  if (typeof exports === 'string') return exports;
  const dotEntry = (exports as ExportsConditionMap)?.['.'];
  if (dotEntry === undefined || typeof dotEntry === 'string') {
    return typeof dotEntry === 'string' ? dotEntry : undefined;
  }
  const bunPath = (dotEntry as ExportsConditionMap)?.['bun'];
  return typeof bunPath === 'string' ? bunPath : undefined;
}

/**
 * Derive the packed source files that MUST ship for an internal workspace
 * dependency, based on the dependency's manifest fields.
 *
 * Priority order:
 * 1. The `package.json` itself (always required — it defines the package).
 * 2. The `exports["."].bun` condition (the TypeScript source entry for Bun).
 * 3. The `main` field (fallback if no exports bun condition).
 * 4. The `module` field (ESM runtime entry, if present).
 *
 * Type declaration paths are intentionally excluded: this invariant validates
 * the no-compile runtime closure, while the packed artifact ships source
 * rather than generated declaration output.
 * Paths are normalized to POSIX-style relative to the workspace directory.
 */
export function deriveRequiredPackedFiles(
  manifest: WorkspaceManifest,
): string[] {
  const files: string[] = ['package.json'];

  const bunCondition = extractBunCondition(manifest.exports);
  if (bunCondition !== undefined) {
    files.push(bunCondition);
  } else if (manifest.main !== undefined) {
    files.push(manifest.main);
  }

  if (manifest.module !== undefined) {
    files.push(manifest.module);
  }

  return files.map((f) => f.split(/[\\/]/).join(posix.sep));
}

/**
 * Verify that all required source files for an internal workspace dependency
 * are present in the packed file set. Returns a mismatch if any are missing.
 */
export function verifyInternalDependencySource(
  workspace: string,
  dependency: string,
  dependencyWorkspaceDir: string,
  dependencyManifest: WorkspaceManifest,
  packed: ReadonlySet<string>,
): InternalSourceMismatch | null {
  const requiredFiles = deriveRequiredPackedFiles(dependencyManifest);
  const missing: string[] = [];
  for (const file of requiredFiles) {
    const packedPath = posix.join(dependencyWorkspaceDir, file);
    if (!packed.has(packedPath)) {
      missing.push(packedPath);
    }
  }
  if (missing.length === 0) {
    return null;
  }
  const message =
    `${workspace} → ${dependency} (${dependencyWorkspaceDir}): ` +
    `required source file(s) NOT in the published tarball: ${missing.join(', ')}`;
  return {
    workspace,
    dependency,
    dependencyWorkspaceDir,
    missingPackedFiles: missing,
    message,
  };
}

function discoverScopedWorkspaces(
  scopeDir: string,
  scopeName: string,
  repoRoot: string,
): string[] {
  let entries: Array<import('node:fs').Dirent> = [];
  try {
    entries = readdirSync(scopeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => isAcceptableWorkspaceEntry(entry, scopeDir, repoRoot))
    .map((entry) => `packages/${scopeName}/${entry.name}`);
}

/**
 * Discover direct package workspaces and one nested package level below scope
 * directories such as `packages/@scope/pkg`.
 */
export function discoverPackageWorkspaces(repoRoot: string): string[] {
  const packagesDir = join(repoRoot, 'packages');
  if (!existsSync(packagesDir)) return [];
  const results: string[] = [];
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (isAcceptableWorkspaceEntry(entry, packagesDir, repoRoot)) {
      if (!entry.name.startsWith('@')) {
        results.push(`packages/${entry.name}`);
      } else {
        const scopeDir = join(packagesDir, entry.name);
        results.push(
          ...discoverScopedWorkspaces(scopeDir, entry.name, repoRoot),
        );
      }
    }
  }
  return results;
}

/**
 * Check whether a directory entry is a directory or symlink that is safe
 * to include as a workspace package.
 */
function isAcceptableWorkspaceEntry(
  entry: import('node:fs').Dirent,
  packagesDir: string,
  repoRoot: string,
): boolean {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
  return isSymlinkSafe(join(packagesDir, entry.name), repoRoot);
}

/**
 * Check whether a path is a safe (non-symlink or in-repo symlink) package
 * directory. Finding5: reject symlinks pointing outside repo root or
 * creating cycles. Follows the symlink and resolves to the canonical path,
 * rejecting targets outside the repo root or that revisit already-seen paths.
 */
function isSymlinkSafe(fullPath: string, repoRoot: string): boolean {
  let stat;
  try {
    stat = lstatSync(fullPath);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return true;
  let realPath: string;
  try {
    realPath = realpathSync(fullPath);
  } catch {
    // Broken symlink — reject
    return false;
  }
  // Canonicalize repoRoot too, since on macOS the temp dir itself may be a
  // symlink (e.g. /tmp → /private/tmp). Without this, a safe in-repo symlink
  // would be rejected because realpathSync resolves past the temp symlink.
  let canonicalRepoRoot: string;
  try {
    canonicalRepoRoot = realpathSync(repoRoot);
  } catch {
    canonicalRepoRoot = repoRoot;
  }
  // The resolved real path must be within the repo root (Finding5 root check)
  const rel = relative(canonicalRepoRoot, realPath);
  if (rel.startsWith('..') || rel === '') {
    // Points outside repo root, or is the repo root itself
    return false;
  }
  // Cycle check: resolve the real path and verify it doesn't loop back
  // to a path we've already resolved (defensive — realpathSync collapses
  // cycles at the OS level, but a circular chain of symlinks could still
  // exist in edge cases).
  try {
    const realStat = statSync(realPath);
    if (!realStat.isDirectory()) return false;
  } catch {
    return false;
  }
  return true;
}

// ─── Task C: Transitive source closure and exported subpath checks ──────────

/**
 * Extract the `bun` condition path (or `import` condition path if no bun) from
 * an exports entry value. The `bun` condition points to TypeScript source;
 * the `import` condition is the ESM runtime entry.
 */
/**
 * Recursively collect all string file paths from an exports entry value
 * (Finding4). Handles nested conditional objects and arrays to any depth.
 *
 * Priority: `bun` → `import` → `require` → `default` → any string leaf.
 * All string leaves are collected so the caller can verify each ships.
 */
function collectExportEntryPaths(
  entry: ExportsEntry | undefined,
  paths: string[],
): void {
  if (entry === undefined || entry === null) return;
  if (typeof entry === 'string') {
    paths.push(entry);
    return;
  }
  if (Array.isArray(entry)) {
    for (const item of entry) {
      collectExportEntryPaths(item, paths);
    }
    return;
  }
  // Condition object: recurse into all condition values.
  const conditionMap = entry as ExportsConditionMap;
  for (const key of Object.keys(conditionMap)) {
    collectExportEntryPaths(conditionMap[key], paths);
  }
}

/**
 * Extract entry file paths from an exports entry value (Finding4).
 * Returns all string leaf paths found by recursively traversing nested
 * conditional exports and arrays.
 */
function extractExportEntryPath(
  entry: ExportsEntry | undefined,
): string[] | undefined {
  if (entry === undefined) return undefined;
  const paths: string[] = [];
  collectExportEntryPaths(entry, paths);
  return paths.length > 0 ? paths : undefined;
}

/**
 * Derive all entry-point source files from a workspace manifest, including
 * the main entry and every exported subpath. Returns POSIX paths relative to
 * the workspace directory.
 *
 * Finding4: recursively traverses ALL conditional exports and arrays to
 * collect every string leaf path, not just the `bun` condition.
 */
export function deriveAllEntryPaths(manifest: WorkspaceManifest): string[] {
  const paths: string[] = [];

  // Finding4: recursively traverse ALL entry paths including the "." entry.
  // Previously only the `bun` condition was extracted from "."; now every
  // string leaf is collected so nested conditional exports and arrays at
  // any depth are covered.
  if (
    manifest.exports !== undefined &&
    manifest.exports !== null &&
    typeof manifest.exports === 'object' &&
    !Array.isArray(manifest.exports)
  ) {
    const exportsMap = manifest.exports as ExportsConditionMap;
    for (const [, entry] of Object.entries(exportsMap)) {
      const entryPaths = extractExportEntryPath(entry);
      if (entryPaths !== undefined) {
        paths.push(...entryPaths);
      }
    }
  } else {
    // No exports map: fall back to main/module
    const bunMain = extractBunCondition(manifest.exports);
    if (bunMain !== undefined) {
      paths.push(bunMain);
    } else if (manifest.main !== undefined) {
      paths.push(manifest.main);
    }
  }

  // If no paths were found from exports, fall back to main/module
  if (paths.length === 0) {
    const bunMain = extractBunCondition(manifest.exports);
    if (bunMain !== undefined) {
      paths.push(bunMain);
    } else if (manifest.main !== undefined) {
      paths.push(manifest.main);
    }
  }

  return paths.map((f) => f.split('/').join(posix.sep));
}

/**
 * Derive source entry-point paths for transitive closure verification.
 *
 * Unlike {@link deriveAllEntryPaths} which collects ALL leaf paths, this
 * function prefers the `bun` condition (TypeScript source) and falls back
 * to `main` only when no `bun` condition exists. This ensures the transitive
 * closure walk follows source files, not compiled output (`dist/`).
 */
function deriveSourceEntryPaths(manifest: WorkspaceManifest): string[] {
  const paths: string[] = [];
  const bunMain = extractBunCondition(manifest.exports);
  if (bunMain !== undefined) {
    paths.push(bunMain);
  } else if (manifest.main !== undefined) {
    paths.push(manifest.main);
  }
  return paths.map((f) => f.split('/').join(posix.sep));
}

/**
 * A missing source file diagnostic from the transitive closure check.
 */
export interface MissingSourceEntry {
  readonly entry: string;
  readonly missingFile: string;
  readonly message: string;
}

/**
 * Resolve a relative module specifier against a source file, applying Node's
 * extension/index resolution plus TypeScript's `.js` → `.ts` swap convention.
 * File candidates are checked BEFORE directory/index candidates so that
 * `types.ts` is preferred over `types/` when both exist.
 * Returns the POSIX path relative to `repoRoot`, or undefined if nothing on
 * disk matches.
 */
function resolveRelativeModule(
  fromFile: string,
  specifier: string,
  repoRoot: string,
): string | undefined {
  const fromDir = dirname(join(repoRoot, fromFile));
  const target = resolve(fromDir, specifier);
  // TypeScript convention: `./helper.js` may resolve to `./helper.ts`.
  // Strip a trailing `.js` so the extension candidates below find `.ts`.
  const targetNoJs = target.replace(/\.js$/, '');
  // File candidates checked first: types.ts must win over types/index.ts
  // when both `types.ts` and a `types/` directory exist. Each candidate
  // must be a FILE (not a directory) to match.
  const isFile = (p: string): boolean => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const fileCandidates = [
    target,
    targetNoJs,
    `${targetNoJs}.ts`,
    `${targetNoJs}.tsx`,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.jsx`,
    `${target}.mjs`,
    `${target}.cjs`,
    `${target}.json`,
  ];
  for (const candidate of fileCandidates) {
    if (isFile(candidate)) {
      return candidate
        .slice(repoRoot.length + 1)
        .split(/[\\/]/)
        .join(posix.sep);
    }
  }
  // Directory/index candidates: only checked if no file matched
  const dirCandidates = [
    join(target, 'index.ts'),
    join(target, 'index.tsx'),
    join(target, 'index.js'),
    join(target, 'index.jsx'),
  ];
  for (const candidate of dirCandidates) {
    if (existsSync(candidate)) {
      return candidate
        .slice(repoRoot.length + 1)
        .split(/[\\/]/)
        .join(posix.sep);
    }
  }
  return undefined;
}

/**
 * Extract relative import/require/re-export specifiers using the TypeScript
 * compiler API (Finding3). The AST correctly excludes commented-out code.
 *
 * Covers: import declarations, import-equals require, dynamic import(),
 * export ... from re-exports (named, namespace, type-only), and bare
 * require() calls with relative string-literal specifiers.
 */
function extractRelativeSpecifiersAst(
  filePath: string,
  source: string,
): string[] {
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const spec = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
      if (spec !== null && spec.startsWith('.')) result.push(spec);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('.')) result.push(spec);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const spec = node.moduleReference.expression.text;
      if (spec.startsWith('.')) result.push(spec);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      isImportOrRequireCall(node)
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) && arg.text.startsWith('.')) {
        result.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

/**
 * Check whether a CallExpression is a dynamic import() or bare require()
 * call with a string-literal argument.
 */
function isImportOrRequireCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

/**
 * Extract and enqueue all unvisited relative specifiers from a source file.
 * Helper for {@link verifyTransitiveSourceClosure} to keep its BFS loop
 * within the lint nesting limit.
 *
 * Finding3: unresolved relative specifiers (re-export targets that don't
 * exist on disk) are returned so the caller can report them as missing.
 */
function enqueueUnvisitedSpecifiers(
  source: string,
  current: string,
  repoRoot: string,
  visited: Set<string>,
  queue: string[],
): string[] {
  const unresolved: string[] = [];
  for (const specifier of extractRelativeSpecifiersAst(current, source)) {
    const resolved = resolveRelativeModule(current, specifier, repoRoot);
    if (resolved !== undefined) {
      if (!visited.has(resolved)) {
        queue.push(resolved);
      }
    } else {
      unresolved.push(specifier);
    }
  }
  return unresolved;
}

/**
 * Verify that the transitive closure of static relative runtime imports from
 * every entry point of a workspace dependency ships in the packed tarball.
 * Uses a BFS walk to follow imports transitively.
 *
 * Returns a list of missing source entries (empty if all transitively
 * required source files ship).
 */
export function verifyTransitiveSourceClosure(
  workspaceDir: string,
  manifest: WorkspaceManifest,
  packed: ReadonlySet<string>,
  repoRoot: string,
): MissingSourceEntry[] {
  const entryPaths = deriveSourceEntryPaths(manifest);
  const missing: MissingSourceEntry[] = [];
  const visited = new Set<string>();

  const queue: string[] = [];
  for (const entry of entryPaths) {
    const packedPath = posix.join(workspaceDir, entry);
    queue.push(packedPath);
  }

  let current = queue.shift();
  while (current !== undefined) {
    if (visited.has(current)) {
      current = queue.shift();
      continue;
    }
    visited.add(current);

    const absPath = join(repoRoot, current);
    const isPacked = packed.has(current);
    const exists = existsSync(absPath);

    if (isPacked && exists) {
      const source = readFileSync(absPath, 'utf8');
      const unresolved = enqueueUnvisitedSpecifiers(
        source,
        current,
        repoRoot,
        visited,
        queue,
      );
      // Finding3: unresolved relative specifiers (re-export targets that
      // don't exist on disk) must be reported as missing since the packed
      // tarball would ship a broken import.
      for (const spec of unresolved) {
        missing.push({
          entry: current,
          missingFile: spec,
          message: `${current} references '${spec}' which does not exist on disk and is NOT in the published tarball`,
        });
      }
    } else if (isPacked && !exists) {
      missing.push({
        entry: current,
        missingFile: current,
        message: `${current} is listed in the published tarball but does not exist on disk`,
      });
    } else if (!isPacked) {
      missing.push({
        entry: current,
        missingFile: current,
        message: `${current} is required transitively but is NOT in the published tarball`,
      });
    }
    current = queue.shift();
  }

  return missing;
}

/**
 * Verify that every exported subpath entry file ships in the packed tarball.
 * Returns a list of missing entries (empty if all ship).
 */
export function verifyExportedSubpaths(
  workspaceDir: string,
  manifest: WorkspaceManifest,
  packed: ReadonlySet<string>,
): MissingSourceEntry[] {
  const missing: MissingSourceEntry[] = [];
  if (
    manifest.exports !== undefined &&
    manifest.exports !== null &&
    typeof manifest.exports === 'object' &&
    !Array.isArray(manifest.exports)
  ) {
    const exportsMap = manifest.exports as ExportsConditionMap;
    for (const [subpath, entry] of Object.entries(exportsMap)) {
      collectMissingSubpath(workspaceDir, subpath, entry, packed, missing);
    }
  }
  return missing;
}

/**
 * Extract the preferred source entry path from an exports entry value.
 * Prefers the `bun` condition (TypeScript source); falls back to `import`,
 * then `require`, then `default`, then any first string leaf.
 */
function extractPreferredSourcePath(
  entry: ExportsEntry | undefined,
): string | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    return entry.length > 0 && typeof entry[0] === 'string'
      ? entry[0]
      : extractPreferredSourcePath(entry[0]);
  }
  // Condition map: prefer bun, then import, then require, then default
  const conditionMap = entry as ExportsConditionMap;
  const preferred =
    conditionMap.bun ??
    conditionMap.import ??
    conditionMap.require ??
    conditionMap.default;
  if (preferred !== undefined) {
    if (typeof preferred === 'string') return preferred;
    return extractPreferredSourcePath(preferred);
  }
  // Fall back to first value
  const firstValue = Object.values(conditionMap)[0];
  if (firstValue !== undefined) {
    if (typeof firstValue === 'string') return firstValue;
    return extractPreferredSourcePath(firstValue);
  }
  return undefined;
}

/**
 * Check a single exported subpath entry and record a mismatch if its entry
 * file is not packed. Extracted from {@link verifyExportedSubpaths} to keep
 * the loop within the lint nesting limit.
 *
 * Finding4: recursively traverse nested conditional exports and arrays.
 * Prefers the `bun` (source) condition path so the check verifies source
 * files ship, not compiled output.
 */
function collectMissingSubpath(
  workspaceDir: string,
  subpath: string,
  entry: ExportsEntry,
  packed: ReadonlySet<string>,
  missing: MissingSourceEntry[],
): void {
  if (subpath === '.') return;
  const entryPath = extractPreferredSourcePath(entry);
  if (entryPath === undefined) return;
  const packedPath = posix.join(workspaceDir, entryPath);
  if (packed.has(packedPath)) return;
  missing.push({
    entry: subpath,
    missingFile: packedPath,
    message:
      `${workspaceDir} exports subpath "${subpath}" → ${entryPath} ` +
      `(${packedPath}) which is NOT in the published tarball`,
  });
}
