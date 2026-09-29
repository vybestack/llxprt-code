#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const serviceMembers = [
  'getWorkspaceContext',
  'getFileSystemService',
  'getFileService',
  'getGitService',
  'getSkillManager',
  'getMcpClientManager',
  'getExtensionLoader',
  'getPromptRegistry',
  'getResourceRegistry',
] as const;
const constructorNames = new Set([
  'WorkspaceContext',
  'StandardFileSystemService',
  'FileDiscoveryService',
  'GitService',
  'SkillManager',
  'LspServiceClient',
  'McpClientManager',
  'ExtensionLoader',
  'PromptRegistry',
  'ResourceRegistry',
]);
const excluded = new Set([
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

export interface WorkspaceConfigSite {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly member: string;
  readonly kind: 'ownership' | 'construction' | 'consumer' | 'projection';
  readonly expression: string;
  readonly origin: string;
  readonly owner: string;
  readonly occurrence: number;
}

type Site = Omit<WorkspaceConfigSite, 'occurrence'>;

function production(file: string, root: string): boolean {
  const parts = relative(root, file).split(sep);
  if (parts[0] !== 'packages' || parts[2] !== 'src') return false;
  if (parts.some((part) => excluded.has(part))) return false;
  if (
    file.endsWith('.d.ts') ||
    /\.(?:test|spec)\.[cm]?tsx?$|\.bun\.ts$/.test(file)
  )
    return false;
  return /\.[cm]?tsx?$/.test(file);
}

function sourceFiles(dir: string, root: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory())
      return excluded.has(entry.name) ? [] : sourceFiles(file, root);
    return entry.isFile() && production(file, root) ? [file] : [];
  });
}

function resolved(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function origin(root: string, symbol: ts.Symbol | undefined): string {
  const declaration = symbol?.declarations?.[0];
  return declaration
    ? relative(root, declaration.getSourceFile().fileName).replaceAll('\\', '/')
    : '';
}

function configClass(node: ts.Node): node is ts.ClassDeclaration {
  return (
    ts.isClassDeclaration(node) &&
    !!node.name &&
    /^Config(?:Base\w*)?$/.test(node.name.text) &&
    /\/core\/src\/config\//.test(
      node.getSourceFile().fileName.replaceAll('\\', '/'),
    )
  );
}

function fromConfig(type: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection())
    return type.types.some((part) => fromConfig(part, seen));
  if (type.getSymbol()?.declarations?.some(configClass)) return true;
  return (type.getBaseTypes() ?? []).some((base) => fromConfig(base, seen));
}

function serviceOrigins(
  type: ts.Type,
  root: string,
  seen = new Set<ts.Type>(),
): string[] {
  if (seen.has(type)) return [];
  seen.add(type);
  if (type.isUnionOrIntersection())
    return type.types.flatMap((part) => serviceOrigins(part, root, seen));
  if (type.getSymbol()) return [origin(root, type.getSymbol())];
  return type
    .getCallSignatures()
    .flatMap((signature) =>
      serviceOrigins(signature.getReturnType(), root, seen),
    );
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  )
    return node.argumentExpression.text;
  if (
    ts.isIndexedAccessTypeNode(node) &&
    ts.isLiteralTypeNode(node.indexType) &&
    ts.isStringLiteral(node.indexType.literal)
  )
    return node.indexType.literal.text;
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    if (
      node.propertyName &&
      !ts.isIdentifier(node.propertyName) &&
      !ts.isStringLiteralLike(node.propertyName)
    )
      return undefined;
    return (
      node.propertyName?.getText().replaceAll(/["']/g, '') ??
      node.name.getText()
    );
  }
  return undefined;
}

function parseConfig(path: string): ts.ParsedCommandLine {
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

interface ScanContext {
  readonly root: string;
  readonly checker: ts.TypeChecker;
  readonly members: ReadonlyMap<string, ts.Symbol | undefined>;
  readonly isService: (type: ts.Type) => boolean;
  readonly add: (
    node: ts.Node,
    member: string,
    kind: Site['kind'],
    symbol?: ts.Symbol,
  ) => void;
}

function serviceShape(type: ts.Type, context: ScanContext): boolean {
  return (
    context.isService(type) ||
    type
      .getCallSignatures()
      .some((signature) => context.isService(signature.getReturnType()))
  );
}

function inspectOwnership(node: ts.Node, context: ScanContext): void {
  if (!configClass(node)) return;
  for (const member of node.members) {
    if (!member.name || !ts.isIdentifier(member.name)) continue;
    const symbol = resolved(context.checker, member.name);
    if (symbol) {
      const type = context.checker.getTypeOfSymbolAtLocation(symbol, member);
      if (context.members.has(member.name.text) || serviceShape(type, context))
        context.add(member.name, member.name.text, 'ownership', symbol);
    }
  }
}

function inspectContract(node: ts.Node, context: ScanContext): void {
  if (
    !ts.isInterfaceDeclaration(node) ||
    !['ConfigConstructorTarget', 'ConfigParameters'].includes(node.name.text)
  )
    return;
  for (const member of node.members) {
    if (
      !ts.isPropertySignature(member) ||
      !member.name ||
      !ts.isIdentifier(member.name)
    )
      continue;
    if (serviceShape(context.checker.getTypeAtLocation(member), context))
      context.add(
        member.name,
        member.name.text,
        'ownership',
        resolved(context.checker, member.name),
      );
  }
}

function inspectConstruction(node: ts.Node, context: ScanContext): void {
  if (!ts.isNewExpression(node)) return;
  const symbol = resolved(context.checker, node.expression);
  if (!symbol || !constructorNames.has(symbol.name)) return;
  if (
    /^(?:packages\/core\/src\/|packages\/(?:mcp|storage)\/)/.test(
      origin(context.root, symbol),
    )
  )
    context.add(node, symbol.name, 'construction', symbol);
}

function accessReceiver(node: ts.Node): ts.Node | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return node.expression;
  if (ts.isIndexedAccessTypeNode(node)) return node.objectType;
  if (ts.isBindingElement(node) && ts.isVariableDeclaration(node.parent.parent))
    return node.parent.parent.initializer;
  return undefined;
}

function accessSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (ts.isPropertyAccessExpression(node)) return resolved(checker, node.name);
  if (ts.isElementAccessExpression(node))
    return resolved(checker, node.argumentExpression);
  return undefined;
}

function inspectAccess(node: ts.Node, context: ScanContext): void {
  const name = memberName(node);
  if (!name || !context.members.has(name)) return;
  const receiver = accessReceiver(node);
  if (!receiver) return;
  const checker = context.checker;
  const type = ts.isTypeNode(receiver)
    ? checker.getTypeFromTypeNode(receiver)
    : checker.getTypeAtLocation(receiver);
  const method = checker.getPropertyOfType(type, name);
  const symbol = accessSymbol(node, checker);
  const callable =
    method &&
    serviceShape(
      checker.getTypeOfSymbolAtLocation(
        method,
        method.valueDeclaration ?? receiver,
      ),
      context,
    );
  if (
    fromConfig(type) ||
    symbol?.declarations?.some((decl) => configClass(decl.parent)) ||
    callable
  )
    context.add(
      node,
      name,
      ts.isIndexedAccessTypeNode(node) ? 'projection' : 'consumer',
      symbol ?? method,
    );
}

function scanNode(
  node: ts.Node,
  context: ScanContext,
  insideConfig: boolean,
): void {
  inspectOwnership(node, context);
  if (insideConfig) {
    inspectContract(node, context);
    inspectConstruction(node, context);
  }
  inspectAccess(node, context);
  ts.forEachChild(node, (child) => scanNode(child, context, insideConfig));
}

function servicePathsForConfig(
  checker: ts.TypeChecker,
  config: ts.ClassDeclaration,
  members: ReadonlyMap<string, ts.Symbol | undefined>,
  root: string,
): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const symbol of members.values()) {
    if (!symbol)
      throw new Error('Missing inventoried Config workspace service member');
    const type = checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.valueDeclaration ?? config,
    );
    for (const signature of type.getCallSignatures()) {
      const result = signature.getReturnType();
      for (const path of serviceOrigins(
        checker.getAwaitedType(result) ?? result,
        root,
      ))
        paths.add(path);
    }
  }
  return paths;
}

function siteEmitter(root: string, sites: Site[]): ScanContext['add'] {
  return (node, member, kind, symbol) => {
    const source = node.getSourceFile();
    const position = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    const file = relative(root, source.fileName).split(sep).join('/');
    sites.push({
      file,
      line: position.line + 1,
      column: position.character + 1,
      member,
      kind,
      expression: node.getText(source),
      origin: origin(root, symbol),
      owner: file.split('/')[1],
    });
  };
}

function scanPackage(
  root: string,
  packageRoot: string,
  overlays: ReadonlyMap<string, string>,
): Site[] {
  const path = join(packageRoot, 'tsconfig.json');
  if (!existsSync(path)) throw new Error(`Missing tsconfig.json: ${path}`);
  const parsed = parseConfig(path);
  const configFile = join(root, 'packages/core/src/config/config.ts');
  const files = [
    ...new Set([
      ...parsed.fileNames,
      ...sourceFiles(join(packageRoot, 'src'), root),
      configFile,
    ]),
  ];
  const host = ts.createCompilerHost(parsed.options);
  const read = host.readFile.bind(host);
  host.readFile = (file) => overlays.get(file) ?? read(file);
  const program = ts.createProgram(
    files,
    { ...parsed.options, noEmit: true },
    host,
  );
  const checker = program.getTypeChecker();
  const sites: Site[] = [];
  const core = program.getSourceFile(configFile);
  if (!core) throw new Error(`Could not resolve Config: ${configFile}`);
  const config = core.statements.find(configClass);
  if (!config?.name)
    throw new Error(`Could not resolve Config declaration: ${configFile}`);
  const configType = checker.getTypeAtLocation(config.name);
  const members = new Map(
    serviceMembers.map((name) => [
      name,
      checker.getPropertyOfType(configType, name),
    ]),
  );
  const servicePaths = servicePathsForConfig(checker, config, members, root);
  const isService = (type: ts.Type): boolean => {
    const unwrapped = checker.getAwaitedType(type) ?? type;
    return serviceOrigins(unwrapped, root).some(
      (path) => servicePaths.has(path) && path !== '',
    );
  };
  const add = siteEmitter(root, sites);
  for (const source of program.getSourceFiles()) {
    if (
      !production(source.fileName, root) ||
      relative(packageRoot, source.fileName).startsWith('..')
    )
      continue;
    const insideConfig = source.fileName
      .replaceAll('\\', '/')
      .includes('/core/src/config/');
    scanNode(source, { root, checker, members, isService, add }, insideConfig);
  }
  return sites;
}

export function scanWorkspaceConfigBoundary(
  root: string,
  overlays: ReadonlyMap<string, string> = new Map(),
): WorkspaceConfigSite[] {
  const absolute = resolve(root);
  const sites = readdirSync(join(absolute, 'packages'), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(absolute, 'packages', entry.name, 'src')),
    )
    .flatMap((entry) =>
      scanPackage(absolute, join(absolute, 'packages', entry.name), overlays),
    );
  const unique = new Map(
    sites.map((site) => [
      `${site.file}:${site.line}:${site.column}:${site.kind}:${site.member}`,
      site,
    ]),
  );
  const counts = new Map<string, number>();
  return [...unique.values()]
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.kind.localeCompare(b.kind),
    )
    .map((site) => {
      const key = `${site.file}:${site.kind}:${site.member}:${site.expression}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      return { ...site, occurrence };
    });
}

function key(site: WorkspaceConfigSite): string {
  return JSON.stringify([
    site.file,
    site.kind,
    site.member,
    site.expression,
    site.occurrence,
  ]);
}

export function unexpectedWorkspaceConfigSites(
  sites: readonly WorkspaceConfigSite[],
  baselinePath: string,
): WorkspaceConfigSite[] {
  const baseline: WorkspaceConfigSite[] = JSON.parse(
    readFileSync(baselinePath, 'utf8'),
  );
  const existing = new Set(baseline.map(key));
  return sites.filter((site) => !existing.has(key(site)));
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const baseline = join(
    root,
    'project-plans/issue2615/workspace-config-sites.json',
  );
  const sites = scanWorkspaceConfigBoundary(root);
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(baseline, `${JSON.stringify(sites, null, 2)}\n`);
    console.log(
      `Wrote ${sites.length} workspace Config sites to ${relative(root, baseline)}`,
    );
  } else {
    const additions = unexpectedWorkspaceConfigSites(sites, baseline);
    for (const site of additions)
      console.error(
        `${site.file}:${site.line}:${site.column}: ${site.member} (${site.kind}; ${site.origin})`,
      );
    if (additions.length) process.exitCode = 1;
    else
      console.log(
        `Workspace Config boundary: pass (${sites.length} inventoried sites)`,
      );
  }
}
