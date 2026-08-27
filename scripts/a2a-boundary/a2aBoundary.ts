/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A host import boundary (issue #3221).
 *
 * packages/a2a-server is a HOST of the public Agent facade, not a co-owner of
 * the runtime. This module generalizes the CLI boundary checker to the a2a
 * host tree with FAIL-CLOSED semantics:
 *
 * - Every import specifier (static import, import equals, dynamic import(),
 *   vi.mock) must be a node builtin, a relative path, exactly `bun:test`, the
 *   A2A transport SDK (@a2a-js/sdk or its subpaths), a ROOT entrypoint of a
 *   runtime package (@vybestack/llxprt-code-{agents,core,mcp,storage} with NO
 *   subpath), or a declared dependency of packages/a2a-server (the dependency
 *   or its subpaths — derived from package.json so the allowlist cannot drift
 *   from the manifest).
 * - Absolute specifiers are rejected (they bypass package boundaries).
 * - Non-literal dynamic imports and non-literal mock-family calls
 *   (vi.mock/doMock/importActual/importMock, bare mock(...)) are rejected —
 *   a specifier this checker cannot read could hide a deep runtime import.
 * - Even from ALLOWED runtime roots, importing the legacy runtime-assembly
 *   symbols (Config, AgentClient) is rejected: the host must reach the
 *   runtime through the public Agent facade, never through legacy
 *   construction reach-through.
 *
 * Matching is exact-or-subpath (pkg or pkg/...), never prefix-based, so
 * lookalike names (@a2a-js/sdkish) fail closed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative as pathRelative } from 'node:path';
import ts from 'typescript';

/** Runtime packages whose ROOT entrypoints a host may import. */
export const RUNTIME_ROOT_PACKAGES: readonly string[] = [
  '@vybestack/llxprt-code-agents',
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-mcp',
  '@vybestack/llxprt-code-storage',
];

/**
 * Legacy runtime-assembly symbols that must never be imported by a host, even
 * from an allowed runtime root: they are the pre-facade reach-through surface.
 */
export const BANNED_RUNTIME_SYMBOLS: readonly string[] = [
  'Config',
  'AgentClient',
];

/** The A2A transport SDK (root or any subpath). */
const A2A_SDK = '@a2a-js/sdk';

export interface A2aSpecifierEvaluation {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface A2aImportViolation {
  readonly file: string;
  readonly line: number;
  readonly kind:
    | 'static-import'
    | 'import-equals'
    | 'dynamic-import'
    | 'dynamic-import-non-literal'
    | 'vi.mock'
    | 'vi.mock-non-literal'
    | 'require'
    | 'require-non-literal'
    | 'banned-symbol'
    | 'runtime-root-form';
  readonly detail: string;
  readonly reason: string;
}

export interface A2aBoundaryResult {
  readonly violations: readonly A2aImportViolation[];
  readonly fileCount: number;
}

/** True when `specifier` addresses `pkg` exactly or a subpath of it. */
function isPackageOrSubpath(specifier: string, pkg: string): boolean {
  return specifier === pkg || specifier.startsWith(pkg + '/');
}

/**
 * Evaluates one module specifier against the fail-closed allowlist.
 * `declaredDependencies` are the keys of the host package's dependencies.
 */
export function evaluateSpecifier(
  specifier: string,
  declaredDependencies: readonly string[],
): A2aSpecifierEvaluation {
  if (specifier.startsWith('/') || specifier.startsWith('\\')) {
    return {
      allowed: false,
      reason: 'absolute specifiers bypass package boundaries',
    };
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return { allowed: true, reason: 'relative path' };
  }
  if (specifier === 'node:test') {
    // node:test would drag the node test runner into a bun test tree; the
    // host uses bun:test.
    return { allowed: false, reason: 'node:test is not the host test runner' };
  }
  if (specifier.startsWith('node:')) {
    return { allowed: true, reason: 'node builtin' };
  }
  if (specifier === 'bun:test') {
    return { allowed: true, reason: 'test runner' };
  }
  if (isPackageOrSubpath(specifier, A2A_SDK)) {
    return { allowed: true, reason: 'A2A transport SDK' };
  }
  for (const runtime of RUNTIME_ROOT_PACKAGES) {
    if (specifier === runtime) {
      return { allowed: true, reason: 'runtime package ROOT entrypoint' };
    }
    if (isPackageOrSubpath(specifier, runtime)) {
      return {
        allowed: false,
        reason: `${runtime} deep subpaths are runtime internals; import the root entrypoint only`,
      };
    }
  }
  for (const dep of declaredDependencies) {
    if (isPackageOrSubpath(specifier, dep)) {
      return { allowed: true, reason: `declared dependency ${dep}` };
    }
  }
  return {
    allowed: false,
    reason: 'not on the fail-closed a2a host allowlist',
  };
}

/** Reads the dependency names from a package.json manifest. */
export function loadDeclaredDependencies(
  manifestPath: string,
  /**
   * 'production' resolves only runtime `dependencies` — what non-test source
   * may import. 'all' additionally resolves `devDependencies` — what test
   * files may import. Per-file scope enforcement lives in
   * {@link scanA2aBoundary}.
   */
  scope: 'production' | 'all' = 'all',
): readonly string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const production = Object.keys(manifest.dependencies ?? {});
  if (scope === 'production') {
    return production;
  }
  return [...production, ...Object.keys(manifest.devDependencies ?? {})];
}

/** True when the repo-relative file path is a test file. */
export function isTestFile(relFile: string): boolean {
  return (
    relFile.endsWith('.test.ts') ||
    relFile.endsWith('.spec.ts') ||
    relFile.includes('__tests__/')
  );
}

/** Creates a TypeScript SourceFile for AST analysis. */
function toSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}

function getLine(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Returns the module specifier of an import-ish node, or null. */
function specifierOf(node: ts.Node): string | null {
  if (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    ts.isStringLiteral(node.arguments[0]!)
  ) {
    return (node.arguments[0] as ts.StringLiteral).text;
  }
  // Mock-family calls with a literal specifier are evaluated like imports:
  // `vi.mock('spec', ...)` / bare `mock('spec', ...)` re-bind the named
  // module's runtime surface for every subsequent import in the file.
  if (
    ts.isCallExpression(node) &&
    isMockCall(node) &&
    ts.isStringLiteral(node.arguments[0]!)
  ) {
    return node.arguments[0].text;
  }
  // CommonJS `require('spec')` binds the module's runtime surface the same
  // way an import does; bun executes require() in ESM/TS files too, so the
  // checker must see it.
  if (
    ts.isCallExpression(node) &&
    isRequireCall(node) &&
    ts.isStringLiteral(node.arguments[0]!)
  ) {
    return node.arguments[0].text;
  }
  return null;
}

/** True for a CommonJS `require(...)` call expression. */
function isRequireCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length >= 1
  );
}

/** True for a dynamic import() whose specifier is not a string literal. */
function isNonLiteralDynamicImport(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length >= 1 &&
    !ts.isStringLiteral(node.arguments[0]!)
  );
}

/**
 * Mock-family call detection. `vi.mock` and its sibling module-specifier
 * methods (`vi.doMock`, `vi.unmock`, `vi.doUnmock`) plus the module-REACHING
 * `vi.importActual`/`vi.importMock` all take a module specifier; a bare
 * `mock(...)` identifier is bun:test's alias for `vi.mock`. Calls with a
 * literal specifier are evaluated; anything else (unknown method, non-literal
 * specifier) is rejected fail-closed because this checker cannot read what
 * module the call targets.
 */
const VI_SPECIFIER_METHODS: ReadonlySet<string> = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

/** Call callee shapes that reference the mock family: `vi.X(...)` or `X(...)`. */
function mockMethodNamesOfCall(
  node: ts.Node,
): { object: string; method: string } | null {
  if (!ts.isCallExpression(node) || node.arguments.length < 1) {
    return null;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const { expression, name } = node.expression;
    if (
      ts.isIdentifier(expression) &&
      expression.text === 'vi' &&
      VI_SPECIFIER_METHODS.has(name.text)
    ) {
      return { object: 'vi', method: name.text };
    }
    return null;
  }
  // bun:test exports `mock` directly; a bare `mock('mod')` binds the same
  // mocking machinery as `vi.mock('mod')`.
  if (
    ts.isIdentifier(node.expression) &&
    VI_SPECIFIER_METHODS.has(node.expression.text)
  ) {
    return { object: 'bun:test', method: node.expression.text };
  }
  return null;
}

/** True for a mock-family call whose module specifier is not a string literal. */
function isNonLiteralMockCall(node: ts.Node): boolean {
  const call = mockMethodNamesOfCall(node);
  if (call === null) {
    return false;
  }
  return !ts.isStringLiteral(node.arguments[0]!);
}

/** True for a mock-family call (any specifier). */
function isMockCall(node: ts.Node): boolean {
  return mockMethodNamesOfCall(node) !== null;
}

/**
 * Returns the call node when it is a non-literal import()/mock-family/
 * require() call. Every one of these binds a module by a specifier this
 * checker cannot read, so the caller rejects it fail-closed.
 */
function nonLiteralImportLike(node: ts.Node): ts.CallExpression | null {
  if (!ts.isCallExpression(node)) {
    return null;
  }
  if (isNonLiteralDynamicImport(node) || isNonLiteralMockCall(node)) {
    return node;
  }
  if (isRequireCall(node) && !ts.isStringLiteral(node.arguments[0]!)) {
    return node;
  }
  return null;
}

/** Kind for a rejected non-literal call, discriminated by call family. */
function nonLiteralViolationKind(
  call: ts.CallExpression,
): A2aImportViolation['kind'] {
  if (isMockCall(call)) {
    return 'vi.mock-non-literal';
  }
  if (isRequireCall(call)) {
    return 'require-non-literal';
  }
  return 'dynamic-import-non-literal';
}

function classifyKind(node: ts.Node): A2aImportViolation['kind'] {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    return 'dynamic-import';
  }
  if (isMockCall(node)) {
    return 'vi.mock';
  }
  if (ts.isCallExpression(node) && isRequireCall(node)) {
    return 'require';
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return 'import-equals';
  }
  return 'static-import';
}

type PushViolation = (v: A2aImportViolation) => void;

/**
 * Flags banned runtime-assembly symbols and un-constrainable binding forms
 * from runtime roots. Fail-closed: runtime roots are only importable via
 * named imports (symbols checkable) — namespace imports, default imports,
 * import-equals, dynamic import(), `export *`, and namespace re-exports all
 * bind the root's runtime-assembly surface beyond what this checker can
 * restrict, so they are rejected outright.
 */
function pushRuntimeRootViolations(
  node: ts.Node,
  specifier: string,
  relFile: string,
  sourceFile: ts.SourceFile,
  push: PushViolation,
): void {
  const rejectForm = (): void => {
    push({
      file: relFile,
      line: getLine(sourceFile, node.getStart()),
      kind: 'runtime-root-form',
      detail: specifier,
      reason:
        'runtime root packages may only be imported via named imports whose symbols can be checked; namespace/default/import-equals/dynamic-import/re-export forms are rejected',
    });
  };

  const rejectBannedName = (name: string, pos: number): void => {
    if (BANNED_RUNTIME_SYMBOLS.includes(name)) {
      push({
        file: relFile,
        line: getLine(sourceFile, pos),
        kind: 'banned-symbol',
        detail: `${name} from ${specifier}`,
        reason:
          'legacy runtime-assembly symbol; the host must use the public Agent facade',
      });
    }
  };

  if (ts.isImportDeclaration(node)) {
    if (node.importClause === undefined) {
      // Side-effect import binds no symbols.
      return;
    }
    const { namedBindings } = node.importClause;
    if (
      node.importClause.name !== undefined ||
      !ts.isNamedImports(namedBindings)
    ) {
      // Default or namespace import: the bound surface cannot be constrained.
      rejectForm();
      return;
    }
    for (const element of namedBindings.elements) {
      rejectBannedName(
        (element.propertyName ?? element.name).text,
        element.getStart(),
      );
    }
    return;
  }

  pushRuntimeRootExportViolations(node, rejectForm, rejectBannedName);
}

/**
 * Continues runtime-root form checking for the non-import-declaration
 * shapes: import-equals, export declarations, and dynamic import().
 */
function pushRuntimeRootExportViolations(
  node: ts.Node,
  rejectForm: () => void,
  rejectBannedName: (name: string, pos: number) => void,
): void {
  if (ts.isImportEqualsDeclaration(node)) {
    rejectForm();
    return;
  }

  if (ts.isExportDeclaration(node)) {
    if (
      node.exportClause === undefined ||
      ts.isNamespaceExport(node.exportClause)
    ) {
      // `export * from root` and `export * as ns from root` both bind the
      // unconstrained namespace.
      rejectForm();
      return;
    }
    for (const element of node.exportClause.elements) {
      rejectBannedName(
        (element.propertyName ?? element.name).text,
        element.getStart(),
      );
    }
    return;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    rejectForm(); // dynamic import() yields the unconstrained namespace
  }
  if (ts.isCallExpression(node) && isRequireCall(node)) {
    rejectForm(); // require() of a root yields the unconstrained namespace
  }
}

/**
 * Scans one source text (a2a host code) for boundary violations: disallowed
 * specifiers, non-literal dynamic imports, non-literal vi.mock calls, and
 * banned runtime-assembly symbols imported from runtime roots.
 *
 * `relFile` is the repo-relative path used in violation reports.
 */
export function scanSourceText(
  relFile: string,
  sourceText: string,
  declaredDependencies: readonly string[],
): A2aImportViolation[] {
  const sourceFile = toSourceFile(relFile, sourceText);
  const violations: A2aImportViolation[] = [];

  function push(v: A2aImportViolation): void {
    const key = `${v.line}|${v.kind}|${v.detail}`;
    if (!violations.some((x) => `${x.line}|${x.kind}|${x.detail}` === key)) {
      violations.push(v);
    }
  }

  function visit(node: ts.Node): void {
    const specifier = specifierOf(node);
    if (specifier !== null) {
      const evaluation = evaluateSpecifier(specifier, declaredDependencies);
      if (!evaluation.allowed) {
        push({
          file: relFile,
          line: getLine(sourceFile, node.getStart()),
          kind: classifyKind(node),
          detail: specifier,
          reason: evaluation.reason,
        });
      }
      if (specifierIsRuntimeRoot(specifier)) {
        pushRuntimeRootViolations(node, specifier, relFile, sourceFile, push);
      }
    }
    const nonLiteral = nonLiteralImportLike(node);
    if (nonLiteral !== null) {
      push({
        file: relFile,
        line: getLine(sourceFile, nonLiteral.getStart()),
        kind: nonLiteralViolationKind(nonLiteral),
        detail: '<dynamic>',
        reason:
          'non-literal module specifiers cannot be analyzed and could hide a deep runtime import',
      });
    }
    ts.forEachChild(node, visit);
  }

  function specifierIsRuntimeRoot(specifier: string): boolean {
    return RUNTIME_ROOT_PACKAGES.some((runtime) => specifier === runtime);
  }

  ts.forEachChild(sourceFile, visit);
  return violations;
}

/** Collects every .ts file under the a2a host tree (src/ plus index.ts). */
export function collectA2aFiles(a2aDir: string): string[] {
  const files: string[] = [];
  const indexPath = join(a2aDir, 'index.ts');
  try {
    readFileSync(indexPath);
    files.push(indexPath);
  } catch {
    // no index.ts — skip
  }
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  };
  walk(join(a2aDir, 'src'));
  return files;
}

/**
 * Runs the full fail-closed boundary scan over the a2a host tree.
 * `a2aDir` is packages/a2a-server; the manifest supplies the declared
 * dependency allowlist (test files additionally see devDependencies).
 */
export function scanA2aBoundary(a2aDir: string): A2aBoundaryResult {
  const manifestPath = join(a2aDir, 'package.json');
  const productionDeps = loadDeclaredDependencies(manifestPath, 'production');
  const allDeps = loadDeclaredDependencies(manifestPath, 'all');
  const files = collectA2aFiles(a2aDir);
  const violations: A2aImportViolation[] = [];
  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    const relFile = relativeTo(a2aDir, file);
    // Test files may import devDependencies; production files are held to
    // the runtime dependency set.
    const declared = isTestFile(relFile) ? allDeps : productionDeps;
    violations.push(...scanSourceText(relFile, sourceText, declared));
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { violations, fileCount: files.length };
}

function relativeTo(from: string, to: string): string {
  return pathRelative(from, to).replace(/\\/g, '/');
}
