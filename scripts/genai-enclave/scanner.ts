/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AST-precise scanner for @google/genai imports and Gemini-named exports.
 *
 * Uses the TypeScript compiler API to detect ALL import forms:
 *   - static import declarations (including type-only)
 *   - dynamic import() expressions
 *   - import-equals with ExternalModuleReference (require)
 *   - export ... from re-exports
 *   - export * from re-exports
 *   - import() in type position (ImportTypeNode)
 *
 * Additionally detects **computed** dynamic import()/require() calls — where
 * the specifier is NOT a string literal (e.g. `import(packageVar)`). A
 * computed specifier outside an enclave is a distinct violation: it could
 * smuggle `@google/genai` past the guard since the module name is resolved at
 * runtime.
 *
 * Also detects exported identifiers whose name contains "Gemini"
 * (case-insensitive), covering: functions, classes, interfaces, type aliases,
 * variables, enums (and const enums), namespaces/modules, re-export aliases,
 * and export default of a bare identifier.
 */

import ts from 'typescript';
import { GENAI_PACKAGE, containsGemini } from './config.ts';

export interface GenaiImportViolation {
  readonly kind: 'genai-import';
  readonly file: string;
  readonly line: number;
  readonly importForm: string;
  readonly specifier: string;
}

export interface ComputedImportViolation {
  readonly kind: 'computed-import';
  readonly file: string;
  readonly line: number;
  readonly importForm: string;
}

export interface GeminiExportViolation {
  readonly kind: 'gemini-export';
  readonly file: string;
  readonly line: number;
  readonly exportName: string;
  readonly exportForm: string;
}

export type Violation =
  | GenaiImportViolation
  | ComputedImportViolation
  | GeminiExportViolation;

const REQUIRE_IDENTIFIER = 'require';

/**
 * Extract the string literal text from a TS node, or null if it is not a
 * string literal or no-substitution template literal.
 */
function literalText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * Recursively unwrap parenthesized expressions to find the core expression.
 */
function unwrapParentheses(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Classify the import/export form of a TS node for diagnostic output.
 */
function classifyForm(node: ts.Node): string {
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
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return 'dynamic import()';
    }
    return 'require()';
  }
  return 'unknown-import-form';
}

/**
 * Result of examining a CallExpression that is a dynamic import() or require().
 */
type CallSpecResult =
  | { readonly type: 'genai'; readonly specifier: string }
  | { readonly type: 'computed' }
  | { readonly type: 'other' };

/**
 * Examine a dynamic import() or require() CallExpression and classify it.
 * Returns `'genai'` if the specifier is a string literal referencing
 * @google/genai, `'computed'` if the specifier is NOT a string literal (a
 * computed form that could smuggle any package), or `'other'` if it is a
 * string literal for a different package.
 */
function classifyCallSpecifier(expr: ts.CallExpression): CallSpecResult {
  const arg = expr.arguments[0];
  if (arg === undefined) {
    return { type: 'other' };
  }
  const text = literalText(arg);
  if (text === null) {
    return { type: 'computed' };
  }
  if (isGenaiSpecifier(text)) {
    return { type: 'genai', specifier: text };
  }
  return { type: 'other' };
}

/**
 * Check whether a CallExpression is a dynamic import() or bare require().
 */
function isImportOrRequireCall(expr: ts.CallExpression): boolean {
  if (expr.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  return (
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === REQUIRE_IDENTIFIER
  );
}

/**
 * Is `specifier` a reference to the @google/genai package (exact or subpath)?
 * Does NOT match @google/genai-utils or @google/genaisdk.
 */
export function isGenaiSpecifier(specifier: string): boolean {
  return (
    specifier === GENAI_PACKAGE || specifier.startsWith(GENAI_PACKAGE + '/')
  );
}

/**
 * Collect all @google/genai import violations AND computed-import violations
 * in a single source file.
 *
 * - **genai-import**: any import/export form with a string-literal specifier
 *   that references @google/genai.
 * - **computed-import**: any dynamic import() or require() call whose
 *   specifier is NOT a string literal (could smuggle @google/genai at runtime).
 *
 * Returns the violations (empty if none).
 */
export function scanGenaiImports(
  sourceFile: ts.SourceFile,
  relPath: string,
): Violation[] {
  const violations: Violation[] = [];
  const visit = (node: ts.Node): void => {
    const violation = findGenaiImportViolation(sourceFile, relPath, node);
    if (violation !== null) violations.push(violation);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function findGenaiImportViolation(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.Node,
): Violation | null {
  let specifier: string | null = null;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    specifier = literalText(node.moduleSpecifier);
  } else if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    specifier = literalText(node.moduleReference.expression);
  } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    specifier = literalText(node.argument.literal);
  }

  if (specifier !== null && isGenaiSpecifier(specifier)) {
    return createImportViolation(sourceFile, relPath, node, specifier);
  }

  const unwrapped = ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node)
    : node;
  if (!ts.isCallExpression(unwrapped) || !isImportOrRequireCall(unwrapped)) {
    return null;
  }
  const result = classifyCallSpecifier(unwrapped);
  if (result.type === 'genai') {
    return createImportViolation(
      sourceFile,
      relPath,
      unwrapped,
      result.specifier,
    );
  }
  return result.type === 'computed'
    ? createComputedViolation(sourceFile, relPath, unwrapped)
    : null;
}

/**
 * Create a genai-import violation for a node with a known string specifier.
 */
function createImportViolation(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.Node,
  specifier: string,
): GenaiImportViolation {
  const line =
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return {
    kind: 'genai-import',
    file: relPath,
    line,
    importForm: classifyForm(node),
    specifier,
  };
}

/**
 * Create a computed-import violation for a dynamic import()/require() call
 * with a non-string-literal specifier.
 */
function createComputedViolation(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.CallExpression,
): ComputedImportViolation {
  const line =
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return {
    kind: 'computed-import',
    file: relPath,
    line,
    importForm:
      node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? 'dynamic import()'
        : 'require()',
  };
}

/**
 * Extract all binding names from a destructuring pattern (object or array).
 * Handles nested patterns and renamed bindings ({ prop: localName }).
 */
function collectBindingNames(name: ts.BindingName): string[] {
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
function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Record a Gemini-named export violation.
 */
function addExportViolation(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.Node,
  exportName: string,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  const line =
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  violations.push({
    kind: 'gemini-export',
    file: relPath,
    line,
    exportName,
    exportForm,
  });
}

/**
 * Check a named-declaration node (function/class/interface/type alias/enum/
 * namespace/module) for a Gemini-containing exported name.
 */
function checkNamedDeclaration(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.Node,
  name: ts.Identifier | undefined,
  exportForm: string,
  violations: GeminiExportViolation[],
): void {
  if (!hasExportModifier(node) || name === undefined) return;
  if (containsGemini(name.text)) {
    addExportViolation(
      sourceFile,
      relPath,
      node,
      name.text,
      exportForm,
      violations,
    );
  }
}

/**
 * Check an exported variable statement for Gemini-containing binding names.
 */
function checkVariableStatement(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.VariableStatement,
  violations: GeminiExportViolation[],
): void {
  if (!hasExportModifier(node)) return;
  for (const decl of node.declarationList.declarations) {
    for (const name of collectBindingNames(decl.name)) {
      if (containsGemini(name)) {
        addExportViolation(
          sourceFile,
          relPath,
          node,
          name,
          'export const/let/var',
          violations,
        );
      }
    }
  }
}

/**
 * Check a named export declaration (`export { Foo as GeminiBar }`) for
 * Gemini-containing exported names.
 */
function checkNamedExports(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.ExportDeclaration,
  violations: GeminiExportViolation[],
): void {
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    if (containsGemini(element.name.text)) {
      addExportViolation(
        sourceFile,
        relPath,
        node,
        element.name.text,
        'export { name }',
        violations,
      );
    }
  }
}

/**
 * Check an export assignment (`export default GeminiFoo`) for a
 * Gemini-containing exported identifier. Only flags when the default export
 * expression is a bare identifier (e.g. `export default GeminiProvider;`),
 * since that reveals the local name. Anonymous default exports of classes or
 * functions are checked if their declaration name contains "Gemini".
 */
function checkExportAssignment(
  sourceFile: ts.SourceFile,
  relPath: string,
  node: ts.ExportAssignment,
  violations: GeminiExportViolation[],
): void {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && containsGemini(expr.text)) {
    addExportViolation(
      sourceFile,
      relPath,
      node,
      expr.text,
      'export default',
      violations,
    );
  }
}

/**
 * Collect all exported identifiers in a source file that are declared locally
 * (not re-exports from another module) and whose name contains "Gemini".
 *
 * Captures: exported function/class/interface/type/variable/enum/namespace/
 * module names, plus re-export aliases.
 */
export function scanGeminiExports(
  sourceFile: ts.SourceFile,
  relPath: string,
): GeminiExportViolation[] {
  const violations: GeminiExportViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        node.name,
        'export function',
        violations,
      );
    } else if (ts.isClassDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        node.name,
        'export class',
        violations,
      );
    } else if (ts.isInterfaceDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        node.name,
        'export interface',
        violations,
      );
    } else if (ts.isTypeAliasDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        node.name,
        'export type',
        violations,
      );
    } else if (ts.isEnumDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        node.name,
        'export enum',
        violations,
      );
    } else if (ts.isModuleDeclaration(node)) {
      checkNamedDeclaration(
        sourceFile,
        relPath,
        node,
        ts.isIdentifier(node.name) ? node.name : undefined,
        'export namespace/module',
        violations,
      );
    } else if (ts.isVariableStatement(node)) {
      checkVariableStatement(sourceFile, relPath, node, violations);
    } else if (ts.isExportDeclaration(node)) {
      checkNamedExports(sourceFile, relPath, node, violations);
    } else if (ts.isExportAssignment(node)) {
      checkExportAssignment(sourceFile, relPath, node, violations);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/**
 * Parse a source file into a TypeScript SourceFile AST.
 */
export function parseSourceFile(
  filePath: string,
  sourceText: string,
): ts.SourceFile {
  const scriptKind = inferScriptKind(filePath);
  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

/**
 * Determine the appropriate ScriptKind from the file extension, including
 * `.mts`, `.cts`, `.d.ts`, `.d.mts`, `.d.cts`, `.tsx`, and `.jsx`.
 */
function inferScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/.test(lower)) return ts.ScriptKind.JS;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

export function getLine(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}
