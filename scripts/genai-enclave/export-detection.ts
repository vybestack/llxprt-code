/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Export-side detection for the genai-enclave boundary guard (#2352).
 *
 * Detects exported identifiers whose name contains "Gemini"
 * (case-insensitive), covering: functions, classes, interfaces, type aliases,
 * variables, enums (and const enums), namespaces/modules, re-export aliases,
 * export default of a bare identifier, CommonJS `module.exports` / `exports`
 * property assignments, and `Object.defineProperty`/`Object.assign` on
 * exports targets.
 *
 * Shadow resolution (F3): a provenance pre-pass tracks local declarations
 * that shadow the CommonJS globals `module`, `exports`, and `Object`.
 * References to shadowed globals are NOT treated as CommonJS export targets.
 *
 * Fail-closed (F4): dynamic/computed export mutations (non-string keys,
 * non-literal Object.assign sources) are flagged because the scanner cannot
 * statically determine whether they introduce Gemini-named exports.
 *
 * CommonJS export detection logic is extracted to export-cjs.ts, and shadow
 * provenance / object-literal binding collection to export-provenance.ts,
 * to keep each module under the lint max-lines limit.
 */

import ts from 'typescript';
import { containsGemini } from './config.ts';
import {
  collectBindingNames,
  hasExportModifier,
  objectPropertyName,
  inlineSpreadPropertyNames,
  isStaticSpreadSource,
} from './ast-helpers.ts';
import { GlobalShadowResolver } from './provenance.ts';
import type { GeminiExportViolation } from './violation-types.ts';
import {
  checkCommonJSExport,
  resolveObjectLiteralBinding,
} from './export-cjs.ts';
import {
  collectExportShadows,
  collectObjectLiteralBindings,
  type ObjectLiteralBindingEntry,
} from './export-provenance.ts';

export type { GeminiExportViolation } from './violation-types.ts';
export type { ObjectLiteralBindingEntry } from './export-provenance.ts';

/**
 * Context for export scanning, carrying the global-shadow resolver so that
 * references to `module`, `exports`, and `Object` are correctly identified
 * as shadowed or not (F3), and a map of local variable declarations whose
 * initializer is a static object literal (F2 identifier resolution).
 */
export interface ExportScanContext {
  readonly sourceFile: ts.SourceFile;
  readonly relPath: string;
  readonly globalShadows: GlobalShadowResolver;
  readonly objectLiteralBindings: ReadonlyMap<
    string,
    readonly ObjectLiteralBindingEntry[]
  >;
}

/**
 * Classify the import/export syntax form of a TS node for diagnostic output.
 * Handles import declarations, export-from declarations, import-equals, and
 * import-type nodes. Returns 'unknown-import-form' for other node types
 * (named declarations are classified by their callers).
 *
 * Used by both import-detection (for import/export declarations) and
 * export-detection (via import-detection's fallback path).
 */
export function classifyImportExportSyntaxForm(node: ts.Node): string {
  if (ts.isImportDeclaration(node)) {
    return node.importClause?.isTypeOnly ? 'import type' : 'import';
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    if (clause === undefined) {
      return 'export * from';
    }
    if (ts.isNamespaceExport(clause)) {
      return 'export * as namespace from';
    }
    return 'export ... from';
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return 'import = require';
  }
  if (ts.isImportTypeNode(node)) {
    return 'import() type';
  }
  return 'unknown-import-form';
}

/**
 * Record a Gemini-named export violation.
 */
export function addExportViolation(
  ctx: ExportScanContext,
  node: ts.Node,
  exportName: string,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  const line =
    ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  violations.push({
    kind: 'gemini-export',
    file: ctx.relPath,
    line,
    exportName,
    exportForm,
  });
}

/**
 * Record a fail-closed violation for a computed/dynamic export mutation.
 */
export function addFailClosedViolation(
  ctx: ExportScanContext,
  node: ts.Node,
  detail: string,
  violations: GeminiExportViolation[],
): void {
  const line =
    ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  violations.push({
    kind: 'gemini-export',
    file: ctx.relPath,
    line,
    exportName: detail,
    exportForm: 'computed export mutation (fail-closed)',
  });
}

/**
 * Check a named-declaration node (function/class/interface/type alias/enum/
 * namespace/module) for a Gemini-containing exported name.
 */
function checkNamedDeclaration(
  ctx: ExportScanContext,
  node: ts.Node,
  name: ts.Identifier | undefined,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  if (!hasExportModifier(node) || name === undefined) return;
  if (containsGemini(name.text)) {
    addExportViolation(ctx, node, name.text, exportForm, violations);
  }
}

/**
 * Check an exported variable statement for Gemini-containing binding names.
 */
function checkVariableStatement(
  ctx: ExportScanContext,
  node: ts.VariableStatement,
  violations: GeminiExportViolation[],
): void {
  if (!hasExportModifier(node)) return;
  for (const decl of node.declarationList.declarations) {
    for (const name of collectBindingNames(decl.name)) {
      if (containsGemini(name)) {
        addExportViolation(ctx, node, name, 'export const/let/var', violations);
      }
    }
  }
}

/**
 * Check a named export declaration (`export { Foo as GeminiBar }`) for
 * Gemini-containing exported names.
 */
function checkNamedExports(
  ctx: ExportScanContext,
  node: ts.ExportDeclaration,
  violations: GeminiExportViolation[],
): void {
  const clause = node.exportClause;
  if (clause === undefined) return;
  if (ts.isNamespaceExport(clause)) {
    if (containsGemini(clause.name.text)) {
      addExportViolation(
        ctx,
        node,
        clause.name.text,
        'export * as name',
        violations,
      );
    }
    return;
  }
  for (const element of clause.elements) {
    const exportedName = element.name.text;
    if (containsGemini(exportedName)) {
      addExportViolation(
        ctx,
        node,
        exportedName,
        'export { name }',
        violations,
      );
    }
  }
}

/**
 * Check an export assignment (`export default GeminiFoo` or `export = ...`)
 * for a Gemini-containing exported identifier or object-literal property.
 *
 * `export =` (isExportEquals) is the TypeScript CommonJS-equivalent form.
 * Its expression may be an object literal (`export = { GeminiTs: 1 }`),
 * an identifier, or a class/function expression — all of which are checked.
 */
function checkExportAssignment(
  ctx: ExportScanContext,
  node: ts.ExportAssignment,
  violations: GeminiExportViolation[],
): void {
  const exportForm = node.isExportEquals ? 'export =' : 'export default';
  let expr = node.expression;
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  if (ts.isIdentifier(expr) && containsGemini(expr.text)) {
    addExportViolation(ctx, node, expr.text, exportForm, violations);
    // Do NOT return early — fall through to inspect any object-literal
    // binding the identifier resolves to, so nested Gemini names are also
    // detected (e.g. `const x = { GeminiLeak: 1 }; export default x;`).
  }
  if (
    (ts.isClassExpression(expr) || ts.isFunctionExpression(expr)) &&
    expr.name !== undefined &&
    containsGemini(expr.name.text)
  ) {
    addExportViolation(ctx, node, expr.name.text, exportForm, violations);
    return;
  }
  // export = { GeminiTs: 1 } — check object-literal property names,
  // including inline spread sources ({...{GeminiLeak: 1}}).
  if (ts.isObjectLiteralExpression(expr)) {
    checkObjectLiteralProperties(ctx, expr, exportForm, violations);
    return;
  }
  // F5: export = someIdentifier where someIdentifier resolves to a static
  // object-literal binding. The identifier's name itself is checked above;
  // here we resolve it to its object literal so nested Gemini names are
  // also detected.
  if (ts.isIdentifier(expr)) {
    const binding = resolveObjectLiteralBinding(ctx, expr);
    if (binding !== undefined) {
      checkObjectLiteralProperties(ctx, binding, exportForm, violations);
    }
  }
}

/**
 * Check the properties of an object-literal expression for Gemini-containing
 * names, including inline spread sources. Used by both ESM export-equals and
 * CommonJS assignment-RHS checks.
 */
function checkObjectLiteralProperties(
  ctx: ExportScanContext,
  expr: ts.ObjectLiteralExpression,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  for (const property of expr.properties) {
    if (ts.isSpreadAssignment(property)) {
      checkInlineSpreadNames(ctx, property, exportForm, violations);
      continue;
    }
    const propName = objectPropertyName(property);
    checkSinglePropertyName(ctx, property, propName, exportForm, violations);
    // F6: recurse into nested object literals so deeply nested Gemini
    // names are detected (e.g. export = { nested: { GeminiDeep: 1 } }).
    // Unwrap parenthesized expressions so wrappers like
    // { nested: ({ GeminiDeep: 1 }) } are also inspected.
    if (ts.isPropertyAssignment(property)) {
      let nestedInit: ts.Expression = property.initializer;
      while (ts.isParenthesizedExpression(nestedInit)) {
        nestedInit = nestedInit.expression;
      }
      if (ts.isObjectLiteralExpression(nestedInit)) {
        checkObjectLiteralProperties(ctx, nestedInit, exportForm, violations);
      }
    }
  }
}

/**
 * Check inline-spread property names from `{...{GeminiLeak: 1}}`.
 * If the spread source is an inline object literal (static), its property
 * names are checked — including when the literal is empty (`{...{}}`),
 * which is a no-op, not a fail-closed case. If the spread source is NOT
 * an inline object literal, the scanner cannot statically inspect it,
 * so it fails-closed (F2).
 */
function checkInlineSpreadNames(
  ctx: ExportScanContext,
  property: ts.SpreadAssignment,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  if (isStaticSpreadSource(property)) {
    const names = inlineSpreadPropertyNames(property);
    for (const name of names) {
      checkSinglePropertyName(ctx, property, name, exportForm, violations);
    }
    // Empty but inspectable — no fail-closed needed.
    return;
  }
  // F2: non-literal spread source — cannot statically inspect properties.
  addFailClosedViolation(
    ctx,
    property,
    `${exportForm} with non-literal spread source`,
    violations,
  );
}

/**
 * Check a single property name (if defined) for a Gemini match and record
 * a violation when it does.
 */
function checkSinglePropertyName(
  ctx: ExportScanContext,
  property: ts.ObjectLiteralElementLike | ts.SpreadAssignment,
  name: string | undefined,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  if (name !== undefined && containsGemini(name)) {
    addExportViolation(ctx, property, name, exportForm, violations);
  }
}

function checkNamespaceExport(
  ctx: ExportScanContext,
  node: ts.NamespaceExportDeclaration,
  violations: GeminiExportViolation[],
): void {
  if (containsGemini(node.name.text)) {
    addExportViolation(
      ctx,
      node,
      node.name.text,
      'export as namespace',
      violations,
    );
  }
}

/**
 * Check an `export import Name = require(...)` for a Gemini-containing name.
 */
function checkImportEqualsExport(
  ctx: ExportScanContext,
  node: ts.ImportEqualsDeclaration,
  violations: GeminiExportViolation[],
): void {
  if (!hasExportModifier(node)) return;
  if (node.name === undefined) return;
  if (containsGemini(node.name.text)) {
    addExportViolation(
      ctx,
      node,
      node.name.text,
      'export import = require',
      violations,
    );
  }
}

/**
 * Dispatch a single node to the appropriate export-check function.
 */
function dispatchExportCheck(
  ctx: ExportScanContext,
  node: ts.Node,
  violations: GeminiExportViolation[],
): void {
  if (ts.isFunctionDeclaration(node)) {
    checkNamedDeclaration(ctx, node, node.name, 'export function', violations);
  } else if (ts.isClassDeclaration(node)) {
    checkNamedDeclaration(ctx, node, node.name, 'export class', violations);
  } else if (ts.isInterfaceDeclaration(node)) {
    checkNamedDeclaration(ctx, node, node.name, 'export interface', violations);
  } else if (ts.isTypeAliasDeclaration(node)) {
    checkNamedDeclaration(ctx, node, node.name, 'export type', violations);
  } else if (ts.isEnumDeclaration(node)) {
    checkNamedDeclaration(ctx, node, node.name, 'export enum', violations);
  } else if (ts.isModuleDeclaration(node)) {
    checkNamedDeclaration(
      ctx,
      node,
      ts.isIdentifier(node.name) ? node.name : undefined,
      'export namespace/module',
      violations,
    );
  } else if (ts.isNamespaceExportDeclaration(node)) {
    checkNamespaceExport(ctx, node, violations);
  } else if (ts.isVariableStatement(node)) {
    checkVariableStatement(ctx, node, violations);
  } else if (ts.isExportDeclaration(node)) {
    checkNamedExports(ctx, node, violations);
  } else if (ts.isExportAssignment(node)) {
    checkExportAssignment(ctx, node, violations);
  } else if (ts.isImportEqualsDeclaration(node)) {
    checkImportEqualsExport(ctx, node, violations);
  } else if (ts.isExpressionStatement(node)) {
    checkCommonJSExport(ctx, node, violations);
  }
}

/**
 * Collect all exported identifiers in a source file that are declared locally
 * (not re-exports from another module) and whose name contains "Gemini".
 *
 * Runs a provenance pre-pass (F3) to track shadows of `module`, `exports`,
 * and `Object` so that references to shadowed globals are not treated as
 * CommonJS export targets. Also collects a map of local variable bindings
 * to static object literals so that identifier assignments can be resolved
 * (F2).
 */
export function scanGeminiExports(
  sourceFile: ts.SourceFile,
  relPath: string,
): GeminiExportViolation[] {
  const ctx: ExportScanContext = {
    sourceFile,
    relPath,
    globalShadows: new GlobalShadowResolver(),
    objectLiteralBindings: collectObjectLiteralBindings(sourceFile),
  };

  // Pre-pass: collect shadow entries for CJS global names.
  collectExportShadows(ctx, sourceFile);

  // Detection pass: find Gemini-named exports using scope-aware resolution.
  const violations: GeminiExportViolation[] = [];
  const visit = (node: ts.Node): void => {
    dispatchExportCheck(ctx, node, violations);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}
