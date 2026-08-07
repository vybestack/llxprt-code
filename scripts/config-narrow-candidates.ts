#!/usr/bin/env bun
/**
 * Lists Config-narrowing candidates for a package.
 *
 * Reports every production file that holds a `Config`-typed value and reads
 * three members or fewer — the files that can move to a narrow capability
 * interface (see `packages/<pkg>/src/config/capabilities.ts`).
 *
 * IMPORTANT: the list still over-reports. A file appears here based on members read
 * on a directly-annotated receiver, which cannot see whether the file forwards
 * its Config to a callee that still requires the full type. Roughly half the
 * candidates fail for that reason. Files that construct a Config are excluded,
 * since they need the concrete class regardless of how little they read. The working method is therefore: apply to
 * all candidates, typecheck, revert whatever the compiler rejects, repeat —
 * each round narrows callees and unblocks their callers.
 *
 * Usage: bun scripts/config-narrow-candidates.ts <package>
 *
 * Part of the #2615 Config decomposition.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const CORE = '@vybestack/llxprt-code-core';
const MAX_MEMBERS = 3;

const TEST_DIRS = [
  '__tests__',
  '__mocks__',
  'test-bun',
  'test-utils',
  'integration-tests',
  'test-setup',
];
const TEST_RE = /\.(test|spec)\.[cm]?tsx?$|\.bun\.ts$/;

function isTestPath(p: string): boolean {
  const normalised = p.split('\\').join('/');
  if (normalised.split('/').some((s) => TEST_DIRS.includes(s))) return true;
  return TEST_RE.test(normalised);
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.[cm]?tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Receiver of a property access, when it is a direct identifier or `this.x`. */
function receiverName(expr: ts.Expression): string | null {
  let e: ts.Expression = expr;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  if (ts.isIdentifier(e)) return e.text;
  const isThisProp =
    ts.isPropertyAccessExpression(e) &&
    e.expression.kind === ts.SyntaxKind.ThisKeyword;
  return isThisProp ? (e as ts.PropertyAccessExpression).name.text : null;
}

function importsConfig(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    const isCoreImport =
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text.startsWith(CORE);
    if (isCoreImport) {
      const bindings = (n as ts.ImportDeclaration).importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        found = bindings.elements.some(
          (el) => (el.propertyName ?? el.name).text === 'Config',
        );
      }
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function isBindable(n: ts.Node): boolean {
  return (
    ts.isParameter(n) ||
    ts.isPropertyDeclaration(n) ||
    ts.isPropertySignature(n) ||
    ts.isVariableDeclaration(n)
  );
}

/**
 * True when the file constructs a Config itself. Such a file is a factory or
 * test harness and needs the concrete class, not a capability interface, no
 * matter how few members it reads.
 */
function constructsConfig(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'Config'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Identifiers annotated exactly `Config` in this file. */
function configIdentifiers(sf: ts.SourceFile): Set<string> {
  const idents = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (isBindable(n)) {
      const decl = n as ts.ParameterDeclaration;
      const named = decl.name && ts.isIdentifier(decl.name);
      const annotated = decl.type?.getText(sf).trim() === 'Config';
      if (named && annotated) idents.add((decl.name as ts.Identifier).text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return idents;
}

function membersRead(sf: ts.SourceFile, idents: Set<string>): Set<string> {
  const members = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      const base = receiverName(n.expression);
      if (base !== null && idents.has(base)) members.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return members;
}

function analyseFile(abs: string): { file: string; members: string[] } | null {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (isTestPath(rel)) return null;

  const src = readFileSync(abs, 'utf8');
  if (!src.includes('Config')) return null;

  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true);
  if (!importsConfig(sf)) return null;
  if (constructsConfig(sf)) return null;

  const idents = configIdentifiers(sf);
  if (idents.size === 0) return null;

  const members = membersRead(sf, idents);
  if (members.size === 0 || members.size > MAX_MEMBERS) return null;

  return { file: rel, members: [...members].sort() };
}

function main(): void {
  const pkg = process.argv[2];
  if (pkg === undefined || pkg === '') {
    console.error('usage: bun scripts/config-narrow-candidates.ts <package>');
    process.exit(1);
  }

  const rows: Array<{ file: string; members: string[] }> = [];
  for (const abs of walk(join(ROOT, 'packages', pkg))) {
    const row = analyseFile(abs);
    if (row !== null) rows.push(row);
  }
  rows.sort(
    (a, b) =>
      a.members.length - b.members.length || a.file.localeCompare(b.file),
  );

  console.log(
    `${pkg}: ${rows.length} candidate file(s) reading <=${MAX_MEMBERS} Config members`,
  );
  for (const r of rows) {
    console.log(`  ${r.members.length}  ${r.file}  [${r.members.join(', ')}]`);
  }

  const byShape = new Map<string, number>();
  for (const r of rows) {
    const key = r.members.join(', ');
    byShape.set(key, (byShape.get(key) ?? 0) + 1);
  }
  console.log(`\ndistinct capability shapes: ${byShape.size}`);
  for (const [shape, count] of [...byShape.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    console.log(`  {${shape}} -> ${count} file(s)`);
  }
}

if (import.meta.main) main();
