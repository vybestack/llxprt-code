/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import {
  containerLiteralStorage,
  frozenPrimitiveTable,
  unwrap,
  type ContainerPolicy,
  type ImmutableTableAllowance,
} from './runtime-state-literal-tables.js';

export type { ContainerPolicy, ImmutableTableAllowance };

export interface AsyncLocalStorageAllowance {
  readonly file: string;
  readonly declaration: string;
  readonly reason: string;
}

export interface RuntimeStateFinding {
  readonly file: string;
  readonly declaration: string;
  readonly kind:
    | 'mutable-state'
    | 'module-mutation'
    | 'async-local-storage'
    | 'stale-immutable-allowance';
  readonly line: number;
  readonly column: number;
}
function mutableStaticField(
  node: ts.PropertyDeclaration,
  checker: ts.TypeChecker,
): boolean {
  if (!isReadonly(node)) return true;
  if (!node.initializer || frozenPrimitiveTable(node.initializer)) return false;
  const initializer = unwrap(node.initializer);
  return (
    ts.isObjectLiteralExpression(initializer) ||
    ts.isArrayLiteralExpression(initializer) ||
    containsMutableConstruction(initializer, checker)
  );
}

function isStatic(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
  );
}

function isReadonly(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
  );
}

function isImmediateFunction(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return (
    !!parent &&
    ts.isCallExpression(parent) &&
    unwrap(parent.expression) === node
  );
}

function isModuleOwned(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isFunctionLike(parent) && !isImmediateFunction(parent)) return false;
    if (ts.isPropertyDeclaration(parent) && !isStatic(parent)) return false;
    parent = parent.parent;
  }
  return true;
}

/**
 * Storage declared in the scanned file itself. Declarations reached through a
 * resolved program (ambient `process`, imported bindings) belong to other
 * files or the platform and are not this module's state.
 */
function isOwnedModuleStorage(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    declaration.getSourceFile() === sourceFile && isModuleOwned(declaration)
  );
}

function declarationName(node: ts.Node): string {
  const parts: string[] = [];
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    const candidate: ts.Node = current;
    const named =
      ts.isVariableDeclaration(candidate) ||
      ts.isPropertyDeclaration(candidate) ||
      ts.isClassDeclaration(candidate);
    const callable =
      ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate);
    if ((named || callable) && candidate.name)
      parts.unshift(candidate.name.getText());
    current = current.parent;
  }
  return parts.length ? parts.join('.') : `<anonymous@${node.getStart()}>`;
}

function asyncHooksImport(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isImportDeclaration(current)) current = current.parent;
  if (!current || !ts.isImportDeclaration(current)) return false;
  return (
    ts.isStringLiteral(current.moduleSpecifier) &&
    ['node:async_hooks', 'async_hooks'].includes(
      current.moduleSpecifier.text,
    ) &&
    !current.importClause?.isTypeOnly
  );
}

function asyncHooksRequire(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'require'
  )
    return false;
  if (checker.getSymbolAtLocation(node.expression)?.declarations?.length)
    return false;
  const argument = node.arguments[0];
  return (
    !!argument &&
    ts.isStringLiteralLike(argument) &&
    ['node:async_hooks', 'async_hooks'].includes(argument.text)
  );
}

function directAlsConstructor(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const target = unwrap(expression);
  if (ts.isIdentifier(target)) {
    const symbol = checker.getSymbolAtLocation(target);
    if (symbol && aliasChainReachesAsyncLocalStorage(symbol, checker))
      return true;
    return !!symbol?.declarations?.some((declaration) => {
      if (
        ts.isBindingElement(declaration) &&
        ts.isObjectBindingPattern(declaration.parent) &&
        !declaration.dotDotDotToken
      ) {
        const owner = declaration.parent.parent;
        const name = declaration.propertyName ?? declaration.name;
        if (!ts.isIdentifier(name) || name.text !== 'AsyncLocalStorage')
          return false;
        return (
          ts.isVariableDeclaration(owner) &&
          !!owner.initializer &&
          asyncHooksRequire(owner.initializer, checker)
        );
      }
      if (!ts.isImportSpecifier(declaration) || declaration.isTypeOnly)
        return false;
      const importedName = declaration.propertyName ?? declaration.name;
      return (
        importedName.text === 'AsyncLocalStorage' &&
        asyncHooksImport(declaration)
      );
    });
  }
  if (
    !ts.isPropertyAccessExpression(target) &&
    !ts.isElementAccessExpression(target)
  )
    return false;
  const member = accessedMember(target);
  if (member === undefined) return false;
  const exported = namespaceExport(target.expression, member, checker);
  if (exported && aliasChainReachesAsyncLocalStorage(exported, checker))
    return true;
  return (
    member === 'AsyncLocalStorage' &&
    valueMatches(target.expression, checker, 'async-hooks')
  );
}

function accessedMember(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined {
  if (ts.isPropertyAccessExpression(access)) return access.name.text;
  return ts.isStringLiteral(access.argumentExpression)
    ? access.argumentExpression.text
    : undefined;
}

function namespaceExport(
  namespace: ts.Expression,
  name: string,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(unwrap(namespace));
  if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return undefined;
  const module = checker.getImmediateAliasedSymbol(symbol);
  return (
    module &&
    checker.getExportsOfModule(module).find((entry) => entry.name === name)
  );
}

function reexportsAsyncLocalStorage(declaration: ts.Declaration): boolean {
  if (!ts.isExportSpecifier(declaration) || declaration.isTypeOnly)
    return false;
  const exported = declaration.parent.parent;
  if (
    exported.isTypeOnly ||
    !exported.moduleSpecifier ||
    !ts.isStringLiteral(exported.moduleSpecifier)
  )
    return false;
  return (
    ['node:async_hooks', 'async_hooks'].includes(
      exported.moduleSpecifier.text,
    ) &&
    (declaration.propertyName ?? declaration.name).text === 'AsyncLocalStorage'
  );
}

/**
 * Follows import/export aliases one hop at a time through resolved modules, so
 * a constructor re-exported from another file (`export { AsyncLocalStorage as
 * Scope } from 'node:async_hooks'`, chained re-exports, `export const Scope =
 * AsyncLocalStorage`) is recognized at its use site. Hops stop at unresolved
 * modules, which is why `node:async_hooks` itself is matched syntactically.
 */
function aliasChainReachesAsyncLocalStorage(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const seen = new Set<ts.Symbol>();
  let current: ts.Symbol | undefined = symbol;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.declarations?.some(reexportsAsyncLocalStorage)) return true;
    if (!(current.flags & ts.SymbolFlags.Alias)) {
      return !!current.declarations?.some(
        (declaration) =>
          ts.isVariableDeclaration(declaration) &&
          !!declaration.initializer &&
          current !== symbol &&
          valueMatches(declaration.initializer, checker, 'als'),
      );
    }
    current = checker.getImmediateAliasedSymbol(current);
  }
  return false;
}

type ValueKind = 'mutable' | 'als' | 'async-hooks';
type LocalFunction =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;
interface BoundValue {
  readonly expression: ts.Expression;
  readonly bindings: ReadonlyMap<ts.Symbol, BoundValue>;
}

function localFunction(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): LocalFunction | undefined {
  const value = unwrap(expression);
  if (seen.includes(value)) return undefined;
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
  if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer
  )
    return localFunction(declaration.initializer, checker, [...seen, value]);
  return undefined;
}

function returnExpressions(node: ts.Node): readonly ts.Expression[] {
  if (ts.isReturnStatement(node))
    return node.expression ? [node.expression] : [];
  if (ts.isFunctionLike(node) || ts.isClassLike(node)) return [];
  const expressions: ts.Expression[] = [];
  ts.forEachChild(node, (child) => {
    expressions.push(...returnExpressions(child));
  });
  return expressions;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function referencedSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
}

function capturesMutableState(
  node: ts.Node,
  checker: ts.TypeChecker,
  matches: (child: ts.Node) => boolean,
): boolean {
  const captured = (child: ts.Node): boolean => {
    const mutated = mutationDeclaration(child, checker);
    if (mutated && !isWithin(mutated, node)) return true;
    if (ts.isIdentifier(child)) {
      const symbol = referencedSymbol(child, checker);
      const declaration = symbol?.valueDeclaration;
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        !isWithin(declaration, node)
      ) {
        const writable =
          ts.isVariableDeclarationList(declaration.parent) &&
          !(declaration.parent.flags & ts.NodeFlags.Const);
        if (writable || matches(child)) return true;
      }
    }
    return (
      ts.forEachChild(child, (part) => captured(part) || undefined) ?? false
    );
  };
  return captured(node);
}

function callResultMatches(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  kind: ValueKind,
  path: readonly ts.Node[],
  bindings: ReadonlyMap<ts.Symbol, BoundValue>,
): boolean {
  if (kind === 'async-hooks' && asyncHooksRequire(node, checker)) return true;
  if (node.expression.getText() === 'Object.freeze')
    return (
      !!node.arguments[0] &&
      valueMatches(node.arguments[0], checker, kind, path, bindings)
    );
  const callable = localFunction(node.expression, checker);
  if (!callable?.body || path.includes(callable)) return false;
  const callBindings = new Map(bindings);
  callable.parameters.forEach((parameter, index) => {
    const symbol = checker.getSymbolAtLocation(parameter.name);
    const argument = node.arguments[index];
    if (symbol && argument)
      callBindings.set(symbol, { expression: argument, bindings });
  });
  const results = ts.isBlock(callable.body)
    ? returnExpressions(callable.body)
    : [callable.body];
  return results.some((result) =>
    valueMatches(result, checker, kind, [...path, callable], callBindings),
  );
}

function valueMatches(
  node: ts.Node,
  checker: ts.TypeChecker,
  kind: ValueKind,
  seen: readonly ts.Node[] = [],
  bindings: ReadonlyMap<ts.Symbol, BoundValue> = new Map(),
): boolean {
  if (seen.includes(node)) return false;
  const path = [...seen, node];
  const matches = (child: ts.Node): boolean =>
    valueMatches(child, checker, kind, path, bindings);
  if (ts.isExpression(node)) {
    const value = unwrap(node);
    if (value !== node) return matches(value);
    if (kind === 'als' && directAlsConstructor(value, checker)) return true;
  }
  if (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    const symbol = referencedSymbol(node, checker);
    const bound = symbol && bindings.get(symbol);
    if (bound)
      return valueMatches(
        bound.expression,
        checker,
        kind,
        path,
        bound.bindings,
      );
    return !!symbol?.declarations?.some((declaration) => {
      if (
        kind === 'async-hooks' &&
        (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
      )
        return asyncHooksImport(declaration);
      if (
        (ts.isVariableDeclaration(declaration) ||
          ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer
      )
        return matches(declaration.initializer);
      return false;
    });
  }
  if (ts.isNewExpression(node))
    return kind === 'mutable' && !isAlsConstructor(node.expression, checker);
  if (ts.isClassLike(node)) return false;
  if (ts.isFunctionLike(node))
    return kind === 'mutable' && capturesMutableState(node, checker, matches);
  if (ts.isCallExpression(node))
    return callResultMatches(node, checker, kind, path, bindings);
  if (ts.isConditionalExpression(node))
    return matches(node.whenTrue) || matches(node.whenFalse);
  if (kind !== 'mutable') return false;
  return ts.forEachChild(node, (child) => matches(child) || undefined) ?? false;
}

function isAlsConstructor(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return valueMatches(expression, checker, 'als');
}

function containsMutableConstruction(
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  return valueMatches(node, checker, 'mutable');
}

type StorageDeclaration = ts.VariableDeclaration | ts.PropertyDeclaration;

function aliasLike(expression: ts.Expression): boolean {
  return (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  );
}

function storageOrigin(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): StorageDeclaration | undefined {
  const value = unwrap(expression);
  if (seen.includes(value)) return undefined;
  const path = [...seen, value];
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
  if (
    declaration &&
    (ts.isVariableDeclaration(declaration) ||
      ts.isPropertyDeclaration(declaration))
  ) {
    if (declaration.initializer) {
      const initializer = unwrap(declaration.initializer);
      if (aliasLike(initializer))
        return storageOrigin(initializer, checker, path);
    }
    return declaration;
  }
  const aliased = containerPropertyOrigin(declaration, checker, path);
  if (aliased) return aliased;
  if (
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value)
  )
    return storageOrigin(value.expression, checker, path);
  return undefined;
}

/**
 * A property of an object literal that was initialized from other storage
 * (`{ sessions }`, `{ held: sessions }`) is the same storage, not fresh
 * container state, so writes through the property reach the original owner.
 */
function containerPropertyOrigin(
  declaration: ts.Declaration | undefined,
  checker: ts.TypeChecker,
  path: readonly ts.Node[],
): StorageDeclaration | undefined {
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    const target =
      checker.getShorthandAssignmentValueSymbol(declaration)?.valueDeclaration;
    if (
      target &&
      (ts.isVariableDeclaration(target) || ts.isPropertyDeclaration(target))
    ) {
      const initializer = target.initializer && unwrap(target.initializer);
      return initializer && aliasLike(initializer)
        ? storageOrigin(initializer, checker, path)
        : target;
    }
    return undefined;
  }
  if (declaration && ts.isPropertyAssignment(declaration)) {
    const initializer = unwrap(declaration.initializer);
    return aliasLike(initializer)
      ? storageOrigin(initializer, checker, path)
      : undefined;
  }
  return undefined;
}

function rootDeclaration(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): ts.Declaration | undefined {
  let value = unwrap(expression);
  if (seen.includes(value)) return undefined;
  while (
    ts.isPropertyAccessExpression(value) ||
    ts.isElementAccessExpression(value)
  )
    value = unwrap(value.expression);
  if (!ts.isIdentifier(value)) return undefined;
  const declaration = referencedSymbol(value, checker)?.valueDeclaration;
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    aliasLike(unwrap(declaration.initializer))
  )
    return rootDeclaration(declaration.initializer, checker, [...seen, value]);
  return declaration;
}

function rebindsOnly(node: ts.Node, target: ts.Expression): boolean {
  return !ts.isCallExpression(node) && ts.isIdentifier(unwrap(target));
}

function mutatesParameter(
  callable: LocalFunction,
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  seen: readonly ts.Node[] = [],
): boolean {
  if (!callable.body || seen.includes(callable)) return false;
  const path = [...seen, callable];
  const visitBody = (node: ts.Node): boolean => {
    const target = mutationTarget(node);
    if (
      target &&
      !rebindsOnly(node, target) &&
      rootDeclaration(target, checker) === parameter
    )
      return true;
    if (ts.isCallExpression(node) && passesParameterToMutator(node))
      return true;
    return (
      ts.forEachChild(node, (child) => visitBody(child) || undefined) ?? false
    );
  };
  const passesParameterToMutator = (call: ts.CallExpression): boolean => {
    const inner = localFunction(call.expression, checker);
    return call.arguments.some(
      (argument, index) =>
        !!inner &&
        inner.parameters[index] !== undefined &&
        rootDeclaration(argument, checker) === parameter &&
        mutatesParameter(inner, inner.parameters[index], checker, path),
    );
  };
  return visitBody(callable.body);
}

function mutatedArgumentStorage(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): readonly StorageDeclaration[] {
  const callable = localFunction(call.expression, checker);
  if (!callable) return [];
  return call.arguments.flatMap((argument, index) => {
    const parameter = callable.parameters[index];
    const origin = parameter && storageOrigin(argument, checker);
    return origin && mutatesParameter(callable, parameter, checker)
      ? [origin]
      : [];
  });
}

function mutationDeclaration(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.VariableDeclaration | ts.PropertyDeclaration | undefined {
  const target = mutationTarget(node);
  if (!target) return undefined;
  const value = unwrap(target);
  if (!ts.isCallExpression(node) && ts.isIdentifier(value)) {
    const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
    return declaration && ts.isVariableDeclaration(declaration)
      ? declaration
      : undefined;
  }
  return storageOrigin(value, checker);
}

function mutationTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return node.left;
  if (ts.isDeleteExpression(node)) return node.expression;
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return node.operand;
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  )
    return undefined;
  const callee = node.expression;
  if (
    [
      'Object.assign',
      'Object.defineProperty',
      'Object.defineProperties',
      'Reflect.set',
      'Reflect.deleteProperty',
    ].includes(callee.getText())
  )
    return node.arguments[0];
  if (
    [
      'set',
      'add',
      'delete',
      'clear',
      'push',
      'pop',
      'shift',
      'unshift',
      'splice',
      'sort',
      'reverse',
      'fill',
      'copyWithin',
    ].includes(callee.name.text)
  )
    return callee.expression;
  return undefined;
}

function isolatedSource(
  filename: string,
  source: string,
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    allowJs: true,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === filename ? sourceFile : undefined),
    getDefaultLibFileName: () => '',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) => name === filename,
    readFile: (name) => (name === filename ? source : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  return {
    sourceFile,
    checker: ts.createProgram([filename], options, host).getTypeChecker(),
  };
}

function resolvedSource(
  program: ts.Program,
  filename: string,
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const sourceFile = program.getSourceFile(filename);
  if (!sourceFile)
    throw new Error(`Resolved program does not contain ${filename}`);
  return { sourceFile, checker: program.getTypeChecker() };
}

/**
 * Single-source structural guard, with no filesystem reads or imported-file analysis.
 * Reports module/block let/var, nested instances and local factory return
 * dependencies in module initializers, captured writable/container state,
 * static writable fields and readonly static object/array/instance fields.
 * Ordinary function locals and instance fields are excluded from mutable-state
 * checks. Literal module data is permitted. Writes and known container mutators
 * follow initializer aliases to their storage declaration, including static
 * fields and writes inside functions. Local alias rebinding is not a mutation
 * of the aliased storage.
 *
 * ALS construction is checked everywhere for value imports (named aliases,
 * namespace and default imports), local initializer aliases and local factory
 * returns from async_hooks or node:async_hooks. Only exact file + qualified
 * declaration matches with nonblank reasons exempt ALS; exemptions never
 * suppress other findings. Paths are compared as supplied.
 *
 * Dependencies follow checker-resolved same-file symbols, return expressions
 * and positional call arguments, with path-local cycle detection. This is not
 * whole-program proof: imported factories, re-exports/require, reassigned or
 * destructured aliases, higher-order call targets, construction through caller-
 * supplied parameters, computed mutator names and custom mutator methods need
 * separate analysis. Without a resolved program the scan is single-source;
 * passing a program whose module resolution covers the scanned files lets ALS
 * constructors be followed through imports and re-exports. Branches are unioned, not evaluated for reachability.
 * With a `containerPolicy`, module-level object/array literal storage (also
 * inside Object.freeze unless it is a primitive-only table) is reported as
 * mutable-state unless an exact file + declaration allowlist entry with a
 * nonblank reason names it; allowlist entries that match no such declaration
 * are reported as stale-immutable-allowance.
 * All non-ALS `new` initializers are conservatively treated as mutable; imported
 * class implementations are not inspected. Object.freeze does not exempt
 * constructed instances. Frozen primitive tables are permitted. Input should
 * already pass TypeScript parsing/typechecking; this scanner is not a compiler
 * diagnostic replacement. No repository discovery or default allowance exists.
 */
export function scanRuntimeStateStructure(
  filename: string,
  source: string,
  allowlist: readonly AsyncLocalStorageAllowance[] = [],
  resolvedProgram?: ts.Program,
  containerPolicy?: ContainerPolicy,
): RuntimeStateFinding[] {
  const { sourceFile, checker } = resolvedProgram
    ? resolvedSource(resolvedProgram, filename)
    : isolatedSource(filename, source);
  const findings: RuntimeStateFinding[] = [];
  const usedAllowances = new Set<ImmutableTableAllowance>();
  function report(
    node: ts.Node,
    kind: RuntimeStateFinding['kind'],
    declaration = declarationName(node),
  ): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    findings.push({
      file: filename,
      declaration,
      kind,
      line: position.line + 1,
      column: position.character + 1,
    });
  }
  function checkModuleVariable(node: ts.VariableDeclaration): void {
    const writable =
      ts.isVariableDeclarationList(node.parent) &&
      !(node.parent.flags & ts.NodeFlags.Const);
    if (
      writable ||
      (node.initializer &&
        containsMutableConstruction(node.initializer, checker))
    )
      return report(node, 'mutable-state');
    if (
      !containerPolicy ||
      !node.initializer ||
      !containerLiteralStorage(node.initializer)
    )
      return;
    const declaration = declarationName(node);
    const allowance = containerPolicy.allowlist.find(
      (entry) =>
        entry.file === filename &&
        entry.declaration === declaration &&
        entry.reason.trim().length > 0,
    );
    if (allowance) usedAllowances.add(allowance);
    else report(node, 'mutable-state', declaration);
  }
  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      isAlsConstructor(node.expression, checker)
    ) {
      const declaration = declarationName(node);
      if (
        !allowlist.some(
          (entry) =>
            entry.file === filename &&
            entry.declaration === declaration &&
            entry.reason.trim().length > 0,
        )
      )
        report(node, 'async-local-storage', declaration);
    }
    if (ts.isVariableDeclaration(node) && isModuleOwned(node))
      checkModuleVariable(node);
    if (
      ts.isPropertyDeclaration(node) &&
      isStatic(node) &&
      isModuleOwned(node) &&
      mutableStaticField(node, checker)
    )
      report(node, 'mutable-state');
    const declaration = mutationDeclaration(node, checker);
    if (
      declaration &&
      isOwnedModuleStorage(declaration, sourceFile) &&
      (ts.isVariableDeclaration(declaration) || isStatic(declaration))
    )
      report(node, 'module-mutation', declarationName(declaration));
    if (ts.isCallExpression(node))
      for (const origin of mutatedArgumentStorage(node, checker))
        if (
          isOwnedModuleStorage(origin, sourceFile) &&
          (ts.isVariableDeclaration(origin) || isStatic(origin))
        )
          report(node, 'module-mutation', declarationName(origin));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  for (const entry of containerPolicy?.allowlist ?? [])
    if (entry.file === filename && !usedAllowances.has(entry))
      findings.push({
        file: filename,
        declaration: entry.declaration,
        kind: 'stale-immutable-allowance',
        line: 1,
        column: 1,
      });
  return findings;
}
