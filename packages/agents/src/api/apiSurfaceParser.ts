import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';

const packageJsonSchema = z.object({ name: z.string().optional() });
const expectedSurfaceSchema = z.array(z.string());

const __dirname = dirname(fileURLToPath(import.meta.url));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tryReadPackageJson(packageJsonPath: string): { name?: string } | null {
  try {
    return packageJsonSchema.parse(
      JSON.parse(readFileSync(packageJsonPath, 'utf8')),
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      return null;
    }
    throw new Error(
      `Failed to read package.json while resolving API-surface repo root at ${packageJsonPath}: ${errorMessage(err)}`,
    );
  }
}

function advanceOrThrow(
  current: string,
  startDir: string,
  context: string,
): string {
  const parent = dirname(current);
  if (parent === current) {
    throw new Error(
      `Unable to locate @vybestack/llxprt-code repo root from ${startDir}${context}`,
    );
  }
  return parent;
}

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = tryReadPackageJson(packageJsonPath);
      if (packageJson === null) {
        current = advanceOrThrow(
          current,
          startDir,
          `; encountered malformed package.json at ${packageJsonPath}`,
        );
        continue;
      }
      if (packageJson.name === '@vybestack/llxprt-code') {
        return current;
      }
    }
    current = advanceOrThrow(current, startDir, '');
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

function createSourceFile(filePath: string): ts.SourceFile {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read declaration file while parsing API surface at ${filePath}: ${errorMessage(err)}`,
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

function normalizeSpecifierToDecl(
  spec: string,
  fromDeclDir: string,
): string | null {
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

function makeExportHelpers(valueNames: Set<string>, typeNames: Set<string>) {
  return {
    recordNamedExports(
      elements: readonly ts.ExportSpecifier[],
      declIsTypeOnly: boolean,
    ): void {
      for (const el of elements) {
        const exportedName = el.name.text;
        const elementIsTypeOnly = declIsTypeOnly || el.isTypeOnly === true;
        if (elementIsTypeOnly) {
          typeNames.add(exportedName);
        } else {
          valueNames.add(exportedName);
        }
      }
    },
    recordExportedName(node: ts.Node & { name?: ts.Identifier }): void {
      if (node.name !== undefined) {
        valueNames.add(node.name.text);
      }
    },
    recordExportedType(node: ts.Node & { name?: ts.Identifier }): void {
      if (node.name !== undefined) {
        typeNames.add(node.name.text);
      }
    },
    visitExportDeclaration(node: ts.ExportDeclaration): void {
      const clause = node.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        this.recordNamedExports(clause.elements, node.isTypeOnly === true);
      } else if (clause !== undefined && ts.isNamespaceExport(clause)) {
        valueNames.add(clause.name.text);
      }
    },
  };
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers
    ? modifiers.some(
        (m: ts.Modifier) =>
          m.kind === ts.SyntaxKind.ExportKeyword ||
          m.kind === ts.SyntaxKind.DefaultKeyword,
      )
    : false;
}

function collectDirectExports(sourceFile: ts.SourceFile): {
  valueNames: Set<string>;
  typeNames: Set<string>;
} {
  const valueNames = new Set<string>();
  const typeNames = new Set<string>();
  const helpers = makeExportHelpers(valueNames, typeNames);

  function visit(node: ts.Node): void {
    if (ts.isExportDeclaration(node)) {
      helpers.visitExportDeclaration(node);
      return;
    }
    if (!hasExportModifier(node)) {
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      helpers.recordExportedType(node);
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      helpers.recordExportedType(node);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      helpers.recordExportedName(node);
      return;
    }
    if (ts.isClassDeclaration(node)) {
      helpers.recordExportedName(node);
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      helpers.recordExportedName(node);
      return;
    }
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
  function visitAll(node: ts.Node): void {
    visit(node);
    ts.forEachChild(node, visitAll);
  }
  visitAll(sourceFile);
  return { valueNames, typeNames };
}

function collectBindingNames(
  nameNode: ts.BindingName,
  into: Set<string>,
): void {
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

export function parseExportedNames(
  declarationPath: string,
  visited: Set<string> = new Set<string>(),
): Set<string> {
  const absolute = resolve(declarationPath);
  if (visited.has(absolute)) {
    return new Set<string>();
  }
  visited.add(absolute);
  if (!existsSync(absolute)) {
    return new Set<string>();
  }
  const sourceFile = createSourceFile(absolute);
  const fromDeclDir = dirname(absolute);
  const result = new Set<string>();
  const { valueNames, typeNames } = collectDirectExports(sourceFile);
  for (const name of valueNames) result.add(name);
  for (const name of typeNames) result.add(name);

  function visit(node: ts.Node): void {
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

export function loadExpectedSurface(snapshotPath: string): Set<string> {
  const absolute = resolve(snapshotPath);
  if (!existsSync(absolute)) {
    throw new Error(
      `Expected API-surface snapshot not found at ${absolute}. ` +
        'Create or restore expected-root-surface.json.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new Error(
      `Failed to parse expected API-surface snapshot JSON at ${absolute}: ${errorMessage(err)}`,
    );
  }
  const validated = expectedSurfaceSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Expected API-surface snapshot at ${absolute} must be a JSON array of strings, got ${typeof parsed}.`,
    );
  }
  return new Set(validated.data);
}
