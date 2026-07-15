/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Import-side detection for the genai-enclave boundary guard (#2352).
 *
 * Uses the TypeScript compiler API to detect ALL import forms that could
 * reference @google/genai:
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
 * Tracks `createRequire` provenance via the scope-aware `ProvenanceResolver`,
 * which correctly handles lexical shadowing (e.g. a top-level
 * `createRequire` import shadowed by a nested local `const createRequire =`
 * or a function parameter).
 *
 * Detections required (#2352 review):
 *   - `const cr = require('node:module').createRequire; cr(url)('@google/genai')`
 *   - bound require alias (`const r2 = r` where `r` is a createRequire binding)
 *   - TS `import mod = require('node:module')`
 *   - computed destructuring `{ ['createRequire']: cr }`
 *   - preserve top-level provenance despite nested same-name shadow
 *
 * Provenance collection (Phase A/B first pass) lives in
 * provenance-collection.ts. Shared context and helper predicates live in
 * import-context.ts.
 */

import ts from 'typescript';
import { GENAI_PACKAGE } from './config.ts';
import {
  literalText,
  elementAccessLiteralText,
  REQUIRE_IDENTIFIER,
  classifyImportExportSyntaxForm,
  unwrapTransparentExpressions,
} from './ast-helpers.ts';
import { ProvenanceResolver, GlobalShadowResolver } from './provenance.ts';
import type {
  GenaiImportViolation,
  ComputedImportViolation,
  Violation,
} from './violation-types.ts';
import {
  type ImportScanContext,
  isCreateRequireFactoryCallee,
  isCreateRequireHelperCallee,
  isGlobalRequireRef,
  isModuleRequireRef,
} from './import-context.ts';
import {
  collectModuleProvenance,
  collectBlockProvenance,
} from './provenance-collection.ts';

export type {
  GenaiImportViolation,
  ComputedImportViolation,
  Violation,
} from './violation-types.ts';
export type { ImportScanContext } from './import-context.ts';

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
 * Classify an indirect-require call expression for diagnostic output.
 * Handles comma-loader, bind, and require/module.require property-access forms.
 */
function classifyIndirectRequireCallee(
  ctx: ImportScanContext,
  callee: ts.Expression,
): string | undefined {
  if (
    ts.isParenthesizedExpression(callee) &&
    ts.isBinaryExpression(callee.expression) &&
    callee.expression.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return 'comma-loader require()';
  }
  if (ts.isCallExpression(callee)) {
    return 'bound require() call (bind)';
  }
  if (ts.isPropertyAccessExpression(callee)) {
    if (isModuleRequireRef(ctx, callee.expression)) {
      return `module.require.${callee.name.text}()`;
    }
    return `require.${callee.name.text}()`;
  }
  return undefined;
}

/**
 * Classify the import/export form of a TS node for diagnostic output.
 * Delegates to the shared form classifier, passing the import context for
 * createRequire-aware call classification.
 */
function classifyImportForm(ctx: ImportScanContext, node: ts.Node): string {
  // F16/F21: export = require(...) — classify the inner call expression.
  if (ts.isExportAssignment(node) && ts.isCallExpression(node.expression)) {
    const inner = classifyImportForm(ctx, node.expression);
    return node.isExportEquals
      ? `export = ${inner}`
      : `export default ${inner}`;
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return 'dynamic import()';
    }
    if (isModuleRequireCall(ctx, node)) {
      return 'module.require()';
    }
    if (isCreateRequireCall(ctx, node)) {
      return 'createRequire()';
    }
    if (
      ts.isIdentifier(node.expression) &&
      ctx.resolver.isBinding(node.expression.text, node.getStart())
    ) {
      return 'bound createRequire()';
    }
    if (isIndirectRequireCall(ctx, node)) {
      const callee = node.expression;
      const indirect = classifyIndirectRequireCallee(ctx, callee);
      if (indirect !== undefined) return indirect;
    }
    return 'require()';
  }
  return classifyImportExportSyntaxForm(node);
}

/**
 * Check whether a CallExpression is a `module.require(...)` or
 * `module['require'](...)` call. Returns false if `module` is shadowed by a
 * local declaration at the call site (F3).
 */
function isModuleRequireCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  const callee = expr.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    if (
      callee.name.text === REQUIRE_IDENTIFIER &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'module'
    ) {
      return !ctx.globalShadows.isShadowed(
        'module',
        callee.expression.getStart(),
      );
    }
    return false;
  }
  if (ts.isElementAccessExpression(callee)) {
    const memberName = elementAccessLiteralText(callee.argumentExpression);
    if (
      memberName === REQUIRE_IDENTIFIER &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'module'
    ) {
      return !ctx.globalShadows.isShadowed(
        'module',
        callee.expression.getStart(),
      );
    }
    return false;
  }
  return false;
}

/**
 * Check whether a CallExpression is a `createRequire(...)(...)` call —
 * i.e. the callee is itself a CallExpression whose function is an identifier
 * referring to the `createRequire` factory (bare name or a tracked alias), OR
 * a call through a known createRequire-returning function (e.g.
 * `cr(url)('@google/genai')` where `cr` is an arrow/function helper whose
 * body returns `createRequire(url)`).
 */
function isCreateRequireCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  const callee = unwrapTransparentExpressions(expr.expression);
  if (!ts.isCallExpression(callee)) {
    return false;
  }
  if (
    isCreateRequireFactoryCallee(ctx, callee.expression) ||
    isCreateRequireHelperCallee(ctx, callee.expression)
  ) {
    return true;
  }
  // For createRequire.call/apply(...)(...), `callee.expression` is the
  // call/apply member access used by the inner factory invocation.
  if (
    isInvokeMemberAccess(callee.expression) &&
    isCreateRequireFactoryCallee(
      ctx,
      getMemberAccessExpression(callee.expression),
    )
  ) {
    return true;
  }
  // createRequire.bind(ctx)(url)(...) — the callee is
  // createRequire.bind(ctx)(url), a CallExpression whose expression is
  // createRequire.bind(ctx) — another CallExpression on a bind member access.
  if (ts.isCallExpression(callee.expression)) {
    const innerCallee = callee.expression.expression;
    if (
      isBindMemberAccess(innerCallee) &&
      isCreateRequireFactoryCallee(ctx, getMemberAccessExpression(innerCallee))
    ) {
      return true;
    }
  }
  // Inline factory chain: require('node:module').createRequire(...)(...)
  // or module.require('node:module').createRequire(...)(...).
  // The callee is createRequire(...)(...), whose callee.expression is
  // require('node:module').createRequire — a PropertyAccessExpression on a
  // require('node:module') call.
  if (
    isPropertyOrElementAccess(callee.expression) &&
    getMemberAccessName(callee.expression) === 'createRequire'
  ) {
    const factoryBase = getMemberAccessExpression(callee.expression);
    if (isNodeModuleRequireCallExpression(ctx, factoryBase)) {
      return true;
    }
  }
  return isCreateRequireHelperCallee(ctx, callee.expression);
}

/**
 * Check whether `expr` is a bare `require('node:module')`,
 * `module.require('node:module')`, or a call through a tracked require alias
 * with the `node:module` / `module` specifier. Used to detect inline
 * factory chains like `require('node:module').createRequire(url)('...')`.
 */
function isNodeModuleRequireCallExpression(
  ctx: ImportScanContext,
  expr: ts.Expression,
): expr is ts.CallExpression {
  if (!ts.isCallExpression(expr)) return false;
  const specifierArg = expr.arguments[0];
  const specifier =
    specifierArg !== undefined ? literalText(specifierArg) : null;
  if (specifier === null) return false;
  const isModuleSpecifier =
    specifier === 'node:module' || specifier === 'module';
  if (!isModuleSpecifier) return false;
  if (
    ts.isIdentifier(expr.expression) &&
    isGlobalRequireRef(ctx, expr.expression)
  ) {
    return true;
  }
  if (isModuleRequireRef(ctx, expr.expression)) {
    return true;
  }
  if (
    ts.isIdentifier(expr.expression) &&
    ctx.resolver.isRequireAlias(expr.expression.text, expr.getStart())
  ) {
    return true;
  }
  return false;
}

/**
 * Check whether an expression is a known loader binding or require alias at
 * the given position. Used for `.call`/`.apply`/`.bind` invocation chains.
 */
function isLoaderBindingExpression(
  ctx: ImportScanContext,
  expr: ts.Expression,
): boolean {
  const candidate = unwrapTransparentExpressions(expr);
  return (
    ts.isIdentifier(candidate) &&
    (ctx.resolver.isBinding(candidate.text, candidate.getStart()) ||
      ctx.resolver.isRequireAlias(candidate.text, candidate.getStart()))
  );
}

/**
 * Check whether a CallExpression is a call through a lexical binding that
 * holds a `createRequire(...)` return value (e.g. `myReq('@google/genai')`),
 * a bare `require` alias (e.g. `const r = require; r('@google/genai')`),
 * or a call through a tracked createRequire-returning function
 * (e.g. `const cr = (url) => createRequire(url); cr(url)('@google/genai')`).
 */
function isBoundCreateRequireCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  const callee = unwrapTransparentExpressions(expr.expression);
  if (isLoaderBindingExpression(ctx, callee)) {
    return true;
  }
  if (
    isInvokeMemberAccess(callee) &&
    isLoaderBindingExpression(ctx, getMemberAccessExpression(callee))
  ) {
    return true;
  }
  if (
    ts.isCallExpression(callee) &&
    isBindMemberAccess(callee.expression) &&
    isLoaderBindingExpression(ctx, getMemberAccessExpression(callee.expression))
  ) {
    return true;
  }
  return false;
}

/**
 * Check whether a CallExpression is a dynamic import(), bare require(),
 * module.require(), module['require'](), createRequire()(...), or a call
 * through a tracked createRequire binding.
 */
function isImportOrRequireCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  if (expr.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }
  if (
    ts.isIdentifier(expr.expression) &&
    isGlobalRequireRef(ctx, expr.expression)
  ) {
    return true;
  }
  if (isModuleRequireCall(ctx, expr) || isCreateRequireCall(ctx, expr)) {
    return true;
  }
  if (isBoundCreateRequireCall(ctx, expr)) {
    return true;
  }
  return isIndirectRequireCall(ctx, expr);
}

/**
 * The set of Function.prototype method names that INVOKE the function
 * immediately: `require.call(...)`, `require.apply(...)`.
 *
 * `.bind(...)` is intentionally NOT in this set — it returns a new function
 * without invoking require, so `require.bind(null)` is not itself a require
 * call. The outer call `require.bind(null)(spec)` is matched separately via
 * the CallExpression callee check.
 */
const INDIRECT_INVOKE_METHODS: ReadonlySet<string> = new Set(['call', 'apply']);

function isIndirectInvokeMethod(name: string | undefined): boolean {
  return name !== undefined && INDIRECT_INVOKE_METHODS.has(name);
}

/**
 * Check whether a CallExpression uses an indirect require invocation form
 * that smuggles the loader past the bare `require(...)` detection:
 *
 * - `require.call(this, spec)` / `require.apply(null, [spec])`
 * - `require['call'](this, spec)` / `require['apply'](null, [spec])` (bracket)
 * - `require.bind(null)(spec)` / `require['bind'](null)(spec)` — the callee
 *   is a CallExpression returning from `require.bind(...)`
 * - `module.require.call(this, spec)` / `module.require['bind'](null)(spec)`
 * - `(0, require)(spec)` — comma-operator loader that strips the receiver
 *
 * Both dot-access and bracket-access forms are handled so the boundary
 * cannot be bypassed via computed member access.
 */
function isIndirectRequireCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  const callee = expr.expression;

  // (0, require)(...) — comma-operator loader. The callee is a
  // ParenthesizedExpression wrapping a BinaryExpression with comma operator
  // whose right operand is `require`.
  if (
    ts.isParenthesizedExpression(callee) &&
    ts.isBinaryExpression(callee.expression) &&
    callee.expression.operatorToken.kind === ts.SyntaxKind.CommaToken &&
    isGlobalRequireRef(ctx, callee.expression.right)
  ) {
    return true;
  }

  // (0, module.require)(...) / (0, module["require"])(...) — comma-operator
  // loader whose right operand is `module.require` or `module['require']`.
  if (
    ts.isParenthesizedExpression(callee) &&
    ts.isBinaryExpression(callee.expression) &&
    callee.expression.operatorToken.kind === ts.SyntaxKind.CommaToken &&
    isModuleRequireRef(ctx, callee.expression.right)
  ) {
    return true;
  }

  // require.call(...) / require.apply(...) — dot access
  // require['call'](...) / require['apply'](...) — bracket access
  if (
    isInvokeMemberAccess(callee) &&
    isIndirectInvokeMethod(getMemberAccessName(callee)) &&
    isGlobalRequireRef(ctx, getMemberAccessExpression(callee))
  ) {
    return true;
  }

  // require.bind(null)(...) / require['bind'](null)(...) — the callee is a
  // CallExpression whose expression is require.bind or require['bind'].
  if (
    ts.isCallExpression(callee) &&
    isBindMemberAccess(callee.expression) &&
    isGlobalRequireRef(ctx, getMemberAccessExpression(callee.expression))
  ) {
    return true;
  }

  // module.require.call(this, ...) / module.require['apply'](null, [...])
  if (
    isInvokeMemberAccess(callee) &&
    isIndirectInvokeMethod(getMemberAccessName(callee)) &&
    isModuleRequireRef(ctx, getMemberAccessExpression(callee))
  ) {
    return true;
  }

  // module.require.bind(null)(...) / module.require['bind'](null)(...)
  if (
    ts.isCallExpression(callee) &&
    isBindMemberAccess(callee.expression) &&
    isModuleRequireRef(ctx, getMemberAccessExpression(callee.expression))
  ) {
    return true;
  }

  return false;
}

/**
 * Check whether `node` is a dot (`obj.method`) or bracket (`obj['method']`)
 * member access whose name is in the invoke-method set.
 */
function isInvokeMemberAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    isIndirectInvokeMethod(getMemberAccessName(node))
  );
}

/**
 * Check whether `node` is a dot or bracket `.bind` member access.
 */
function isBindMemberAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    (ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)) &&
    getMemberAccessName(node) === 'bind'
  );
}

/**
 * Check whether `node` is a dot (`obj.method`) or bracket (`obj['method']`)
 * member access.
 */
function isPropertyOrElementAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
  );
}

/**
 * Extract the member name from a PropertyAccessExpression or
 * ElementAccessExpression (string-literal key), or undefined if the key is
 * computed/non-string.
 */
function getMemberAccessName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return elementAccessLiteralText(node.argumentExpression);
}

/**
 * Extract the object expression from a PropertyAccessExpression or
 * ElementAccessExpression.
 */
function getMemberAccessExpression(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ts.Expression {
  return node.expression;
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
 * @google/genai, `'computed'` if the specifier is NOT a string literal, or
 * `'other'` if it is a string literal for a different package.
 *
 * Handles indirect invocation forms:
 * - `.call(this, spec)` — specifier is arguments[1]
 * - `.apply(null, [spec])` — specifier is the first element of arguments[1]
 */
function classifyCallSpecifier(expr: ts.CallExpression): CallSpecResult {
  const callee = expr.expression;
  const methodName = isPropertyOrElementAccess(callee)
    ? getMemberAccessName(callee)
    : undefined;
  const isCallForm = methodName === 'call';
  const isApplyForm = methodName === 'apply';

  let arg: ts.Expression | undefined;
  if (isCallForm) {
    // require.call(this, spec) — specifier is the second argument
    arg = expr.arguments[1];
  } else if (isApplyForm) {
    // require.apply(null, ['spec']) — extract the first element of the
    // second argument array.
    const arrArg = expr.arguments[1];
    if (arrArg !== undefined && ts.isArrayLiteralExpression(arrArg)) {
      arg = arrArg.elements[0];
    } else {
      return { type: 'computed' };
    }
  } else {
    arg = expr.arguments[0];
  }
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

// ─── Violation creation ──────────────────────────────────────────────────────

function createImportViolation(
  ctx: ImportScanContext,
  node: ts.Node,
  specifier: string,
): GenaiImportViolation {
  const line =
    ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return {
    kind: 'genai-import',
    file: ctx.relPath,
    line,
    importForm: classifyImportForm(ctx, node),
    specifier,
  };
}

function createComputedViolation(
  ctx: ImportScanContext,
  node: ts.Node,
): ComputedImportViolation {
  const line =
    ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return {
    kind: 'computed-import',
    file: ctx.relPath,
    line,
    importForm: classifyImportForm(ctx, node),
  };
}

function findGenaiImportViolation(
  ctx: ImportScanContext,
  node: ts.Node,
): GenaiImportViolation | ComputedImportViolation | null {
  let specifier: string | null = null;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    specifier = literalText(node.moduleSpecifier);
  } else if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    const refExpr = node.moduleReference.expression;
    specifier = literalText(refExpr);
    if (specifier === null) {
      return createComputedViolation(ctx, node);
    }
  } else if (ts.isImportTypeNode(node)) {
    if (ts.isLiteralTypeNode(node.argument)) {
      specifier = literalText(node.argument.literal);
    } else {
      // Non-string/non-literal ImportTypeNode argument (e.g. a template
      // literal or identifier in type position) — the module specifier
      // is not statically resolvable. Fail closed as a computed import.
      return createComputedViolation(ctx, node);
    }
  }

  if (specifier !== null && isGenaiSpecifier(specifier)) {
    return createImportViolation(ctx, node, specifier);
  }

  // F16/F21: export = require('@google/genai') — an ExportAssignment whose
  // expression is a require/import call. The ExportAssignment itself is not
  // a CallExpression, so unwrap it and check the inner call.
  let callNode: ts.CallExpression | null = null;
  if (ts.isCallExpression(node)) {
    callNode = node;
  } else if (
    ts.isExportAssignment(node) &&
    ts.isCallExpression(node.expression)
  ) {
    callNode = node.expression;
  }

  if (callNode === null || !isImportOrRequireCall(ctx, callNode)) {
    return null;
  }
  const result = classifyCallSpecifier(callNode);
  if (result.type === 'genai') {
    return createImportViolation(ctx, node, result.specifier);
  }
  return result.type === 'computed' ? createComputedViolation(ctx, node) : null;
}

/**
 * Collect all @google/genai import violations AND computed-import violations
 * in a single source file. Returns the violations (empty if none).
 */
export function createImportScanContext(
  sourceFile: ts.SourceFile,
  relPath: string,
): ImportScanContext {
  const ctx: ImportScanContext = {
    sourceFile,
    relPath,
    resolver: new ProvenanceResolver(),
    globalShadows: new GlobalShadowResolver(),
    knownFactoryAliases: new Set(),
    knownBindings: new Set(),
    knownNamespaces: new Set(),
    createRequireReturningFunctions: new Set(),
  };
  collectModuleProvenance(ctx, sourceFile);
  collectBlockProvenance(ctx, sourceFile);
  return ctx;
}

export function isProvenModuleLoaderCall(
  ctx: ImportScanContext,
  expr: ts.CallExpression,
): boolean {
  return isImportOrRequireCall(ctx, expr);
}

export function scanGenaiImports(
  sourceFile: ts.SourceFile,
  relPath: string,
): Violation[] {
  const violations: Violation[] = [];
  const ctx = createImportScanContext(sourceFile, relPath);

  // Detection pass uses the complete scope-aware provenance graph.
  const visit = (node: ts.Node): void => {
    const violation = findGenaiImportViolation(ctx, node);
    if (violation !== null) violations.push(violation);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}
