#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface AgentCoreBoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly kind:
    | 'workspace-import'
    | 'runtime-import'
    | 'ambient-io'
    | 'unresolved-import';
  readonly detail: string;
}

interface ScanContext {
  readonly root: string;
  readonly packageDir: string;
  readonly compilerOptions: ts.CompilerOptions;
}
interface ImportScan {
  readonly violations: AgentCoreBoundaryViolation[];
  readonly localDependencies: string[];
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const FORBIDDEN_GLOBALS = new Set([
  'process',
  'Bun',
  'Deno',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'console',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'require',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Worker',
  'MessageChannel',
  'Date',
  'performance',
  'globalThis',
  'global',
  'eval',
  'Function',
]);
const RUNTIME_MODULES = new Set([
  'fs',
  'path',
  'process',
  'child_process',
  'net',
  'http',
  'https',
  'os',
  'timers',
]);
const ALLOWED_EXTERNALS = new Set(['zod']);

function sourcesUnder(directory: string): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        ['node_modules', 'dist', '.git'].includes(entry.name)
      )
        continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (
        entry.isFile() &&
        extname(child) === '.ts' &&
        !/\.test\.ts$/.test(child)
      )
        files.push(resolve(child));
    }
  };
  visit(directory);
  return files.sort();
}

function isInside(path: string, directory: string): boolean {
  const pathRelative = relative(directory, path);
  return (
    pathRelative === '' ||
    (pathRelative !== '..' &&
      !pathRelative.startsWith(
        `..${process.platform === 'win32' ? '\\' : '/'}`,
      ))
  );
}

function importCallSpecifier(node: ts.Node): ts.Expression | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const expression = node.expression;
  const isRequire =
    ts.isIdentifier(expression) && expression.text === 'require';
  if (expression.kind !== ts.SyntaxKind.ImportKeyword && !isRequire)
    return undefined;
  return node.arguments[0];
}

function importNodes(source: ts.SourceFile): readonly ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      found.push(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    )
      found.push(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      found.push(node.argument.literal);
    else {
      const specifier = importCallSpecifier(node);
      if (specifier) found.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function packageName(specifier: string): string {
  const [first, second] = specifier.split('/');
  return specifier.startsWith('@')
    ? `${first}/${second ?? ''}`
    : (first ?? specifier);
}

function violation(
  source: ts.SourceFile,
  node: ts.Node,
  kind: AgentCoreBoundaryViolation['kind'],
  detail: string,
): AgentCoreBoundaryViolation {
  return {
    file: source.fileName,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    kind,
    detail,
  };
}

function isRuntimeImport(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    specifier.startsWith('bun:') ||
    RUNTIME_MODULES.has(packageName(specifier))
  );
}

function isWorkspaceImport(specifier: string): boolean {
  return (
    specifier.startsWith('@vybestack/llxprt-code-') &&
    !specifier.startsWith('@vybestack/llxprt-code-agent-core')
  );
}

function packageRoot(
  resolvedFile: string,
  expectedName: string,
): string | undefined {
  let directory = dirname(resolvedFile);
  while (directory !== dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (ts.sys.fileExists(manifest)) {
      const metadata: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
      if (
        typeof metadata === 'object' &&
        metadata !== null &&
        'name' in metadata &&
        metadata.name === expectedName
      )
        return directory;
    }
    directory = dirname(directory);
  }
  return undefined;
}

function zodRuntimeExport(
  specifier: string,
  resolvedFile: string,
): string | undefined {
  const root = packageRoot(resolvedFile, 'zod');
  if (!root) return undefined;
  const metadata: unknown = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  );
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('exports' in metadata)
  )
    return undefined;
  const subpath =
    specifier === 'zod' ? '.' : `.${specifier.slice('zod'.length)}`;
  const exports = metadata.exports;
  if (typeof exports !== 'object' || exports === null || !(subpath in exports))
    return undefined;
  const conditions = exports[subpath];
  if (
    typeof conditions !== 'object' ||
    conditions === null ||
    !('import' in conditions)
  )
    return undefined;
  const target = conditions.import;
  return typeof target === 'string' ? resolve(root, target) : undefined;
}

function resolveImport(
  source: ts.SourceFile,
  node: ts.StringLiteralLike,
  specifier: string,
  context: ScanContext,
  violations: AgentCoreBoundaryViolation[],
): string[] {
  if (extname(source.fileName) === '.js' && specifier.startsWith('.')) {
    const runtimeTarget = resolve(dirname(source.fileName), specifier);
    if (ts.sys.fileExists(runtimeTarget)) return [runtimeTarget];
  }
  const resolved = ts.resolveModuleName(
    specifier,
    source.fileName,
    context.compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (!resolved) {
    violations.push(
      violation(
        source,
        node,
        'unresolved-import',
        `Import could not be resolved: ${specifier}`,
      ),
    );
    return [];
  }
  const target = resolve(resolved);
  if (isInside(target, context.packageDir)) return [target];
  const sourcePackage = packageRoot(source.fileName, 'zod');
  if (sourcePackage && isInside(target, sourcePackage)) return [target];
  if (ALLOWED_EXTERNALS.has(specifier)) {
    const runtimeTarget = zodRuntimeExport(specifier, target);
    if (runtimeTarget && ts.sys.fileExists(runtimeTarget))
      return [runtimeTarget];
  }
  const kind: AgentCoreBoundaryViolation['kind'] = isWorkspaceImport(specifier)
    ? 'workspace-import'
    : 'runtime-import';
  violations.push(
    violation(
      source,
      node,
      kind,
      `Resolved import is outside the audited agent-core and Zod runtime graph: ${specifier} -> ${relative(context.root, target)}`,
    ),
  );
  return [];
}

function inspectImport(
  source: ts.SourceFile,
  node: ts.Node,
  context: ScanContext,
): ImportScan {
  if (!ts.isStringLiteralLike(node)) {
    return {
      violations: [
        violation(
          source,
          node,
          'runtime-import',
          'Import specifiers must be statically analyzable.',
        ),
      ],
      localDependencies: [],
    };
  }
  const specifier = node.text;
  if (isRuntimeImport(specifier)) {
    return {
      violations: [
        violation(
          source,
          node,
          'runtime-import',
          `Runtime or I/O module import is forbidden: ${specifier}`,
        ),
      ],
      localDependencies: [],
    };
  }
  const violations = isWorkspaceImport(specifier)
    ? [
        violation(
          source,
          node,
          'workspace-import',
          `Workspace dependency is forbidden: ${specifier}`,
        ),
      ]
    : [];
  const localDependencies = resolveImport(
    source,
    node,
    specifier,
    context,
    violations,
  );
  return { violations, localDependencies };
}

function scanImports(source: ts.SourceFile, context: ScanContext): ImportScan {
  const violations: AgentCoreBoundaryViolation[] = [];
  const localDependencies: string[] = [];
  for (const node of importNodes(source)) {
    const result = inspectImport(source, node, context);
    violations.push(...result.violations);
    localDependencies.push(...result.localDependencies);
  }
  return { violations, localDependencies };
}

function isNamedProperty(parent: ts.Node): boolean {
  return (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent)
  );
}

function isImportOrExportSpecifierName(
  parent: ts.Node,
  node: ts.Identifier,
): boolean {
  if (ts.isImportSpecifier(parent))
    return parent.name === node || parent.propertyName === node;
  if (ts.isExportSpecifier(parent))
    return parent.name === node || parent.propertyName === node;
  return false;
}

function isInertIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (isNamedProperty(parent)) return 'name' in parent && parent.name === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  return isImportOrExportSpecifierName(parent, node);
}

function isLocalCapabilityName(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || !FORBIDDEN_GLOBALS.has(node.text)) return false;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent))
    return parent.name === node;
  if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent))
    return parent.name === node;
  return false;
}

function isForbiddenCapabilityUse(node: ts.Node): node is ts.Identifier {
  return (
    ts.isIdentifier(node) &&
    FORBIDDEN_GLOBALS.has(node.text) &&
    !isInertIdentifier(node)
  );
}

function scanAmbientCapabilities(
  source: ts.SourceFile,
  checker?: ts.TypeChecker,
): AgentCoreBoundaryViolation[] {
  const violations: AgentCoreBoundaryViolation[] = [];
  const localNames = new Set<string>();
  const collectLocals = (node: ts.Node): void => {
    if (isLocalCapabilityName(node)) localNames.add(node.text);
    ts.forEachChild(node, collectLocals);
  };
  collectLocals(source);
  const inspect = (node: ts.Node): void => {
    if (isForbiddenCapabilityUse(node)) {
      const symbol = checker?.getSymbolAtLocation(node);
      const isLocal = checker
        ? symbol?.declarations?.some(
            (declaration) => declaration.getSourceFile() === source,
          )
        : localNames.has(node.text);
      if (!isLocal)
        violations.push(
          violation(
            source,
            node,
            'ambient-io',
            `Ambient runtime capability is forbidden: ${node.text}`,
          ),
        );
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return violations;
}

function createScanContext(root: string, packageDir: string): ScanContext {
  const configPath = join(packageDir, 'tsconfig.json');
  const configRead = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configRead.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(configRead.error.messageText, '\n'),
    );
  const config = ts.parseJsonConfigFileContent(
    configRead.config,
    ts.sys,
    packageDir,
    undefined,
    configPath,
  );
  return { root, packageDir, compilerOptions: config.options };
}

function normalizeViolations(
  root: string,
  violations: readonly AgentCoreBoundaryViolation[],
): readonly AgentCoreBoundaryViolation[] {
  const unique = new Map<string, AgentCoreBoundaryViolation>();
  for (const entry of violations) {
    const normalized = {
      ...entry,
      file: relative(root, entry.file).replaceAll('\\', '/'),
    };
    unique.set(
      `${normalized.file}:${entry.line}:${entry.kind}:${entry.detail}`,
      normalized,
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line,
  );
}

export function scanAgentCoreBoundary(
  repoRoot: string = DEFAULT_ROOT,
): readonly AgentCoreBoundaryViolation[] {
  const root = resolve(repoRoot);
  const packageDir = join(root, 'packages/agent-core');
  const context = createScanContext(root, packageDir);
  const files = [
    ...sourcesUnder(join(packageDir, 'src')),
    join(packageDir, 'index.ts'),
  ];
  const program = ts.createProgram({
    rootNames: files,
    options: { ...context.compilerOptions, noEmit: true },
  });
  const violations: AgentCoreBoundaryViolation[] = [];
  const visited = new Set<string>();
  const pending = [...files];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file && ts.sys.fileExists(file) && !visited.has(resolve(file))) {
      visited.add(resolve(file));
      const programSource = program.getSourceFile(resolve(file));
      const source =
        programSource ??
        ts.createSourceFile(
          resolve(file),
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          extname(file) === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS,
        );
      if (source) {
        const imports = scanImports(source, context);
        const checker = programSource ? program.getTypeChecker() : undefined;
        const ambientViolations = isInside(resolve(file), context.packageDir)
          ? scanAmbientCapabilities(source, checker)
          : [];
        violations.push(...imports.violations, ...ambientViolations);
        pending.push(...imports.localDependencies);
      }
    }
  }
  return normalizeViolations(root, violations);
}

if (import.meta.main) {
  const violations = scanAgentCoreBoundary();
  if (violations.length > 0) {
    for (const entry of violations)
      console.error(
        `${entry.file}:${entry.line} [${entry.kind}] ${entry.detail}`,
      );
    process.exitCode = 1;
  } else {
    console.log('Agent-core import boundary check passed.');
  }
}
