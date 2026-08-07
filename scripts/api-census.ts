#!/usr/bin/env bun
/**
 * AST-based cross-package import census.
 *
 * Replaces the earlier regex prototype. Uses the TypeScript parser so that
 * multi-line imports, type-only specifiers, dynamic imports, require calls and
 * export-from statements are classified correctly rather than approximately.
 *
 * Definitions (these matter — earlier drafts conflated them):
 *   statement   one import/export/dynamic-import/require node
 *   deep        specifier with a subpath, e.g. pkg/a/b.js
 *   root        bare package specifier, e.g. pkg
 *   self        consumer package === target package (excluded from cross-package totals)
 *   test        any file under a test root or matching a test filename pattern,
 *               including bun tests (test-bun/**, *.bun.ts) which the earlier
 *               prototype misclassified as production
 *
 * Output: tmp/census-ast.json plus a printed summary.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');
const SCOPE = '@vybestack/llxprt-code';

export interface ImportRecord {
  consumer: string;
  file: string;
  targetPkg: string;
  subpath: string | null;
  kind: 'import' | 'export-from' | 'dynamic' | 'require';
  /** Whole statement was `import type` / `export type`. */
  statementTypeOnly: boolean;
  /** Named bindings, with per-specifier type-only flags. */
  specifiers: Array<{ name: string; typeOnly: boolean }>;
  namespaceImport: boolean;
  defaultImport: boolean;
  isTest: boolean;
  isSelf: boolean;
}

/** Test roots and filename patterns used across this repo. */
const TEST_DIR_SEGMENTS = [
  '__tests__',
  '__mocks__',
  'test-bun',
  'test-utils',
  'integration-tests',
  'test-setup',
  'test-scripts',
];
const TEST_FILE_RE = /\.(test|spec)\.[cm]?tsx?$|\.bun\.ts$/;
/**
 * Package-root harness files. These are not under a test directory and do not
 * carry a test suffix, so an earlier version counted them as production.
 */
const TEST_FILE_NAMES = new Set([
  'test-setup.ts',
  'bun-test-setup.ts',
  'vitest.config.ts',
  'vitest.setup.ts',
  'bunfig.toml.ts',
]);

export function isTestPath(relPath: string): boolean {
  // `path.relative` yields platform separators; normalise before splitting so
  // directory-segment matching works on Windows as well as POSIX.
  const normalised = relPath.split('\\').join('/');
  const parts = normalised.split('/');
  if (parts.some((p) => TEST_DIR_SEGMENTS.includes(p))) return true;
  if (TEST_FILE_NAMES.has(parts[parts.length - 1])) return true;
  return TEST_FILE_RE.test(normalised);
}

/**
 * True when the specifier is this monorepo's scope at a package boundary.
 * A bare `startsWith` would also match `@vybestack/llxprt-codeXYZ`.
 */
export function isWorkspaceSpecifier(spec: string): boolean {
  return spec === SCOPE || spec.startsWith(`${SCOPE}-`);
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    // readdirSync order is filesystem-dependent. Sort so the emitted record
    // order — and therefore tmp/census-ast.json — is reproducible across runs
    // and machines.
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') {
      continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.[cm]?tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

function splitSpecifier(spec: string): { pkg: string; subpath: string | null } {
  const rest = spec.slice('@vybestack/'.length);
  const slash = rest.indexOf('/');
  return slash === -1
    ? { pkg: rest, subpath: null }
    : { pkg: rest.slice(0, slash), subpath: rest.slice(slash + 1) };
}

function collectNamed(
  bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined,
): {
  specifiers: Array<{ name: string; typeOnly: boolean }>;
  namespace: boolean;
} {
  const specifiers: Array<{ name: string; typeOnly: boolean }> = [];
  let namespace = false;
  if (!bindings) return { specifiers, namespace };
  if (ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings)) {
    namespace = true;
    return { specifiers, namespace };
  }
  for (const el of bindings.elements) {
    specifiers.push({
      name: (el.propertyName ?? el.name).text,
      typeOnly: Boolean((el as ts.ImportSpecifier).isTypeOnly),
    });
  }
  return { specifiers, namespace };
}

/** A call expression of the form `import('...')` with a literal specifier. */
function dynamicImportSpecifier(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const [first] = node.arguments;
  if (!first || !ts.isStringLiteralLike(first)) return null;
  return first.text;
}

/** A call expression of the form `require('...')` with a literal specifier. */
function requireSpecifier(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression)) return null;
  if (node.expression.text !== 'require') return null;
  const [first] = node.arguments;
  if (!first || !ts.isStringLiteralLike(first)) return null;
  return first.text;
}

export function scanFile(
  absPath: string,
  relPath: string,
  consumer: string,
  source: string,
): ImportRecord[] {
  const sf = ts.createSourceFile(
    absPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(absPath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const records: ImportRecord[] = [];
  const isTest = isTestPath(relPath);

  const push = (
    spec: string,
    kind: ImportRecord['kind'],
    statementTypeOnly: boolean,
    specifiers: Array<{ name: string; typeOnly: boolean }>,
    namespaceImport: boolean,
    defaultImport: boolean,
  ) => {
    if (!isWorkspaceSpecifier(spec)) return;
    const { pkg, subpath } = splitSpecifier(spec);
    records.push({
      consumer,
      file: relPath,
      targetPkg: pkg,
      subpath,
      kind,
      statementTypeOnly,
      specifiers,
      namespaceImport,
      defaultImport,
      isTest,
      isSelf: pkg === `llxprt-code-${consumer}` || pkg === consumer,
    });
  };

  const visitImport = (node: ts.ImportDeclaration): void => {
    const clause = node.importClause;
    const { specifiers, namespace } = collectNamed(clause?.namedBindings);
    push(
      (node.moduleSpecifier as ts.StringLiteral).text,
      'import',
      Boolean(clause?.isTypeOnly),
      specifiers,
      namespace,
      Boolean(clause?.name),
    );
  };

  const visitExportFrom = (node: ts.ExportDeclaration): void => {
    const { specifiers, namespace } = collectNamed(node.exportClause);
    push(
      (node.moduleSpecifier as ts.StringLiteral).text,
      'export-from',
      Boolean(node.isTypeOnly),
      specifiers,
      namespace || !node.exportClause, // bare `export * from`
      false,
    );
  };

  const visit = (node: ts.Node): void => {
    const dynamic = dynamicImportSpecifier(node);
    const required = requireSpecifier(node);
    if (ts.isImportDeclaration(node)) {
      visitImport(node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      visitExportFrom(node);
    } else if (dynamic !== null) {
      push(dynamic, 'dynamic', false, [], false, false);
    } else if (required !== null) {
      push(required, 'require', false, [], false, false);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return records;
}

/**
 * Scan every package source file, skipping any that cannot be read.
 *
 * A file can vanish or become unreadable between the directory walk and the
 * read; that must not discard the whole run's analysis.
 */
function collectRecords(pkgDirs: string[]): {
  records: ImportRecord[];
  unreadable: string[];
} {
  const records: ImportRecord[] = [];
  const unreadable: string[] = [];
  for (const pkg of pkgDirs) {
    for (const abs of walk(join(PACKAGES, pkg))) {
      // Normalise separators at the source: `relative` yields platform
      // separators, and every downstream consumer — the stored record, the
      // test classifier, the reports — treats paths as POSIX.
      const rel = relative(ROOT, abs).split('\\').join('/');
      let source: string;
      try {
        source = readFileSync(abs, 'utf8');
      } catch {
        unreadable.push(rel);
        continue;
      }
      records.push(...scanFile(abs, rel, pkg, source));
    }
  }
  return { records, unreadable };
}

function main(): void {
  const pkgDirs = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  const { records, unreadable } = collectRecords(pkgDirs);
  if (unreadable.length > 0) {
    console.log(
      `WARNING: skipped ${unreadable.length} unreadable file(s): ${unreadable.slice(0, 5).join(', ')}`,
    );
  }

  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  writeFileSync(
    join(ROOT, 'tmp', 'census-ast.json'),
    JSON.stringify(records, null, 2),
  );

  const cross = records.filter((r) => !r.isSelf);
  const self = records.filter((r) => r.isSelf);
  const deep = cross.filter((r) => r.subpath !== null);
  const prod = deep.filter((r) => !r.isTest);

  console.log('='.repeat(64));
  console.log(`statements total          ${records.length}`);
  console.log(`  self-import (excluded)  ${self.length}`);
  console.log(`  cross-package           ${cross.length}`);
  console.log(`    deep                  ${deep.length}`);
  console.log(`      production          ${prod.length}`);
  console.log(`      test                ${deep.length - prod.length}`);
  console.log(`    root barrel           ${cross.length - deep.length}`);

  console.log('\nby kind (cross-package deep):');
  for (const k of ['import', 'export-from', 'dynamic', 'require'] as const) {
    console.log(`  ${k.padEnd(14)} ${deep.filter((r) => r.kind === k).length}`);
  }

  // type-only, measured per specifier rather than per statement
  let typeSpec = 0;
  let valueSpec = 0;
  for (const r of deep) {
    for (const s of r.specifiers) {
      if (r.statementTypeOnly || s.typeOnly) typeSpec++;
      else valueSpec++;
    }
  }
  const totalSpec = typeSpec + valueSpec;
  const typeOnlyPct =
    totalSpec === 0 ? 'n/a' : `${((typeSpec / totalSpec) * 100).toFixed(1)}%`;
  // Denominator is NAMED BINDINGS only. Namespace imports, default imports,
  // dynamic imports, side-effect imports and export-star carry no named
  // bindings and are excluded — this is not a percentage of statements.
  // Every statement carrying no named binding, including type-only namespace
  // and default forms — an earlier version excluded statementTypeOnly, which
  // contradicted the printed label.
  const unnamed = deep.filter((r) => r.specifiers.length === 0).length;
  console.log(
    `\nnamed symbol bindings (deep): ${totalSpec}  type-only=${typeSpec} (${typeOnlyPct} of named bindings)  value=${valueSpec}`,
  );
  console.log(
    `  statements carrying no named binding (namespace/default/dynamic/star): ${unnamed} — excluded from the ratio above`,
  );

  console.log('\ndeep statements by target package (prod / test):');
  const byPkg = new Map<string, { p: number; t: number }>();
  for (const r of deep) {
    const e = byPkg.get(r.targetPkg) ?? { p: 0, t: 0 };
    if (r.isTest) e.t++;
    else e.p++;
    byPkg.set(r.targetPkg, e);
  }
  for (const [k, v] of [...byPkg.entries()].sort(
    // Total descending, then package name so equal totals order stably.
    (a, b) => b[1].p + b[1].t - (a[1].p + a[1].t) || a[0].localeCompare(b[0]),
  )) {
    console.log(
      `  ${k.padEnd(26)} total=${String(v.p + v.t).padStart(5)}  prod=${String(v.p).padStart(5)}  test=${String(v.t).padStart(5)}`,
    );
  }
}

if (import.meta.main) main();
