/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Banned runtime-assembly scanner (#2378): detects imports/usages of runtime-
 * construction primitives, literal `new MessageBus(...)`, and
 * `.initialize({ messageBus: ... })` calls in production CLI source.
 */

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { BannedSymbolHit } from './config.ts';
import { BANNED_RUNTIME_ASSEMBLY_SYMBOLS } from './config.ts';
import {
  getLine,
  createSourceFile,
  isRuntimeAssemblyPackage,
  getRuntimeAssemblyModuleFromInitializer,
  bindingElementSourceName,
  unwrapParentheses,
} from './ast-helpers.ts';

// ─── Binding collection: import declarations ────────────────────────────────

/**
 * Returns the set of local identifier names that were imported under a banned
 * runtime-assembly symbol (accounting for `import { x as y }` aliasing).
 */
function collectBannedImportBindings(
  node: ts.ImportDeclaration,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): { named: Set<string>; namespaces: Set<string> } {
  const namedBindings = new Set<string>();
  const namespaceBindings = new Set<string>();
  if (!isRuntimeAssemblyPackage(node)) {
    return { named: namedBindings, namespaces: namespaceBindings };
  }
  const clause = node.importClause;
  if (clause === undefined) {
    return { named: namedBindings, namespaces: namespaceBindings };
  }
  const named = clause.namedBindings;
  if (named !== undefined && ts.isNamespaceImport(named)) {
    namespaceBindings.add(named.name.text);
  } else if (named !== undefined && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(importedName)) {
        hits.push({
          line: getLine(sourceFile, element.getStart()),
          symbol: importedName,
          kind: 'import',
        });
        namedBindings.add(element.name.text);
      }
    }
  }
  return { named: namedBindings, namespaces: namespaceBindings };
}

// ─── Binding collection: dynamic import/require destructures ────────────────

function collectBannedDynamicBindings(
  node: ts.VariableDeclaration,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): Set<string> {
  const namedBindings = new Set<string>();
  const moduleName = getRuntimeAssemblyModuleFromInitializer(node.initializer);
  if (moduleName === undefined || !ts.isObjectBindingPattern(node.name)) {
    return namedBindings;
  }
  for (const element of node.name.elements) {
    const sourceName = bindingElementSourceName(element);
    if (sourceName === undefined) continue;
    if (BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(sourceName)) {
      hits.push({
        line: getLine(sourceFile, element.getStart()),
        symbol: sourceName,
        kind: 'import',
      });
      if (ts.isIdentifier(element.name)) {
        namedBindings.add(element.name.text);
      }
    }
  }
  return namedBindings;
}

function collectDynamicNamespaceBinding(
  node: ts.VariableDeclaration,
): string | undefined {
  return getRuntimeAssemblyModuleFromInitializer(node.initializer) !==
    undefined && ts.isIdentifier(node.name)
    ? node.name.text
    : undefined;
}

function collectDynamicMessageBusBinding(
  node: ts.VariableDeclaration,
): string | undefined {
  if (
    getRuntimeAssemblyModuleFromInitializer(node.initializer) === undefined ||
    !ts.isObjectBindingPattern(node.name)
  ) {
    return undefined;
  }
  const binding = node.name.elements.find(
    (element) => bindingElementSourceName(element) === 'MessageBus',
  );
  return binding !== undefined && ts.isIdentifier(binding.name)
    ? binding.name.text
    : undefined;
}

function collectMessageBusPropertyAlias(
  node: ts.VariableDeclaration,
): string | undefined {
  return ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    isRuntimeMessageBusMember(node.initializer)
    ? node.name.text
    : undefined;
}

// ─── Member access helpers ──────────────────────────────────────────────────

function isRuntimeMessageBusMember(expression: ts.Expression): boolean {
  const member = unwrapParentheses(expression);
  if (ts.isPropertyAccessExpression(member)) {
    return (
      member.name.text === 'MessageBus' &&
      getRuntimeAssemblyModuleFromInitializer(
        unwrapParentheses(member.expression),
      ) !== undefined
    );
  }
  return isElementAccessMessageBus(member);
}

function isElementAccessMessageBus(member: ts.Node): boolean {
  if (!ts.isElementAccessExpression(member)) return false;
  if (
    member.argumentExpression === undefined ||
    !ts.isStringLiteral(member.argumentExpression) ||
    member.argumentExpression.text !== 'MessageBus'
  ) {
    return false;
  }
  return (
    getRuntimeAssemblyModuleFromInitializer(
      unwrapParentheses(member.expression),
    ) !== undefined
  );
}

function getBannedDynamicNamespaceMember(node: ts.Node): string | undefined {
  const expression =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? node.expression
      : undefined;
  if (
    expression === undefined ||
    getRuntimeAssemblyModuleFromInitializer(expression) === undefined
  ) {
    return undefined;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(node.name.text)
  ) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteral(node.argumentExpression) &&
    BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(node.argumentExpression.text)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function getBannedNamespaceMember(
  node: ts.Node,
  namespaceBindings: ReadonlySet<string>,
): string | undefined {
  if (
    isNamespacePropertyAccess(node, namespaceBindings) &&
    BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(node.name.text)
  ) {
    return (node as ts.PropertyAccessExpression).name.text;
  }
  const elementSymbol = getNamespaceElementSymbol(node, namespaceBindings);
  if (elementSymbol !== undefined) {
    return elementSymbol;
  }
  return undefined;
}

function isNamespacePropertyAccess(
  node: ts.Node,
  namespaceBindings: ReadonlySet<string>,
): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    namespaceBindings.has(node.expression.text)
  );
}

function getNamespaceElementSymbol(
  node: ts.Node,
  namespaceBindings: ReadonlySet<string>,
): string | undefined {
  if (!isNamespaceElementAccess(node, namespaceBindings)) return undefined;
  const arg = node.argumentExpression;
  if (
    arg !== undefined &&
    ts.isStringLiteral(arg) &&
    BANNED_RUNTIME_ASSEMBLY_SYMBOLS.has(arg.text)
  ) {
    return arg.text;
  }
  return undefined;
}

function isNamespaceElementAccess(
  node: ts.Node,
  namespaceBindings: ReadonlySet<string>,
): node is ts.ElementAccessExpression {
  return (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    namespaceBindings.has(node.expression.text)
  );
}

// ─── Pattern detectors ──────────────────────────────────────────────────────

function isNamespaceMessageBusAccess(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  namespaceBindings: ReadonlySet<string>,
): boolean {
  if (!ts.isIdentifier(expression.expression)) return false;
  if (!namespaceBindings.has(expression.expression.text)) return false;
  return isMessageBusMember(expression);
}

function isMessageBusMember(node: ts.Expression): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'MessageBus') {
    return true;
  }
  return (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === 'MessageBus'
  );
}

/**
 * Detects a `new MessageBus(...)` construction.
 */
function isNewMessageBus(
  node: ts.Node,
  messageBusBindings: ReadonlySet<string>,
  namespaceBindings: ReadonlySet<string>,
): node is ts.NewExpression {
  if (!ts.isNewExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) {
    return messageBusBindings.has(node.expression.text);
  }
  if (isRuntimeMessageBusMember(node.expression)) return true;
  return (
    (ts.isPropertyAccessExpression(node.expression) ||
      ts.isElementAccessExpression(node.expression)) &&
    isNamespaceMessageBusAccess(node.expression, namespaceBindings)
  );
}

/**
 * Detects a `.initialize({ messageBus: ... })` call.
 */
function isInitializeWithMessageBus(
  node: ts.Node,
  configBindings: ReadonlySet<string>,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrapParentheses(node.expression);
  if (
    !(
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      configBindings.has(callee.expression.text) &&
      callee.name.text === 'initialize'
    )
  ) {
    return false;
  }
  const firstArg = node.arguments[0];
  if (firstArg === undefined || !ts.isObjectLiteralExpression(firstArg)) {
    return false;
  }
  return firstArg.properties.some(hasMessageBusProperty);
}

function hasMessageBusProperty(prop: ts.ObjectLiteralElementLike): boolean {
  const propName = prop.name;
  if (propName === undefined) return false;
  if (ts.isIdentifier(propName)) return propName.text === 'messageBus';
  return ts.isStringLiteral(propName) && propName.text === 'messageBus';
}

// ─── Import collection for Config/MessageBus type tracking ──────────────────

interface TrackedBindings {
  messageBusBindings: Set<string>;
  configTypeBindings: Set<string>;
  configValueBindings: Set<string>;
  bannedLocalBindings: Set<string>;
  namespaceBindings: Set<string>;
}

function createTrackedBindings(): TrackedBindings {
  return {
    messageBusBindings: new Set(),
    configTypeBindings: new Set(),
    configValueBindings: new Set(),
    bannedLocalBindings: new Set(),
    namespaceBindings: new Set(),
  };
}

function isConfigTypeAnnotation(
  node: ts.ParameterDeclaration | ts.VariableDeclaration,
  configTypeBindings: ReadonlySet<string>,
): boolean {
  return (
    node.type !== undefined &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    configTypeBindings.has(node.type.typeName.text)
  );
}

function collectNamedImportBindings(
  namedBindings: ts.NamedImports,
  tracked: TrackedBindings,
): void {
  for (const element of namedBindings.elements) {
    const importedName = (element.propertyName ?? element.name).text;
    if (importedName === 'MessageBus') {
      tracked.messageBusBindings.add(element.name.text);
    }
    if (importedName === 'Config') {
      tracked.configTypeBindings.add(element.name.text);
    }
  }
}

/**
 * Process a single node during the import-collection pass.
 */
function processImportNode(
  node: ts.Node,
  tracked: TrackedBindings,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): void {
  if (ts.isImportDeclaration(node)) {
    processImportDeclaration(node, tracked, hits, sourceFile);
  } else if (
    ts.isParameter(node) &&
    ts.isIdentifier(node.name) &&
    isConfigTypeAnnotation(node, tracked.configTypeBindings)
  ) {
    tracked.configValueBindings.add(node.name.text);
  } else if (ts.isVariableDeclaration(node)) {
    processVariableDeclaration(node, tracked, hits, sourceFile);
  }
}

function processImportDeclaration(
  node: ts.ImportDeclaration,
  tracked: TrackedBindings,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): void {
  if (
    isRuntimeAssemblyPackage(node) &&
    node.importClause?.namedBindings !== undefined &&
    ts.isNamedImports(node.importClause.namedBindings)
  ) {
    collectNamedImportBindings(node.importClause.namedBindings, tracked);
  }
  const bindings = collectBannedImportBindings(node, hits, sourceFile);
  for (const binding of bindings.named) {
    tracked.bannedLocalBindings.add(binding);
  }
  for (const binding of bindings.namespaces) {
    tracked.namespaceBindings.add(binding);
  }
}

function processVariableDeclaration(
  node: ts.VariableDeclaration,
  tracked: TrackedBindings,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): void {
  if (
    ts.isIdentifier(node.name) &&
    isConfigTypeAnnotation(node, tracked.configTypeBindings)
  ) {
    tracked.configValueBindings.add(node.name.text);
  }
  const dynamicBindings = collectBannedDynamicBindings(node, hits, sourceFile);
  for (const binding of dynamicBindings) {
    tracked.bannedLocalBindings.add(binding);
  }
  const namespaceBinding = collectDynamicNamespaceBinding(node);
  if (namespaceBinding !== undefined) {
    tracked.namespaceBindings.add(namespaceBinding);
  }
  const messageBusBinding = collectDynamicMessageBusBinding(node);
  if (messageBusBinding !== undefined) {
    tracked.messageBusBindings.add(messageBusBinding);
  }
  const messageBusAlias = collectMessageBusPropertyAlias(node);
  if (messageBusAlias !== undefined) {
    tracked.messageBusBindings.add(messageBusAlias);
  }
}

// ─── Usage pass helpers ─────────────────────────────────────────────────────

function isImportSpecifierName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return parent !== undefined && ts.isImportSpecifier(parent);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  return isNamedDeclaration(parent, node);
}

function isNamedDeclaration(parent: ts.Node, node: ts.Identifier): boolean {
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  return ts.isBindingElement(parent) && parent.name === node;
}

function processUsageNode(
  node: ts.Node,
  tracked: TrackedBindings,
  hits: BannedSymbolHit[],
  sourceFile: ts.SourceFile,
): void {
  const namespaceMember =
    getBannedNamespaceMember(node, tracked.namespaceBindings) ??
    getBannedDynamicNamespaceMember(node);
  if (namespaceMember !== undefined) {
    hits.push({
      line: getLine(sourceFile, node.getStart()),
      symbol: namespaceMember,
      kind: 'usage',
    });
  }
  if (
    isNewMessageBus(node, tracked.messageBusBindings, tracked.namespaceBindings)
  ) {
    hits.push({
      line: getLine(sourceFile, node.getStart()),
      symbol: 'new MessageBus',
      kind: 'pattern',
    });
  }
  if (isInitializeWithMessageBus(node, tracked.configValueBindings)) {
    hits.push({
      line: getLine(sourceFile, node.getStart()),
      symbol: '.initialize({ messageBus })',
      kind: 'pattern',
    });
  }
  if (
    ts.isIdentifier(node) &&
    tracked.bannedLocalBindings.has(node.text) &&
    !isImportSpecifierName(node) &&
    !isDeclarationName(node)
  ) {
    hits.push({
      line: getLine(sourceFile, node.getStart()),
      symbol: node.text,
      kind: 'usage',
    });
  }
}

// ─── Main scanner ───────────────────────────────────────────────────────────

/**
 * Scans a production CLI source file for banned runtime-assembly symbols and
 * patterns (#2378).
 */
export function scanBannedRuntimeAssembly(filePath: string): BannedSymbolHit[] {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const sourceFile = createSourceFile(filePath, sourceText);
  const hits: BannedSymbolHit[] = [];
  const tracked = createTrackedBindings();

  // First pass: collect banned import specifiers + their local bindings.
  function collectImports(node: ts.Node): void {
    processImportNode(node, tracked, hits, sourceFile);
    ts.forEachChild(node, collectImports);
  }
  ts.forEachChild(sourceFile, collectImports);

  // Second pass: usages + literal patterns.
  function visitUsages(node: ts.Node): void {
    processUsageNode(node, tracked, hits, sourceFile);
    ts.forEachChild(node, visitUsages);
  }
  ts.forEachChild(sourceFile, visitUsages);

  return deduplicateHits(hits);
}

function deduplicateHits(hits: BannedSymbolHit[]): BannedSymbolHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.line}|${h.symbol}|${h.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
