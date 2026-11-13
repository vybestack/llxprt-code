/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import {
  isModuleOwned,
  storageOrigin,
  type StorageDeclaration,
} from './runtime-state-storage-provenance.js';
import { unwrap } from './runtime-state-literal-tables.js';

export function isOwnedModuleStorage(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    declaration.getSourceFile() === sourceFile && isModuleOwned(declaration)
  );
}

export function declarationName(node: ts.Node): string {
  const parts: string[] = [];
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    const candidate: ts.Node = current;
    const named =
      ts.isVariableDeclaration(candidate) ||
      ts.isPropertyDeclaration(candidate) ||
      ts.isClassDeclaration(candidate);
    const callable =
      ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate);
    if ((named || callable) && candidate.name)
      parts.unshift(candidate.name.getText());
    current = current.parent;
  }
  return parts.length ? parts.join('.') : `<anonymous@${node.getStart()}>`;
}

export function accessedMember(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(access)) return access.name.text;
  return ts.isStringLiteral(access.argumentExpression)
    ? access.argumentExpression.text
    : undefined;
}

export function mutationDeclaration(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.VariableDeclaration | ts.PropertyDeclaration | undefined {
  const target = mutationTarget(node);
  if (!target) return undefined;
  const value = unwrap(target);
  if (!ts.isCallExpression(node) && ts.isIdentifier(value)) {
    const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
    return declaration && ts.isVariableDeclaration(declaration)
      ? declaration
      : undefined;
  }
  return storageOrigin(value, checker);
}

export function mutationTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return node.left;
  if (ts.isDeleteExpression(node)) return node.expression;
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return node.operand;
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  )
    return undefined;
  const callee = node.expression;
  if (
    [
      'Object.assign',
      'Object.defineProperty',
      'Object.defineProperties',
      'Reflect.set',
      'Reflect.deleteProperty',
    ].includes(callee.getText())
  )
    return node.arguments[0];
  if (
    [
      'set',
      'add',
      'delete',
      'clear',
      'push',
      'pop',
      'shift',
      'unshift',
      'splice',
      'sort',
      'reverse',
      'fill',
      'copyWithin',
    ].includes(callee.name.text)
  )
    return callee.expression;
  return undefined;
}

export function targetsGlobalThis(
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  const target = mutationTarget(node);
  if (!target) return false;
  let root = unwrap(target);
  while (
    ts.isPropertyAccessExpression(root) ||
    ts.isElementAccessExpression(root)
  )
    root = unwrap(root.expression);
  if (!ts.isIdentifier(root) || root.text !== 'globalThis') return false;
  const declarations = checker.getSymbolAtLocation(root)?.declarations ?? [];
  return declarations.every(
    (declaration) => declaration.getSourceFile().isDeclarationFile,
  );
}

export function targetsProcessEnvironment(
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  const target = mutationTarget(node);
  if (!target) return false;
  let current = unwrap(target);
  let addressesEnvironment = false;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    addressesEnvironment ||= accessedMember(current) === 'env';
    current = unwrap(current.expression);
  }
  if (
    !addressesEnvironment ||
    !ts.isIdentifier(current) ||
    current.text !== 'process'
  )
    return false;
  return (checker.getSymbolAtLocation(current)?.declarations ?? []).every(
    (declaration) => declaration.getSourceFile().isDeclarationFile,
  );
}

export function processEnvironmentSite(node: ts.Node): string {
  const target = mutationTarget(node);
  if (!target) throw new Error('Environment mutation is missing its target');
  let current = unwrap(target);
  const members: string[] = [];
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    const member = accessedMember(current);
    if (member === undefined) return 'process.env';
    members.unshift(member);
    current = unwrap(current.expression);
  }
  const scope = declarationName(node);
  const enclosing = scope.startsWith('<anonymous@') ? '<module>' : scope;
  return `${enclosing}.${current.getText()}.${members.join('.')}`;
}

export function unresolvedConstruction(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const value = unwrap(expression);
  if (!ts.isNewExpression(value)) return false;
  const symbol = checker.getSymbolAtLocation(value.expression);
  const resolved =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declarations = resolved?.declarations ?? [];
  const hasResolvedImplementation = declarations.some(
    (declaration) =>
      ts.isClassDeclaration(declaration) &&
      !declaration.getSourceFile().isDeclarationFile,
  );
  return (
    !hasResolvedImplementation &&
    ((symbol?.declarations ?? []).some((declaration) =>
      ts.isImportSpecifier(declaration),
    ) ||
      declarations.some(
        (declaration) =>
          ts.isClassDeclaration(declaration) &&
          declaration.getSourceFile().isDeclarationFile,
      ))
  );
}

function methodMutatesReceiver(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
  seen: readonly ts.MethodDeclaration[] = [],
): boolean {
  if (!method.body || seen.includes(method)) return false;
  const path = [...seen, method];
  let mutates = false;
  const visitMethod = (node: ts.Node): void => {
    if (
      mutates ||
      (ts.isFunctionLike(node) && node !== method && !ts.isArrowFunction(node))
    )
      return;
    const target = mutationTarget(node);
    if (target) {
      let root = unwrap(target);
      while (
        ts.isPropertyAccessExpression(root) ||
        ts.isElementAccessExpression(root)
      )
        root = unwrap(root.expression);
      if (root.kind === ts.SyntaxKind.ThisKeyword) {
        mutates = true;
        return;
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      unwrap(node.expression.expression).kind === ts.SyntaxKind.ThisKeyword
    ) {
      const methods =
        checker
          .getSymbolAtLocation(node.expression.name)
          ?.declarations?.filter(ts.isMethodDeclaration) ?? [];
      if (
        methods.some((nested) => methodMutatesReceiver(nested, checker, path))
      ) {
        mutates = true;
        return;
      }
    }
    ts.forEachChild(node, visitMethod);
  };
  visitMethod(method.body);
  return mutates;
}

export function moduleInstanceMutation(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): StorageDeclaration | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const methods =
    checker
      .getSymbolAtLocation(call.expression.name)
      ?.declarations?.filter(ts.isMethodDeclaration) ?? [];
  if (!methods.some((method) => methodMutatesReceiver(method, checker)))
    return undefined;
  const origin = storageOrigin(call.expression.expression, checker);
  return origin &&
    ts.isVariableDeclaration(origin) &&
    isOwnedModuleStorage(origin, sourceFile)
    ? origin
    : undefined;
}
