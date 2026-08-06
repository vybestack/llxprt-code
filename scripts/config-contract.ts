#!/usr/bin/env bun
/**
 * Config cross-package contract analysis.
 *
 * Supersedes the earlier prototype, which selected only files importing Config
 * from a deep `config/*` subpath and matched four hard-coded receiver names.
 * That undercounted the contract: Config is also imported from the root barrel,
 * and receivers are frequently named something else or narrowed structurally.
 *
 * Method: AST. For every file outside core that imports `Config` (root barrel
 * or deep), bind every identifier annotated as `Config` — parameters,
 * properties, variables, and `Pick<Config, ...>` / intersection narrowings —
 * then collect property accesses on those identifiers.
 *
 * Limitation, stated plainly: this is syntactic, not type-resolved. It will
 * miss receivers whose Config-ness is only inferable through inference chains,
 * and `Pick<Config, 'x'>` narrowings are reported separately because they are
 * already a capability interface rather than god-object usage.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');
const TEST_DIR_SEGMENTS = [
  '__tests__',
  '__mocks__',
  'test-bun',
  'test-utils',
  'integration-tests',
  'test-setup',
];
const TEST_FILE_RE = /\.(test|spec)\.[cm]?tsx?$|\.bun\.ts$/;
const isTestPath = (p: string) =>
  p.split('/').some((s) => TEST_DIR_SEGMENTS.includes(s)) ||
  TEST_FILE_RE.test(p);

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

const direct = new Map<string, Usage>();
const viaPick = new Map<string, Usage>();
const importingFiles = { prod: new Set<string>(), test: new Set<string>() };
let pickNarrowings = 0;

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
  isTest ? u.test++ : u.prod++;
  map.set(method, u);
}

for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)) {
  if (pkg === 'core') continue; // cross-package contract only
  for (const abs of walk(join(PACKAGES, pkg))) {
    const rel = relative(ROOT, abs);
    const src = readFileSync(abs, 'utf8');
    if (!/\bConfig\b/.test(src)) continue;

    const sf = ts.createSourceFile(
      abs,
      src,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const isTest = isTestPath(rel);

    // 1. does this file import Config from the core package at all?
    let importsConfig = false;
    const check = (n: ts.Node): void => {
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text.startsWith('@vybestack/llxprt-code-core')
      ) {
        const b = n.importClause?.namedBindings;
        if (b && ts.isNamedImports(b)) {
          for (const el of b.elements) {
            if ((el.propertyName ?? el.name).text === 'Config') {
              importsConfig = true;
            }
          }
        }
      }
      ts.forEachChild(n, check);
    };
    check(sf);
    if (!importsConfig) continue;
    (isTest ? importingFiles.test : importingFiles.prod).add(rel);

    // 2. bind identifiers annotated as Config (or Pick<Config,...>)
    const configIdents = new Set<string>();
    const pickIdents = new Set<string>();

    const typeMentionsConfig = (
      t: ts.TypeNode | undefined,
    ): 'direct' | 'pick' | null => {
      if (!t) return null;
      const text = t.getText(sf);
      if (/\bPick\s*<\s*Config\s*,/.test(text)) return 'pick';
      if (/^Config$/.test(text.trim())) return 'direct';
      if (/\bConfig\b/.test(text) && /[&|]/.test(text)) return 'direct';
      return null;
    };

    const bind = (n: ts.Node): void => {
      if (
        (ts.isParameter(n) ||
          ts.isPropertyDeclaration(n) ||
          ts.isPropertySignature(n) ||
          ts.isVariableDeclaration(n)) &&
        n.name &&
        ts.isIdentifier(n.name)
      ) {
        const kind = typeMentionsConfig(n.type);
        if (kind === 'direct') configIdents.add(n.name.text);
        else if (kind === 'pick') {
          pickIdents.add(n.name.text);
          pickNarrowings++;
        }
      }
      ts.forEachChild(n, bind);
    };
    bind(sf);
    if (configIdents.size === 0 && pickIdents.size === 0) continue;

    // 3. collect property accesses on those identifiers
    const collect = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n)) {
        let base: ts.Node = n.expression;
        // unwrap this.x / a?.b chains to the leading identifier
        while (
          ts.isPropertyAccessExpression(base) ||
          ts.isNonNullExpression(base) ||
          ts.isParenthesizedExpression(base)
        ) {
          base = ts.isPropertyAccessExpression(base)
            ? base.name
            : base.expression;
        }
        const baseName = ts.isIdentifier(base) ? base.text : null;
        if (baseName && configIdents.has(baseName)) {
          record(direct, n.name.text, rel, isTest);
        } else if (baseName && pickIdents.has(baseName)) {
          record(viaPick, n.name.text, rel, isTest);
        }
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
  }
}

console.log('=== Config cross-package contract (AST, all importers) ===');
console.log(
  `files outside core importing Config: production=${importingFiles.prod.size} test=${importingFiles.test.size}`,
);
console.log(`Pick<Config,...> narrowings found: ${pickNarrowings}`);

const prodMethods = [...direct.values()].filter((u) => u.prod > 0);
console.log(
  `\ndistinct members accessed on a Config-typed receiver: ${direct.size}`,
);
console.log(`  with at least one PRODUCTION access: ${prodMethods.length}`);

console.log('\n--- production members, by call count ---');
for (const u of prodMethods.sort((a, b) => b.prod - a.prod)) {
  console.log(
    `  ${u.method.padEnd(40)} prod=${String(u.prod).padStart(4)} test=${String(u.test).padStart(4)} files=${u.files.size}`,
  );
}

const singleUse = prodMethods.filter((u) => u.prod === 1);
console.log(
  `\nmembers with exactly ONE production call site: ${singleUse.length}`,
);
console.log(`  ${singleUse.map((u) => u.method).join(', ')}`);

if (viaPick.size) {
  console.log('\n--- accessed via Pick<Config,...> capability narrowing ---');
  for (const u of [...viaPick.values()].sort((a, b) => b.prod - a.prod)) {
    console.log(`  ${u.method.padEnd(40)} prod=${u.prod} test=${u.test}`);
  }
}
