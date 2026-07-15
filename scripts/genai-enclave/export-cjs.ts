/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CommonJS export detection for the genai-enclave boundary guard (#2352).
 *
 * Extracted from export-detection.ts to keep each module under the lint
 * max-lines limit. Handles `module.exports` / `exports` property assignments,
 * `Object.defineProperty` / `Object.defineProperties` / `Object.assign`
 * mutations, chained and logical-assignment forms, and object-literal RHS
 * inspection including nested literals and spread sources.
 *
 * Fail-closed (F2/F4): dynamic/computed export mutations that the scanner
 * cannot statically resolve are flagged as violations.
 */

import ts from 'typescript';
import { containsGemini } from './config.ts';
import {
  literalText,
  elementAccessName,
  objectPropertyName,
  inlineSpreadPropertyNames,
  isStaticSpreadSource,
  unwrapTransparentExpressions,
} from './ast-helpers.ts';
import type { GeminiExportViolation } from './violation-types.ts';
import { isProvenModuleLoaderCall } from './import-detection.ts';
import {
  type ExportScanContext,
  addExportViolation,
  addFailClosedViolation,
} from './export-detection.ts';

/**
 * Check whether an expression is `module.exports` (property access or
 * element access with a string key). Returns false if `module` is shadowed
 * by a local declaration at the reference position (F3).
 */
export function isModuleExports(
  ctx: ExportScanContext,
  node: ts.Expression,
): boolean {
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'exports' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'module'
  ) {
    return !ctx.globalShadows.isShadowed('module', node.expression.getStart());
  }
  if (ts.isElementAccessExpression(node)) {
    const memberName = elementAccessName(node);
    if (
      memberName === 'exports' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'module'
    ) {
      return !ctx.globalShadows.isShadowed(
        'module',
        node.expression.getStart(),
      );
    }
  }
  return false;
}

/**
 * Check whether an expression is a CommonJS `exports` reference or
 * `module.exports`. Returns false if the referenced global is shadowed (F3).
 */
export function isCommonJSExports(
  ctx: ExportScanContext,
  node: ts.Expression,
): boolean {
  if (ts.isIdentifier(node) && node.text === 'exports') {
    return !ctx.globalShadows.isShadowed('exports', node.getStart());
  }
  return isModuleExports(ctx, node);
}

/**
 * Record a Gemini-named CommonJS export violation if the name matches.
 */
function addCommonJSViolation(
  ctx: ExportScanContext,
  node: ts.Node,
  exportName: string | undefined,
  violations: GeminiExportViolation[],
): void {
  if (exportName !== undefined && containsGemini(exportName)) {
    addExportViolation(
      ctx,
      node,
      exportName,
      'module.exports / exports assignment',
      violations,
    );
  }
}

function isLogicalExpression(node: ts.BinaryExpression): boolean {
  return [
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
  ].includes(node.operatorToken.kind);
}

/**
 * Global identifiers that are statically known to produce no export names
 * when used as `module.exports = <id>`. These are JavaScript global
 * constants; they are parsed as Identifier nodes (not keyword nodes) so
 * the neutral-identifier fail-closed must explicitly exempt them.
 */
const SAFE_GLOBAL_IDENTIFIERS: ReadonlySet<string> = new Set([
  'undefined',
  'NaN',
  'Infinity',
]);

function isSafeStaticExportValue(rhs: ts.Expression): boolean {
  const safeKinds: readonly ts.SyntaxKind[] = [
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.CallExpression,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.UndefinedKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
  ];
  return safeKinds.includes(rhs.kind);
}

function checkCompositeAssignmentRhs(
  ctx: ExportScanContext,
  node: ts.Node,
  rhs: ts.Expression,
  violations: GeminiExportViolation[],
): boolean {
  if (ts.isConditionalExpression(rhs)) {
    checkCommonJSAssignmentRhs(ctx, node, rhs.whenTrue, violations);
    checkCommonJSAssignmentRhs(ctx, node, rhs.whenFalse, violations);
    return true;
  }
  if (!ts.isBinaryExpression(rhs)) return false;
  if (rhs.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    checkCommonJSAssignmentRhs(ctx, node, rhs.right, violations);
    return true;
  }
  if (!isLogicalExpression(rhs)) return false;
  checkCommonJSAssignmentRhs(ctx, node, rhs.left, violations);
  checkCommonJSAssignmentRhs(ctx, node, rhs.right, violations);
  return true;
}

/**
 * Inspect the RHS of a CommonJS assignment for Gemini-named exports.
 * Handles identifiers, class/function expressions, and object literals.
 * Recurses into nested object literals (`module.exports = { nested: { GeminiDeep: 1 } }`).
 * Recurses into chained assignments (e.g. `exports = module.exports = { ... }`).
 *
 * F2 fail-closed: a CallExpression RHS (e.g. `module.exports = someFunc()`)
 * is flagged because the scanner cannot statically determine the exported
 * names. This does NOT apply to createRequire(...)(...) forms, which are
 * require calls handled by the import-side detector, not export mutations.
 */
function checkCommonJSAssignmentRhs(
  ctx: ExportScanContext,
  node: ts.Node,
  rhs: ts.Expression,
  violations: GeminiExportViolation[],
): void {
  const candidate = unwrapTransparentExpressions(rhs);
  if (checkCompositeAssignmentRhs(ctx, node, candidate, violations)) return;
  if (ts.isObjectLiteralExpression(candidate)) {
    checkCommonJSObjectLiteral(ctx, candidate, violations);
    return;
  }
  if (ts.isIdentifier(candidate)) {
    // The identifier name is statically resolvable. If it contains "Gemini",
    // flag it as a Gemini export.
    addCommonJSViolation(ctx, node, candidate.text, violations);
    // If the identifier resolves to a static object-literal binding, also
    // inspect the object's properties (F2 resolvable spread).
    const binding = resolveObjectLiteralBinding(ctx, candidate);
    if (binding !== undefined) {
      checkCommonJSObjectLiteral(ctx, binding, violations);
      return;
    }
    // An unresolved neutral identifier cannot be statically inspected for
    // its exported names. Its own name has been checked above; if the name
    // itself does not contain "Gemini" and is not a known-safe global
    // constant (undefined/NaN/Infinity), fail closed to avoid missing a
    // dynamic export surface.
    if (
      !containsGemini(candidate.text) &&
      !SAFE_GLOBAL_IDENTIFIERS.has(candidate.text)
    ) {
      addFailClosedViolation(
        ctx,
        node,
        'module.exports = unresolved identifier (fail-closed)',
        violations,
      );
    }
    return;
  }
  if (
    (ts.isClassExpression(candidate) || ts.isFunctionExpression(candidate)) &&
    candidate.name !== undefined
  ) {
    addCommonJSViolation(ctx, node, candidate.name.text, violations);
    return;
  }
  // F2 fail-closed: a CallExpression RHS (e.g. `module.exports = someFunc()`)
  // cannot be statically inspected. Proven module-loader calls are import-side
  // concerns and are exempt using the same scope-aware provenance model.
  if (
    ts.isCallExpression(candidate) &&
    !isProvenModuleLoaderCall(ctx.importContext, candidate)
  ) {
    addFailClosedViolation(
      ctx,
      node,
      'module.exports = callExpression() (fail-closed)',
      violations,
    );
    return;
  }
  // A3: any other expression kind (PropertyAccess, ArrayLiteral, etc.)
  // cannot be statically inspected for export names — fail closed.
  // Null/undefined/boolean/number literals produce no export names.
  // Class/function expressions (named or anonymous) are safe: their names
  // have already been checked above, or they are anonymous (no export name).
  // CallExpressions are handled above (fail-closed or exempted).
  if (!isSafeStaticExportValue(candidate)) {
    addFailClosedViolation(
      ctx,
      node,
      'module.exports = unresolvable expression (fail-closed)',
      violations,
    );
  }
}

/**
 * Resolve an identifier to its static object-literal binding, respecting
 * lexical scope (Finding2: no false violation from inner-scope shadow).
 * Returns the innermost (scope-correct) object-literal binding for the
 * identifier at the reference position, or undefined.
 */
export function resolveObjectLiteralBinding(
  ctx: ExportScanContext,
  identifier: ts.Identifier,
): ts.ObjectLiteralExpression | undefined {
  const entries = ctx.objectLiteralBindings.get(identifier.text);
  if (entries === undefined || entries.length === 0) return undefined;
  const pos = identifier.getStart();
  const active = entries.filter((e) => e.from <= pos && pos <= e.to);
  if (active.length === 0) return undefined;
  active.sort((a, b) => {
    const aRange = a.to - a.from;
    const bRange = b.to - b.from;
    if (aRange !== bRange) return aRange - bRange;
    return b.from - a.from;
  });
  return active[0].literal;
}

/**
 * Check a single spread assignment in a CommonJS object-literal RHS.
 * If the spread source is an inline object literal (static), its property
 * names are checked; if empty (`{...{}}`), no fail-closed is needed.
 * Otherwise (non-literal spread source) the scanner fails-closed (F2).
 */
function checkCommonJSSpread(
  ctx: ExportScanContext,
  property: ts.SpreadAssignment,
  violations: GeminiExportViolation[],
): void {
  // Finding10: distinguish static empty spreads from non-literal spreads.
  if (isStaticSpreadSource(property)) {
    const names = inlineSpreadPropertyNames(property);
    for (const name of names) {
      addCommonJSViolation(ctx, property, name, violations);
    }
    // Empty but inspectable — no fail-closed needed.
    return;
  }
  // F2: non-literal spread source — cannot statically inspect.
  addFailClosedViolation(
    ctx,
    property,
    'module.exports object literal with non-literal spread source',
    violations,
  );
}

/**
 * Check a single non-spread property in a CommonJS object-literal RHS,
 * recursing into nested object literals.
 */
function checkCommonJSObjectProperty(
  ctx: ExportScanContext,
  property: ts.ObjectLiteralElementLike,
  violations: GeminiExportViolation[],
): void {
  const propName = objectPropertyName(property);
  addCommonJSViolation(ctx, property, propName, violations);
  // Method declarations (`{ GeminiMethod() {} }`) are ObjectLiteralElementLike
  // nodes parsed as MethodDeclaration; their name is covered by the
  // objectPropertyName call above, so no separate branch is needed.
  // Recurse into nested object literals: `{ nested: { GeminiDeep: 1 } }`
  if (
    propName !== undefined &&
    ts.isPropertyAssignment(property) &&
    ts.isObjectLiteralExpression(property.initializer)
  ) {
    checkCommonJSObjectLiteral(ctx, property.initializer, violations);
  }
}

/**
 * Check the properties of a CommonJS object-literal RHS for Gemini-containing
 * names, including inline spread sources and nested object literals.
 */
function checkCommonJSObjectLiteral(
  ctx: ExportScanContext,
  rhs: ts.ObjectLiteralExpression,
  violations: GeminiExportViolation[],
): void {
  for (const property of rhs.properties) {
    if (ts.isSpreadAssignment(property)) {
      checkCommonJSSpread(ctx, property, violations);
      continue;
    }
    checkCommonJSObjectProperty(ctx, property, violations);
  }
}

function isExportAssignmentOperator(token: ts.Node): boolean {
  return (
    token.kind === ts.SyntaxKind.EqualsToken ||
    token.kind === ts.SyntaxKind.BarBarEqualsToken ||
    token.kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    token.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
  );
}

/**
 * Check CommonJS named property and object-literal export assignments,
 * including logical-assignment operators (`||=`, `??=`, `&&=`) and chained
 * assignments like `exports = module.exports = { ... }`.
 *
 * F4 fail-closed: element-access assignments with computed (non-string)
 * keys are flagged because the scanner cannot statically determine the
 * exported name.
 */
export function checkCommonJSExport(
  ctx: ExportScanContext,
  node: ts.ExpressionStatement,
  violations: GeminiExportViolation[],
): void {
  const expr = node.expression;
  if (ts.isCallExpression(expr)) {
    checkCommonJSCall(ctx, expr, violations);
    return;
  }
  if (
    !ts.isBinaryExpression(expr) ||
    !isExportAssignmentOperator(expr.operatorToken)
  ) {
    return;
  }
  const lhs = expr.left;
  // module.exports.GeminiName = ... / exports.GeminiName = ...
  // Also: exports.GeminiName ||= ... / ??= ... / &&=...
  if (
    ts.isPropertyAccessExpression(lhs) &&
    isCommonJSExports(ctx, lhs.expression)
  ) {
    addCommonJSViolation(ctx, node, lhs.name.text, violations);
    return;
  }
  if (
    ts.isElementAccessExpression(lhs) &&
    isCommonJSExports(ctx, lhs.expression)
  ) {
    const memberName = elementAccessName(lhs);
    if (memberName !== undefined) {
      addCommonJSViolation(ctx, node, memberName, violations);
    } else {
      // F4 fail-closed: computed key on exports
      addFailClosedViolation(
        ctx,
        node,
        'module.exports[computedKey] assignment',
        violations,
      );
    }
    return;
  }
  // Only `=` supports RHS inspection (object literals). Logical-assignment
  // operators (`module.exports ||= { GeminiLeak: 1 }`) require the property
  // name to already be on the LHS, which is handled above.
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    // Whole-target logical assignments (`module.exports ||= { ... }`,
    // `exports ||= { ... }`, `??=`, `&&=`) must also inspect the RHS because
    // the assigned value becomes part of the exported surface.
    if (isCommonJSExports(ctx, lhs)) {
      checkCommonJSAssignmentRhs(ctx, node, expr.right, violations);
    }
    return;
  }
  // module.exports = { ... } / module.exports = GeminiName / module.exports = class Gemini {}
  if (isModuleExports(ctx, lhs)) {
    checkCommonJSAssignmentRhs(ctx, node, expr.right, violations);
    return;
  }
  // exports = module.exports = { ... } (chained assignment)
  // The LHS is `exports` (isCommonJSExports); the RHS is the chained
  // BinaryExpression. We only need to inspect the RHS, as the inner
  // `module.exports = { ... }` is handled by the recursion.
  if (isCommonJSExports(ctx, lhs)) {
    checkCommonJSAssignmentRhs(ctx, node, expr.right, violations);
  }
}

/** Dispatch Object/Reflect static method calls to the right checker. */
function checkCommonJSCall(
  ctx: ExportScanContext,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  // Object.* static method calls
  const objectMethod = getStaticMethodName(ctx, expr.expression, 'Object');
  if (objectMethod !== undefined) {
    dispatchStaticMethod(ctx, objectMethod, 'Object', expr, violations);
    return;
  }
  // Reflect.* static method calls (Finding3: Reflect.defineProperty)
  const reflectMethod = getStaticMethodName(ctx, expr.expression, 'Reflect');
  if (reflectMethod !== undefined) {
    dispatchStaticMethod(ctx, reflectMethod, 'Reflect', expr, violations);
  }
}

/**
 * Dispatch a static method name (defineProperty/defineProperties/assign)
 * to the appropriate checker, regardless of whether it was called as
 * Object.* or Reflect.*.
 */
function dispatchStaticMethod(
  ctx: ExportScanContext,
  methodName: string,
  objectName: string,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  if (methodName === 'defineProperty') {
    checkDefinePropertyCall(ctx, expr, violations);
  } else if (methodName === 'defineProperties') {
    checkDefinePropertiesCall(ctx, expr, violations);
  } else if (methodName === 'assign') {
    checkAssignCall(ctx, expr, violations);
  } else if (methodName === 'set' && objectName === 'Reflect') {
    checkReflectSetCall(ctx, expr, violations);
  }
}

/**
 * Extract the method name from `Object.method` (PropertyAccess) or
 * `Object['method']` (ElementAccess). Returns undefined if the callee
 * is not a static method on `objectName`, or if `Object` is shadowed (F3).
 */
function getStaticMethodName(
  ctx: ExportScanContext,
  expr: ts.Expression,
  objectName: string,
): string | undefined {
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === objectName
  ) {
    if (ctx.globalShadows.isShadowed(objectName, expr.expression.getStart())) {
      return undefined;
    }
    return expr.name.text;
  }
  if (
    ts.isElementAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === objectName
  ) {
    if (ctx.globalShadows.isShadowed(objectName, expr.expression.getStart())) {
      return undefined;
    }
    return elementAccessName(expr);
  }
  return undefined;
}

function checkDefinePropertyCall(
  ctx: ExportScanContext,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  const target = expr.arguments[0];
  const keyArg = expr.arguments[1];
  if (target === undefined || keyArg === undefined) return;
  if (!isCommonJSExports(ctx, target)) return;
  const keyText = literalText(keyArg);
  if (keyText !== null) {
    addCommonJSViolation(ctx, expr, keyText, violations);
  } else {
    // F4 fail-closed: computed key variable
    addFailClosedViolation(
      ctx,
      expr,
      'Object.defineProperty with computed key',
      violations,
    );
  }
}

/**
 * Check a single property or spread assignment in a defineProperties
 * descriptor map, recording violations as appropriate (F2 fail-closed for
 * non-literal spread sources).
 */
function checkDefinePropertiesProperty(
  ctx: ExportScanContext,
  property: ts.ObjectLiteralElementLike,
  violations: GeminiExportViolation[],
): void {
  if (ts.isSpreadAssignment(property)) {
    if (isStaticSpreadSource(property)) {
      const names = inlineSpreadPropertyNames(property);
      for (const name of names) {
        addCommonJSViolation(ctx, property, name, violations);
      }
      return;
    }
    addFailClosedViolation(
      ctx,
      property,
      'Object.defineProperties with non-literal spread source',
      violations,
    );
    return;
  }
  addCommonJSViolation(ctx, property, objectPropertyName(property), violations);
}

function checkDefinePropertiesCall(
  ctx: ExportScanContext,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  const target = expr.arguments[0];
  const descriptorMap = expr.arguments[1];
  if (target === undefined || descriptorMap === undefined) return;
  if (!isCommonJSExports(ctx, target)) return;
  if (!ts.isObjectLiteralExpression(descriptorMap)) {
    // F2 fail-closed: non-literal descriptor map (variable, call, etc.)
    addFailClosedViolation(
      ctx,
      expr,
      'Object.defineProperties with non-literal descriptor map',
      violations,
    );
    return;
  }
  for (const property of descriptorMap.properties) {
    checkDefinePropertiesProperty(ctx, property, violations);
  }
}

/**
 * Check a single property/spread in an Object.assign source object argument.
 * Records Gemini violations or F2 fail-closed for non-literal spreads.
 */
function checkAssignSourceProperty(
  ctx: ExportScanContext,
  property: ts.ObjectLiteralElementLike,
  violations: GeminiExportViolation[],
): void {
  if (ts.isSpreadAssignment(property)) {
    if (isStaticSpreadSource(property)) {
      const names = inlineSpreadPropertyNames(property);
      for (const name of names) {
        addCommonJSViolation(ctx, property, name, violations);
      }
      return;
    }
    addFailClosedViolation(
      ctx,
      property,
      'Object.assign with non-literal spread source',
      violations,
    );
    return;
  }
  addCommonJSViolation(ctx, property, objectPropertyName(property), violations);
}

function checkAssignCall(
  ctx: ExportScanContext,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  const target = expr.arguments[0];
  if (target === undefined || !isCommonJSExports(ctx, target)) return;
  if (expr.arguments.length === 1) return;
  let hasLiteralSource = false;
  let hasNonLiteralSource = false;
  for (const arg of expr.arguments) {
    if (ts.isObjectLiteralExpression(arg)) {
      hasLiteralSource = true;
      for (const property of arg.properties) {
        checkAssignSourceProperty(ctx, property, violations);
      }
    } else if (arg !== target) {
      // The first argument is the target (exports); any subsequent
      // non-literal argument is a non-literal source.
      hasNonLiteralSource = true;
    }
  }
  // F4 fail-closed: if no object-literal source was found, the scanner
  // cannot statically determine what properties are being added.
  if (!hasLiteralSource) {
    addFailClosedViolation(
      ctx,
      expr,
      'Object.assign with non-literal source',
      violations,
    );
  }
  // F2 fail-closed: if there IS a literal source but also a non-literal
  // source, the scanner detects Gemini names in the literal but cannot
  // inspect the non-literal source, so it fails-closed for the non-literal.
  if (hasLiteralSource && hasNonLiteralSource) {
    addFailClosedViolation(
      ctx,
      expr,
      'Object.assign with mixed literal and non-literal sources',
      violations,
    );
  }
}

/**
 * Check a `Reflect.set(exports, 'GeminiName', value)` call. The signature is
 * the same as Object.defineProperty — target, key, value — but without a
 * descriptor map. The key is checked for Gemini content.
 */
function checkReflectSetCall(
  ctx: ExportScanContext,
  expr: ts.CallExpression,
  violations: GeminiExportViolation[],
): void {
  const target = expr.arguments[0];
  const keyArg = expr.arguments[1];
  if (target === undefined || keyArg === undefined) return;
  if (!isCommonJSExports(ctx, target)) return;
  const keyText = literalText(keyArg);
  if (keyText !== null) {
    addCommonJSViolation(ctx, expr, keyText, violations);
  } else {
    addFailClosedViolation(
      ctx,
      expr,
      'Reflect.set with computed key',
      violations,
    );
  }
}
