/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Low-level AST helper functions shared by both import-detection and
 * export-detection modules (#2352). Extracted to avoid circular imports.
 */

import ts from 'typescript';

const REQUIRE_IDENTIFIER = 'require';

/**
 * Extract the string literal text from a TS node, or null if it is not a
 * string literal or no-substitution template literal.
 */
export function literalText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * Extract the string text from an ElementAccessExpression argument
 * (e.g. `obj['require']` → `'require'`), or undefined if it is not a string.
 */
export function elementAccessLiteralText(
  node: ts.Expression | undefined,
): string | undefined {
  if (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }
  return undefined;
}

/**
 * Extract all binding names from a destructuring pattern (object or array).
 * Handles nested patterns and renamed bindings ({ prop: localName }).
 */
export function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }
  if (!ts.isObjectBindingPattern(name) && !ts.isArrayBindingPattern(name)) {
    return [];
  }
  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      names.push(...collectBindingNames(element.name));
    }
  }
  return names;
}

/**
 * Check whether a declaration node has an `export` modifier.
 */
export function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Extract the property name from a string-literal or identifier key of an
 * ElementAccessExpression, or undefined if the key is computed/non-string.
 */
export function elementAccessName(
  node: ts.ElementAccessExpression,
): string | undefined {
  const argument = node.argumentExpression;
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return argument.text;
  }
  return undefined;
}

/**
 * Extract the name of an ObjectLiteralElementLike property (identifier,
 * string-literal key, or computed-string key), or undefined for spread or
 * computed-non-string keys.
 */
export function objectPropertyName(
  node: ts.ObjectLiteralElementLike,
): string | undefined {
  if (ts.isSpreadAssignment(node)) return undefined;
  const name = node.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) ||
      ts.isNoSubstitutionTemplateLiteral(name.expression))
  ) {
    return name.expression.text;
  }
  return undefined;
}

/**
 * Extract the imported (source) name from a binding element or import
 * specifier, accounting for renamed bindings.  Returns the property name
 * (`propertyName`) if present, otherwise the local name.
 */
export function importedNameOfBinding(element: ts.BindingElement): string {
  if (element.propertyName) {
    return ts.isIdentifier(element.propertyName)
      ? element.propertyName.text
      : element.propertyName.getText();
  }
  return ts.isIdentifier(element.name)
    ? element.name.text
    : element.name.getText();
}

/**
 * Extract the imported (source) name from an import specifier, accounting
 * for renamed imports (`import { createRequire as cr }`). Returns the
 * property name if present, otherwise the local name.
 */
export function importedNameOfSpecifier(element: ts.ImportSpecifier): string {
  return element.propertyName?.text ?? element.name.text;
}

/**
 * Determine if `text` is a logical-assignment operator token name
 * (`||=`, `??=`, `&&=`).
 */
export function isLogicalAssignmentToken(
  token: ts.Token<ts.SyntaxKind>,
): boolean {
  return (
    token.kind === ts.SyntaxKind.BarBarEqualsToken ||
    token.kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    token.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
  );
}

export { REQUIRE_IDENTIFIER };

/**
 * Check whether a SpreadAssignment's source expression is an inline object
 * literal (statically inspectable). Returns true for both empty `{}` and
 * populated `{ key: value }` literals.
 *
 * Finding10: distinguishes static empty spreads (`{...{}}`) from
 * non-inspectable spread sources (`{...someVar}`). The caller must check
 * this BEFORE calling {@link inlineSpreadPropertyNames} to avoid treating
 * an empty result as non-literal.
 */
export function isStaticSpreadSource(node: ts.SpreadAssignment): boolean {
  return ts.isObjectLiteralExpression(node.expression);
}

/**
 * Extract property names from a SpreadAssignment's expression when it is an
 * inline object literal (`{...{GeminiLeak: 1}}`). Returns the property names
 * of the spread source; returns an empty array for non-literal spread sources
 * OR for empty object literals (`{...{}}`).
 *
 * Callers MUST use {@link isStaticSpreadSource} to distinguish between
 * "empty but inspectable" (static empty spread, no fail-closed needed) and
 * "non-inspectable" (non-literal spread, fail-closed required).
 */
export function inlineSpreadPropertyNames(node: ts.SpreadAssignment): string[] {
  const expr = node.expression;
  if (!ts.isObjectLiteralExpression(expr)) return [];
  const names: string[] = [];
  for (const property of expr.properties) {
    const name = objectPropertyName(property);
    if (name !== undefined) names.push(name);
  }
  return names;
}
