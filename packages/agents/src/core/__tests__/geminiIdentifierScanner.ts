/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AST-based Gemini identifier scanner.
 *
 * Uses the TypeScript compiler API to parse each source file exactly once and
 * extract declared identifiers (exported and non-exported) from:
 * - Variable declarations (const, let, var — including arrow functions)
 * - Function declarations (sync, async)
 * - Class declarations (including abstract)
 * - Interface declarations
 * - Type alias declarations
 * - Enum declarations and enum members
 * - `declare` forms (declare const/function/class/enum)
 * - Default exports (function/class)
 * - Re-export forms (`export { Name }`, `export { X as Name }`)
 * - Class methods (sync, async, private)
 * - Class properties (including private and readonly)
 * - Getters and setters
 * - Method and property signatures (interfaces/type literals bodies)
 * - Function/method/arrow-function parameters (including destructured)
 * - Import aliases (named import with alias, default import alias, namespace import alias)
 * - Named class/function expressions
 * - Nested binding identifiers (destructuring patterns)
 *
 * Comments, string literals, and template literals are never parsed as
 * identifiers because the AST naturally separates them from declarations.
 *
 * This scanner is used by providerAgnosticNaming.test.ts to enforce the
 * provider-agnostic naming architecture rule.
 */

import ts from 'typescript';

/** A declared identifier found by the scanner. */
export interface DeclaredIdentifier {
  /** The identifier name as it appears in source. */
  name: string;
  /** 1-based line number in the source file. */
  line: number;
  /** The kind of declaration (e.g. "class", "function", "variable"). */
  kind: string;
  /** True if the declaration is exported. */
  exported: boolean;
  /** Module specifier for import and named re-export declarations. */
  moduleSpecifier?: string;
  /** Original imported or re-exported symbol before local aliasing. */
  importedSymbol?: string;
  /** Public name introduced by a named re-export. */
  exportedSymbol?: string;
}

const GEMINI_PATTERN = /gemini/i;

/** Check if an identifier name contains "gemini" (case-insensitive). */
export function isGeminiName(name: string): boolean {
  return GEMINI_PATTERN.test(name);
}

/**
 * Case-insensitive prefilter: returns true if the file is a candidate for
 * Gemini identifier scanning. Files whose raw source text (and filename) do
 * not contain "gemini" at all cannot contain a Gemini identifier, so they
 * can be skipped before AST creation. This preserves correctness because any
 * file that DOES contain a Gemini identifier must contain the substring
 * "gemini" somewhere in its text or name.
 */
export function shouldScanForGemini(text: string, filePath: string): boolean {
  if (GEMINI_PATTERN.test(text)) {
    return true;
  }
  return GEMINI_PATTERN.test(filePath);
}

/**
 * Check whether a node has a modifier of the given syntax kind (e.g. Export,
 * Default). Uses `=== true` so the returned boolean is never nullable.
 */
function hasModifierKind(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  return ts.getModifiers(node)?.some((m) => m.kind === kind) === true;
}

/**
 * Check whether a VariableDeclaration is exported by traversing its parent
 * chain: VariableDeclaration -> VariableDeclarationList -> VariableStatement.
 * The `export` modifier lives on the VariableStatement, not on the
 * VariableDeclaration or VariableDeclarationList. This corrects the previous
 * bug where `node.parent` (VariableDeclarationList) was checked directly for
 * `isVariableStatement`.
 */
function isExportedByVariableStatement(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return false;
  }
  const stmt = list.parent;
  if (!ts.isVariableStatement(stmt)) {
    return false;
  }
  return hasModifierKind(stmt, ts.SyntaxKind.ExportKeyword);
}

/**
 * Determine whether a declaration node is exported — either via its own
 * `export`/`export default` modifier or via an enclosing VariableStatement.
 */
function isExported(node: ts.Node): boolean {
  if (ts.isVariableDeclaration(node)) {
    return isExportedByVariableStatement(node);
  }
  return (
    hasModifierKind(node, ts.SyntaxKind.ExportKeyword) ||
    hasModifierKind(node, ts.SyntaxKind.DefaultKeyword)
  );
}

/** Convert a character offset into a 1-based line number. */
function getLine(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Attempt to extract a Gemini-matching declared identifier from a name node.
 * Returns `undefined` when the node is missing, is not an Identifier, or the
 * name does not contain "gemini".
 */
function tryExtractGeminiIdentifier(
  nameNode: ts.Node | undefined,
  kind: string,
  exported: boolean,
  sf: ts.SourceFile,
): DeclaredIdentifier | undefined {
  if (nameNode === undefined || !ts.isIdentifier(nameNode)) {
    return undefined;
  }
  const name = nameNode.text;
  if (!isGeminiName(name)) {
    return undefined;
  }
  return {
    name,
    line: getLine(sf, nameNode.getStart()),
    kind,
    exported,
  };
}

/**
 * Collect a Gemini-matching identifier from an optional name node into the
 * results array (no-op when the name is missing or not Gemini-prefixed).
 */
function collectNamedDeclaration(
  nameNode: ts.Node | undefined,
  kind: string,
  exported: boolean,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  const hit = tryExtractGeminiIdentifier(nameNode, kind, exported, sf);
  if (hit !== undefined) {
    results.push(hit);
  }
}

/**
 * Collect Gemini-matching identifiers from a binding element, recursing into
 * nested destructuring patterns.
 */
function collectBindingElement(
  el: ts.Node,
  kind: string,
  exported: boolean,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (!ts.isBindingElement(el)) {
    return;
  }
  collectBindingName(el.name, kind, exported, sf, results);
}

/**
 * Collect Gemini-matching identifiers from a binding name, handling both
 * simple identifier names and destructuring patterns (object and array),
 * including nested patterns.
 */
function collectBindingName(
  name: ts.BindingName,
  kind: string,
  exported: boolean,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (ts.isIdentifier(name)) {
    collectNamedDeclaration(name, kind, exported, sf, results);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      collectBindingElement(el, kind, exported, sf, results);
    }
  }
}

/**
 * Collect Gemini-matching identifiers from function parameters, handling
 * destructuring patterns within parameters.
 */
function collectParameters(
  params: ts.NodeArray<ts.ParameterDeclaration>,
  exported: boolean,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  for (const param of params) {
    collectBindingName(param.name, 'parameter', exported, sf, results);
  }
}

/**
 * Collect a Gemini-matching identifier from an ExportSpecifier. The exported
 * name is `node.name` (the local/aliased name is `propertyName`). For
 * `export { X as GeminiClient }`, name=GeminiClient. For `export { GeminiClient }`,
 * name=GeminiClient.
 */
function collectExportSpecifier(
  node: ts.ExportSpecifier,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  const exportedName = node.name.text;
  const originalName = node.propertyName?.text ?? exportedName;
  const declaration = node.parent.parent;
  const moduleSpecifier =
    ts.isExportDeclaration(declaration) &&
    declaration.moduleSpecifier !== undefined &&
    ts.isStringLiteral(declaration.moduleSpecifier)
      ? declaration.moduleSpecifier.text
      : undefined;

  if (isGeminiName(exportedName)) {
    results.push({
      name: exportedName,
      line: getLine(sf, node.name.getStart()),
      kind: 'export-named',
      exported: true,
      moduleSpecifier,
      importedSymbol: originalName,
      exportedSymbol: exportedName,
    });
  }
  if (originalName !== exportedName && isGeminiName(originalName)) {
    results.push({
      name: originalName,
      line: getLine(sf, node.propertyName?.getStart() ?? node.name.getStart()),
      kind: 'export-source',
      exported: true,
      moduleSpecifier,
      importedSymbol: originalName,
      exportedSymbol: exportedName,
    });
  }
}

function collectNamespaceExport(
  node: ts.NamespaceExport,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (!isGeminiName(node.name.text)) {
    return;
  }
  const declaration = node.parent;
  const moduleSpecifier =
    ts.isExportDeclaration(declaration) &&
    declaration.moduleSpecifier !== undefined &&
    ts.isStringLiteral(declaration.moduleSpecifier)
      ? declaration.moduleSpecifier.text
      : undefined;
  results.push({
    name: node.name.text,
    line: getLine(sf, node.name.getStart()),
    kind: 'export-namespace',
    exported: true,
    moduleSpecifier,
    importedSymbol: '*',
    exportedSymbol: node.name.text,
  });
}

function collectExportAssignment(
  node: ts.ExportAssignment,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (!ts.isIdentifier(node.expression)) {
    return;
  }
  collectNamedDeclaration(
    node.expression,
    node.isExportEquals === true ? 'export-equals' : 'export-default',
    true,
    sf,
    results,
  );
}

/**
 * Collect Gemini-matching identifiers from an ImportClause's named bindings.
 * Carries the module specifier and imported symbol for exact tuple matching.
 */
function collectImportClause(
  node: ts.ImportClause,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  const moduleSpecifier = resolveModuleSpecifier(node);
  // Default import: `import GeminiClient from '...'`
  if (node.name !== undefined) {
    const name = node.name;
    if (isGeminiName(name.text)) {
      results.push({
        name: name.text,
        line: getLine(sf, name.getStart()),
        kind: 'import-default',
        exported: false,
        moduleSpecifier,
        importedSymbol: 'default',
      });
    }
  }
  const bindings = node.namedBindings;
  if (bindings === undefined) {
    return;
  }
  if (ts.isNamespaceImport(bindings)) {
    // `import * as GeminiModule from '...'`
    const name = bindings.name;
    if (isGeminiName(name.text)) {
      results.push({
        name: name.text,
        line: getLine(sf, name.getStart()),
        kind: 'import-namespace',
        exported: false,
        moduleSpecifier,
        importedSymbol: '*',
      });
    }
    return;
  }
  if (ts.isNamedImports(bindings)) {
    // `import { Client as GeminiClient, GeminiClient } from '...'`
    for (const spec of bindings.elements) {
      const localName = spec.name;
      const importedName = spec.propertyName ?? localName;
      if (isGeminiName(localName.text) || isGeminiName(importedName.text)) {
        results.push({
          name: localName.text,
          line: getLine(sf, localName.getStart()),
          kind: 'import-named',
          exported: false,
          moduleSpecifier,
          importedSymbol: importedName.text,
        });
      }
    }
  }
}

/**
 * Extract the module specifier string from an ImportClause by traversing to
 * its parent ImportDeclaration. Returns undefined if the specifier cannot be
 * resolved (e.g. the node is detached from its parent).
 */
function resolveModuleSpecifier(node: ts.ImportClause): string | undefined {
  const parent = node.parent;
  if (
    ts.isImportDeclaration(parent) &&
    ts.isStringLiteral(parent.moduleSpecifier)
  ) {
    return parent.moduleSpecifier.text;
  }
  return undefined;
}

/**
 * Determine the kind label for a class member.
 */
function classMemberKind(member: ts.ClassElement): string | undefined {
  if (ts.isMethodDeclaration(member)) {
    return 'method';
  }
  if (ts.isPropertyDeclaration(member)) {
    return 'property';
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return 'getter';
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return 'setter';
  }
  return undefined;
}

/**
 * Collect Gemini-matching identifiers from class members: methods,
 * properties, getters, setters, and constructors.
 *
 * Constructors carry parameters (including TypeScript parameter properties
 * like `constructor(public geminiClient: unknown)`) that introduce declared
 * identifiers into the class scope.
 */
function collectClassMember(
  member: ts.ClassElement,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  const exported = hasModifierKind(member, ts.SyntaxKind.ExportKeyword);
  // Constructors introduce parameter properties and plain parameters.
  if (ts.isConstructorDeclaration(member)) {
    collectParameters(member.parameters, exported, sf, results);
    return;
  }
  const name = member.name;
  const kind = classMemberKind(member);
  if (kind === undefined) {
    return;
  }
  if (name !== undefined && ts.isIdentifier(name)) {
    collectNamedDeclaration(name, kind, exported, sf, results);
  }
  // Collect parameters from methods, getters, and setters
  if (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    collectParameters(member.parameters, exported, sf, results);
  }
}

/**
 * Collect Gemini-matching identifiers from type member signatures: method
 * signatures, property signatures, call signatures, and construct signatures
 * (interfaces and type literals).
 */
function collectTypeMember(
  member: ts.TypeElement,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  const name = member.name;
  if (ts.isMethodSignature(member) || ts.isPropertySignature(member)) {
    if (name !== undefined && ts.isIdentifier(name)) {
      collectNamedDeclaration(
        name,
        ts.isMethodSignature(member)
          ? 'method-signature'
          : 'property-signature',
        false,
        sf,
        results,
      );
    }
    // Collect parameters from method signatures
    if (ts.isMethodSignature(member)) {
      collectParameters(member.parameters, false, sf, results);
    }
    return;
  }
  // Call signatures and construct signatures carry parameters without a
  // declared name of their own — only their parameters introduce identifiers.
  if (
    ts.isCallSignatureDeclaration(member) ||
    ts.isConstructSignatureDeclaration(member)
  ) {
    collectParameters(member.parameters, false, sf, results);
  }
}

/**
 * Collect Gemini-matching identifiers from enum members.
 */
function collectEnumMembers(
  members: ts.NodeArray<ts.EnumMember>,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  for (const member of members) {
    if (ts.isIdentifier(member.name)) {
      collectNamedDeclaration(member.name, 'enum-member', false, sf, results);
    }
  }
}

/**
 * Collect identifiers from signature-bearing nodes: function declarations,
 * arrow functions, class members, type members, and type-level function types.
 * Extracted from collectFromNode to keep the dispatch function under the
 * max-lines-per-function limit.
 */
function collectSignatureNodes(
  node: ts.Node,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (ts.isFunctionDeclaration(node)) {
    const exported = isExported(node);
    collectNamedDeclaration(node.name, 'function', exported, sf, results);
    collectParameters(node.parameters, exported, sf, results);
    return;
  }
  if (ts.isArrowFunction(node)) {
    collectParameters(node.parameters, false, sf, results);
    return;
  }
  if (ts.isTypeElement(node)) {
    collectTypeMember(node, sf, results);
    return;
  }
  // FunctionTypeNode: `type T = (param) => void` — a type-level function type
  // whose parameters introduce identifiers in its type scope.
  if (ts.isFunctionTypeNode(node)) {
    collectParameters(node.parameters, false, sf, results);
  }
}

/**
 * Collect identifiers from expression nodes: class expressions and function
 * expressions. Extracted from collectFromNode.
 *
 * Function expressions carry parameters that introduce identifiers into their
 * local scope, so their parameters are collected alongside their name.
 */
function collectExpressionNodes(
  node: ts.Node,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (ts.isClassExpression(node)) {
    if (node.name !== undefined) {
      collectNamedDeclaration(
        node.name,
        'class-expression',
        false,
        sf,
        results,
      );
    }
    return;
  }
  if (ts.isFunctionExpression(node)) {
    if (node.name !== undefined) {
      collectNamedDeclaration(
        node.name,
        'function-expression',
        false,
        sf,
        results,
      );
    }
    collectParameters(node.parameters, false, sf, results);
    return;
  }
}

/**
 * Determine the kind label for an object literal member, or null if the member
 * type does not contribute a named identifier (e.g. spread assignments).
 * Extracted to avoid nested ternary expression complexity.
 */
function objectLiteralMemberKind(
  member: ts.ObjectLiteralElementLike,
): string | null {
  if (ts.isMethodDeclaration(member)) {
    return 'object-method';
  }
  if (ts.isGetAccessorDeclaration(member)) {
    return 'object-getter';
  }
  if (ts.isSetAccessorDeclaration(member)) {
    return 'object-setter';
  }
  if (
    ts.isPropertyAssignment(member) ||
    ts.isShorthandPropertyAssignment(member)
  ) {
    return 'object-property';
  }
  return null;
}

/**
 * Collect Gemini-matching identifiers from object literal members: properties
 * (including shorthand), methods, and getters/setters.
 *
 * Object literal members appear in exported const expressions like:
 *   export const Factory = {
 *     geminiClient: null,
 *     refreshGeminiTools() {},
 *   };
 */
function collectObjectLiteralMember(
  member: ts.ObjectLiteralElementLike,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  // Spread assignments ({ ...other }) have no name.
  if (member.name === undefined || !ts.isIdentifier(member.name)) {
    return;
  }
  const kind = objectLiteralMemberKind(member);
  if (kind === null) {
    return;
  }
  collectNamedDeclaration(member.name, kind, false, sf, results);
  // Collect parameters from methods, getters, setters
  const hasParams =
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member);
  if (hasParams) {
    collectParameters(member.parameters, false, sf, results);
  }
}

/**
 * Dispatch a single AST node to the appropriate identifier collector based on
 * its declaration kind. Keeps the AST walk flat — each branch is a single
 * `if`/`return`, avoiding nested control flow.
 */
function collectModuleDeclaration(
  node: ts.Node,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): boolean {
  if (!ts.isModuleDeclaration(node) || !ts.isIdentifier(node.name)) {
    return false;
  }
  collectNamedDeclaration(
    node.name,
    'namespace',
    isExported(node),
    sf,
    results,
  );
  return true;
}

function collectFromNode(
  node: ts.Node,
  sf: ts.SourceFile,
  results: DeclaredIdentifier[],
): void {
  if (ts.isVariableDeclaration(node)) {
    collectBindingName(node.name, 'variable', isExported(node), sf, results);
    return;
  }
  if (ts.isClassDeclaration(node)) {
    collectNamedDeclaration(node.name, 'class', isExported(node), sf, results);
    return;
  }
  if (ts.isClassElement(node)) {
    collectClassMember(node, sf, results);
    return;
  }
  if (ts.isInterfaceDeclaration(node)) {
    collectNamedDeclaration(
      node.name,
      'interface',
      isExported(node),
      sf,
      results,
    );
    return;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    collectNamedDeclaration(node.name, 'type', isExported(node), sf, results);
    return;
  }
  if (ts.isEnumDeclaration(node)) {
    collectNamedDeclaration(node.name, 'enum', isExported(node), sf, results);
    collectEnumMembers(node.members, sf, results);
    return;
  }
  if (ts.isExportSpecifier(node)) {
    collectExportSpecifier(node, sf, results);
    return;
  }
  if (ts.isNamespaceExport(node)) {
    collectNamespaceExport(node, sf, results);
    return;
  }
  if (ts.isExportAssignment(node)) {
    collectExportAssignment(node, sf, results);
    return;
  }
  if (collectModuleDeclaration(node, sf, results)) {
    return;
  }
  if (ts.isImportClause(node)) {
    collectImportClause(node, sf, results);
    return;
  }
  // import GeminiModule = require("./gemini.js");
  if (ts.isImportEqualsDeclaration(node)) {
    collectNamedDeclaration(
      node.name,
      'import-equals',
      isExported(node),
      sf,
      results,
    );
    return;
  }
  // Type parameters: class AgentClient<TGemini>, interface I<TGemini>, etc.
  if (ts.isTypeParameterDeclaration(node)) {
    collectNamedDeclaration(node.name, 'type-parameter', false, sf, results);
    return;
  }
  // Object literal members: { geminiClient: null, refreshGeminiTools() {} }
  if (ts.isObjectLiteralElementLike(node)) {
    collectObjectLiteralMember(node, sf, results);
    return;
  }
  collectSignatureNodes(node, sf, results);
  collectExpressionNodes(node, sf, results);
}

/**
 * Extract all declared identifiers from a parsed source file that contain
 * "gemini" (case-insensitive). Each file is parsed once; this function walks
 * the AST a single time collecting matching declarations.
 */
export function extractDeclaredIdentifiers(
  sf: ts.SourceFile,
): DeclaredIdentifier[] {
  const results: DeclaredIdentifier[] = [];
  function visit(node: ts.Node): void {
    collectFromNode(node, sf, results);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return results;
}

/**
 * Quick boolean check: does the source file contain any Gemini-prefixed
 * declared identifier?
 */
export function hasGeminiIdentifier(sf: ts.SourceFile): boolean {
  const ids = extractDeclaredIdentifiers(sf);
  return ids.length > 0;
}
