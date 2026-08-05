#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Graph drift validator for the affected-test-shard selector (issue #2709).
 *
 * The fast PR selector (`scripts/affected-test-shards.ts`) reads a checked-in
 * import graph (`scripts/affected-test-shards.data.json`) and does NOT scan
 * source at PR time. This validator scans the real tracked TypeScript/TSX
 * source once (in CI after install, or locally via `lint:affected-shards`) and
 * fails when the checked-in graph drifts from the actual AST-derived edges.
 *
 * It extracts inter-package import-like edges from every tracked `.ts`/`.tsx`
 * file under `packages/`, ignoring comments and arbitrary string literals
 * (only `import`, `export ... from`, `require()`, and dynamic `import()`
 * specifiers count). It then compares the extracted edges exactly against the
 * checked-in `importEdges` + `testOnlyEdges`, verifies every workspace maps to
 * a canonical shard consistently, and verifies observer paths exist.
 *
 * Usage:
 *   bun scripts/check-affected-test-shards.ts
 *   bun scripts/check-affected-test-shards.ts --root <dir>
 *
 * Exits 0 on success, 1 on any drift.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { TEST_SHARDS } from './test-shards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_DATA_PATH = join(__dirname, 'affected-test-shards.data.json');

const PACKAGE_PREFIX = '@vybestack/llxprt-code-';
// `test-bun/` holds Bun-native suites registered in scripts/bun-test-manifest.ts.
// They are tests by construction but live outside `src/`, so without this they
// would be read as production code and their imports misclassified.
const TEST_PATH_RE =
  /(__tests__|\.test\.|\.spec\.|\.bun\.ts$|\/tests\/|\/test-bun\/|\/integration-tests\/|\/test\/)/;

interface ObserverRule {
  readonly observingPackage: string;
  readonly selectShard: string;
  readonly reason: string;
}

interface GraphData {
  readonly packageToShard: Record<string, string>;
  readonly shardOrder: readonly string[];
  readonly shardTimingsSeconds: Record<string, number>;
  readonly importEdges: Record<string, readonly string[]>;
  readonly testOnlyEdges: Record<string, readonly string[]>;
  readonly observers: Record<string, readonly ObserverRule[]>;
  readonly sharedInputs: readonly string[];
}

/**
 * Returns tracked files matching the given pathspecs via `git ls-files`. Using
 * tracked files means node_modules/build artifacts are never scanned, and a git
 * failure throws instead of being silently skipped.
 */
function listTrackedFiles(
  repoRoot: string,
  pathspecs: readonly string[] = [],
): readonly string[] {
  const out = execFileSync('git', ['ls-files', ...pathspecs], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * If `node` is an import-like declaration/export/call with a string-literal
 * module specifier, returns that specifier string; otherwise returns `null`.
 */
function tryExtractSpecifier(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : null;
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : null;
  }
  if (ts.isCallExpression(node) && node.expression !== undefined) {
    const isRequire =
      ts.isIdentifier(node.expression) && node.expression.text === 'require';
    const isDynamicImport =
      node.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (isRequire || isDynamicImport) {
      const arg = node.arguments[0];
      return arg !== undefined && ts.isStringLiteral(arg)
        ? (arg as ts.StringLiteral).text
        : null;
    }
  }
  return null;
}

/**
 * Extracts import-like module specifiers from a source file using the
 * TypeScript compiler API. Only static `import`, `export ... from`, `require()`
 * calls, and dynamic `import()` calls are recognized — comments and arbitrary
 * string literals are ignored.
 */
function extractImportSpecifiers(
  sourceText: string,
  fileName: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specs: string[] = [];

  function visit(node: ts.Node): void {
    const spec = tryExtractSpecifier(node);
    if (spec !== null) {
      specs.push(spec);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specs;
}

/**
 * Reads a file and records every inter-package import edge it contains into
 * the `edgeFiles` map. Each edge is tracked as {prod, test} so an edge seen
 * in any production file is classified as production. Fail-fast: a read error
 * propagates instead of being silently skipped.
 */
function recordEdgesFromFile(
  file: string,
  pkg: string,
  repoRoot: string,
  edgeFiles: Map<string, { prod: boolean; test: boolean }>,
): void {
  const absFile = join(repoRoot, file);
  const sourceText = readFileSync(absFile, 'utf-8');
  // Normalize OS path separators to '/' so TEST_PATH_RE (which uses '/') is
  // correct on Windows as well.
  const relFile = relative(join(repoRoot, 'packages', pkg), absFile)
    .split(sep)
    .join('/');
  const isTest = TEST_PATH_RE.test(relFile);
  const depSpecs = extractImportSpecifiers(sourceText, absFile)
    .filter((spec) => spec.startsWith(PACKAGE_PREFIX))
    .map((spec) => spec.slice(PACKAGE_PREFIX.length).split('/')[0])
    .filter((dep) => dep !== pkg);
  for (const dep of depSpecs) {
    const key = `${pkg}\x00${dep}`;
    const entry = edgeFiles.get(key) ?? { prod: false, test: false };
    if (isTest) {
      entry.test = true;
    } else {
      entry.prod = true;
    }
    edgeFiles.set(key, entry);
  }
}

function extractAllEdges(repoRoot: string): {
  readonly prodEdges: Map<string, Set<string>>;
  readonly testOnlyEdges: Map<string, Set<string>>;
} {
  const packagesDir = join(repoRoot, 'packages');
  if (!existsSync(packagesDir)) {
    throw new Error(`packages/ directory not found at ${packagesDir}`);
  }

  // Track, for each (from → to) edge, whether it appears in any prod file
  // and/or any test file. An edge is "prod" if it appears in at least one
  // production file; it is "test-only" only if it appears exclusively in
  // test files.
  /** key: "from\x00to", value: { prod: boolean, test: boolean } */
  const edgeFiles = new Map<string, { prod: boolean; test: boolean }>();
  /** All packages seen during extraction. */
  const seenPackages = new Set<string>();

  for (const file of listTrackedFiles(repoRoot, [
    'packages/**/*.ts',
    'packages/**/*.tsx',
  ])) {
    const m = file.match(/^packages\/([a-z0-9-]+)\//);
    if (!m) continue;
    const pkg = m[1];
    seenPackages.add(pkg);
    recordEdgesFromFile(file, pkg, repoRoot, edgeFiles);
  }

  const prodEdges = new Map<string, Set<string>>();
  const testOnlyEdges = new Map<string, Set<string>>();
  for (const pkg of seenPackages) {
    prodEdges.set(pkg, new Set());
    testOnlyEdges.set(pkg, new Set());
  }
  for (const [key, { prod, test }] of edgeFiles) {
    const [from, to] = key.split('\x00');
    if (prod) {
      prodEdges.get(from)!.add(to);
    } else if (test) {
      testOnlyEdges.get(from)!.add(to);
    }
  }

  return { prodEdges, testOnlyEdges };
}

interface DriftIssue {
  readonly kind: string;
  readonly detail: string;
}

/**
 * Compares extracted production/test-only edges against the checked-in data
 * file and reports missing, stale, and misclassified edges.
 */
function compareEdges(
  pkg: string,
  extractedProd: Set<string>,
  extractedTest: Set<string>,
  dataProd: Set<string>,
  dataTest: Set<string>,
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const dep of [...extractedProd].sort()) {
    if (!dataProd.has(dep)) {
      issues.push(
        dataTest.has(dep)
          ? {
              kind: 'edge-misclassified',
              detail: `Package '${pkg}' has a production import of '${dep}' (found in a non-test file), but the data file classifies it as testOnlyEdges. Move it to importEdges.`,
            }
          : {
              kind: 'edge-missing',
              detail: `Package '${pkg}' has a production import of '${dep}' that is missing from importEdges in the data file. Add "${dep}" to importEdges["${pkg}"].`,
            },
      );
    }
  }

  for (const dep of [...extractedTest].sort()) {
    if (!dataTest.has(dep)) {
      issues.push(
        dataProd.has(dep)
          ? {
              kind: 'edge-misclassified',
              detail: `Package '${pkg}' imports '${dep}' only from test files, but the data file lists it in importEdges (production). Move it to testOnlyEdges.`,
            }
          : {
              kind: 'edge-missing',
              detail: `Package '${pkg}' has a test-only import of '${dep}' that is missing from testOnlyEdges in the data file. Add "${dep}" to testOnlyEdges["${pkg}"].`,
            },
      );
    }
  }

  for (const dep of [...dataProd].sort()) {
    if (!extractedProd.has(dep) && !extractedTest.has(dep)) {
      issues.push({
        kind: 'edge-stale',
        detail: `importEdges["${pkg}"] lists '${dep}' but no such import exists in tracked source. Remove it.`,
      });
    }
  }
  for (const dep of [...dataTest].sort()) {
    if (!extractedProd.has(dep) && !extractedTest.has(dep)) {
      issues.push({
        kind: 'edge-stale',
        detail: `testOnlyEdges["${pkg}"] lists '${dep}' but no such import exists in tracked source. Remove it.`,
      });
    }
  }

  return issues;
}

/** Builds the canonical workspace → shard map from TEST_SHARDS. */
function buildCanonicalShardMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const shard of TEST_SHARDS) {
    if (shard.isScriptsShard) continue;
    for (const ws of shard.workspaces) {
      map.set(ws, shard.name);
    }
  }
  return map;
}

/** Validates packageToShard against the canonical shard map. */
function validateShardMap(
  data: GraphData,
  canonical: Map<string, string>,
): DriftIssue[] {
  const issues: DriftIssue[] = [];
  for (const [pkg, shard] of Object.entries(data.packageToShard)) {
    const canonicalShard = canonical.get(pkg);
    if (canonicalShard === undefined) {
      issues.push({
        kind: 'unknown-package-in-shard-map',
        detail: `packageToShard references package '${pkg}' which is not a declared workspace in TEST_SHARDS.`,
      });
    } else if (canonicalShard !== shard) {
      issues.push({
        kind: 'shard-mismatch',
        detail: `packageToShard['${pkg}'] = '${shard}' but TEST_SHARDS assigns '${pkg}' to shard '${canonicalShard}'.`,
      });
    }
  }
  return issues;
}

/** Validates shardOrder, shardTimingsSeconds, and observer references. */
function validateShardConfig(
  data: GraphData,
  canonical: Map<string, string>,
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  for (const name of TEST_SHARDS.map((s) => s.name)) {
    if (!data.shardOrder.includes(name)) {
      issues.push({
        kind: 'shard-order-missing',
        detail: `shardOrder is missing canonical shard '${name}'.`,
      });
    }
  }

  for (const name of data.shardOrder) {
    if (!(name in data.shardTimingsSeconds)) {
      issues.push({
        kind: 'timing-missing',
        detail: `shardTimingsSeconds is missing timing for shard '${name}'.`,
      });
    }
  }

  for (const [observedPkg, obsList] of Object.entries(data.observers)) {
    for (const obs of obsList) {
      if (!canonical.has(obs.observingPackage)) {
        issues.push({
          kind: 'observer-unknown-package',
          detail: `observers['${observedPkg}'] references observingPackage '${obs.observingPackage}' which is not a declared workspace.`,
        });
      }
      if (!data.shardOrder.includes(obs.selectShard)) {
        issues.push({
          kind: 'observer-unknown-shard',
          detail: `observers['${observedPkg}'] references selectShard '${obs.selectShard}' which is not in shardOrder.`,
        });
      }
    }
  }

  return issues;
}

/** Indispensable shared inputs that MUST appear in sharedInputs. */
const REQUIRED_SHARED_INPUTS: readonly string[] = [
  'package.json',
  'package-lock.json',
  'bun.lock',
  'tsconfig.json',
  'scripts/test.ts',
  'scripts/postinstall.cjs',
];

/**
 * Validates sharedInputs bidirectionally: each listed entry must exist on disk
 * (stale/dangling), and each indispensable input must be listed (missing).
 */
function validateSharedInputs(data: GraphData, repoRoot: string): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const dataInputs = new Set<string>(data.sharedInputs);

  // Existence: every listed shared input must exist on disk.
  for (const entry of [...dataInputs].sort()) {
    if (!existsSync(join(repoRoot, entry))) {
      issues.push({
        kind: 'shared-input-not-found',
        detail: `sharedInputs references '${entry}' which does not exist on disk.`,
      });
    }
  }
  // Missing: indispensable inputs must be listed.
  for (const entry of REQUIRED_SHARED_INPUTS) {
    if (!dataInputs.has(entry)) {
      issues.push({
        kind: 'shared-input-missing',
        detail: `sharedInputs is missing canonical shared input '${entry}'. Add it.`,
      });
    }
  }
  return issues;
}

/**
 * Reverse-completeness: every canonical TEST_SHARDS workspace must be present
 * in packageToShard, catching a new workspace added without updating the data.
 */
function validateReverseCompleteness(
  data: GraphData,
  canonical: Map<string, string>,
): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const mapped = new Set<string>(Object.keys(data.packageToShard));
  for (const ws of [...canonical.keys()].sort()) {
    if (!mapped.has(ws)) {
      issues.push({
        kind: 'workspace-not-in-shard-map',
        detail: `workspace '${ws}' is declared in TEST_SHARDS but is missing from packageToShard.`,
      });
    }
  }
  return issues;
}

function checkGraph(
  repoRoot: string,
  dataPath: string,
): { readonly issues: readonly DriftIssue[]; readonly ok: boolean } {
  const issues: DriftIssue[] = [];
  const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as GraphData;
  const { prodEdges, testOnlyEdges } = extractAllEdges(repoRoot);

  const dataProdEdges = new Map<string, readonly string[]>(
    Object.entries(data.importEdges),
  );
  const dataTestOnlyEdges = new Map<string, readonly string[]>(
    Object.entries(data.testOnlyEdges),
  );

  const allPackageNames = new Set<string>([
    ...prodEdges.keys(),
    ...testOnlyEdges.keys(),
    ...dataProdEdges.keys(),
    ...dataTestOnlyEdges.keys(),
  ]);

  for (const pkg of [...allPackageNames].sort()) {
    issues.push(
      ...compareEdges(
        pkg,
        prodEdges.get(pkg) ?? new Set<string>(),
        testOnlyEdges.get(pkg) ?? new Set<string>(),
        new Set(dataProdEdges.get(pkg) ?? []),
        new Set(dataTestOnlyEdges.get(pkg) ?? []),
      ),
    );
  }

  const canonical = buildCanonicalShardMap();
  issues.push(...validateShardMap(data, canonical));
  issues.push(...validateShardConfig(data, canonical));
  issues.push(...validateSharedInputs(data, repoRoot));
  issues.push(...validateReverseCompleteness(data, canonical));

  return { issues, ok: issues.length === 0 };
}

function formatIssue(issue: DriftIssue): string {
  return `  - [${issue.kind}] ${issue.detail}`;
}

function main(): void {
  const rootArg = process.argv.find((a) => a === '--root');
  let repoRoot = DEFAULT_REPO_ROOT;
  if (rootArg !== undefined) {
    const idx = process.argv.indexOf('--root');
    if (idx + 1 < process.argv.length) {
      repoRoot = resolve(process.argv[idx + 1]);
    }
  }
  const dataPath = DEFAULT_DATA_PATH;

  console.log(
    `affected-test-shards drift guard: scanning ${repoRoot} against ${relative(repoRoot, dataPath)}`,
  );

  const { issues, ok } = checkGraph(repoRoot, dataPath);

  if (!ok) {
    console.error('\naffected-test-shards drift guard FAILED:');
    for (const issue of issues) {
      console.error(formatIssue(issue));
    }
    console.error(
      '\nFix: update scripts/affected-test-shards.data.json so the ' +
        'importEdges/testOnlyEdges match the real AST-derived imports, then ' +
        're-run `bun scripts/check-affected-test-shards.ts`.',
    );
    process.exit(1);
  }

  console.log(
    'affected-test-shards drift guard PASSED: checked-in graph matches real imports.',
  );
  process.exit(0);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
