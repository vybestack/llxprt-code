/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shadow provenance and object-literal binding collection for the export-side
 * genai-enclave boundary guard (#2352).
 *
 * Extracted from export-detection.ts to keep each module under the lint
 * max-lines limit. Runs a pre-pass to track local declarations that shadow
 * the CommonJS globals `module`, `exports`, and `Object`, and collects a map
 * of local variable names → static object-literal initializers for F2
 * identifier resolution.
 */

import ts from 'typescript';
import { collectBindingNames, isFunctionLikeNode } from './ast-helpers.ts';
import { blockScopedRange, hoistedRange } from './provenance.ts';
import type { ExportScanContext } from './export-detection.ts';

/**
 * A local variable binding whose initializer is a static object literal.
 * Used to resolve `module.exports = someVar` (F2 identifier resolution).
 *
 * Stores ALL declarations (including shadowed inner-scope ones), each with its
 * active range, so the scope-aware resolver can pick the innermost binding
 * at the reference position (Finding2: no false violation from inner scope).
 */
export interface ObjectLiteralBindingEntry {
  readonly literal: ts.ObjectLiteralExpression;
  readonly from: number;
  readonly to: number;
}

/**
 * Register shadow entries for all variable-declaration binding names.
 * `GlobalShadowResolver.registerShadow` filters to CJS global names
 * (`module`, `exports`, `Object`) downstream, so all bindings are
 * processed here unconditionally.
 */
export function collectExportShadows(
  ctx: ExportScanContext,
  node: ts.Node,
): void {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      registerVarShadows(ctx, decl);
    }
  } else if (isFunctionLikeNode(node)) {
    registerFunctionShadows(ctx, node);
  }
  ts.forEachChild(node, (child) => collectExportShadows(ctx, child));
}

/**
 * Register CJS global name shadows from variable declaration bindings.
 */
function registerVarShadows(
  ctx: ExportScanContext,
  decl: ts.VariableDeclaration,
): void {
  const range = computeVarRange(decl);
  for (const name of collectBindingNames(decl.name)) {
    ctx.globalShadows.registerShadow(name, range.from, range.to);
  }
}

/**
 * Register CJS global name shadows from function parameters and names.
 */
function registerFunctionShadows(
  ctx: ExportScanContext,
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): void {
  const range = hoistedRange(node);
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name !== undefined
  ) {
    ctx.globalShadows.registerShadow(node.name.text, range.from, range.to);
  }
  for (const param of node.parameters) {
    for (const name of collectBindingNames(param.name)) {
      ctx.globalShadows.registerShadow(name, range.from, range.to);
    }
  }
}

/**
 * Compute the active range for a variable declaration's shadow.
 */
function computeVarRange(decl: ts.VariableDeclaration): {
  readonly from: number;
  readonly to: number;
} {
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return blockScopedRange(decl);
  }
  const variableStatement = list.parent;
  const isModuleScoped =
    variableStatement !== undefined &&
    variableStatement.parent !== undefined &&
    ts.isSourceFile(variableStatement.parent);
  if (isModuleScoped) {
    return { from: 0, to: decl.getSourceFile().getEnd() };
  }
  const isVar = (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
  return isVar ? hoistedRange(decl) : blockScopedRange(decl);
}

/**
 * Type guards for named declaration node kinds.
 */

/**
 * Collect a map of local variable names → object-literal initializers from
 * all variable declarations in the source file (F2 identifier resolution).
 * Used to resolve `module.exports = someVar` when `someVar` points to a
 * static object-literal declaration.
 */
export function collectObjectLiteralBindings(
  sourceFile: ts.SourceFile,
): Map<string, ObjectLiteralBindingEntry[]> {
  const map = new Map<string, ObjectLiteralBindingEntry[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        registerObjectLiteralBinding(decl, map);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return map;
}

/**
 * Register all binding names from a variable declaration whose initializer
 * is a static object literal into the bindings map (F2).
 *
 * Only identifier declarations (`const x = { ... }`) are registered.
 * Destructuring patterns (`const { a, b } = { ... }`) extract properties
 * FROM the initializer, so the initializer is not the binding's value.
 */
function registerObjectLiteralBinding(
  decl: ts.VariableDeclaration,
  map: Map<string, ObjectLiteralBindingEntry[]>,
): void {
  if (
    decl.initializer === undefined ||
    !ts.isObjectLiteralExpression(decl.initializer)
  ) {
    return;
  }
  // Only register for simple identifier declarations. Destructuring
  // patterns do not establish a single-name → object-literal binding.
  if (!ts.isIdentifier(decl.name)) return;
  const range = computeVarRange(decl);
  const entry: ObjectLiteralBindingEntry = {
    literal: decl.initializer,
    from: range.from,
    to: range.to,
  };
  const list = map.get(decl.name.text);
  if (list === undefined) {
    map.set(decl.name.text, [entry]);
  } else {
    list.push(entry);
  }
}
