/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import { compilerSourcePath } from '../compiler-source-path.js';
import {
  isModuleOwned,
  isStatic,
  referencedSymbol,
  bindingElements,
  bindingKeys,
  projectedBindingValue,
  storageOrigin,
  rootDeclaration,
  type StorageDeclaration,
} from './runtime-state-storage-provenance.js';
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

function isReadonly(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
  );
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
  | ts.ArrowFunction
  | ts.MethodDeclaration;
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
  const symbol = checker.getSymbolAtLocation(value);
  const resolved =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declaration =
    resolved?.declarations?.find(
      (candidate) =>
        (ts.isFunctionDeclaration(candidate) ||
          ts.isMethodDeclaration(candidate)) &&
        !!candidate.body,
    ) ?? resolved?.valueDeclaration;
  if (
    declaration &&
    (ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration))
  )
    return declaration;
  if (!declaration) return undefined;
  const initialized =
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyAssignment(declaration) ||
    ts.isPropertyDeclaration(declaration);
  if (initialized && declaration.initializer)
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

type MutationParameter = ts.ParameterDeclaration | ts.BindingElement;

function parameterArguments(
  callable: LocalFunction,
  arguments_: readonly ts.Expression[],
  checker: ts.TypeChecker,
): ReadonlyArray<readonly [MutationParameter, ts.Expression]> {
  return callable.parameters.flatMap(
    (
      parameter,
      index,
    ): ReadonlyArray<readonly [MutationParameter, ts.Expression]> => {
      const argument = arguments_[index];
      if (!argument) return [];
      return ts.isIdentifier(parameter.name)
        ? [[parameter, argument]]
        : bindingElements(parameter.name).map(
            (element): readonly [MutationParameter, ts.Expression] => [
              element,
              projectedBindingValue(argument, bindingKeys(element), checker),
            ],
          );
    },
  );
}

function rebindsOnly(node: ts.Node, target: ts.Expression): boolean {
  return !ts.isCallExpression(node) && ts.isIdentifier(unwrap(target));
}

function mutatesParameter(
  callable: LocalFunction,
  parameter: MutationParameter,
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
    return (
      !!inner &&
      parameterArguments(inner, call.arguments, checker).some(
        ([target, argument]) =>
          rootDeclaration(argument, checker) === parameter &&
          mutatesParameter(inner, target, checker, path),
      )
    );
  };
  return visitBody(callable.body);
}

function mutatedArgumentStorage(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  summaries: Map<MutationParameter, boolean>,
): readonly StorageDeclaration[] {
  const callable = localFunction(call.expression, checker);
  if (!callable) return [];
  return parameterArguments(callable, call.arguments, checker).flatMap(
    ([parameter, argument]) => {
      const origin = storageOrigin(argument, checker);
      if (!origin) return [];
      const mutates =
        summaries.get(parameter) ??
        mutatesParameter(callable, parameter, checker);
      summaries.set(parameter, mutates);
      return mutates ? [origin] : [];
    },
  );
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
    getSourceFile: (name) =>
      compilerSourcePath(name) === compilerSourcePath(filename)
        ? sourceFile
        : undefined,
    getDefaultLibFileName: () => '',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) =>
      compilerSourcePath(name) === compilerSourcePath(filename),
    readFile: (name) =>
      compilerSourcePath(name) === compilerSourcePath(filename)
        ? source
        : undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(
    [compilerSourcePath(filename)],
    options,
    host,
  );
  return resolvedSource(program, compilerSourcePath(filename));
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
 * Dependencies follow checker-resolved function/method symbols, return expressions
 * and positional call arguments, with path-local cycle detection and per-scan
 * parameter mutation summaries. Resolved imports and re-exports reach their
 * implementation bodies. Storage follows binding projections and local assignment
 * provenance. This is not whole-program proof: require, higher-order call targets,
 * construction through caller-
 * supplied parameters and computed mutator names need
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
  const mutationSummaries = new Map<MutationParameter, boolean>();
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
      for (const origin of mutatedArgumentStorage(
        node,
        checker,
        mutationSummaries,
      ))
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
