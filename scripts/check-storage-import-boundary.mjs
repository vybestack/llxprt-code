#!/usr/bin/env node

/**
 * check-storage-import-boundary.mjs
 *
 * Validates that no non-core file imports moved storage symbols from
 * @vybestack/llxprt-code-core (root or deep paths). Uses TypeScript
 * compiler API for accurate detection of all import kinds.
 *
 * See plan/06-consumer-integration-dependency-graph.md for usage examples.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

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

function walkDir(dir, excludePatterns) {
  const results = [];
  const absDir = resolve(dir);
  const cwd = process.cwd();

  function shouldExclude(filePath) {
    const rel = relative(cwd, filePath).replace(/\\/g, '/');
    for (const pat of excludePatterns) {
      const normalized = pat.replace(/\\/g, '/');
      if (normalized.endsWith('/**')) {
        const prefix = normalized.slice(0, -3);
        const regexStr = globToRegexSource(prefix);
        const regex = new RegExp('^' + regexStr + '(/|$)');
        if (regex.test(rel)) return true;
      } else {
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

function getLine(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function isFromPackage(specifier, fromPackage, deepPaths) {
  if (!specifier) return false;
  if (specifier === fromPackage) return true;
  if (specifier.startsWith(fromPackage + '/')) {
    const subPath = specifier.slice(fromPackage.length + 1);
    const bare = subPath.replace(/\.js$/, '');
    if (deepPaths.length === 0) return true;
    return deepPaths.some((dp) => bare === dp || bare.startsWith(dp + '/'));
  }
  return false;
}

function collectIdentifiers(node, set) {
  if (ts.isIdentifier(node)) set.add(node.text);
  ts.forEachChild(node, (child) => collectIdentifiers(child, set));
}

/**
 * Collect all X.Y property-access identifiers where X matches namespaceVarName.
 * Returns the set of Y identifiers accessed through the namespace.
 */
function collectNamespaceAccesses(sourceFile, namespaceVarName) {
  const accessed = new Set();
  function walk(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === namespaceVarName &&
      ts.isIdentifier(node.name)
    ) {
      accessed.add(node.name.text);
    }
    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      node.left.text === namespaceVarName &&
      ts.isIdentifier(node.right)
    ) {
      accessed.add(node.right.text);
    }
    ts.forEachChild(node, walk);
  }
  ts.forEachChild(sourceFile, walk);
  return accessed;
}

/**
 * Context object threaded through the per-node-type handlers.
 */
function createContext(sourceFile, movedSymbols, fromPackage, deepPaths) {
  return {
    sourceFile,
    movedSymbols,
    fromPackage,
    deepPaths,
    violations: [],
    getLine: (pos) => getLine(sourceFile, pos),
    checkSymbol(name, importKind, specifier, line) {
      if (movedSymbols.length > 0 && movedSymbols.includes(name)) {
        this.violations.push({
          symbol: name,
          importKind,
          moduleSpecifier: specifier,
          line,
        });
      }
    },
  };
}

function isViMockCall(node) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'mock' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'vi'
  );
}

function collectDynamicImportViolations(ctx, node, specifier, line) {
  const parent = node.parent;
  if (!parent) return;
  const ids = new Set();
  collectIdentifiers(parent, ids);
  for (const sym of ctx.movedSymbols) {
    if (ids.has(sym)) {
      ctx.violations.push({
        symbol: sym,
        importKind: 'dynamic-import',
        moduleSpecifier: specifier,
        line,
      });
    }
  }
}

function collectFactoryViolations(ctx, factory, specifier, line, importKind) {
  const ids = new Set();
  collectIdentifiers(factory, ids);
  for (const sym of ctx.movedSymbols) {
    if (ids.has(sym)) {
      ctx.violations.push({
        symbol: sym,
        importKind,
        moduleSpecifier: specifier,
        line,
      });
    }
  }
}

function handleNamespaceImport(ctx, nsName, specifier, line) {
  if (ctx.movedSymbols.length === 0) return;
  const accessed = collectNamespaceAccesses(ctx.sourceFile, nsName);
  const usedMoved = [...accessed].filter((s) => ctx.movedSymbols.includes(s));
  for (const sym of usedMoved) {
    ctx.violations.push({
      symbol: `${nsName}.${sym} (namespace)`,
      importKind: 'namespace-import',
      moduleSpecifier: specifier,
      line,
    });
  }
}

function visitImportDeclaration(node, ctx) {
  if (!ts.isImportDeclaration(node)) return;
  const modSpec = node.moduleSpecifier;
  if (!modSpec || !ts.isStringLiteral(modSpec)) return;
  if (!isFromPackage(modSpec.text, ctx.fromPackage, ctx.deepPaths)) return;

  const specifier = modSpec.text;
  const line = ctx.getLine(node.getStart());
  const clause = node.importClause;
  if (!clause) return;

  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const el of clause.namedBindings.elements) {
      const sym = el.propertyName ? el.propertyName.text : el.name.text;
      ctx.checkSymbol(sym, 'static-import', specifier, line);
    }
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    handleNamespaceImport(ctx, clause.namedBindings.name.text, specifier, line);
  }
  if (clause.name) {
    ctx.checkSymbol(clause.name.text, 'static-import', specifier, line);
  }
}

function visitImportEquals(node, ctx) {
  if (!ts.isImportEqualsDeclaration(node)) return;
  if (
    !node.moduleReference ||
    !ts.isExternalModuleReference(node.moduleReference)
  )
    return;
  const expr = node.moduleReference.expression;
  if (!expr || !ts.isStringLiteral(expr)) return;
  if (!isFromPackage(expr.text, ctx.fromPackage, ctx.deepPaths)) return;
  ctx.checkSymbol(
    node.name.text,
    'import-equals',
    expr.text,
    ctx.getLine(node.getStart()),
  );
}

function visitDynamicImport(node, ctx) {
  if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
  if (node.arguments.length === 0 || !ts.isStringLiteral(node.arguments[0]))
    return;
  const specifier = node.arguments[0].text;
  if (!isFromPackage(specifier, ctx.fromPackage, ctx.deepPaths)) return;
  // LIMITATION: we only scan the immediate parent node for symbol
  // identifiers. Moved symbols bound through intermediate variable
  // assignments or deep destructuring across statements may not be
  // detected. This is acceptable for a boundary guard where false
  // negatives are tolerable but false positives are not.
  collectDynamicImportViolations(
    ctx,
    node,
    specifier,
    ctx.getLine(node.getStart()),
  );
}

function visitViMockCall(node, ctx) {
  if (!isViMockCall(node)) return;
  if (node.arguments.length < 1 || !ts.isStringLiteral(node.arguments[0]))
    return;
  const specifier = node.arguments[0].text;
  if (!isFromPackage(specifier, ctx.fromPackage, ctx.deepPaths)) return;
  const line = ctx.getLine(node.getStart());
  if (node.arguments.length < 2) return;
  collectFactoryViolations(ctx, node.arguments[1], specifier, line, 'vi.mock');
}

function visitCallExpression(node, ctx) {
  if (!ts.isCallExpression(node)) return;
  visitDynamicImport(node, ctx);
  visitViMockCall(node, ctx);
}

function visitNode(node, ctx) {
  visitImportDeclaration(node, ctx);
  visitImportEquals(node, ctx);
  visitCallExpression(node, ctx);
  ts.forEachChild(node, (child) => visitNode(child, ctx));
}

function deduplicateViolations(violations) {
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.symbol}|${v.importKind}|${v.moduleSpecifier}|${v.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function analyzeFile(filePath, movedSymbols, fromPackage, deepPaths) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const ctx = createContext(sourceFile, movedSymbols, fromPackage, deepPaths);
  visitNode(sourceFile, ctx);

  return deduplicateViolations(ctx.violations);
}

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
  const deepPaths = (args['deep-paths'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const excludeCoreCompat = args['exclude-core-compat-tests'];

  if (excludeCoreCompat) {
    excludeGlobs.push('packages/core/src/storage/storage-compat.test.ts');
  }

  console.log(`Checking import boundary for moved storage symbols...`);
  console.log(`Scanning: ${scanDir}`);
  console.log(`Moved symbols: ${movedSymbols.length}`);
  console.log(`Deep paths: ${deepPaths.join(', ') || '(all)'}`);
  console.log(`Exclude core compat tests: ${excludeCoreCompat ? 'yes' : 'no'}`);

  const files = walkDir(scanDir, excludeGlobs);
  console.log(`Scanning ${files.length} .ts files...\n`);

  let totalViolations = 0;
  const violationsByFile = {};

  for (const filePath of files) {
    const rel = relative(repoRoot, filePath).replace(/\\/g, '/');
    // Skip files within packages/storage itself (will import from its own package)
    if (rel.startsWith('packages/storage/')) continue;

    const fileViolations = analyzeFile(
      filePath,
      movedSymbols,
      fromPackage,
      deepPaths,
    );
    if (fileViolations.length > 0) {
      violationsByFile[rel] = fileViolations;
      totalViolations += fileViolations.length;
    }
  }

  if (totalViolations === 0) {
    console.log(
      'PASS: No moved storage symbols imported from core outside core-compat tests.',
    );
    process.exit(0);
  } else {
    console.log(`FAIL: ${totalViolations} violation(s) found:\n`);
    for (const [file, viols] of Object.entries(violationsByFile)) {
      console.log(`  ${file}:`);
      for (const v of viols) {
        console.log(
          `    line ${v.line}: ${v.symbol} (${v.importKind}) from ${v.moduleSpecifier}`,
        );
      }
    }
    console.log(
      `\n${totalViolations} violation(s). Fix imports to use @vybestack/llxprt-code-storage.`,
    );
    process.exit(1);
  }
}

main();
