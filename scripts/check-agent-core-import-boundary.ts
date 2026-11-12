#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readdirSync } from 'node:fs';
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

function importNodes(source: ts.SourceFile): readonly ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    )
      found.push(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      found.push(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    )
      found.push(node.arguments[0]);
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

function resolveImport(
  source: ts.SourceFile,
  node: ts.StringLiteralLike,
  specifier: string,
  context: ScanContext,
  violations: AgentCoreBoundaryViolation[],
): string[] {
  const resolved = ts.resolveModuleName(
    specifier,
    source.fileName,
    context.compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  if (!resolved) {
    const unresolvedExternal =
      !isWorkspaceImport(specifier) &&
      !specifier.startsWith('.') &&
      !ALLOWED_EXTERNALS.has(packageName(specifier));
    if (unresolvedExternal) {
      violations.push(
        violation(
          source,
          node,
          'unresolved-import',
          `Import could not be resolved inside the approved pure dependency set: ${specifier}`,
        ),
      );
    }
    return [];
  }
  const target = resolve(resolved);
  if (isInside(target, context.packageDir)) return [target];
  if (target.includes(`${join(context.root, 'packages')}/`)) {
    violations.push(
      violation(
        source,
        node,
        'workspace-import',
        `Import resolves outside agent-core: ${specifier} -> ${relative(context.root, target)}`,
      ),
    );
  }
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

function scanAmbientCapabilities(
  source: ts.SourceFile,
): AgentCoreBoundaryViolation[] {
  const violations: AgentCoreBoundaryViolation[] = [];
  const inspect = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
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
    if (file && !visited.has(resolve(file))) {
      visited.add(resolve(file));
      const source = program.getSourceFile(resolve(file));
      if (source) {
        const imports = scanImports(source, context);
        violations.push(
          ...imports.violations,
          ...scanAmbientCapabilities(source),
        );
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
