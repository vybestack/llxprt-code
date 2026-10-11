/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';

type LocalFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;
function localFunction(node: ts.Node): node is LocalFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}
function returnedExpressions(body: ts.ConciseBody): readonly ts.Expression[] {
  if (!ts.isBlock(body)) return [body];
  const returned: ts.Expression[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression)
      returned.push(node.expression);
    ts.forEachChild(node, collect);
  };
  collect(body);
  return returned;
}
function callBindings(
  node: ts.CallExpression,
  declaration: LocalFunction,
  checker: ts.TypeChecker,
  bindings: ReadonlyMap<ts.Symbol, ts.Expression>,
): ReadonlyMap<ts.Symbol, ts.Expression> {
  const substitutions = new Map(bindings);
  for (const [index, parameter] of declaration.parameters.entries()) {
    if (
      !ts.isIdentifier(parameter.name) ||
      parameter.dotDotDotToken ||
      parameter.initializer
    )
      continue;
    const symbol = checker.getSymbolAtLocation(parameter.name);
    const argument = node.arguments[index];
    if (symbol && argument && !ts.isSpreadElement(argument))
      substitutions.set(symbol, argument);
  }
  return substitutions;
}
export function javascriptExpressionTypes(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): readonly ts.Type[] {
  if (!/\.[cm]?js$/.test(expression.getSourceFile().fileName)) return [];
  const visit = (
    node: ts.Expression,
    bindings: ReadonlyMap<ts.Symbol, ts.Expression>,
    seen: ReadonlySet<ts.Node>,
  ): readonly ts.Type[] => {
    if (seen.has(node)) return [];
    const next = new Set([...seen, node]);
    const own = [checker.getTypeAtLocation(node)];
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const bound = symbol && bindings.get(symbol);
      if (bound) return [...own, ...visit(bound, bindings, next)];
      const declaration = symbol?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer
      )
        return [...own, ...visit(declaration.initializer, bindings, next)];
    }
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
      return [...own, ...visit(node.expression, bindings, next)];
    if (ts.isConditionalExpression(node))
      return [
        ...own,
        ...visit(node.whenTrue, bindings, next),
        ...visit(node.whenFalse, bindings, next),
      ];
    if (!ts.isCallExpression(node)) return own;
    const declaration = checker.getResolvedSignature(node)?.declaration;
    if (!declaration || !localFunction(declaration) || !declaration.body)
      return own;
    if (!/\.[cm]?js$/.test(declaration.getSourceFile().fileName)) return own;
    const substitutions = callBindings(node, declaration, checker, bindings);
    return [
      ...own,
      ...returnedExpressions(declaration.body).flatMap((value) =>
        visit(value, substitutions, next),
      ),
    ];
  };
  return visit(expression, new Map(), new Set());
}
