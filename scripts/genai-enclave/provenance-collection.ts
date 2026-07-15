/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * First-pass provenance collection for the genai-enclave import detector
 * (#2352).
 *
 * Two-phase scan that walks the full AST to register createRequire factory
 * aliases, bindings, namespaces, require aliases, and shadow entries before
 * violation detection runs.
 *
 * Phase A collects module-scoped entries (hoisted ESM imports, TS import-equals
 * declarations). Phase B collects block/function-scoped entries (variable
 * declarations, assignments, function shadows). Phase A must complete before
 * Phase B so that variable declarations referencing factory aliases are
 * resolved correctly regardless of source order.
 */

import ts from 'typescript';
import {
  literalText,
  collectBindingNames,
  elementAccessLiteralText,
  importedNameOfBinding,
  importedNameOfSpecifier,
  REQUIRE_IDENTIFIER,
  isFunctionLikeNode,
  objectPropertyName,
  unwrapTransparentExpressions,
} from './ast-helpers.ts';
import {
  blockScopedRange,
  getEnclosingScopeRange,
  hoistedRange,
  moduleRange,
} from './provenance.ts';
import { functionReturnIsProven } from './helper-return-analysis.ts';
import {
  type ImportScanContext,
  isCreateRequireFactoryCallee,
  isCreateRequireHelperCallee,
  isGlobalRequireRef,
  isModuleRequireRef,
  registerCreateRequireMemberHelper,
} from './import-context.ts';

/**
 * Module specifiers that export the `createRequire` factory.
 * Both the `node:`-prefixed and bare forms are accepted.
 */
const MODULE_FACTORY_SPECIFIERS: ReadonlySet<string> = new Set([
  'node:module',
  'module',
]);

// ─── Module-scope provenance collection ──────────────────────────────────────

/**
 * Register a createRequire factory alias from an ESM import of node:module.
 */
function collectModuleImport(
  ctx: ImportScanContext,
  node: ts.ImportDeclaration,
): void {
  const moduleSpecifier = literalText(node.moduleSpecifier);
  if (
    moduleSpecifier === null ||
    !MODULE_FACTORY_SPECIFIERS.has(moduleSpecifier)
  ) {
    return;
  }
  const clause = node.importClause;
  if (clause === undefined) return;
  const range = moduleRange(node);

  if (
    clause.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings)
  ) {
    for (const element of clause.namedBindings.elements) {
      if (importedNameOfSpecifier(element) === 'createRequire') {
        ctx.resolver.register(
          element.name.text,
          'factory',
          range.from,
          range.to,
          element.name.getStart(),
        );
        ctx.knownFactoryAliases.add(element.name.text);
      }
    }
  }

  if (
    clause.namedBindings !== undefined &&
    ts.isNamespaceImport(clause.namedBindings)
  ) {
    ctx.resolver.register(
      clause.namedBindings.name.text,
      'namespace',
      range.from,
      range.to,
      clause.namedBindings.name.getStart(),
    );
    ctx.knownNamespaces.add(clause.namedBindings.name.text);
  }

  if (clause.name !== undefined) {
    ctx.resolver.register(
      clause.name.text,
      'namespace',
      range.from,
      range.to,
      clause.name.getStart(),
    );
    ctx.knownNamespaces.add(clause.name.text);
  }
}

/**
 * Process a TS import-equals declaration: `import mod = require('node:module')`.
 * If the require target is node:module or module, registers the binding as a
 * namespace so `mod.createRequire(...)` is tracked. For any other target,
 * the binding is a shadow so it does not interfere with provenance.
 */
function collectImportEquals(
  ctx: ImportScanContext,
  node: ts.ImportEqualsDeclaration,
): void {
  if (!ts.isExternalModuleReference(node.moduleReference)) return;
  const refExpr = node.moduleReference.expression;
  const specifier = literalText(refExpr);
  if (specifier === null) return;
  if (!MODULE_FACTORY_SPECIFIERS.has(specifier)) return;
  const range = moduleRange(node);
  ctx.resolver.register(
    node.name.text,
    'namespace',
    range.from,
    range.to,
    node.name.getStart(),
  );
  ctx.knownNamespaces.add(node.name.text);
}

/**
 * Phase-A visitor: collect ALL module-scoped provenance entries (ESM imports
 * and TS import-equals). These are hoisted and active for the entire file.
 * Must complete before Phase B so variable declarations that reference
 * factory aliases are resolved correctly regardless of source order.
 */
export function collectModuleProvenance(
  ctx: ImportScanContext,
  node: ts.Node,
): void {
  if (ts.isImportDeclaration(node)) {
    collectModuleImport(ctx, node);
  } else if (ts.isImportEqualsDeclaration(node)) {
    collectImportEquals(ctx, node);
  }
  ts.forEachChild(node, (child) => collectModuleProvenance(ctx, child));
}

// ─── Block-scope provenance collection ──────────────────────────────────────

/**
 * Register all binding names from a declaration as the given provenance kind.
 */
function registerBindings(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  kind: 'factory' | 'binding' | 'namespace',
  range: { readonly from: number; readonly to: number },
): void {
  const declPos = declaration.name.getStart();
  for (const name of collectBindingNames(declaration.name)) {
    ctx.resolver.register(name, kind, range.from, range.to, declPos);
    if (kind === 'factory') ctx.knownFactoryAliases.add(name);
    if (kind === 'binding') ctx.knownBindings.add(name);
  }
}

/**
 * Register all binding names as require aliases.
 */
function registerRequireAliases(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  range: { readonly from: number; readonly to: number },
): void {
  const declPos = declaration.name.getStart();
  for (const name of collectBindingNames(declaration.name)) {
    ctx.resolver.register(name, 'require-alias', range.from, range.to, declPos);
  }
}

/**
 * Try to classify and register an identifier initializer. Returns true if
 * the initializer was handled (factory binding, require alias, etc.).
 */
function tryRegisterIdentifierInitializer(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression,
  range: { readonly from: number; readonly to: number },
): boolean {
  if (!ts.isIdentifier(initializer)) return false;

  // Bound require alias: `const r2 = r` where `r` is a known binding
  if (ctx.resolver.isBinding(initializer.text, initializer.getStart())) {
    registerBindings(ctx, declaration, 'binding', range);
    return true;
  }
  // Factory alias assignment: `const r = createRequire` where `createRequire`
  // is a known factory alias. Registers `r` as a factory so downstream calls
  // like `r(url)('...')` are detected.
  if (ctx.resolver.isFactoryAlias(initializer.text, initializer.getStart())) {
    registerBindings(ctx, declaration, 'factory', range);
    return true;
  }
  // Bare require alias: `const r = require` (F2)
  if (
    initializer.text === REQUIRE_IDENTIFIER &&
    isGlobalRequireRef(ctx, initializer)
  ) {
    registerRequireAliases(ctx, declaration, range);
    return true;
  }
  // Transitive require alias: `const b = a` where `a` is a known require alias
  if (ctx.resolver.isRequireAlias(initializer.text, initializer.getStart())) {
    registerRequireAliases(ctx, declaration, range);
    return true;
  }
  return false;
}

/**
 * Try to classify and register a call-expression initializer. Returns true
 * if the initializer was handled (createRequire binding, helper binding).
 */
function tryRegisterCallInitializer(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression,
  range: { readonly from: number; readonly to: number },
): boolean {
  if (!ts.isCallExpression(initializer)) return false;

  // createRequire()(...) → binding (return value of createRequire)
  if (isCreateRequireFactoryCallee(ctx, initializer.expression)) {
    registerBindings(ctx, declaration, 'binding', range);
    return true;
  }
  // Call to a scope-resolved helper that returns createRequire(...) → binding
  if (isCreateRequireHelperCallee(ctx, initializer.expression)) {
    registerBindings(ctx, declaration, 'binding', range);
    return true;
  }
  // A5: Direct arrow/function IIFE that returns createRequire(...) → binding
  // e.g. `const req = (() => createRequire(import.meta.url))();`
  //   or `const req = ((url) => createRequire(url))(import.meta.url);`
  //   or `const req = (function(url) { return createRequire(url); })(...);`
  // Parentheses around the function expression must be unwrapped.
  const iifeCallee = unwrapTransparentExpressions(initializer.expression);
  if (
    isFunctionLikeNode(iifeCallee) &&
    functionReturnsCreateRequire(ctx, iifeCallee)
  ) {
    registerBindings(ctx, declaration, 'binding', range);
    return true;
  }
  // require.bind(null) or module.require.bind(null) stored as a variable →
  // register as a require-alias so calls through it are detected (F3).
  if (isRequireBindCall(ctx, initializer)) {
    registerRequireAliases(ctx, declaration, range);
    return true;
  }
  return false;
}

/**
 * Try to classify and register a member-access initializer. Returns true if
 * the initializer was handled (module.require alias, namespace property).
 * Handles `const r = module.require` (Finding1) and `const cr = m.createRequire`.
 */
function tryRegisterMemberAccessInitializer(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression,
  range: { readonly from: number; readonly to: number },
): boolean {
  // module.require alias: `const r = module.require` (Finding1)
  if (
    ts.isPropertyAccessExpression(initializer) &&
    initializer.name.text === REQUIRE_IDENTIFIER &&
    isModuleRequireRef(ctx, initializer)
  ) {
    registerRequireAliases(ctx, declaration, range);
    return true;
  }
  // module['require'] alias: `const r = module['require']` (Finding1)
  if (
    ts.isElementAccessExpression(initializer) &&
    elementAccessLiteralText(initializer.argumentExpression) ===
      REQUIRE_IDENTIFIER &&
    isModuleRequireRef(ctx, initializer)
  ) {
    registerRequireAliases(ctx, declaration, range);
    return true;
  }
  // Property/element access from node:module namespace: `const cr = m.createRequire`
  // or `const cr = m['createRequire']`
  if (isNamespaceFactoryMember(ctx, initializer)) {
    registerBindings(ctx, declaration, 'factory', range);
    return true;
  }
  // require('node:module').createRequire — the initializer is a property
  // access on a require('node:module') call expression (Finding1).
  if (isRequireCallFactoryProperty(ctx, initializer)) {
    registerBindings(ctx, declaration, 'factory', range);
    return true;
  }
  return false;
}

/**
 * Check whether an expression is a `require('node:module')` or
 * `module.require('node:module')` (or require-alias) call whose result is
 * being used to access `.createRequire`.
 */
function isRequireCallFactoryProperty(
  ctx: ImportScanContext,
  initializer: ts.Expression | undefined,
): boolean {
  if (initializer === undefined) return false;
  const candidate = unwrapTransparentExpressions(initializer);
  if (
    !ts.isPropertyAccessExpression(candidate) &&
    !ts.isElementAccessExpression(candidate)
  ) {
    return false;
  }
  const memberName = ts.isPropertyAccessExpression(candidate)
    ? candidate.name.text
    : elementAccessLiteralText(candidate.argumentExpression);
  if (memberName !== 'createRequire') return false;
  return isNodeModuleRequireInitializer(ctx, candidate.expression);
}

/**
 * Check whether a CallExpression is a `require.bind(...)` or
 * `module.require.bind(...)` call whose result (a bound require function) is
 * being stored in a variable. Such a stored alias is a require-alias.
 */
function isRequireBindCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  const callee = expr.expression;
  // require.bind(...) / require['bind'](...)
  if (
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 'bind') ||
    (ts.isElementAccessExpression(callee) &&
      elementAccessLiteralText(callee.argumentExpression) === 'bind')
  ) {
    if (isGlobalRequireRef(ctx, callee.expression)) {
      return true;
    }
    // module.require.bind(...) / module['require']['bind'](...)
    return isModuleRequireRef(ctx, callee.expression);
  }
  return false;
}

/**
 * Check if an initializer is `require('node:module')` or `require('module')`.
 * Also detects `module.require('node:module')` and calls through a
 * module.require alias (Finding1).
 */
function isNodeModuleRequireInitializer(
  ctx: ImportScanContext,
  initializer: ts.Expression | undefined,
): initializer is ts.CallExpression {
  if (initializer === undefined || !ts.isCallExpression(initializer))
    return false;
  // Bare require('node:module')
  if (
    ts.isIdentifier(initializer.expression) &&
    isGlobalRequireRef(ctx, initializer.expression) &&
    MODULE_FACTORY_SPECIFIERS.has(literalText(initializer.arguments[0]) ?? '')
  ) {
    return true;
  }
  // module.require('node:module')
  if (isModuleRequireRef(ctx, initializer.expression)) {
    return MODULE_FACTORY_SPECIFIERS.has(
      literalText(initializer.arguments[0]) ?? '',
    );
  }
  // Call through a module.require alias: `const r = module.require; r('node:module')`
  if (
    ts.isIdentifier(initializer.expression) &&
    ctx.resolver.isRequireAlias(
      initializer.expression.text,
      initializer.getStart(),
    )
  ) {
    return MODULE_FACTORY_SPECIFIERS.has(
      literalText(initializer.arguments[0]) ?? '',
    );
  }
  return false;
}

/**
 * Process a CJS require of node:module: `const { createRequire } = require('node:module')`.
 * Registers factory aliases from destructuring, or a namespace binding from
 * a whole-module acquisition.
 */
function collectCjsModuleRequire(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
  range: { readonly from: number; readonly to: number },
): void {
  if (!isNodeModuleRequireInitializer(ctx, declaration.initializer)) return;
  const name = declaration.name;
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      if (importedNameOfBinding(element) === 'createRequire') {
        const localName = element.name.getText();
        ctx.resolver.register(
          localName,
          'factory',
          range.from,
          range.to,
          element.name.getStart(),
        );
        ctx.knownFactoryAliases.add(localName);
      }
    }
    return;
  }
  if (ts.isIdentifier(name)) {
    ctx.resolver.register(
      name.text,
      'namespace',
      range.from,
      range.to,
      name.getStart(),
    );
    ctx.knownNamespaces.add(name.text);
  }
}

/**
 * Compute the active provenance range for a variable declaration.
 *
 * - Module-scoped declarations (direct child of SourceFile) are active from
 *   position 0, conservatively covering TDZ so forward references are caught.
 * - `var` declarations are hoisted to their function scope.
 * - `const`/`let` inside a block are active from the declaration position to
 *   the end of that block.
 */
function variableDeclarationRange(declaration: ts.VariableDeclaration): {
  readonly from: number;
  readonly to: number;
} {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list)) {
    return blockScopedRange(declaration);
  }
  const variableStatement = list.parent;
  const isModuleScoped =
    variableStatement !== undefined &&
    variableStatement.parent !== undefined &&
    ts.isSourceFile(variableStatement.parent);
  if (isModuleScoped) {
    return moduleRange(declaration);
  }
  const isVar = (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
  return isVar ? hoistedRange(declaration) : blockScopedRange(declaration);
}

/**
 * Check whether `initializer` is a member access on a node:module namespace
 * binding whose member name is `createRequire` (either via property access
 * `m.createRequire` or element access `m['createRequire']`). Consolidates
 * the logic previously duplicated in isNamespaceFactoryProperty and
 * isNamespaceFactoryElement.
 */
function isNamespaceFactoryMember(
  ctx: ImportScanContext,
  initializer: ts.Expression | undefined,
): boolean {
  if (initializer === undefined) return false;
  const candidate = unwrapTransparentExpressions(initializer);
  if (ts.isPropertyAccessExpression(candidate)) {
    if (candidate.name.text !== 'createRequire') return false;
    const namespace = unwrapTransparentExpressions(candidate.expression);
    return (
      ts.isIdentifier(namespace) &&
      ctx.resolver.isNamespace(namespace.text, namespace.getStart())
    );
  }
  if (ts.isElementAccessExpression(candidate)) {
    if (
      elementAccessLiteralText(candidate.argumentExpression) !== 'createRequire'
    ) {
      return false;
    }
    const namespace = unwrapTransparentExpressions(candidate.expression);
    return (
      ts.isIdentifier(namespace) &&
      ctx.resolver.isNamespace(namespace.text, namespace.getStart())
    );
  }
  return false;
}

function registerObjectMemberHelpers(
  ctx: ImportScanContext,
  container: ts.Identifier,
  literal: ts.ObjectLiteralExpression,
  range: { readonly from: number; readonly to: number },
): boolean {
  let registered = false;
  for (const property of literal.properties) {
    const member = objectPropertyName(property);
    let isHelper = false;
    if (ts.isMethodDeclaration(property)) {
      isHelper = functionReturnsCreateRequire(ctx, property);
    } else if (ts.isPropertyAssignment(property)) {
      const initializer = unwrapTransparentExpressions(property.initializer);
      isHelper =
        isFunctionLikeNode(initializer) &&
        functionReturnsCreateRequire(ctx, initializer);
    }
    if (member !== undefined && isHelper) {
      registerCreateRequireMemberHelper(
        ctx,
        container.text,
        member,
        range,
        container.getStart(),
      );
      registered = true;
    }
  }
  return registered;
}

function collectVariableDeclaration(
  ctx: ImportScanContext,
  declaration: ts.VariableDeclaration,
): void {
  const initializer =
    declaration.initializer === undefined
      ? undefined
      : unwrapTransparentExpressions(declaration.initializer);
  const range = variableDeclarationRange(declaration);

  if (
    ts.isIdentifier(declaration.name) &&
    initializer !== undefined &&
    ts.isObjectLiteralExpression(initializer) &&
    registerObjectMemberHelpers(ctx, declaration.name, initializer, range)
  ) {
    return;
  }

  // CJS require of node:module → factory aliases or namespace binding
  if (isNodeModuleRequireInitializer(ctx, initializer)) {
    collectCjsModuleRequire(ctx, declaration, range);
    return;
  }

  // Call-expression initializers: createRequire bindings, helper bindings
  if (
    initializer !== undefined &&
    tryRegisterCallInitializer(ctx, declaration, initializer, range)
  ) {
    return;
  }

  // Member-access initializers: module.require alias, namespace property
  if (
    initializer !== undefined &&
    tryRegisterMemberAccessInitializer(ctx, declaration, initializer, range)
  ) {
    return;
  }

  // Identifier initializers: binding aliases, require aliases
  if (
    initializer !== undefined &&
    tryRegisterIdentifierInitializer(ctx, declaration, initializer, range)
  ) {
    return;
  }

  // Shadow: any other variable declaration of a name shadows broader provenance
  for (const name of collectBindingNames(declaration.name)) {
    ctx.resolver.register(
      name,
      'shadow',
      range.from,
      range.to,
      declaration.name.getStart(),
    );
    // Also register as a global shadow (module/exports/Object) for F3
    ctx.globalShadows.registerShadow(name, range.from, range.to);
  }
}

function functionDeclarationRange(node: ts.FunctionDeclaration): {
  readonly from: number;
  readonly to: number;
} {
  if (ts.isSourceFile(node.parent)) return moduleRange(node);
  const range = getEnclosingScopeRange(node);
  return { from: range.start, to: range.end };
}

function ownFunctionRange(
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): { readonly from: number; readonly to: number } {
  return { from: node.getStart(), to: node.getEnd() };
}

function collectFunctionShadows(
  ctx: ImportScanContext,
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): void {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    const declarationRange = functionDeclarationRange(node);
    ctx.resolver.register(
      node.name.text,
      'shadow',
      declarationRange.from,
      declarationRange.to,
      node.name.getStart(),
    );
    ctx.globalShadows.registerShadow(
      node.name.text,
      declarationRange.from,
      declarationRange.to,
    );
  } else if (ts.isFunctionExpression(node) && node.name !== undefined) {
    const expressionRange = ownFunctionRange(node);
    ctx.resolver.register(
      node.name.text,
      'shadow',
      expressionRange.from,
      expressionRange.to,
      node.name.getStart(),
    );
    ctx.globalShadows.registerShadow(
      node.name.text,
      expressionRange.from,
      expressionRange.to,
    );
  }
  const parameterRange = ownFunctionRange(node);
  for (const param of node.parameters) {
    for (const name of collectBindingNames(param.name)) {
      ctx.resolver.register(
        name,
        'shadow',
        parameterRange.from,
        parameterRange.to,
        param.name.getStart(),
      );
      ctx.globalShadows.registerShadow(
        name,
        parameterRange.from,
        parameterRange.to,
      );
    }
  }
}

function collectCallAssignment(
  ctx: ImportScanContext,
  lhs: ts.Identifier,
  rhs: ts.Expression,
  range: { readonly from: number; readonly to: number },
): void {
  if (!ts.isCallExpression(rhs)) return;
  let kind: 'binding' | 'require-alias' | undefined;
  if (isCreateRequireFactoryCallee(ctx, rhs.expression)) {
    kind = 'binding';
  } else if (isRequireBindCall(ctx, rhs)) {
    kind = 'require-alias';
  } else if (isCreateRequireHelperCallee(ctx, rhs.expression)) {
    kind = 'binding';
  } else {
    // A7: Direct arrow/function IIFE that returns createRequire(...) → binding.
    // Same logic as tryRegisterCallInitializer for variable declarations.
    const iifeCallee = unwrapTransparentExpressions(rhs.expression);
    if (
      isFunctionLikeNode(iifeCallee) &&
      functionReturnsCreateRequire(ctx, iifeCallee)
    ) {
      kind = 'binding';
    }
  }
  if (kind === undefined) return;
  ctx.resolver.register(lhs.text, kind, range.from, range.to, lhs.getStart());
  if (kind === 'binding') ctx.knownBindings.add(lhs.text);
}

/**
 * Compute the active range for an assignment alias. The alias lifetime
 * must follow the outer LHS binding's declaration scope, not the inner
 * assignment block. For `let r; { r = require; } r('...')`, the alias
 * must be active where `r(...)` is called outside the block (Finding2b).
 *
 * Falls back to the assignment's enclosing block scope if the LHS
 * declaration scope cannot be resolved (e.g. undeclared assignment target).
 */
function assignmentAliasRange(
  ctx: ImportScanContext,
  lhs: ts.Identifier,
  node: ts.ExpressionStatement,
): { readonly from: number; readonly to: number } {
  const declRange = ctx.resolver.declarationRangeAt(lhs.text, lhs.getStart());
  if (declRange !== undefined) return declRange;
  return blockScopedRange(node);
}

/**
 * Process an assignment expression that may establish a require alias or
 * binding (F2). Handles `r = require` and `r = someRequireAlias` where `r`
 * is a previously-declared variable.
 */
function collectAssignment(
  ctx: ImportScanContext,
  node: ts.ExpressionStatement,
): void {
  const expr = node.expression;
  if (!ts.isBinaryExpression(expr)) return;
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
  const lhs = expr.left;
  if (!ts.isIdentifier(lhs)) return;
  const rhs = unwrapTransparentExpressions(expr.right);
  const rhsPos = rhs.getStart();
  const range = assignmentAliasRange(ctx, lhs, node);

  // r = require
  if (
    ts.isIdentifier(rhs) &&
    rhs.text === REQUIRE_IDENTIFIER &&
    isGlobalRequireRef(ctx, rhs)
  ) {
    ctx.resolver.register(
      lhs.text,
      'require-alias',
      range.from,
      range.to,
      lhs.getStart(),
    );
    return;
  }
  // r = someBinding (createRequire return value)
  if (ts.isIdentifier(rhs) && ctx.resolver.isBinding(rhs.text, rhsPos)) {
    ctx.resolver.register(
      lhs.text,
      'binding',
      range.from,
      range.to,
      lhs.getStart(),
    );
    ctx.knownBindings.add(lhs.text);
    return;
  }
  // r = factory alias: `r = createRequire`
  if (ts.isIdentifier(rhs) && ctx.resolver.isFactoryAlias(rhs.text, rhsPos)) {
    ctx.resolver.register(
      lhs.text,
      'factory',
      range.from,
      range.to,
      lhs.getStart(),
    );
    ctx.knownFactoryAliases.add(lhs.text);
    return;
  }
  // r = someRequireAlias (transitive)
  if (ts.isIdentifier(rhs) && ctx.resolver.isRequireAlias(rhs.text, rhsPos)) {
    ctx.resolver.register(
      lhs.text,
      'require-alias',
      range.from,
      range.to,
      lhs.getStart(),
    );
    return;
  }
  collectCallAssignment(ctx, lhs, rhs, range);
}

/**
 * Phase-B visitor: collect ALL block/function-scoped provenance entries
 * (variable declarations, assignments, function shadows). Module-scoped
 * entries from Phase A are already registered, so this correctly resolves
 * forward references to factory aliases.
 *
 * Runs multiple passes until a fixed point is reached, so that a function
 * declared BEFORE another function it calls is correctly identified as a
 * createRequire-returning function (Finding1: forward hoisted helper fixed
 * point). Each pass may discover new createRequire-returning functions that
 * were missed in previous passes due to forward references.
 */
export function collectBlockProvenance(
  ctx: ImportScanContext,
  node: ts.Node,
): void {
  let previousRevision: number;
  do {
    previousRevision = ctx.resolver.revision;
    collectBlockProvenanceVisit(ctx, node);
  } while (ctx.resolver.revision !== previousRevision);
}

/**
 * Recursively visit nodes for block-scope provenance collection.
 */
function collectBlockProvenanceVisit(
  ctx: ImportScanContext,
  node: ts.Node,
): void {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      collectVariableDeclaration(ctx, declaration);
    }
  } else if (ts.isExpressionStatement(node)) {
    collectAssignment(ctx, node);
  } else if (isFunctionLikeNode(node)) {
    collectFunctionShadows(ctx, node);
    collectCreateRequireReturningFunction(ctx, node);
  }
  ts.forEachChild(node, (child) => collectBlockProvenanceVisit(ctx, child));
}

/**
 * Check if a function declaration/expression's body contains a return
 * statement that returns a createRequire factory call result. If so, record
 * the function name so callers' return values are tracked as bindings.
 *
 * Arrow functions assigned to variables (`const getReq = (url) =>
 * createRequire(url)`) have no `name` property — the name is derived from
 * the parent VariableDeclarator's identifier (Finding1: arrow helpers).
 */
function collectCreateRequireReturningFunction(
  ctx: ImportScanContext,
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): void {
  const binding = helperBinding(node);
  if (binding === undefined || !functionReturnsCreateRequire(ctx, node)) return;
  const key = `${binding.name}:${binding.range.from}:${binding.range.to}`;
  if (ctx.createRequireReturningFunctions.has(key)) return;
  ctx.createRequireReturningFunctions.add(key);
  ctx.resolver.register(
    binding.name,
    'helper',
    binding.range.from,
    binding.range.to,
    binding.declPos,
  );
}

function isTransparentParent(node: ts.Node): boolean {
  const guards: ReadonlyArray<(candidate: ts.Node) => boolean> = [
    ts.isParenthesizedExpression,
    ts.isAsExpression,
    ts.isTypeAssertionExpression,
    ts.isSatisfiesExpression,
    ts.isNonNullExpression,
  ];
  return guards.some((guard) => guard(node));
}

function helperBinding(
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
):
  | {
      readonly name: string;
      readonly range: { readonly from: number; readonly to: number };
      readonly declPos: number;
    }
  | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return {
      name: node.name.text,
      range: functionDeclarationRange(node),
      declPos: node.name.getStart(),
    };
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    let parent = node.parent;
    while (isTransparentParent(parent)) {
      parent = parent.parent;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return {
        name: parent.name.text,
        range: variableDeclarationRange(parent),
        declPos: parent.name.getStart(),
      };
    }
  }
  return undefined;
}

/**
 * Determine whether a function's OWN body (not nested function bodies)
 * contains a return statement whose expression is a createRequire factory
 * call or a createRequire binding.
 *
 * Finding2: only return statements that belong DIRECTLY to this function
 * are considered. Return statements inside nested functions are excluded
 * to avoid false positives (e.g. a function that wraps a helper which
 * returns createRequire should not be classified as createRequire-returning
 * unless its own return statement calls that helper).
 */
function functionReturnsCreateRequire(
  ctx: ImportScanContext,
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): boolean {
  const body = node.body;
  if (body === undefined) return false;
  return functionReturnIsProven(body, (expression) =>
    isCreateRequireReturnExpression(ctx, expression),
  );
}

/** Check whether an expression returns a proven createRequire binding. */
function isCreateRequireReturnExpression(
  ctx: ImportScanContext,
  expression: ts.Expression,
): boolean {
  const expr = unwrapTransparentExpressions(expression);
  if (
    ts.isCallExpression(expr) &&
    (isCreateRequireFactoryCallee(ctx, expr.expression) ||
      isCreateRequireHelperCallee(ctx, expr.expression))
  ) {
    return true;
  }
  return (
    ts.isIdentifier(expr) && ctx.resolver.isBinding(expr.text, expr.getStart())
  );
}
