/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { isBuiltin } from 'node:module';
import ts from 'typescript';

function moduleValue(
  node: ts.Expression,
  checker: ts.TypeChecker,
  seen: ReadonlySet<ts.Node> = new Set(),
): boolean {
  if (seen.has(node)) return false;
  const next = new Set([...seen, node]);
  if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node))
    return moduleValue(node.expression, checker, next);
  if (ts.isCallExpression(node)) {
    const loader =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require');
    const argument = node.arguments[0];
    if (
      !argument ||
      !ts.isStringLiteralLike(argument) ||
      isBuiltin(argument.text)
    )
      return false;
    return loader;
  }
  if (!ts.isIdentifier(node)) return false;
  return !!checker
    .getSymbolAtLocation(node)
    ?.declarations?.some((declaration) => {
      if (ts.isNamespaceImport(declaration)) return true;
      return (
        ts.isVariableDeclaration(declaration) &&
        !!declaration.initializer &&
        moduleValue(declaration.initializer, checker, next)
      );
    });
}
function namedImport(node: ts.Node, checker: ts.TypeChecker): void {
  if (!ts.isImportSpecifier(node) && !ts.isExportSpecifier(node)) return;
  const owner = node.parent.parent;
  const declaration = ts.isImportClause(owner) ? owner.parent : owner;
  if (
    !ts.isImportDeclaration(declaration) &&
    !ts.isExportDeclaration(declaration)
  )
    return;
  const module = declaration.moduleSpecifier;
  if (!module || !ts.isStringLiteralLike(module) || isBuiltin(module.text))
    return;
  const symbol = checker.getSymbolAtLocation(node.name);
  const resolved =
    symbol &&
    (symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol);
  if (!resolved?.declarations?.length)
    throw new Error(
      `Unresolved JavaScript module member: ${node.getSourceFile().fileName}: ${node.getText()}`,
    );
}
function requireMember(node: ts.Node, checker: ts.TypeChecker): void {
  let receiver: ts.Expression;
  let name: string;
  if (ts.isPropertyAccessExpression(node)) {
    receiver = node.expression;
    name = node.name.text;
  } else if (
    ts.isBindingElement(node) &&
    ts.isObjectBindingPattern(node.parent)
  ) {
    const declaration = node.parent.parent;
    if (
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      node.dotDotDotToken
    )
      return;
    const property = node.propertyName ?? node.name;
    if (!ts.isIdentifier(property) && !ts.isStringLiteralLike(property)) return;
    receiver = declaration.initializer;
    name = property.text;
  } else return;
  if (!moduleValue(receiver, checker)) return;
  if (!checker.getPropertyOfType(checker.getTypeAtLocation(receiver), name))
    throw new Error(
      `Unresolved JavaScript module member: ${node.getSourceFile().fileName}: ${name}`,
    );
}
export function verifyJavascriptModuleIdentities(program: ts.Program): void {
  const checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    if (
      !/\.[cm]?js$/.test(source.fileName) ||
      program.isSourceFileFromExternalLibrary(source)
    )
      continue;
    const visit = (node: ts.Node): void => {
      namedImport(node, checker);
      requireMember(node, checker);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
