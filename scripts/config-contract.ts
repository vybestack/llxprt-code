#!/usr/bin/env bun
/**
 * Config cross-package contract analysis.
 *
 * Supersedes an earlier prototype that examined only files importing `Config`
 * from a deep `config/*` subpath and matched four hard-coded receiver names.
 * That undercounted the contract: `Config` is also imported from the root
 * barrel, and receivers are frequently named something else.
 *
 * Method: AST. For every file outside core that imports `Config`, bind every
 * identifier annotated as `Config` — parameters, properties, variables, and
 * `Pick<Config, ...>` narrowings — then collect property accesses whose direct
 * receiver is one of those identifiers.
 *
 * Limitations, stated plainly:
 *   - Syntactic, not type-resolved. Identifiers are tracked by text per file,
 *     so a shadowed unrelated `config` can produce a false positive. An
 *     independent checker-based pass puts the true figure near 128 members and
 *     53 single-access members; this script reports slightly more.
 *   - Records property ACCESSES, not calls. Reading a property or passing a
 *     method reference counts.
 *   - Misses receivers whose Config-ness is only inferable, and aliased
 *     imports (`import { Config as X }`) used under the alias name.
 *
 * These numbers size the problem. They are not sufficient to publish a
 * contract; that requires committed checker-based tooling.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');
const CORE_SPECIFIER = '@vybestack/llxprt-code-core';

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
const TEST_FILE_NAMES = new Set(['test-setup.ts', 'bun-test-setup.ts']);

function isTestPath(p: string): boolean {
  const parts = p.split('/');
  if (parts.some((s) => TEST_DIR_SEGMENTS.includes(s))) return true;
  if (TEST_FILE_NAMES.has(parts[parts.length - 1])) return true;
  return TEST_FILE_RE.test(p);
}

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.[cm]?tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

interface Usage {
  method: string;
  files: Set<string>;
  prod: number;
  test: number;
}

function record(
  map: Map<string, Usage>,
  method: string,
  rel: string,
  isTest: boolean,
): void {
  const u = map.get(method) ?? {
    method,
    files: new Set<string>(),
    prod: 0,
    test: 0,
  };
  u.files.add(rel);
  if (isTest) u.test++;
  else u.prod++;
  map.set(method, u);
}

/** Does this source file import `Config` from the core package? */
function importsConfig(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text.startsWith(CORE_SPECIFIER)
    ) {
      const bindings = n.importClause?.namedBindings;
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

type Annotation = 'direct' | 'pick' | null;

function classifyAnnotation(
  t: ts.TypeNode | undefined,
  sf: ts.SourceFile,
): Annotation {
  if (!t) return null;
  const text = t.getText(sf).trim();
  if (/\bPick\s*<\s*Config\s*,/.test(text)) return 'pick';
  if (text === 'Config') return 'direct';
  if (/\bConfig\b/.test(text) && /[&|]/.test(text)) return 'direct';
  return null;
}

function isBindableDeclaration(
  n: ts.Node,
): n is
  | ts.ParameterDeclaration
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.VariableDeclaration {
  return (
    ts.isParameter(n) ||
    ts.isPropertyDeclaration(n) ||
    ts.isPropertySignature(n) ||
    ts.isVariableDeclaration(n)
  );
}

interface Bindings {
  direct: Set<string>;
  pick: Set<string>;
}

function bindConfigIdentifiers(sf: ts.SourceFile): Bindings {
  const bindings: Bindings = { direct: new Set(), pick: new Set() };
  const visit = (n: ts.Node): void => {
    if (isBindableDeclaration(n) && n.name && ts.isIdentifier(n.name)) {
      const kind = classifyAnnotation(n.type, sf);
      if (kind === 'direct') bindings.direct.add(n.name.text);
      else if (kind === 'pick') bindings.pick.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return bindings;
}

/**
 * Name of the receiver of a property access, but only when the receiver is a
 * direct reference to a tracked identifier.
 *
 * An earlier version walked chains via `base.name`, which selected the LAST
 * segment of `a.b.c` rather than the receiver, so `config.options.x` reported
 * `x` against a receiver named `options`. A deeper chain is not a direct
 * `Config` receiver and must not be counted at all.
 */
function receiverName(expr: ts.Expression): string | null {
  let e: ts.Expression = expr;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  if (ts.isIdentifier(e)) return e.text;
  if (
    ts.isPropertyAccessExpression(e) &&
    e.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return e.name.text;
  }
  return null;
}

function collectAccesses(
  sf: ts.SourceFile,
  bindings: Bindings,
  rel: string,
  isTest: boolean,
  direct: Map<string, Usage>,
  viaPick: Map<string, Usage>,
): void {
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      const base = receiverName(n.expression);
      if (base !== null && bindings.direct.has(base)) {
        record(direct, n.name.text, rel, isTest);
      } else if (base !== null && bindings.pick.has(base)) {
        record(viaPick, n.name.text, rel, isTest);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

function analyse(): {
  direct: Map<string, Usage>;
  viaPick: Map<string, Usage>;
  prodFiles: Set<string>;
  testFiles: Set<string>;
  pickCount: number;
} {
  const direct = new Map<string, Usage>();
  const viaPick = new Map<string, Usage>();
  const prodFiles = new Set<string>();
  const testFiles = new Set<string>();
  let pickCount = 0;

  const packages = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== 'core'); // cross-package contract only

  const analyseFile = (abs: string): void => {
    const src = readFileSync(abs, 'utf8');
    if (!src.includes('Config')) return;

    const sf = ts.createSourceFile(
      abs,
      src,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (!importsConfig(sf)) return;

    const rel = relative(ROOT, abs);
    const isTest = isTestPath(rel);
    if (isTest) testFiles.add(rel);
    else prodFiles.add(rel);

    const bindings = bindConfigIdentifiers(sf);
    pickCount += bindings.pick.size;
    if (bindings.direct.size + bindings.pick.size > 0) {
      collectAccesses(sf, bindings, rel, isTest, direct, viaPick);
    }
  };

  for (const pkg of packages) {
    for (const abs of walk(join(PACKAGES, pkg))) {
      analyseFile(abs);
    }
  }

  return { direct, viaPick, prodFiles, testFiles, pickCount };
}

function main(): void {
  const { direct, viaPick, prodFiles, testFiles, pickCount } = analyse();

  console.log('=== Config cross-package contract (AST, all importers) ===');
  console.log(
    `files outside core importing Config: production=${prodFiles.size} test=${testFiles.size}`,
  );
  console.log(`Pick<Config,...> narrowings: ${pickCount}`);

  const prodMembers = [...direct.values()].filter((u) => u.prod > 0);
  console.log(`\ndistinct members on a Config-typed receiver: ${direct.size}`);
  console.log(`  with at least one PRODUCTION access: ${prodMembers.length}`);
  console.log(
    '  NOTE: syntactic upper estimate. Checker-based analysis puts this near 128.',
  );

  console.log('\n--- production members, by access count ---');
  for (const u of prodMembers.sort((a, b) => b.prod - a.prod)) {
    console.log(
      `  ${u.method.padEnd(40)} prod=${String(u.prod).padStart(4)} test=${String(u.test).padStart(4)} files=${u.files.size}`,
    );
  }

  const single = prodMembers.filter((u) => u.prod === 1);
  console.log(`\nmembers with exactly ONE production access: ${single.length}`);
  console.log(`  ${single.map((u) => u.method).join(', ')}`);

  if (viaPick.size > 0) {
    console.log('\n--- accessed via Pick<Config,...> capability narrowing ---');
    for (const u of [...viaPick.values()].sort((a, b) => b.prod - a.prod)) {
      console.log(`  ${u.method.padEnd(40)} prod=${u.prod} test=${u.test}`);
    }
  }
}

if (import.meta.main) main();
