#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-runtime-dependency-declarations.ts
 *
 * Enforces that every NPM-published workspace package declares the packages it
 * imports at runtime (#3305).
 *
 * `packages/mcp` value-imported `@vybestack/llxprt-code-core` while declaring it
 * in `devDependencies` only. `scripts/bind-release-deps.ts` rewrites `file:`
 * specifiers in every dependency section at release time, so the published
 * manifest carried core in a section that `npm install` never installs for a
 * consumer. The shipped `dist/mcp/**` still emitted bare
 * `@vybestack/llxprt-code-core/...` specifiers, so `npm i
 * @vybestack/llxprt-code-mcp` produced a package that could not resolve its own
 * imports. Workspace hoisting and the tsconfig path wildcards hid this in-repo.
 *
 * A package declared only in `devDependencies` is therefore a FAILURE here:
 * that is precisely the defect shape.
 *
 * "Production source" is defined by reachability, not by filename convention:
 * a file counts if it is reachable by transitive relative import from one of
 * the package's published source entrypoints. There is deliberately no
 * "looks like a test" path allowlist, because such a list can be widened to
 * make a real violation disappear.
 *
 * Specifier extraction uses the TypeScript compiler API so commented-out code
 * and string literals cannot produce false positives, and so type-only imports
 * (which are erased and never reach the runtime graph) can be excluded
 * precisely.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NON_NPM_RELEASE_PACKAGES } from './utils/release-packages.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A conditional-exports entry value, to any nesting depth. */
export type ExportsEntry =
  | string
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry | undefined }
  | undefined;

/** The subset of a workspace manifest this guard reads. */
export interface WorkspaceManifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly main?: string;
  readonly exports?: ExportsEntry;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

/** A bare runtime import found in a production source file. */
export interface BareRuntimeImport {
  readonly specifier: string;
  readonly packageName: string;
  readonly line: number;
}

/** An undeclared runtime dependency. */
export interface RuntimeDependencyViolation {
  readonly workspaceDir: string;
  readonly packageName: string;
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly importedPackage: string;
  readonly declaredIn: readonly string[];
  readonly message: string;
}

// ─── Repo root ──────────────────────────────────────────────────────────────

/**
 * Anchor the repo root to THIS script's location rather than `process.cwd()`,
 * so the guard is deterministic regardless of the invoking directory. Tests
 * pass their own root explicitly, so no environment override is needed.
 */
export function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// ─── Specifier classification ───────────────────────────────────────────────

const BUILTIN_MODULES: ReadonlySet<string> = new Set(builtinModules);

/** Whether a specifier points at a path rather than a package. */
export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

/**
 * Resolve a bare specifier to the package that must be installed for it.
 * `@scope/name/sub/path.js` → `@scope/name`; `pkg/sub.js` → `pkg`.
 */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return segments.slice(0, 2).join('/');
  }
  return segments[0];
}

/**
 * Whether a specifier is satisfied by the runtime itself and so never needs a
 * manifest declaration. Node builtins are accepted with and without the `node:`
 * prefix because both forms resolve; `bun:` modules are Bun intrinsics.
 */
export function isRuntimeProvidedSpecifier(specifier: string): boolean {
  if (specifier.startsWith('bun:')) return true;
  if (specifier.startsWith('node:')) return true;
  return BUILTIN_MODULES.has(packageNameOf(specifier));
}

// ─── AST extraction ─────────────────────────────────────────────────────────

function parseSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/**
 * Whether an import declaration contributes to the runtime graph.
 *
 * `import type ...` is erased. So is a declaration whose named bindings are all
 * inline-type (`import { type A, type B } from 'x'`). A default binding, a
 * namespace binding, a bare side-effect import, or any value-named binding
 * makes it a runtime import.
 */
function isRuntimeImportDeclaration(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    // `import 'x'` — a side-effect import, evaluated at runtime.
    return true;
  }
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined) return true;
  if (ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

/** Whether an `export ... from` declaration contributes to the runtime graph. */
function isRuntimeExportDeclaration(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  if (clause === undefined) {
    // `export * from 'x'` — re-exports values at runtime.
    return true;
  }
  if (ts.isNamespaceExport(clause)) return true;
  return clause.elements.some((element) => !element.isTypeOnly);
}

/** Whether a call expression is a dynamic `import()` or a bare `require()`. */
function isImportOrRequireCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

/**
 * The static text of a module specifier, or null when it is computed.
 *
 * No-substitution template literals count: `` import(`some-pkg`) `` resolves
 * to a fixed package at runtime exactly like a quoted string, so excluding it
 * would let a real dependency escape the guard.
 */
function literalSpecifierOf(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function collectFromImportDeclaration(
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  found: string[][],
): void {
  if (!isRuntimeImportDeclaration(node)) return;
  const specifier = literalSpecifierOf(node.moduleSpecifier);
  if (specifier === null) return;
  found.push([specifier, String(lineOf(sourceFile, node))]);
}

function collectFromExportDeclaration(
  node: ts.ExportDeclaration,
  sourceFile: ts.SourceFile,
  found: string[][],
): void {
  if (!isRuntimeExportDeclaration(node)) return;
  const specifier = literalSpecifierOf(node.moduleSpecifier);
  if (specifier === null) return;
  found.push([specifier, String(lineOf(sourceFile, node))]);
}

function collectFromNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  found: string[][],
): void {
  if (ts.isImportDeclaration(node)) {
    collectFromImportDeclaration(node, sourceFile, found);
    return;
  }
  if (ts.isExportDeclaration(node)) {
    collectFromExportDeclaration(node, sourceFile, found);
    return;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    !node.isTypeOnly &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const specifier = literalSpecifierOf(node.moduleReference.expression);
    if (specifier !== null) {
      found.push([specifier, String(lineOf(sourceFile, node))]);
    }
    return;
  }
  if (
    ts.isCallExpression(node) &&
    node.arguments.length > 0 &&
    isImportOrRequireCall(node)
  ) {
    const specifier = literalSpecifierOf(node.arguments[0]);
    if (specifier !== null) {
      found.push([specifier, String(lineOf(sourceFile, node))]);
    }
  }
}

/** Every module specifier that contributes to the runtime graph, with lines. */
function extractRuntimeSpecifiers(
  filePath: string,
  source: string,
): Array<{ specifier: string; line: number }> {
  const sourceFile = parseSourceFile(filePath, source);
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    collectFromNode(node, sourceFile, found);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found.map(([specifier, line]) => ({
    specifier,
    line: Number(line),
  }));
}

/**
 * The bare (package) runtime imports of one source file, excluding runtime
 * builtins and relative paths.
 */
export function extractBareRuntimeImports(
  filePath: string,
  source: string,
): BareRuntimeImport[] {
  return extractRuntimeSpecifiers(filePath, source)
    .filter(
      ({ specifier }) =>
        !isRelativeSpecifier(specifier) &&
        !isRuntimeProvidedSpecifier(specifier),
    )
    .map(({ specifier, line }) => ({
      specifier,
      packageName: packageNameOf(specifier),
      line,
    }));
}

// ─── Entry points and reachability ──────────────────────────────────────────

function collectBunConditionPaths(entry: ExportsEntry, paths: string[]): void {
  if (entry === undefined || entry === null) return;
  if (typeof entry === 'string') {
    paths.push(entry);
    return;
  }
  if (Array.isArray(entry)) {
    for (const item of entry) collectBunConditionPaths(item, paths);
    return;
  }
  // Prefer the `bun` condition: it points at TypeScript source, whereas
  // `import`/`require` point at build output that may not exist yet. The
  // remaining conditions are a fallback chain so a subpath that exposes only
  // `require` (or only `default`) still contributes an entrypoint rather than
  // dropping out of the scan unnoticed.
  for (const condition of ['bun', 'import', 'require', 'default'] as const) {
    if (entry[condition] !== undefined) {
      collectBunConditionPaths(entry[condition], paths);
      return;
    }
  }
}

/**
 * Source entry-point paths for a manifest, relative to the workspace dir.
 * Every subpath key of `exports` contributes, not just `"."`, because a
 * consumer may import any of them.
 *
 * `main` and a bare `index.ts` are fallbacks used only when `exports` yields
 * nothing. Every published workspace here declares a `bun` condition pointing
 * at TypeScript source while `main` points into `dist/`, so preferring the
 * exports map keeps the guard off build output. Scanning `dist/` would make the
 * result depend on whether the tree happens to be built, and would report the
 * same defect twice.
 */
export function deriveSourceEntryPaths(manifest: WorkspaceManifest): string[] {
  const paths: string[] = [];
  const exportsMap = manifest.exports;
  if (
    exportsMap !== undefined &&
    exportsMap !== null &&
    typeof exportsMap === 'object' &&
    !Array.isArray(exportsMap)
  ) {
    for (const entry of Object.values(exportsMap)) {
      collectBunConditionPaths(entry, paths);
    }
  } else {
    collectBunConditionPaths(exportsMap, paths);
  }
  if (paths.length === 0 && manifest.main !== undefined) {
    paths.push(manifest.main);
  }
  if (paths.length === 0) {
    paths.push('index.ts');
  }
  return [...new Set(paths.map((path) => path.replace(/^\.\//, '')))];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a relative specifier against a source file, applying Node's
 * extension/index resolution plus TypeScript's `./x.js` → `./x.ts` convention.
 * File candidates are checked before directory/index candidates so `types.ts`
 * wins over `types/index.ts` when both exist.
 */
export function resolveRelativeModule(
  fromAbsFile: string,
  specifier: string,
): string | undefined {
  const target = resolve(dirname(fromAbsFile), specifier);
  const targetNoJs = target.replace(/\.(js|jsx|mjs|cjs)$/, '');
  const fileCandidates = [
    target,
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
    if (isFile(candidate)) return candidate;
  }
  for (const base of [targetNoJs, target]) {
    for (const indexName of ['index.ts', 'index.tsx', 'index.js']) {
      const candidate = join(base, indexName);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function toPosixRepoRelative(absPath: string, repoRoot: string): string {
  return absPath
    .slice(repoRoot.length + 1)
    .split(/[\\/]/)
    .join(posix.sep);
}

/**
 * Whether `absPath` is `absDir` or lives beneath it.
 *
 * Compared via `relative` rather than a string prefix: on Windows `resolve`
 * produces backslash-separated paths, so a hard-coded `/` prefix test would
 * reject every file and the guard would silently scan nothing and pass.
 */
function isInsideDirectory(absPath: string, absDir: string): boolean {
  const rel = relative(absDir, absPath);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return (
    rel !== '..' && !rel.startsWith(`..${posix.sep}`) && !rel.startsWith('..\\')
  );
}

function enqueueRelativeImports(
  absFile: string,
  source: string,
  absWorkspaceDir: string,
  visited: ReadonlySet<string>,
  queue: string[],
): void {
  const reachable = extractRuntimeSpecifiers(absFile, source)
    .filter(({ specifier }) => isRelativeSpecifier(specifier))
    .map(({ specifier }) => resolveRelativeModule(absFile, specifier))
    .filter((resolved): resolved is string => resolved !== undefined)
    .filter((resolved) => isInsideDirectory(resolved, absWorkspaceDir))
    .filter((resolved) => !visited.has(resolved));
  queue.push(...reachable);
}

/**
 * The production source set of a workspace: every file reachable by transitive
 * relative import from a published source entrypoint. Returned as absolute
 * paths, sorted for deterministic reporting.
 */
export function collectProductionSourceFiles(
  workspaceDir: string,
  manifest: WorkspaceManifest,
  repoRoot: string,
): string[] {
  const absWorkspaceDir = resolve(repoRoot, workspaceDir);
  const queue: string[] = [];
  for (const entry of deriveSourceEntryPaths(manifest)) {
    const candidate = resolve(absWorkspaceDir, entry);
    const resolved = isFile(candidate)
      ? candidate
      : resolveRelativeModule(
          join(absWorkspaceDir, 'placeholder.ts'),
          `./${entry}`,
        );
    if (
      resolved !== undefined &&
      isInsideDirectory(resolved, absWorkspaceDir)
    ) {
      queue.push(resolved);
    }
  }

  const visited = new Set<string>();
  let current = queue.shift();
  while (current !== undefined) {
    if (!visited.has(current)) {
      visited.add(current);
      // `.d.ts` files are types only and never contribute runtime imports.
      if (!current.endsWith('.d.ts')) {
        const source = readFileSync(current, 'utf8');
        enqueueRelativeImports(
          current,
          source,
          absWorkspaceDir,
          visited,
          queue,
        );
      }
    }
    current = queue.shift();
  }
  return [...visited].sort();
}

// ─── Declaration checking ───────────────────────────────────────────────────

const RUNTIME_SECTIONS = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

const ALL_SECTIONS = [...RUNTIME_SECTIONS, 'devDependencies'] as const;

function sectionsDeclaring(
  manifest: WorkspaceManifest,
  packageName: string,
): string[] {
  return ALL_SECTIONS.filter((section) => {
    const deps = manifest[section];
    return deps !== undefined && packageName in deps;
  });
}

function isDeclaredForRuntime(
  manifest: WorkspaceManifest,
  packageName: string,
): boolean {
  return RUNTIME_SECTIONS.some((section) => {
    const deps = manifest[section];
    return deps !== undefined && packageName in deps;
  });
}

function violationMessage(
  workspaceDir: string,
  file: string,
  line: number,
  specifier: string,
  importedPackage: string,
  declaredIn: readonly string[],
): string {
  const where =
    declaredIn.length === 0
      ? 'is not declared at all'
      : `is declared only in ${declaredIn.join(', ')}`;
  return (
    `${file}:${line}: imports "${specifier}" at runtime, but ` +
    `"${importedPackage}" ${where} in ${workspaceDir}/package.json — ` +
    'add it to "dependencies" (or "peerDependencies"/"optionalDependencies"). ' +
    'A devDependencies-only declaration is never installed for a consumer.'
  );
}

/**
 * Undeclared runtime imports of a single workspace.
 *
 * `productionSourceFiles` lets a caller that already walked the closure reuse
 * it instead of re-reading and re-parsing every file.
 */
export function checkWorkspaceRuntimeDeclarations(
  workspaceDir: string,
  manifest: WorkspaceManifest,
  repoRoot: string,
  productionSourceFiles?: readonly string[],
): RuntimeDependencyViolation[] {
  const violations: RuntimeDependencyViolation[] = [];
  const selfName = manifest.name;
  const sourceFiles =
    productionSourceFiles ??
    collectProductionSourceFiles(workspaceDir, manifest, repoRoot);
  for (const absFile of sourceFiles) {
    const source = readFileSync(absFile, 'utf8');
    const file = toPosixRepoRelative(absFile, repoRoot);
    const undeclared = extractBareRuntimeImports(absFile, source).filter(
      (bare) =>
        bare.packageName !== selfName &&
        !isDeclaredForRuntime(manifest, bare.packageName),
    );
    for (const bare of undeclared) {
      const declaredIn = sectionsDeclaring(manifest, bare.packageName);
      violations.push({
        workspaceDir,
        packageName: selfName ?? workspaceDir,
        file,
        line: bare.line,
        specifier: bare.specifier,
        importedPackage: bare.packageName,
        declaredIn,
        message: violationMessage(
          workspaceDir,
          file,
          bare.line,
          bare.specifier,
          bare.packageName,
          declaredIn,
        ),
      });
    }
  }
  return violations;
}

// ─── Workspace discovery ────────────────────────────────────────────────────

interface RootManifest {
  readonly workspaces?: unknown;
}

function readManifest(path: string): WorkspaceManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as WorkspaceManifest;
}

/**
 * Workspace directories that the release pipeline publishes to NPM. Private
 * packages and the explicitly non-NPM packages are excluded: nothing installs
 * them from a registry, so their declarations cannot break a consumer.
 */
export function discoverPublishedWorkspaces(
  repoRoot: string,
): Array<{ workspaceDir: string; manifest: WorkspaceManifest }> {
  const rootManifest = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ) as RootManifest;
  const declared = rootManifest.workspaces;
  if (!Array.isArray(declared)) {
    throw new Error('Root package.json must declare a workspaces array.');
  }
  const workspaceDirs = declared.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  const globbed = workspaceDirs.filter((entry) => /[*?[\]{}]/.test(entry));
  if (globbed.length > 0) {
    throw new Error(
      `Glob workspace patterns are not supported by this guard: ${globbed.join(', ')}`,
    );
  }
  return workspaceDirs
    .map((workspaceDir) => ({
      workspaceDir,
      manifestPath: join(repoRoot, workspaceDir, 'package.json'),
    }))
    .filter(({ manifestPath }) => existsSync(manifestPath))
    .map(({ workspaceDir, manifestPath }) => ({
      workspaceDir,
      manifest: readManifest(manifestPath),
    }))
    .filter(({ manifest }) => isPublishedToNpm(manifest));
}

/**
 * Whether the release pipeline publishes this workspace to NPM. Private and
 * explicitly non-NPM packages are never installed from a registry, so their
 * declarations cannot break a consumer.
 */
function isPublishedToNpm(manifest: WorkspaceManifest): boolean {
  if (manifest.private === true) return false;
  return (
    manifest.name === undefined || !NON_NPM_RELEASE_PACKAGES.has(manifest.name)
  );
}

/** Undeclared runtime imports across every published workspace. */
export function checkAllWorkspaces(
  repoRoot: string,
): RuntimeDependencyViolation[] {
  return discoverPublishedWorkspaces(repoRoot).flatMap(
    ({ workspaceDir, manifest }) =>
      checkWorkspaceRuntimeDeclarations(workspaceDir, manifest, repoRoot),
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

function groupByWorkspace(
  violations: readonly RuntimeDependencyViolation[],
): Map<string, RuntimeDependencyViolation[]> {
  const grouped = new Map<string, RuntimeDependencyViolation[]>();
  for (const violation of violations) {
    const existing = grouped.get(violation.workspaceDir);
    if (existing === undefined) {
      grouped.set(violation.workspaceDir, [violation]);
    } else {
      existing.push(violation);
    }
  }
  return grouped;
}

function main(): void {
  const repoRoot = defaultRepoRoot();
  const workspaces = discoverPublishedWorkspaces(repoRoot);
  console.log(
    `Checking runtime dependency declarations across ${workspaces.length} published workspace(s)...`,
  );

  let scannedFiles = 0;
  const violations: RuntimeDependencyViolation[] = [];
  for (const { workspaceDir, manifest } of workspaces) {
    // Walk the closure once and reuse it for both the count and the check.
    const sourceFiles = collectProductionSourceFiles(
      workspaceDir,
      manifest,
      repoRoot,
    );
    scannedFiles += sourceFiles.length;
    violations.push(
      ...checkWorkspaceRuntimeDeclarations(
        workspaceDir,
        manifest,
        repoRoot,
        sourceFiles,
      ),
    );
  }

  if (violations.length === 0) {
    console.log(
      `\nPASS: ${scannedFiles} production source file(s) import only declared packages.`,
    );
    process.exit(0);
  }

  console.log(`\nFAIL: ${violations.length} undeclared runtime import(s):\n`);
  for (const [workspaceDir, group] of groupByWorkspace(violations)) {
    console.log(`  ${workspaceDir}:`);
    for (const violation of group) {
      console.log(`    ${violation.message}`);
    }
    console.log('');
  }
  console.log(
    'A published package must declare everything it imports at runtime; ' +
      'workspace hoisting hides this in-repo but breaks the published tarball.',
  );
  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
