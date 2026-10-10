/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';

export interface ImmutableTableAllowance {
  readonly file: string;
  readonly declaration: string;
  readonly reason: string;
}

/**
 * Enables container-literal rejection for a scanned file. Module-level
 * object/array storage is then reported unless it is a frozen primitive table
 * or an exact file + declaration entry with a nonblank reason.
 */
export interface ContainerPolicy {
  readonly allowlist: readonly ImmutableTableAllowance[];
}

/**
 * Module storage whose initializer is an object/array literal, including one
 * wrapped in Object.freeze that is not a primitive-only table. Such storage
 * is only exempt when it is an allowlisted immutable lookup table.
 */
export function containerLiteralStorage(node: ts.Expression): boolean {
  if (frozenPrimitiveTable(node)) return false;
  let expression = unwrap(node);
  if (
    ts.isCallExpression(expression) &&
    expression.expression.getText() === 'Object.freeze' &&
    expression.arguments[0]
  )
    expression = unwrap(expression.arguments[0]);
  return (
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression)
  );
}

export function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    return unwrap(expression.expression);
  if (ts.isSatisfiesExpression(expression))
    return unwrap(expression.expression);
  return expression;
}

function primitiveLiteral(node: ts.Expression): boolean {
  const expression = unwrap(node);
  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression))
    return true;
  if (
    [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
    ].includes(expression.kind)
  )
    return true;
  return (
    ts.isPrefixUnaryExpression(expression) &&
    [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(
      expression.operator,
    ) &&
    ts.isNumericLiteral(expression.operand)
  );
}

function deepFrozenMember(node: ts.Expression): boolean {
  return primitiveLiteral(node) || frozenPrimitiveTable(node);
}

/**
 * Object.freeze over an object/array literal whose members are primitives or
 * themselves frozen tables, so freezing is deep and no member is writable.
 */
export function frozenPrimitiveTable(node: ts.Expression): boolean {
  const expression = unwrap(node);
  if (
    !ts.isCallExpression(expression) ||
    expression.expression.getText() !== 'Object.freeze'
  )
    return false;
  const argument = expression.arguments[0];
  if (!argument) return false;
  const value = unwrap(argument);
  return (
    (ts.isObjectLiteralExpression(value) &&
      value.properties.every(
        (property) =>
          ts.isPropertyAssignment(property) &&
          !ts.isComputedPropertyName(property.name) &&
          deepFrozenMember(property.initializer),
      )) ||
    (ts.isArrayLiteralExpression(value) &&
      value.elements.every(deepFrozenMember))
  );
}
