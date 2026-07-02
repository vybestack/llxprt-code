import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let current = startDir;
  while (true) {
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.name === '@vybestack/llxprt-code') {
          return current;
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          const parent = dirname(current);
          if (parent === current) {
            throw new Error(
              `Unable to locate @vybestack/llxprt-code repo root from ${startDir}; encountered malformed package.json at ${packageJsonPath}: ${err.message}`,
            );
          }
          current = parent;
          continue;
        }
        throw new Error(
          `Failed to read package.json while resolving API-surface repo root at ${packageJsonPath}: ${err.message}`,
        );
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Unable to locate @vybestack/llxprt-code repo root from ${startDir}`,
      );
    }
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);

export const API_SURFACE_REPORT_PATH = join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'agents-api-surface',
  'report.json',
);

export const DENIED_INTERNAL_NAMES = Object.freeze(
  new Set(['AgentClient', 'CoreToolScheduler', 'AgenticLoop']),
);

function createSourceFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read declaration file while parsing API surface at ${filePath}: ${err.message}`,
    );
  }
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function normalizeSpecifierToDecl(spec, fromDeclDir) {
  if (!spec) return null;
  if (
    spec.startsWith('@') ||
    spec.startsWith('/') ||
    spec.startsWith('node:')
  ) {
    return null;
  }
  let base = spec;
  base = base.replace(/\.(js|mjs|cjs|mts|cts|ts|tsx|d\.ts)$/i, '');
  base = base.replace(/\.d$/i, '');
  const candidates = [
    `${base}.d.ts`,
    `${base}.ts`,
    `${base}/index.d.ts`,
    `${base}/index.ts`,
  ];
  for (const candidate of candidates) {
    const resolved = resolve(fromDeclDir, candidate);
    if (existsSync(resolved) && extname(resolved) === '.ts') {
      return resolved;
    }
  }
  return null;
}

function collectDirectExports(sourceFile) {
  const valueNames = new Set();
  const typeNames = new Set();
  function visit(node) {
    if (ts.isExportDeclaration(node)) {
      // Record named-export aliases for BOTH re-exports with a specifier
      // (`export { X as Y } from './m.js'`) and local re-exports
      // (`export { X as Y }`). This is the SINGLE source of truth for
      // named-export alias mapping; parseExportedNames does NOT re-process
      // named re-exports (it only recurses into export-star `export *`).
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const declIsTypeOnly = node.isTypeOnly === true;
        for (const el of node.exportClause.elements) {
          // el.name is the EXPORTED name (the public alias seen by
          // consumers); el.propertyName is the local/original name. The
          // surface records el.name: `export { X as Y } from './m.js'`
          // exports Y, not X.
          //
          // The per-element isTypeOnly flag (TS 4.5+ inline
          // `export { type X, Y }`) is honored in addition to the
          // declaration-level flag; either being true means the element is
          // type-only. The agents barrel uses exactly this pattern
          // (`export { StreamEventType, type StreamEvent } from ...`), so
          // StreamEvent is classified as a type, not a value.
          const exportedName = el.name.text;
          const elementIsTypeOnly = declIsTypeOnly || el.isTypeOnly === true;
          if (elementIsTypeOnly) {
            typeNames.add(exportedName);
          } else {
            valueNames.add(exportedName);
          }
        }
      } else if (
        node.exportClause &&
        ts.isNamespaceExport(node.exportClause) &&
        node.exportClause.name
      ) {
        valueNames.add(node.exportClause.name.text);
      }
      return;
    }
    const hasExportModifier = node.modifiers
      ? node.modifiers.some(
          (m) =>
            m.kind === ts.SyntaxKind.ExportKeyword ||
            m.kind === ts.SyntaxKind.DefaultKeyword,
        )
      : false;
    if (!hasExportModifier) {
      return;
    }
    if (ts.isInterfaceDeclaration(node) && node.name) {
      typeNames.add(node.name.text);
      return;
    }
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      typeNames.add(node.name.text);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      valueNames.add(node.name.text);
      return;
    }
    if (ts.isClassDeclaration(node) && node.name) {
      valueNames.add(node.name.text);
      return;
    }
    if (ts.isEnumDeclaration(node) && node.name) {
      valueNames.add(node.name.text);
      return;
    }
    // `export const ...` / `export declare const ...` — the export modifier
    // lives on the surrounding VariableStatement, not on the inner
    // VariableDeclarationList. Match the VariableStatement form (which owns
    // the export modifier) so declaration-file exports such as
    // `export declare const Internal: number;` are recorded. The inner
    // VariableDeclarationList reached via visitAll descent carries no export
    // modifier of its own and is intentionally skipped below.
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        collectBindingNames(decl.name, valueNames);
      }
      return;
    }
    if (ts.isVariableDeclarationList(node)) {
      return;
    }
  }
  function visitAll(node) {
    visit(node);
    ts.forEachChild(node, visitAll);
  }
  visitAll(sourceFile);
  return { valueNames, typeNames };
}

function collectBindingNames(nameNode, into) {
  if (ts.isIdentifier(nameNode)) {
    into.add(nameNode.text);
    return;
  }
  if (ts.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      collectBindingNames(el.name, into);
    }
    return;
  }
  if (ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      if (ts.isBindingElement(el)) {
        collectBindingNames(el.name, into);
      }
    }
  }
}

export function parseExportedNames(declarationPath, visited = new Set()) {
  const absolute = resolve(declarationPath);
  if (visited.has(absolute)) {
    return new Set();
  }
  visited.add(absolute);
  if (!existsSync(absolute)) {
    return new Set();
  }
  const sourceFile = createSourceFile(absolute);
  const fromDeclDir = dirname(absolute);
  const result = new Set();
  const { valueNames, typeNames } = collectDirectExports(sourceFile);
  for (const name of valueNames) result.add(name);
  for (const name of typeNames) result.add(name);

  function visit(node) {
    if (!ts.isExportDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const moduleSpecifier = node.moduleSpecifier;
    const specifierText =
      moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
        ? moduleSpecifier.text
        : null;
    if (!specifierText) {
      ts.forEachChild(node, visit);
      return;
    }
    const referencedDecl = normalizeSpecifierToDecl(specifierText, fromDeclDir);
    if (!referencedDecl) {
      ts.forEachChild(node, visit);
      return;
    }
    // Only recurse into export-star (`export * from './m.js'`). Named
    // re-exports (`export { X as Y } from './m.js'`) are already recorded by
    // collectDirectExports, which is the single source of truth for
    // named-export alias mapping.
    const isExportStar = !node.exportClause;
    if (isExportStar) {
      const nested = parseExportedNames(referencedDecl, visited);
      for (const name of nested) result.add(name);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return result;
}

export function loadExpectedSurface(snapshotPath) {
  const absolute = resolve(snapshotPath);
  if (!existsSync(absolute)) {
    throw new Error(
      `Expected API-surface snapshot not found at ${absolute}. ` +
        'Create or restore expected-root-surface.json.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse expected API-surface snapshot JSON at ${absolute}: ${err.message}`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string')
  ) {
    throw new Error(
      `Expected API-surface snapshot at ${absolute} must be a JSON array of strings, got ${typeof parsed}.`,
    );
  }
  return new Set(parsed);
}
