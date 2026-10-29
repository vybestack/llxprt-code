/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import { unwrap } from './runtime-state-literal-tables.js';

export function isStatic(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
  );
}

function isImmediateFunction(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return (
    !!parent &&
    ts.isCallExpression(parent) &&
    unwrap(parent.expression) === node
  );
}

export function isModuleOwned(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isFunctionLike(parent) && !isImmediateFunction(parent)) return false;
    if (ts.isPropertyDeclaration(parent) && !isStatic(parent)) return false;
    parent = parent.parent;
  }
  return true;
}

export function referencedSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
}

export type StorageDeclaration =
  | ts.VariableDeclaration
  | ts.PropertyDeclaration;

function aliasLike(expression: ts.Expression): boolean {
  return (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  );
}

export function bindingElements(
  name: ts.BindingName,
): readonly ts.BindingElement[] {
  if (ts.isIdentifier(name)) return [];
  return name.elements.flatMap((element) => {
    if (ts.isOmittedExpression(element) || element.dotDotDotToken) return [];
    if (ts.isIdentifier(element.name)) return [element];
    return bindingElements(element.name);
  });
}

export function bindingOwner(
  element: ts.BindingElement,
): ts.VariableDeclaration | ts.ParameterDeclaration {
  const owner = element.parent.parent;
  if (ts.isBindingElement(owner)) return bindingOwner(owner);
  if (ts.isVariableDeclaration(owner) || ts.isParameter(owner)) return owner;
  throw new Error('Binding pattern has no storage owner');
}

export function bindingKeys(element: ts.BindingElement): readonly string[] {
  const pattern = element.parent;
  const key = ts.isArrayBindingPattern(pattern)
    ? String(pattern.elements.indexOf(element))
    : (element.propertyName ?? element.name)
        .getText()
        .replace(/^['"]|['"]$/g, '');
  const owner = pattern.parent;
  return ts.isBindingElement(owner) ? [...bindingKeys(owner), key] : [key];
}

export function projectedBindingValue(
  expression: ts.Expression,
  keys: readonly string[],
  checker: ts.TypeChecker,
): ts.Expression {
  let value = unwrap(expression);
  for (const key of keys) {
    if (ts.isArrayLiteralExpression(value)) {
      const element = value.elements[Number(key)];
      if (
        !element ||
        ts.isOmittedExpression(element) ||
        ts.isSpreadElement(element)
      )
        return value;
      value = unwrap(element);
      continue;
    }
    const property = checker
      .getTypeAtLocation(value)
      .getProperty(key)?.valueDeclaration;
    if (property && ts.isPropertyAssignment(property)) {
      value = unwrap(property.initializer);
    } else if (property && ts.isShorthandPropertyAssignment(property)) {
      value = property.name;
    } else {
      return value;
    }
  }
  return value;
}

function conditionalScope(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isIterationStatement(node, false) ||
    ts.isConditionalExpression(node) ||
    ts.isSwitchStatement(node)
  );
}

function localAssignments(
  value: ts.Identifier,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): {
  readonly values: readonly ts.Expression[];
  readonly replacesInitial: boolean;
} {
  if (isModuleOwned(declaration)) return { values: [], replacesInitial: false };
  let scope: ts.Node = value;
  while (scope.parent && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope))
    scope = scope.parent;
  const symbol = referencedSymbol(value, checker);
  let assigned: readonly ts.Expression[] = [];
  let replacesInitial = false;
  const visit = (node: ts.Node): void => {
    if (
      node.getStart() >= value.getStart() ||
      (node !== scope && ts.isFunctionLike(node))
    )
      return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      referencedSymbol(node.left, checker) === symbol
    ) {
      let parent: ts.Node = node;
      while (
        parent.parent &&
        parent.parent !== scope &&
        !conditionalScope(parent) &&
        !ts.isFunctionLike(parent)
      )
        parent = parent.parent;
      if (parent.parent === scope) {
        assigned = [node.right];
        replacesInitial = true;
      } else assigned = [...assigned, node.right];
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return { values: assigned, replacesInitial };
}

export function storageOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): StorageDeclaration | undefined {
  const value = unwrap(expression);
  if (seen.includes(value)) return undefined;
  const path = [...seen, value];
  const declaration = referencedSymbol(value, checker)?.valueDeclaration;
  if (declaration && ts.isIdentifier(value)) {
    const assigned = localAssignments(value, declaration, checker);
    const origins = assigned.values
      .map((candidate) => storageOrigin(candidate, checker, path))
      .filter((origin): origin is StorageDeclaration => origin !== undefined);
    const moduleOrigin = origins.find(isModuleOwned);
    if (moduleOrigin) return moduleOrigin;
    if (assigned.replacesInitial) return origins[0];
  }
  if (
    declaration &&
    ts.isBindingElement(declaration) &&
    !declaration.dotDotDotToken
  ) {
    const owner = bindingOwner(declaration);
    if (owner.initializer)
      return (
        storageOrigin(
          projectedBindingValue(
            owner.initializer,
            bindingKeys(declaration),
            checker,
          ),
          checker,
          path,
        ) ?? storageOrigin(owner.initializer, checker, path)
      );
  }
  if (
    declaration &&
    (ts.isVariableDeclaration(declaration) ||
      ts.isPropertyDeclaration(declaration))
  ) {
    if (declaration.initializer) {
      const initializer = unwrap(declaration.initializer);
      if (aliasLike(initializer))
        return storageOrigin(initializer, checker, path);
    }
    return declaration;
  }
  const aliased = containerPropertyOrigin(declaration, checker, path);
  if (aliased) return aliased;
  if (
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value)
  )
    return storageOrigin(value.expression, checker, path);
  return undefined;
}

/**
 * A property of an object literal that was initialized from other storage
 * (`{ sessions }`, `{ held: sessions }`) is the same storage, not fresh
 * container state, so writes through the property reach the original owner.
 */
function containerPropertyOrigin(
  declaration: ts.Declaration | undefined,
  checker: ts.TypeChecker,
  path: readonly ts.Node[],
): StorageDeclaration | undefined {
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    const target =
      checker.getShorthandAssignmentValueSymbol(declaration)?.valueDeclaration;
    if (
      target &&
      (ts.isVariableDeclaration(target) || ts.isPropertyDeclaration(target))
    ) {
      const initializer = target.initializer && unwrap(target.initializer);
      return initializer && aliasLike(initializer)
        ? storageOrigin(initializer, checker, path)
        : target;
    }
    return undefined;
  }
  if (declaration && ts.isPropertyAssignment(declaration)) {
    const initializer = unwrap(declaration.initializer);
    return aliasLike(initializer)
      ? storageOrigin(initializer, checker, path)
      : undefined;
  }
  return undefined;
}

export function rootDeclaration(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): ts.Declaration | undefined {
  let value = unwrap(expression);
  if (seen.includes(value)) return undefined;
  while (
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value)
  )
    value = unwrap(value.expression);
  if (!ts.isIdentifier(value) || seen.includes(value)) return undefined;
  const declaration = referencedSymbol(value, checker)?.valueDeclaration;
  if (!declaration) return undefined;
  const path = [...seen, value];
  const assigned = localAssignments(value, declaration, checker);
  const origins = assigned.values
    .map((candidate) => rootDeclaration(candidate, checker, path))
    .filter((origin): origin is ts.Declaration => origin !== undefined);
  const externalOrigin = origins.find(
    (origin) =>
      ts.isParameter(origin) ||
      (ts.isBindingElement(origin) && ts.isParameter(bindingOwner(origin))) ||
      isModuleOwned(origin),
  );
  if (externalOrigin) return externalOrigin;
  if (assigned.replacesInitial) return origins[0];
  if (ts.isBindingElement(declaration)) {
    const owner = bindingOwner(declaration);
    if (ts.isParameter(owner)) return declaration;
    if (owner.initializer)
      return rootDeclaration(
        projectedBindingValue(
          owner.initializer,
          bindingKeys(declaration),
          checker,
        ),
        checker,
        path,
      );
  }
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    aliasLike(unwrap(declaration.initializer))
  )
    return rootDeclaration(declaration.initializer, checker, path);
  return declaration;
}
