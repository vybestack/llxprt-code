#!/usr/bin/env node

/**
 * preflight-import-inventory.mjs
 *
 * TypeScript parser-based import inventory for moved storage symbols.
 * Scans all .ts files under a scan directory and detects imports of moved
 * symbols from @vybestack/llxprt-code-core (root and deep paths).
 *
 * Detects: static imports, namespace imports, import-equals,
 *          dynamic import(), and vi.mock() calls.
 *
 * See plan/00a-preflight-verification.md for usage examples.
 */

import * as ts from 'typescript';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

interface ImportRecord {
  symbol: string;
  importKind: string;
  moduleSpecifier: string;
  line: number;
}

interface AnalysisContext {
  sourceFile: ts.SourceFile;
  movedSymbols: string[];
  fromPackage: string;
  imports: ImportRecord[];
  getLine: (pos: number) => number;
  isFromPackage: (specifier: string) => boolean;
  addImport: (
    symbol: string,
    importKind: string,
    moduleSpecifier: string,
    line: number,
  ) => void;
}

interface ParsedArgs {
  [key: string]: string | boolean;
}

interface ScanResult {
  consumers: Array<{ filePath: string; imports: ImportRecord[] }>;
  byImportKind: Record<string, number>;
  byPackage: Record<string, number>;
}

interface ReconciliationResult {
  status: string;
  missingFromPlan: string[];
  extraInPlan: string[];
}

interface InventoryResult {
  generatedAt: string;
  fromPackage: string;
  scanDir: string;
  movedSymbols: string[];
  consumers: Array<{ filePath: string; imports: ImportRecord[] }>;
  summary: {
    totalFiles: number;
    totalImports: number;
    byImportKind: Record<string, number>;
    byPackage: Record<string, number>;
  };
  reconciliation: ReconciliationResult;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

/**
 * Converts a simple glob (only `*` is special, matching a single path
 * segment) into a safe regex source string. All other regex metacharacters
 * are escaped first so that user-supplied patterns cannot inject regex
 * syntax (prevents regular-expression-injection; see CodeQL js/regex-injection).
 */
function globToRegexSource(glob: string): string {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Re-enable the single supported wildcard: escaped `\*` -> `[^/]+`.
  return escaped.replace(/\\\*/g, '[^/]+');
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function walkDir(dir: string, excludePatterns: string[]): string[] {
  const results: string[] = [];
  const absDir = resolve(dir);
  const cwd = process.cwd();

  function shouldExclude(filePath: string): boolean {
    const rel = relative(cwd, filePath).replace(/\\/g, '/');
    for (const pat of excludePatterns) {
      const normalized = pat.replace(/\\/g, '/');
      // Support basic glob: trailing /** means match everything under prefix
      if (normalized.endsWith('/**')) {
        const prefix = normalized.slice(0, -3);
        // Replace single glob * with [^/]+ for segment matching
        const regexStr = globToRegexSource(prefix);
        const regex = new RegExp('^' + regexStr + '(/|$)');
        if (regex.test(rel)) return true;
      } else {
        // Exact match
        const regexStr = globToRegexSource(normalized);
        const regex = new RegExp('^' + regexStr + '$');
        if (regex.test(rel)) return true;
      }
    }
    return false;
  }

  function walk(d: string): void {
    if (shouldExclude(d)) return;
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (shouldExclude(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && extname(entry.name) === '.ts') {
        results.push(full);
      }
    }
  }
  walk(absDir);
  return results;
}

// ---------------------------------------------------------------------------
// TypeScript AST analysis
// ---------------------------------------------------------------------------

/**
 * Context object threaded through the per-node-type handlers.
 */
function createAnalysisContext(
  sourceFile: ts.SourceFile,
  movedSymbols: string[],
  fromPackage: string,
): AnalysisContext {
  const ctx: AnalysisContext = {
    sourceFile,
    movedSymbols,
    fromPackage,
    imports: [],
    getLine: (pos: number) =>
      sourceFile.getLineAndCharacterOfPosition(pos).line + 1,
    isFromPackage(specifier: string): boolean {
      if (!specifier) return false;
      return (
        specifier === fromPackage || specifier.startsWith(fromPackage + '/')
      );
    },
    addImport(
      symbol: string,
      importKind: string,
      moduleSpecifier: string,
      line: number,
    ): void {
      if (movedSymbols.includes(symbol)) {
        this.imports.push({ symbol, importKind, moduleSpecifier, line });
      }
    },
  };
  return ctx;
}

function collectIdentifiers(node: ts.Node, set: Set<string>): void {
  if (ts.isIdentifier(node)) {
    set.add(node.text);
  }
  ts.forEachChild(node, (child) => collectIdentifiers(child, set));
}

function isViMockCall(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'mock' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi'
  );
}

// 1. Static imports: import { X } from '...' and import X from '...'
function visitImportDeclaration(node: ts.Node, ctx: AnalysisContext): void {
  if (!ts.isImportDeclaration(node)) return;
  const modSpec = node.moduleSpecifier;
  if (!modSpec || !ts.isStringLiteral(modSpec)) return;
  const specifier = modSpec.text;
  if (!ctx.isFromPackage(specifier)) return;

  const importClause = node.importClause;
  if (!importClause) return;
  const line = ctx.getLine(node.getStart());

  if (
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    for (const element of importClause.namedBindings.elements) {
      const importedName = element.name.text;
      const symbolName = element.propertyName
        ? element.propertyName.text
        : importedName;
      ctx.addImport(symbolName, 'static-import', specifier, line);
    }
  }

  if (
    importClause.namedBindings &&
    ts.isNamespaceImport(importClause.namedBindings)
  ) {
    ctx.addImport('*', 'namespace-import', specifier, line);
  }

  if (importClause.name) {
    ctx.addImport(importClause.name.text, 'static-import', specifier, line);
  }
}

// 2. Import-equals: import X = require('...')
function visitImportEquals(node: ts.Node, ctx: AnalysisContext): void {
  if (!ts.isImportEqualsDeclaration(node)) return;
  if (
    !node.moduleReference ||
    !ts.isExternalModuleReference(node.moduleReference)
  )
    return;
  const expr = node.moduleReference.expression;
  if (!expr || !ts.isStringLiteral(expr)) return;
  if (!ctx.isFromPackage(expr.text)) return;
  ctx.addImport(
    node.name.text,
    'import-equals',
    expr.text,
    ctx.getLine(node.getStart()),
  );
}

// 3a. Dynamic imports: import('...')
function visitDynamicImport(
  node: ts.CallExpression,
  ctx: AnalysisContext,
): void {
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
  if (node.arguments.length === 0 || !ts.isStringLiteral(node.arguments[0]))
    return;
  const specifier = node.arguments[0].text;
  if (!ctx.isFromPackage(specifier)) return;

  const line = ctx.getLine(node.getStart());
  let ancestor: ts.Node | undefined = node.parent;
  const ids = new Set<string>();
  collectIdentifiers(node, ids);
  for (let i = 0; i < 5 && ancestor; i++) {
    collectIdentifiers(ancestor, ids);
    if (ts.isVariableDeclaration(ancestor)) {
      collectIdentifiers(ancestor.name, ids);
    }
    ancestor = ancestor.parent;
  }
  for (const sym of ctx.movedSymbols) {
    if (ids.has(sym)) {
      ctx.addImport(sym, 'dynamic-import', specifier, line);
    }
  }
}

// 3b. vi.mock('...') detection
function visitViMockCall(node: ts.CallExpression, ctx: AnalysisContext): void {
  if (!isViMockCall(node)) return;
  if (node.arguments.length < 1 || !ts.isStringLiteral(node.arguments[0]))
    return;
  const specifier = node.arguments[0].text;
  if (!ctx.isFromPackage(specifier)) return;
  if (node.arguments.length < 2) return;

  const line = ctx.getLine(node.getStart());
  const ids = new Set<string>();
  collectIdentifiers(node.arguments[1], ids);
  for (const sym of ctx.movedSymbols) {
    if (ids.has(sym)) {
      ctx.addImport(sym, 'vi.mock', specifier, line);
    }
  }
}

function visitCallExpression(node: ts.Node, ctx: AnalysisContext): void {
  if (!ts.isCallExpression(node)) return;
  visitDynamicImport(node, ctx);
  visitViMockCall(node, ctx);
  ts.forEachChild(node, (child) => visitNode(child, ctx));
}

function visitNode(node: ts.Node, ctx: AnalysisContext): void {
  visitImportDeclaration(node, ctx);
  visitImportEquals(node, ctx);

  if (ts.isCallExpression(node)) {
    visitCallExpression(node, ctx);
    return;
  }

  ts.forEachChild(node, (child) => visitNode(child, ctx));
}

function deduplicateImports(imports: ImportRecord[]): ImportRecord[] {
  const seen = new Set<string>();
  const deduped: ImportRecord[] = [];
  for (const imp of imports) {
    if (imp.symbol === '*') continue; // skip namespace wildcards for inventory
    const key = `${imp.symbol}|${imp.importKind}|${imp.moduleSpecifier}|${imp.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(imp);
    }
  }
  return deduped;
}

/**
 * Extract all import references to `fromPackage` (root or deep paths)
 * and identify which moved symbols are imported.
 */
function analyzeFile(
  filePath: string,
  movedSymbols: string[],
  fromPackage: string,
): ImportRecord[] {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const ctx = createAnalysisContext(sourceFile, movedSymbols, fromPackage);
  visitNode(sourceFile, ctx);
  return deduplicateImports(ctx.imports);
}

// ---------------------------------------------------------------------------
// P06 consumer list extraction
// ---------------------------------------------------------------------------
function extractP06Consumers(filePath: string): Set<string> {
  if (!existsSync(filePath)) return new Set();
  const text = readFileSync(filePath, 'utf-8');
  const consumers = new Set<string>();
  // Match file paths like packages/.../*.ts in the P06 markdown
  const re = /`((?:packages\/[^\s`]+\.ts))`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    consumers.add(m[1]);
  }
  return consumers;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface ParseOptionsResult {
  movedSymbols: string[];
  fromPackage: string;
  scanDir: string;
  excludeGlobs: string[];
  outputJson: string;
  outputText: string;
  expectedConsumersFile: string;
}

function parseOptions(argv: string[]): ParseOptionsResult {
  const args = parseArgs(argv);
  const movedSymbolsArg =
    typeof args['moved-symbols'] === 'string' ? args['moved-symbols'] : '';
  const movedSymbols = movedSymbolsArg
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  const fromPackage =
    typeof args['from-package'] === 'string'
      ? args['from-package']
      : '@vybestack/llxprt-code-core';
  const scanDir =
    typeof args['scan-dir'] === 'string' ? args['scan-dir'] : 'packages';
  const excludeGlobArg =
    typeof args['exclude-glob'] === 'string' ? args['exclude-glob'] : '';
  const excludeGlobs = excludeGlobArg
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  excludeGlobs.push('packages/*/dist/**');
  excludeGlobs.push('packages/*/*/dist/**');
  return {
    movedSymbols,
    fromPackage,
    scanDir,
    excludeGlobs,
    outputJson:
      typeof args['output-json'] === 'string' ? args['output-json'] : '',
    outputText:
      typeof args['output-text'] === 'string' ? args['output-text'] : '',
    expectedConsumersFile:
      typeof args['expected-consumers-file'] === 'string'
        ? args['expected-consumers-file']
        : '',
  };
}

function scanFiles(
  repoRoot: string,
  files: string[],
  movedSymbols: string[],
  fromPackage: string,
): ScanResult {
  const consumers: Array<{ filePath: string; imports: ImportRecord[] }> = [];
  const byImportKind: Record<string, number> = {};
  const byPackage: Record<string, number> = {};

  for (const filePath of files) {
    const rel = relative(repoRoot, filePath).replace(/\\/g, '/');
    const fileImports = analyzeFile(filePath, movedSymbols, fromPackage);
    if (fileImports.length === 0) continue;

    consumers.push({ filePath: rel, imports: fileImports });
    for (const imp of fileImports) {
      byImportKind[imp.importKind] = (byImportKind[imp.importKind] || 0) + 1;
      const pkgMatch = rel.match(/^(packages\/[^/]+)/);
      if (pkgMatch) {
        const pkg = pkgMatch[1];
        byPackage[pkg] = (byPackage[pkg] || 0) + 1;
      }
    }
  }
  return { consumers, byImportKind, byPackage };
}

function reconcileConsumers(
  result: InventoryResult,
  consumers: Array<{ filePath: string; imports: ImportRecord[] }>,
  expectedConsumersFile: string,
): void {
  if (!expectedConsumersFile) {
    result.reconciliation.status = 'pass';
    console.log(
      '\nNo P06 consumers file specified; reconciliation auto-passed.',
    );
    return;
  }

  const p06Consumers = extractP06Consumers(expectedConsumersFile);
  const inventoryConsumers = new Set(consumers.map((c) => c.filePath));

  const missing = [...inventoryConsumers].filter((c) => !p06Consumers.has(c));
  const extra = [...p06Consumers].filter((c) => !inventoryConsumers.has(c));

  result.reconciliation.missingFromPlan = missing.sort();
  result.reconciliation.extraInPlan = extra.sort();

  if (missing.length === 0) {
    result.reconciliation.status = 'pass';
    console.log(
      `\nReconciliation: PASS (all inventory consumers found in P06)`,
    );
  } else {
    result.reconciliation.status = 'blocked';
    console.log(
      `\nReconciliation: BLOCKED (${missing.length} consumers found by inventory but not listed in P06):`,
    );
    for (const f of missing) {
      console.log(`  - ${f}`);
    }
  }

  if (extra.length > 0) {
    console.log(
      `\nWarning: ${extra.length} consumers listed in P06 but not found by inventory:`,
    );
    for (const f of extra) {
      console.log(`  - ${f}`);
    }
  }
}

function writeJsonOutput(outputJson: string, result: InventoryResult): void {
  if (!outputJson) return;
  const jsonDir = resolve(outputJson, '..');
  mkdirSync(jsonDir, { recursive: true });
  writeFileSync(outputJson, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nJSON output written to: ${outputJson}`);
}

function appendReconciliationLines(
  lines: string[],
  reconciliation: ReconciliationResult,
): void {
  lines.push(`Reconciliation: ${reconciliation.status}`);
  if (reconciliation.missingFromPlan.length) {
    lines.push(`Missing from plan (${reconciliation.missingFromPlan.length}):`);
    for (const f of reconciliation.missingFromPlan) {
      lines.push(`  - ${f}`);
    }
  }
  if (reconciliation.extraInPlan.length) {
    lines.push(`Extra in plan (${reconciliation.extraInPlan.length}):`);
    for (const f of reconciliation.extraInPlan) {
      lines.push(`  - ${f}`);
    }
  }
}

function writeTextOutput(
  opts: ParseOptionsResult & {
    byImportKind: Record<string, number>;
    byPackage: Record<string, number>;
  },
  result: InventoryResult,
  consumers: Array<{ filePath: string; imports: ImportRecord[] }>,
  totalImports: number,
): void {
  if (!opts.outputText) return;
  const { fromPackage, scanDir, movedSymbols, byImportKind, byPackage } = opts;
  const txtDir = resolve(opts.outputText, '..');
  mkdirSync(txtDir, { recursive: true });
  const lines: string[] = [];
  lines.push(`P00a Import Inventory — ${result.generatedAt}`);
  lines.push('='.repeat(60));
  lines.push(`From package: ${fromPackage}`);
  lines.push(`Scan directory: ${scanDir}`);
  lines.push(`Moved symbols: ${movedSymbols.length}`);
  lines.push('');
  lines.push(`Total consumer files: ${consumers.length}`);
  lines.push(`Total imports: ${totalImports}`);
  lines.push('');
  lines.push('Import kinds:');
  for (const [kind, count] of Object.entries(byImportKind)) {
    lines.push(`  ${kind}: ${count}`);
  }
  lines.push('');
  lines.push('By package:');
  for (const [pkg, count] of Object.entries(byPackage).sort()) {
    lines.push(`  ${pkg}: ${count}`);
  }
  lines.push('');
  lines.push('Consumer files:');
  for (const c of consumers) {
    lines.push(`  ${c.filePath}:`);
    for (const imp of c.imports) {
      lines.push(
        `    - ${imp.symbol} (${imp.importKind}) from ${imp.moduleSpecifier} line ${imp.line}`,
      );
    }
  }
  lines.push('');
  appendReconciliationLines(lines, result.reconciliation);
  writeFileSync(opts.outputText, lines.join('\n') + '\n');
  console.log(`Text output written to: ${opts.outputText}`);
}

function main(): void {
  const opts = parseOptions(process.argv);
  const repoRoot = process.cwd();

  if (!opts.movedSymbols.length) {
    console.error('ERROR: --moved-symbols is required');
    process.exit(1);
  }

  console.log(
    `Scanning ${opts.scanDir} for imports of moved symbols from ${opts.fromPackage}...`,
  );
  console.log(
    `Moved symbols (${opts.movedSymbols.length}): ${opts.movedSymbols.join(', ')}`,
  );

  const files = walkDir(opts.scanDir, opts.excludeGlobs);
  console.log(`Scanning ${files.length} .ts files...`);

  const { consumers, byImportKind, byPackage } = scanFiles(
    repoRoot,
    files,
    opts.movedSymbols,
    opts.fromPackage,
  );

  const totalImports = consumers.reduce((sum, c) => sum + c.imports.length, 0);

  const result: InventoryResult = {
    generatedAt: new Date().toISOString(),
    fromPackage: opts.fromPackage,
    scanDir: opts.scanDir,
    movedSymbols: opts.movedSymbols,
    consumers,
    summary: {
      totalFiles: consumers.length,
      totalImports,
      byImportKind,
      byPackage,
    },
    reconciliation: {
      status: 'pending',
      missingFromPlan: [],
      extraInPlan: [],
    },
  };

  reconcileConsumers(result, consumers, opts.expectedConsumersFile);

  writeJsonOutput(opts.outputJson, result);
  writeTextOutput(
    { ...opts, byImportKind, byPackage },
    result,
    consumers,
    totalImports,
  );

  console.log('\n=== Summary ===');
  console.log(`Consumer files: ${consumers.length}`);
  console.log(`Total imports: ${totalImports}`);
  console.log(`Reconciliation: ${result.reconciliation.status}`);

  if (result.reconciliation.status === 'blocked') {
    process.exit(1);
  }
}

main();
