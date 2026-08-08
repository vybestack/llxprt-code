#!/usr/bin/env bun
/**
 * Config coupling census — the honest metric.
 *
 * The existing boundary guard asks "does this file reference the type named
 * Config?". That question is gameable, and was gamed three times in this
 * effort: by indexed-access projections, by `as unknown as` casts, and finally
 * by declaring a 104-member type with a different name and depending on that
 * instead.
 *
 * This script asks the question that cannot be renamed around: for each file
 * outside core, HOW MANY distinct configuration members does it actually
 * touch, whatever the declared type is called? A file touching three members
 * is decomposed. A file touching a hundred is not, no matter what the type is
 * named.
 *
 * Method: TypeScript checker. Resolve every property access whose receiver
 * type structurally originates from Config's member set, regardless of the
 * declared type name.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');

const TEST_DIRS = [
  '__tests__',
  '__mocks__',
  'test-bun',
  'test-utils',
  'integration-tests',
  'test-setup',
];
const TEST_FILE = /\.(test|spec)\.[cm]?tsx?$|\.bun\.ts$/;
const isTest = (p: string) =>
  p.split('/').some((s) => TEST_DIRS.includes(s)) || TEST_FILE.test(p);

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

/** Collect the member names declared on the Config class hierarchy. */
function configMemberNames(program: ts.Program): Set<string> {
  const checker = program.getTypeChecker();
  const names = new Set<string>();
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.includes('/core/src/config/config.ts')) continue;
    ts.forEachChild(sf, (n) => {
      if (ts.isClassDeclaration(n) && n.name?.text === 'Config') {
        const t = checker.getTypeAtLocation(n.name!);
        for (const p of checker.getPropertiesOfType(
          checker.getDeclaredTypeOfSymbol(
            checker.getSymbolAtLocation(n.name!)!,
          ),
        )) {
          names.add(p.getName());
        }
        for (const p of checker.getPropertiesOfType(t)) names.add(p.getName());
      }
    });
  }
  return names;
}

function main(): void {
  const pkgDirs = readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((d) => d !== 'core');

  const files: string[] = [];
  for (const p of pkgDirs) {
    try {
      statSync(join(PACKAGES, p, 'src'));
    } catch {
      continue;
    }
    files.push(...walk(join(PACKAGES, p, 'src')));
  }
  const prod = files.filter((f) => !isTest(relative(ROOT, f)));

  const program = ts.createProgram(
    [...prod, join(PACKAGES, 'core', 'src', 'config', 'config.ts')],
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.Latest,
      skipLibCheck: true,
      noEmit: true,
      allowJs: false,
    },
  );
  const checker = program.getTypeChecker();
  const configNames = configMemberNames(program);

  const perFile = new Map<string, Set<string>>();

  for (const abs of prod) {
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const rel = relative(ROOT, abs);
    const touched = new Set<string>();

    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n)) {
        const name = n.name.text;
        if (configNames.has(name)) {
          const recv = checker.getTypeAtLocation(n.expression);
          const props = checker.getPropertiesOfType(recv);
          // Heuristic that cannot be renamed around: if the receiver exposes a
          // large slice of Config's member set, the file is coupled to the
          // god-object regardless of what its declared type is called.
          const overlap = props.filter((p) =>
            configNames.has(p.getName()),
          ).length;
          if (overlap >= 5) touched.add(name);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (touched.size > 0) perFile.set(rel, touched);
  }

  const rows = [...perFile.entries()].sort((a, b) => b[1].size - a[1].size);
  const BUDGET = 12;

  console.log('=== Config coupling per file (members actually touched) ===');
  console.log(`files coupled to config-shaped receivers: ${rows.length}`);
  const over = rows.filter(([, s]) => s.size > BUDGET);
  console.log(`files over the ${BUDGET}-member budget: ${over.length}`);
  console.log(
    `total distinct members touched: ${new Set(rows.flatMap(([, s]) => [...s])).size}`,
  );

  console.log(`\n--- worst offenders ---`);
  for (const [f, s] of rows.slice(0, 20)) {
    console.log(`  ${String(s.size).padStart(3)}  ${f}`);
  }

  const byPkg = new Map<string, { files: number; over: number }>();
  for (const [f, s] of rows) {
    const pkg = f.split('/')[1];
    const e = byPkg.get(pkg) ?? { files: 0, over: 0 };
    e.files++;
    if (s.size > BUDGET) e.over++;
    byPkg.set(pkg, e);
  }
  console.log(`\n--- by package (coupled / over budget) ---`);
  for (const [k, v] of [...byPkg.entries()].sort(
    (a, b) => b[1].over - a[1].over,
  )) {
    console.log(`  ${k.padEnd(14)} ${v.files} coupled, ${v.over} over budget`);
  }
}

if (import.meta.main) main();
