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
        const regexStr = prefix.replace(/\*/g, '[^/]+');
        const regex = new RegExp('^' + regexStr + '(/|$)');
        if (regex.test(rel)) return true;
      } else {
        const regexStr = normalized.replace(/\*/g, '[^/]+');
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

function analyzeFile(filePath, movedSymbols, fromPackage, deepPaths) {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations = [];

  function getLine(pos) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function isFromPackage(specifier) {
    if (!specifier) return false;
    if (specifier === fromPackage) return true;
    if (specifier.startsWith(fromPackage + '/')) {
      // Check if deep path matches moved deep paths
      const subPath = specifier.slice(fromPackage.length + 1);
      // Strip .js extension for comparison
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
      // Also handle type references like X.SomeType in type positions
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

  function checkSymbol(name, importKind, specifier, line) {
    if (movedSymbols.length > 0 && movedSymbols.includes(name)) {
      violations.push({
        symbol: name,
        importKind,
        moduleSpecifier: specifier,
        line,
      });
    }
  }

  function visit(node) {
    // Static imports
    if (ts.isImportDeclaration(node)) {
      const modSpec = node.moduleSpecifier;
      if (
        modSpec &&
        ts.isStringLiteral(modSpec) &&
        isFromPackage(modSpec.text)
      ) {
        const specifier = modSpec.text;
        const line = getLine(node.getStart());
        const clause = node.importClause;
        if (clause) {
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              const sym = el.propertyName ? el.propertyName.text : el.name.text;
              checkSymbol(sym, 'static-import', specifier, line);
            }
          }
          if (
            clause.namedBindings &&
            ts.isNamespaceImport(clause.namedBindings)
          ) {
            // Only flag namespace imports if the namespace is used to access moved symbols.
            // If movedSymbols is empty (deep-path-only check), skip namespace detection.
            const nsName = clause.namedBindings.name.text;
            if (movedSymbols.length > 0) {
              const accessed = collectNamespaceAccesses(sourceFile, nsName);
              const usedMoved = [...accessed].filter((s) =>
                movedSymbols.includes(s),
              );
              if (usedMoved.length > 0) {
                for (const sym of usedMoved) {
                  violations.push({
                    symbol: `${nsName}.${sym} (namespace)`,
                    importKind: 'namespace-import',
                    moduleSpecifier: specifier,
                    line,
                  });
                }
              }
            }
          }
          if (clause.name) {
            checkSymbol(clause.name.text, 'static-import', specifier, line);
          }
        }
      }
    }

    // Import-equals
    if (ts.isImportEqualsDeclaration(node)) {
      if (
        node.moduleReference &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const expr = node.moduleReference.expression;
        if (expr && ts.isStringLiteral(expr) && isFromPackage(expr.text)) {
          checkSymbol(
            node.name.text,
            'import-equals',
            expr.text,
            getLine(node.getStart()),
          );
        }
      }
    }

    // Call expressions (dynamic import + vi.mock)
    if (ts.isCallExpression(node)) {
      // Dynamic import
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (
          node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const specifier = node.arguments[0].text;
          if (isFromPackage(specifier)) {
            const line = getLine(node.getStart());
            const parent = node.parent;
            if (parent) {
              const ids = new Set();
              collectIdentifiers(parent, ids);
              for (const sym of movedSymbols) {
                if (ids.has(sym)) {
                  violations.push({
                    symbol: sym,
                    importKind: 'dynamic-import',
                    moduleSpecifier: specifier,
                    line,
                  });
                }
              }
            }
          }
        }
      }

      // vi.mock
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'mock' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'vi'
      ) {
        if (
          node.arguments.length >= 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const specifier = node.arguments[0].text;
          if (isFromPackage(specifier)) {
            const line = getLine(node.getStart());
            if (node.arguments.length >= 2) {
              const factory = node.arguments[1];
              const ids = new Set();
              collectIdentifiers(factory, ids);
              for (const sym of movedSymbols) {
                if (ids.has(sym)) {
                  violations.push({
                    symbol: sym,
                    importKind: 'vi.mock',
                    moduleSpecifier: specifier,
                    line,
                  });
                }
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Deduplicate
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.symbol}|${v.importKind}|${v.moduleSpecifier}|${v.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
