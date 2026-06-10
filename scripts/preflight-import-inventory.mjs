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

import { createRequire } from 'node:module';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
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
function globToRegexSource(glob) {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Re-enable the single supported wildcard: escaped `\*` -> `[^/]+`.
  return escaped.replace(/\\\*/g, '[^/]+');
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function walkDir(dir, excludePatterns) {
  const results = [];
  const absDir = resolve(dir);
  const cwd = process.cwd();

  function shouldExclude(filePath) {
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

  function walk(d) {
    if (shouldExclude(d)) return;
    let entries;
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
 * Extract all import references to `fromPackage` (root or deep paths)
 * and identify which moved symbols are imported.
 */
function analyzeFile(filePath, movedSymbols, fromPackage) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const imports = [];

  function addImport(symbol, importKind, moduleSpecifier, line) {
    if (movedSymbols.includes(symbol)) {
      imports.push({ symbol, importKind, moduleSpecifier, line });
    }
  }

  function getLine(pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function isFromPackage(specifier) {
    if (!specifier) return false;
    return specifier === fromPackage || specifier.startsWith(fromPackage + '/');
  }

  // Collect all identifiers in a tree (deep)
  function collectIdentifiers(node, set) {
    if (ts.isIdentifier(node)) {
      set.add(node.text);
    }
    ts.forEachChild(node, (child) => collectIdentifiers(child, set));
  }

  // 1. Static imports: import { X } from '...' and import X from '...'
  function visitImportDeclaration(node) {
    if (!ts.isImportDeclaration(node)) return;
    const modSpec = node.moduleSpecifier;
    if (!modSpec || !ts.isStringLiteral(modSpec)) return;
    const specifier = modSpec.text;
    if (!isFromPackage(specifier)) return;

    const importClause = node.importClause;
    if (!importClause) return;

    // Named imports: import { X, Y } from '...'
    if (
      importClause.namedBindings &&
      ts.isNamedImports(importClause.namedBindings)
    ) {
      for (const element of importClause.namedBindings.elements) {
        const importedName = element.name.text;
        // The original name (before 'as') if present
        const symbolName = element.propertyName
          ? element.propertyName.text
          : importedName;
        addImport(
          symbolName,
          'static-import',
          specifier,
          getLine(node.getStart()),
        );
      }
    }

    // Namespace import: import * as X from '...'
    if (
      importClause.namedBindings &&
      ts.isNamespaceImport(importClause.namedBindings)
    ) {
      // Record as namespace-import — the namespace itself may reference moved symbols
      // We'll note the namespace name but we can't resolve individual usages statically
      // For inventory purposes, we note it as a namespace-import
      addImport('*', 'namespace-import', specifier, getLine(node.getStart()));
    }

    // Default import: import X from '...'
    if (importClause.name) {
      addImport(
        importClause.name.text,
        'static-import',
        specifier,
        getLine(node.getStart()),
      );
    }
  }

  // 2. Import-equals: import X = require('...')
  function visitImportEquals(node) {
    if (!ts.isImportEqualsDeclaration(node)) return;
    if (
      node.moduleReference &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expr = node.moduleReference.expression;
      if (expr && ts.isStringLiteral(expr)) {
        if (isFromPackage(expr.text)) {
          const name = node.name.text;
          addImport(name, 'import-equals', expr.text, getLine(node.getStart()));
        }
      }
    }
  }

  // 3. Dynamic imports: import('...')
  function visitCallExpression(node) {
    if (!ts.isCallExpression(node)) return;

    // Dynamic import: import('...')
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        if (isFromPackage(specifier)) {
          const line = getLine(node.getStart());
          // Walk up ancestors to find binding pattern
          // AST chain: CallExpression(import) -> AwaitExpression -> VariableDeclaration (sibling has ObjectBindingPattern)
          let ancestor = node.parent;
          const ids = new Set();
          // Collect identifiers from the node itself
          collectIdentifiers(node, ids);
          // Walk up to find VariableDeclaration with binding pattern
          for (let i = 0; i < 5 && ancestor; i++) {
            collectIdentifiers(ancestor, ids);
            if (ts.isVariableDeclaration(ancestor)) {
              // The name could be an ObjectBindingPattern or identifier
              collectIdentifiers(ancestor.name, ids);
            }
            ancestor = ancestor.parent;
          }
          for (const sym of movedSymbols) {
            if (ids.has(sym)) {
              addImport(sym, 'dynamic-import', specifier, line);
            }
          }
        }
      }
    }

    // vi.mock('...') detection
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'mock' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'vi'
    ) {
      if (node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        if (isFromPackage(specifier)) {
          const line = getLine(node.getStart());
          // Parse factory function to find moved symbol names
          if (node.arguments.length >= 2) {
            const factory = node.arguments[1];
            const ids = new Set();
            collectIdentifiers(factory, ids);
            for (const sym of movedSymbols) {
              if (ids.has(sym)) {
                addImport(sym, 'vi.mock', specifier, line);
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visitNode(child));
  }

  function visitNode(node) {
    visitImportDeclaration(node);
    visitImportEquals(node);

    if (ts.isCallExpression(node)) {
      visitCallExpression(node);
      // Don't recurse further here; visitCallExpression already recurses children
      return;
    }

    ts.forEachChild(node, (child) => visitNode(child));
  }

  visitNode(sourceFile);

  // Deduplicate by symbol+importKind+moduleSpecifier+line
  const seen = new Set();
  const deduped = [];
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

// ---------------------------------------------------------------------------
// P06 consumer list extraction
// ---------------------------------------------------------------------------
function extractP06Consumers(filePath) {
  if (!existsSync(filePath)) return new Set();
  const text = readFileSync(filePath, 'utf-8');
  const consumers = new Set();
  // Match file paths like packages/.../*.ts in the P06 markdown
  const re = /`((?:packages\/[^\s`]+\.ts))`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    consumers.add(m[1]);
  }
  return consumers;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();

  const movedSymbols = (args['moved-symbols'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const fromPackage = args['from-package'] || '@vybestack/llxprt-code-core';
  const scanDir = args['scan-dir'] || 'packages';
  const excludeGlobs = (args['exclude-glob'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Always exclude dist directories — they are generated build output
  excludeGlobs.push('packages/*/dist/**');
  excludeGlobs.push('packages/*/*/dist/**');
  const outputJson = args['output-json'] || '';
  const outputText = args['output-text'] || '';
  const expectedConsumersFile = args['expected-consumers-file'] || '';

  if (!movedSymbols.length) {
    console.error('ERROR: --moved-symbols is required');
    process.exit(1);
  }

  console.log(
    `Scanning ${scanDir} for imports of moved symbols from ${fromPackage}...`,
  );
  console.log(
    `Moved symbols (${movedSymbols.length}): ${movedSymbols.join(', ')}`,
  );

  const files = walkDir(scanDir, excludeGlobs);
  console.log(`Scanning ${files.length} .ts files...`);

  const consumers = [];
  const byImportKind = {};
  const byPackage = {};

  for (const filePath of files) {
    const rel = relative(repoRoot, filePath).replace(/\\/g, '/');
    const fileImports = analyzeFile(filePath, movedSymbols, fromPackage);
    if (fileImports.length > 0) {
      consumers.push({ filePath: rel, imports: fileImports });

      for (const imp of fileImports) {
        byImportKind[imp.importKind] = (byImportKind[imp.importKind] || 0) + 1;

        // Extract package path: packages/XXX/...
        const pkgMatch = rel.match(/^(packages\/[^/]+)/);
        if (pkgMatch) {
          byPackage[pkgMatch[1]] = (byPackage[pkgMatch[1]] || 0) + 1;
        }
      }
    }
  }

  const totalImports = consumers.reduce((sum, c) => sum + c.imports.length, 0);

  // Build JSON output
  const result = {
    generatedAt: new Date().toISOString(),
    fromPackage,
    scanDir,
    movedSymbols,
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

  // Reconcile with P06 consumer list
  if (expectedConsumersFile) {
    const p06Consumers = extractP06Consumers(expectedConsumersFile);
    const inventoryConsumers = new Set(consumers.map((c) => c.filePath));

    // Consumers in inventory but not in P06
    const missing = [];
    for (const c of inventoryConsumers) {
      if (!p06Consumers.has(c)) {
        missing.push(c);
      }
    }

    // Consumers in P06 but not in inventory
    const extra = [];
    for (const c of p06Consumers) {
      if (!inventoryConsumers.has(c)) {
        extra.push(c);
      }
    }

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
  } else {
    // No P06 file to reconcile — auto-pass
    result.reconciliation.status = 'pass';
    console.log(
      '\nNo P06 consumers file specified; reconciliation auto-passed.',
    );
  }

  // Write JSON
  if (outputJson) {
    const jsonDir = resolve(outputJson, '..');
    mkdirSync(jsonDir, { recursive: true });
    writeFileSync(outputJson, JSON.stringify(result, null, 2) + '\n');
    console.log(`\nJSON output written to: ${outputJson}`);
  }

  // Write text
  if (outputText) {
    const txtDir = resolve(outputText, '..');
    mkdirSync(txtDir, { recursive: true });
    const lines = [];
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
    lines.push(`Reconciliation: ${result.reconciliation.status}`);
    if (result.reconciliation.missingFromPlan.length) {
      lines.push(
        `Missing from plan (${result.reconciliation.missingFromPlan.length}):`,
      );
      for (const f of result.reconciliation.missingFromPlan) {
        lines.push(`  - ${f}`);
      }
    }
    if (result.reconciliation.extraInPlan.length) {
      lines.push(
        `Extra in plan (${result.reconciliation.extraInPlan.length}):`,
      );
      for (const f of result.reconciliation.extraInPlan) {
        lines.push(`  - ${f}`);
      }
    }
    writeFileSync(outputText, lines.join('\n') + '\n');
    console.log(`Text output written to: ${outputText}`);
  }

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Consumer files: ${consumers.length}`);
  console.log(`Total imports: ${totalImports}`);
  console.log(`Reconciliation: ${result.reconciliation.status}`);

  // Exit code
  if (result.reconciliation.status === 'blocked') {
    process.exit(1);
  }
}

main();
