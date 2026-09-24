#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface BoundaryFinding {
  readonly file: string;
  readonly line: number;
  readonly member: string;
  readonly role: 'ownership' | 'injection' | 'construction' | 'consumer';
}

type EmitFinding = (
  node: ts.Node,
  member: string,
  role: BoundaryFinding['role'],
) => void;

const forbidden =
  /^(?:get|set|peek|create|dispose|release)?(?:OrCreate)?(?:AsyncTaskManager|AsyncTaskReminderService|AsyncTaskAutoTrigger|ShellJobManager|SessionRecordingService|RuntimeMessageBus|InteractiveSubagentSchedulerFactory|SchedulerRegistry|ToolSchedulerFactory|Scheduler)$|^(?:asyncTaskManager|asyncTaskReminderService|asyncTaskAutoTrigger|shellJobManager|sessionRecordingService|runtimeMessageBus|schedulerRegistry|subagentSchedulerFactory|toolSchedulerFactory)$/;
const serviceNames = new Set([
  'AsyncTaskManager',
  'AsyncTaskReminderService',
  'AsyncTaskAutoTrigger',
  'ShellJobManager',
  'SessionRecordingService',
  'MessageBus',
  'SessionSchedulerRegistry',
  'CoreToolScheduler',
]);
const excludedParts = new Set([
  '__tests__',
  '__mocks__',
  'fixtures',
  '__fixtures__',
  'test',
  'test-utils',
  'integration-tests',
  'test-bun',
  'test-setup',
]);

function production(file: string, root: string): boolean {
  const parts = relative(root, file).split(sep);
  if (parts[0] !== 'packages' || parts[2] !== 'src') return false;
  if (parts.some((part) => excludedParts.has(part))) return false;
  if (/\.(?:test|spec)\.[cm]?tsx?$|\.bun\.ts$/.test(file)) return false;
  return /\.[cm]?tsx?$/.test(file) && !file.endsWith('.d.ts');
}

function resolvedSymbol(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol?.flags && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function configClass(node: ts.Node): node is ts.ClassDeclaration {
  return (
    ts.isClassDeclaration(node) &&
    node.name !== undefined &&
    /^Config(?:Base\w*)?$/.test(node.name.text) &&
    node
      .getSourceFile()
      .fileName.replaceAll('\\', '/')
      .includes('/core/src/config/')
  );
}

function isConfigType(type: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection())
    return type.types.some((part) => isConfigType(part, seen));
  const symbol = type.getSymbol();
  if (symbol?.declarations?.some(configClass)) return true;
  if (
    !symbol ||
    !(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))
  )
    return false;
  return (type.getBaseTypes() ?? []).some((base) => isConfigType(base, seen));
}

function configMember(symbol: ts.Symbol | undefined): boolean {
  return (
    symbol?.declarations?.some((decl) => {
      const parent = decl.parent;
      return parent !== undefined && configClass(parent);
    }) ?? false
  );
}

function isCoreServiceSymbol(
  symbol: ts.Symbol | undefined,
): symbol is ts.Symbol {
  return (
    symbol !== undefined &&
    serviceNames.has(symbol.name) &&
    (symbol.declarations?.some((decl) =>
      decl
        .getSourceFile()
        .fileName.replaceAll('\\', '/')
        .includes('/core/src/'),
    ) ??
      false)
  );
}

function serviceType(type: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection())
    return type.types.some((part) => serviceType(part, seen));
  if (isCoreServiceSymbol(type.getSymbol())) return true;
  return type
    .getCallSignatures()
    .some((signature) => serviceType(signature.getReturnType(), seen));
}

function parsePackageConfig(path: string): ts.ParsedCommandLine {
  const read = ts.readConfigFile(path, ts.sys.readFile);
  if (read.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    resolve(path, '..'),
    undefined,
    path,
  );
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n'),
        )
        .join('\n'),
    );
  return parsed;
}

function inspectConstructor(
  constructor: ts.ConstructorDeclaration,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  for (const param of constructor.parameters) {
    if (serviceType(checker.getTypeAtLocation(param)))
      emit(param, param.name.getText(), 'injection');
  }
}

function inspectClass(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (!configClass(node)) return;
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      inspectConstructor(member, checker, emit);
    } else if (member.name) {
      const name = member.name.getText().replaceAll(/["']/g, '');
      if (forbidden.test(name)) emit(member.name, name, 'ownership');
    }
  }
}

function inspectConstruction(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (!ts.isNewExpression(node)) return;
  const target = resolvedSymbol(checker, node.expression);
  if (isCoreServiceSymbol(target)) emit(node, target.name, 'construction');
}

function inspectInjection(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (
    !ts.isPropertySignature(node) ||
    !node.name ||
    !ts.isInterfaceDeclaration(node.parent)
  )
    return;
  if (
    !['ConfigConstructorTarget', 'ConfigParameters'].includes(
      node.parent.name.text,
    )
  )
    return;
  if (serviceType(checker.getTypeAtLocation(node)))
    emit(node, node.name.getText(), 'injection');
}

function accessMember(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteralLike(node.argumentExpression)
    ? node.argumentExpression.text
    : undefined;
}

function inspectAccess(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  )
    return;
  const key = accessMember(node);
  if (!key || !forbidden.test(key)) return;
  const target = ts.isPropertyAccessExpression(node)
    ? node.name
    : node.argumentExpression;
  if (
    isConfigType(checker.getTypeAtLocation(node.expression)) ||
    configMember(resolvedSymbol(checker, target))
  )
    emit(node, key, 'consumer');
}

function inspectProjection(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (
    !ts.isIndexedAccessTypeNode(node) ||
    !ts.isLiteralTypeNode(node.indexType)
  )
    return;
  const index = node.indexType.literal;
  if (
    ts.isStringLiteral(index) &&
    forbidden.test(index.text) &&
    isConfigType(checker.getTypeFromTypeNode(node.objectType))
  ) {
    emit(node, index.text, 'consumer');
  }
}

function inspectBinding(
  node: ts.Node,
  checker: ts.TypeChecker,
  emit: EmitFinding,
): void {
  if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent))
    return;
  const declaration = node.parent.parent;
  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer)
    return;
  const key =
    node.propertyName?.getText().replaceAll(/["']/g, '') ?? node.name.getText();
  if (
    forbidden.test(key) &&
    isConfigType(checker.getTypeAtLocation(declaration.initializer))
  )
    emit(node, key, 'consumer');
}

function sourceFiles(dir: string, root: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return excludedParts.has(entry.name) ? [] : sourceFiles(path, root);
    return entry.isFile() && production(path, root) ? [path] : [];
  });
}

function scanPackage(
  root: string,
  packageRoot: string,
  configFile: string,
): BoundaryFinding[] {
  const configPath = join(packageRoot, 'tsconfig.json');
  const parsed = parsePackageConfig(configPath);
  const files = [
    ...new Set([
      ...parsed.fileNames,
      ...sourceFiles(join(packageRoot, 'src'), root),
      configFile,
    ]),
  ];
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const findings: BoundaryFinding[] = [];
  const emit: EmitFinding = (node, member, role) => {
    const file = node.getSourceFile();
    const line =
      file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ file: file.fileName, line, member, role });
  };
  for (const source of program.getSourceFiles()) {
    if (
      production(source.fileName, root) &&
      !relative(packageRoot, source.fileName).startsWith('..')
    ) {
      const insideConfig = source.fileName
        .replaceAll('\\', '/')
        .includes('/core/src/config/');
      const visit = (node: ts.Node): void => {
        inspectClass(node, checker, emit);
        if (insideConfig) {
          inspectConstruction(node, checker, emit);
          inspectInjection(node, checker, emit);
        }
        inspectAccess(node, checker, emit);
        inspectProjection(node, checker, emit);
        inspectBinding(node, checker, emit);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return findings;
}

/** Scan each package with its tsconfig so aliases and inferred types resolve as in its build. */
export function scanSessionConfigBoundary(root: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const packages = join(root, 'packages');
  const configFile = join(packages, 'core/src/config/config.ts');
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    const packageRoot = join(packages, entry.name);
    if (entry.isDirectory() && existsSync(join(packageRoot, 'src'))) {
      if (!ts.sys.fileExists(join(packageRoot, 'tsconfig.json')))
        throw new Error(`Missing tsconfig.json for ${packageRoot}`);
      findings.push(...scanPackage(root, packageRoot, configFile));
    }
  }
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.role.localeCompare(b.role),
  );
}

if (import.meta.main) {
  const rootFlag = process.argv.indexOf('--root');
  const fixtureRoot = rootFlag === -1 ? undefined : process.argv[rootFlag + 1];
  if (rootFlag !== -1 && !fixtureRoot)
    throw new Error('--root needs a directory');
  const root = resolve(fixtureRoot ?? join(import.meta.dir, '..'));
  const findings = scanSessionConfigBoundary(root);
  for (const finding of findings) {
    console.error(
      `${relative(root, finding.file)}:${finding.line}: ${finding.member} (${finding.role})`,
    );
  }
  if (findings.length) process.exitCode = 1;
  else console.log('Session Config boundary: pass');
}
