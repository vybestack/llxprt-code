/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared import-scanning context and factory-callee helpers for the
 * genai-enclave boundary guard (#2352).
 *
 * Extracted from import-detection.ts so that both the provenance-collection
 * pass (provenance-collection.ts) and the violation-detection pass
 * (import-detection.ts) can reference these without creating a circular
 * dependency.
 */

import ts from 'typescript';
import { elementAccessLiteralText, REQUIRE_IDENTIFIER } from './ast-helpers.ts';
import type { ProvenanceResolver, GlobalShadowResolver } from './provenance.ts';

/**
 * Provenance keys (local names) that are "known" at any position in the file.
 * Shared by the provenance-collection and violation-detection passes.
 */
export interface ImportScanContext {
  readonly sourceFile: ts.SourceFile;
  readonly relPath: string;
  readonly resolver: ProvenanceResolver;
  readonly globalShadows: GlobalShadowResolver;
  readonly knownFactoryAliases: Set<string>;
  readonly knownBindings: Set<string>;
  readonly knownNamespaces: Set<string>;
  /** Function names whose body returns a createRequire(...) result. */
  readonly createRequireReturningFunctions: Set<string>;
}

/**
 * Check whether a call-expression callee refers to the `createRequire`
 * factory — either the bare name, a tracked named-import alias, or a member
 * access through a namespace/default binding from node:module
 * (e.g. `m.createRequire`).
 */
export function isCreateRequireFactoryCallee(
  ctx: ImportScanContext,
  expr: ts.Expression,
): boolean {
  if (ts.isIdentifier(expr)) {
    // A bare `createRequire` identifier is the factory ONLY when the
    // provenance resolver has a factory-alias entry for it at this position
    // (e.g. from `import { createRequire } from 'node:module'`). A mere
    // absence of a shadow is insufficient — the identifier must have
    // valid resolver provenance as a factory alias.
    return ctx.resolver.isFactoryAlias(expr.text, expr.getStart());
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'createRequire'
  ) {
    if (!ts.isIdentifier(expr.expression)) return false;
    return ctx.resolver.isNamespace(expr.expression.text, expr.getStart());
  }
  if (
    ts.isElementAccessExpression(expr) &&
    elementAccessLiteralText(expr.argumentExpression) === 'createRequire'
  ) {
    if (!ts.isIdentifier(expr.expression)) return false;
    return ctx.resolver.isNamespace(expr.expression.text, expr.getStart());
  }
  return false;
}

/**
 * Check whether an expression is a reference to the global `require`
 * function (bare identifier, not shadowed).
 *
 * F24: `require` is the global builtin ONLY when no local declaration
 * shadows it at this position. Any non-undefined provenance kind means a
 * local binding was established (factory, binding, namespace, shadow,
 * require-alias), so the global builtin is NOT available.
 */
export function isGlobalRequireRef(
  ctx: ImportScanContext,
  expr: ts.Expression,
): boolean {
  if (!ts.isIdentifier(expr) || expr.text !== REQUIRE_IDENTIFIER) {
    return false;
  }
  if (ctx.globalShadows.isShadowed(REQUIRE_IDENTIFIER, expr.getStart())) {
    return false;
  }
  // Any provenance kind means a local declaration shadows the global
  // builtin at this position.
  const kind = ctx.resolver.resolve(REQUIRE_IDENTIFIER, expr.getStart());
  return kind === undefined;
}

/**
 * Check whether an expression is `module.require` (property access or element
 * access), respecting shadow resolution (F3).
 *
 * F25: consistent with isGlobalRequireRef, also check the provenance resolver.
 * If `module` has any provenance entry (local binding shadows the global),
 * it is NOT the CJS module builtin.
 */
export function isModuleRequireRef(
  ctx: ImportScanContext,
  expr: ts.Expression,
): boolean {
  const moduleExpr = getModuleBaseExpression(expr);
  if (moduleExpr === undefined) return false;
  const pos = moduleExpr.getStart();
  if (ctx.globalShadows.isShadowed('module', pos)) {
    return false;
  }
  // F25: also check the provenance resolver for consistency. A local
  // declaration of `module` (any kind) shadows the global CJS builtin.
  const kind = ctx.resolver.resolve('module', pos);
  return kind === undefined;
}

/**
 * Extract the `module` base identifier and verify the member is `require`.
 * Returns the module identifier expression if this is a `module.require`
 * reference, or undefined otherwise.
 */
function getModuleBaseExpression(
  expr: ts.Expression,
): ts.Identifier | undefined {
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === REQUIRE_IDENTIFIER &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'module'
  ) {
    return expr.expression;
  }
  if (ts.isElementAccessExpression(expr)) {
    const memberName = elementAccessLiteralText(expr.argumentExpression);
    if (
      memberName === REQUIRE_IDENTIFIER &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'module'
    ) {
      return expr.expression;
    }
  }
  return undefined;
}
