/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AST helper functions shared across the CLI import boundary scanners.
 *
 * These functions operate on TypeScript compiler API nodes and provide
 * specifier extraction, classification, and deep-import detection used by
 * the import scanner, getConfig scanner, and banned-runtime-assembly scanner.
 */

import ts from 'typescript';
import { RUNTIME_PACKAGES, PUBLIC_SUBPATHS_BY_PACKAGE } from './config.ts';

export function getLine(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Returns true if `specifier` is a deep sub-path of a runtime package that is
 * NOT a documented public subpath for THAT package.
 */
export function isDisallowedDeepImport(specifier: string): boolean {
  for (const pkg of RUNTIME_PACKAGES) {
    if (specifier === pkg) return false; // bare root is public
    if (specifier.startsWith(pkg + '/')) {
      const subPath = specifier.slice(pkg.length + 1);
      const publicForPkg = PUBLIC_SUBPATHS_BY_PACKAGE[pkg] ?? [];
      if (publicForPkg.includes(subPath)) return false;
      return true;
    }
  }
  return false;
}

export function isAllowed(
  relFile: string,
  specifier: string,
  allowlist: Record<string, readonly string[]>,
): boolean {
  const allowed = allowlist[relFile];
  return Boolean(allowed && allowed.includes(specifier));
}

/**
 * Predicate: is `node` a `vi.mock(...)` call expression?
 *
 * The receiver MUST be the identifier `vi` (not just any `.mock(...)` call),
 * so `somethingElse.mock('...')` is NOT a vi.mock call.
 */
export function isViMockCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'mock' &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'vi'
  );
}

export function literalSpecifierText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

/**
 * Extract the module specifier string from any import-bearing node, or null.
 *
 * Returns null for non-literal specifiers (e.g. `vi.mock(someVar)`), so the
 * caller can separately flag non-literal vi.mock calls.
 */
export function specifierOf(node: ts.Node): string | null {
  if (!node) return null;
  if (ts.isImportDeclaration(node)) {
    const m = node.moduleSpecifier;
    return literalSpecifierText(m);
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    node.moduleReference &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const expr = node.moduleReference.expression;
    return literalSpecifierText(expr);
  }
  const unwrapped = ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node)
    : node;
  if (ts.isCallExpression(unwrapped)) {
    if (unwrapped.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = unwrapped.arguments[0];
      return literalSpecifierText(arg);
    }
    if (isViMockCall(unwrapped)) {
      const arg = unwrapped.arguments[0];
      return literalSpecifierText(arg);
    }
  }
  return null;
}

/**
 * Detect a `vi.mock(...)` call whose first argument is NOT a string literal.
 *
 * Returns the CallExpression node when it matches, or null.
 */
export function isNonLiteralViMock(node: ts.Node): ts.CallExpression | null {
  if (!isViMockCall(node)) return null;
  const arg = node.arguments[0];
  if (arg !== undefined && literalSpecifierText(arg) === null) {
    return node;
  }
  return null;
}

export function isNonLiteralDynamicImport(
  node: ts.Node,
): ts.CallExpression | null {
  const unwrapped = ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node)
    : node;
  if (!ts.isCallExpression(unwrapped)) return null;
  if (unwrapped.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const arg = unwrapped.arguments[0];
  if (arg !== undefined && literalSpecifierText(arg) === null) {
    return unwrapped;
  }
  return null;
}

/**
 * True when `moduleName` names a runtime-assembly package (bare root or any
 * deep subpath). Shared by the static-import guard and the dynamic
 * import()/require() destructuring guard.
 */
export function isRuntimeAssemblyModuleName(moduleName: string): boolean {
  return [
    '@vybestack/llxprt-code-core',
    '@vybestack/llxprt-code-providers',
    '@vybestack/llxprt-code-agents',
  ].some(
    (packageName) =>
      moduleName === packageName || moduleName.startsWith(`${packageName}/`),
  );
}

export function isRuntimeAssemblyPackage(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return false;
  }
  return isRuntimeAssemblyModuleName(node.moduleSpecifier.text);
}

/**
 * If `init` is a dynamic `import('<pkg>')` (optionally awaited) or a CommonJS
 * `require('<pkg>')` whose static string specifier names a runtime-assembly
 * package, return that specifier; otherwise undefined.
 */
export function getRuntimeAssemblyModuleFromInitializer(
  init: ts.Expression | undefined,
): string | undefined {
  if (init === undefined) {
    return undefined;
  }
  const unwrapped = ts.isParenthesizedExpression(init)
    ? unwrapParentheses(init)
    : init;
  const expr: ts.Expression = ts.isAwaitExpression(unwrapped)
    ? unwrapped.expression
    : unwrapped;
  if (!ts.isCallExpression(expr)) {
    return undefined;
  }
  const callee = expr.expression;
  const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
  if (!isDynamicImport && !isRequire) {
    return undefined;
  }
  const specifier = literalSpecifierText(expr.arguments[0]);
  if (specifier === null) {
    return undefined;
  }
  return isRuntimeAssemblyModuleName(specifier) ? specifier : undefined;
}

/**
 * Extract the ORIGINAL (source) exported name of an object-destructure binding
 * element.
 */
export function bindingElementSourceName(
  element: ts.BindingElement,
): string | undefined {
  const source = element.propertyName ?? element.name;
  if (ts.isIdentifier(source) || ts.isStringLiteral(source)) {
    return source.text;
  }
  return undefined;
}

export function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Create a TypeScript SourceFile from a file path, handling .tsx vs .ts.
 * Callers are responsible for guarding file-read failures before invoking
 * this function (the source text is supplied as an argument).
 */
export function createSourceFile(
  filePath: string,
  sourceText: string,
): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
