/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';

export interface AmbientSource {
  readonly file: string;
  readonly exportName: string;
  readonly members?: readonly string[];
}

export interface AmbientDelegationFinding {
  readonly rule: 'runtime-ambient-delegation';
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: 'argument' | 'receiver' | 'return' | 'call';
}

type FunctionBody =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration;

function isFunction(node: ts.Node): node is FunctionBody {
  if (ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node))
    return true;
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function unalias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function sourceSymbols(
  program: ts.Program,
  roots: readonly AmbientSource[],
): ReadonlySet<ts.Symbol> {
  const checker = program.getTypeChecker();
  return new Set(
    roots.map((root) => {
      const file = program.getSourceFile(root.file);
      const module = file && checker.getSymbolAtLocation(file);
      let symbol =
        module &&
        checker
          .getExportsOfModule(module)
          .find((entry) => entry.name === root.exportName);
      if (symbol) symbol = unalias(checker, symbol);
      for (const member of root.members ?? []) {
        const declaration =
          symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        symbol =
          symbol && declaration
            ? checker.getPropertyOfType(
                checker.getTypeOfSymbolAtLocation(symbol, declaration),
                member,
              )
            : undefined;
        if (symbol) symbol = unalias(checker, symbol);
      }
      if (!symbol)
        throw new Error(
          `Unresolved ambient source: ${root.file}#${root.exportName}.${root.members?.join('.') ?? ''}`,
        );
      return symbol;
    }),
  );
}

function callableDeclarations(
  ambient: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): ReadonlyMap<ts.SignatureDeclaration | ts.JSDocSignature, ts.Symbol> {
  const declarations = new Map<
    ts.SignatureDeclaration | ts.JSDocSignature,
    ts.Symbol
  >();
  for (const symbol of ambient) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;
    for (const signature of checker
      .getTypeOfSymbolAtLocation(symbol, declaration)
      .getCallSignatures()) {
      if (signature.declaration)
        declarations.set(signature.declaration, symbol);
    }
  }
  return declarations;
}

interface Binding {
  readonly symbol: ts.Symbol;
  readonly value: ts.Expression;
}

interface ReturnedValue {
  readonly owner: FunctionBody;
  readonly expression: ts.Expression;
  readonly location: ts.Node;
}

/**
 * Reports only supplied source files; helper-return summaries use non-declaration
 * files in the same Program. Roots identify callable export/member declarations,
 * not spelling matches. Supply a correctly resolved, typechecked Program.
 *
 * This is a flow-insensitive negative control, not proof of API correctness.
 * Assignments join monotonically (overwrites do not erase provenance), and
 * destructuring/aggregate values conservatively share provenance across fields.
 * Local helper returns substitute simple positional identifier parameters using
 * finite summaries, including recursive helper cycles. Default/rest/destructured
 * parameters and spread-argument positioning are not modeled. No heap writes,
 * context-sensitive closures, dynamic dispatch, reflective calls, runtime imports,
 * or erased/unresolved symbol recovery is attempted. External helper bodies and
 * getter property reads are opaque; getter bodies themselves are checked.
 * Callable destructuring and destructuring defaults/rest are not resolved.
 * Calls and new-expression arguments are sinks at module level and in function,
 * arrow, method, constructor and getter bodies; returns are also checked.
 * Parameter initializers and constructor-result provenance are not modeled.
 * Member roots match the
 * declared member symbol, so instances sharing that declaration share the policy.
 * Configure only service-bearing sources, not primitive observability accessors.
 * There are no assembly exemptions or automatic repository-wide assertions.
 */
export function scanAmbientDelegation(
  program: ts.Program,
  sources: readonly ts.SourceFile[],
  ambientSources: readonly AmbientSource[],
): readonly AmbientDelegationFinding[] {
  const checker = program.getTypeChecker();
  const ambient = sourceSymbols(program, ambientSources);
  const ambientDeclarations = callableDeclarations(ambient, checker);
  const bindings: Binding[] = [];
  const returns: ReturnedValue[] = [];
  const calls: Array<ts.CallExpression | ts.NewExpression> = [];
  const functions = new Set<FunctionBody>();
  const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
    const symbol =
      ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
    return symbol && unalias(checker, symbol);
  };
  const bind = (name: ts.Node, value: ts.Expression): void => {
    if (ts.isIdentifier(name)) {
      const symbol = symbolAt(name);
      if (symbol) bindings.push({ symbol, value });
    } else if (
      ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)
    ) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) bind(element.name, value);
      }
    } else if (ts.isObjectLiteralExpression(name)) {
      for (const property of name.properties) {
        if (ts.isPropertyAssignment(property))
          bind(property.initializer, value);
        if (ts.isShorthandPropertyAssignment(property))
          bind(property.name, value);
      }
    } else if (ts.isArrayLiteralExpression(name)) {
      for (const element of name.elements) bind(element, value);
    }
  };
  const collect = (node: ts.Node, owner?: FunctionBody): void => {
    if (isFunction(node)) {
      functions.add(node);
      if (node.body) {
        if (!ts.isBlock(node.body))
          returns.push({
            owner: node,
            expression: node.body,
            location: node.body,
          });
        collect(node.body, node);
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer)
      bind(node.name, node.initializer);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      bind(node.left, node.right);
    if (owner && ts.isReturnStatement(node) && node.expression)
      returns.push({ owner, expression: node.expression, location: node });
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node);
    ts.forEachChild(node, (child) => collect(child, owner));
  };
  for (const file of program.getSourceFiles()) {
    if (!file.isDeclarationFile) collect(file);
  }

  const aliases = new Map<ts.Symbol, readonly ts.Expression[]>();
  for (const binding of bindings)
    aliases.set(binding.symbol, [
      ...(aliases.get(binding.symbol) ?? []),
      binding.value,
    ]);
  const targets = (
    expression: ts.Expression,
    seen: ReadonlySet<ts.Symbol> = new Set(),
  ): readonly ts.Symbol[] => {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    )
      return targets(expression.expression, seen);
    const symbol = symbolAt(
      ts.isPropertyAccessExpression(expression) ? expression.name : expression,
    );
    const declaredOrigins = checker
      .getTypeAtLocation(expression)
      .getCallSignatures()
      .flatMap((signature) => {
        const origin =
          signature.declaration &&
          ambientDeclarations.get(signature.declaration);
        return origin ? [origin] : [];
      });
    if (!symbol || seen.has(symbol)) return declaredOrigins;
    const next = new Set([...seen, symbol]);
    return [
      ...declaredOrigins,
      symbol,
      ...(aliases.get(symbol) ?? []).flatMap((value) => targets(value, next)),
    ];
  };
  const parameters = new Map<
    FunctionBody,
    ReadonlyArray<ts.Symbol | undefined>
  >();
  for (const fn of functions) {
    parameters.set(
      fn,
      fn.parameters.map((parameter) =>
        ts.isIdentifier(parameter.name) &&
        !parameter.dotDotDotToken &&
        !parameter.initializer
          ? symbolAt(parameter.name)
          : undefined,
      ),
    );
  }
  const parameterSymbols = new Set(
    [...parameters.values()]
      .flat()
      .filter((symbol): symbol is ts.Symbol => symbol !== undefined),
  );
  const tainted = new Map<ts.Symbol, ReadonlySet<ts.Symbol>>();
  const summaries = new Map<FunctionBody, ReadonlySet<ts.Symbol>>();
  const helperBodies = (symbol: ts.Symbol): readonly FunctionBody[] =>
    (symbol.declarations ?? []).flatMap((declaration) => {
      if (isFunction(declaration)) return [declaration];
      return ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isFunction(declaration.initializer)
        ? [declaration.initializer]
        : [];
    });
  const provenance = (expression: ts.Expression): readonly ts.Symbol[] => {
    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression);
      return symbol
        ? [
            ...(parameterSymbols.has(symbol) ? [symbol] : []),
            ...(tainted.get(symbol) ?? []),
          ]
        : [];
    }
    if (ts.isCallExpression(expression))
      return targets(expression.expression).flatMap((symbol) => {
        if (ambient.has(symbol)) return [symbol];
        return helperBodies(symbol).flatMap((fn) =>
          [...(summaries.get(fn) ?? [])].flatMap((origin) => {
            if (ambient.has(origin)) return [origin];
            const index = parameters.get(fn)?.indexOf(origin) ?? -1;
            const argument =
              index < 0 ? undefined : expression.arguments[index];
            return argument ? provenance(argument) : [];
          }),
        );
      });
    if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression) ||
      ts.isAwaitExpression(expression) ||
      ts.isSpreadElement(expression)
    )
      return provenance(expression.expression);
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      return provenance(expression.expression);
    if (ts.isConditionalExpression(expression))
      return [
        ...provenance(expression.whenTrue),
        ...provenance(expression.whenFalse),
      ];
    if (ts.isBinaryExpression(expression)) {
      const kind = expression.operatorToken.kind;
      if (kind === ts.SyntaxKind.EqualsToken)
        return provenance(expression.right);
      if (
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
      )
        return [
          ...provenance(expression.left),
          ...provenance(expression.right),
        ];
    }
    if (ts.isArrayLiteralExpression(expression))
      return expression.elements.flatMap(provenance);
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.flatMap((property) => {
        if (ts.isPropertyAssignment(property))
          return provenance(property.initializer);
        if (ts.isShorthandPropertyAssignment(property))
          return provenance(property.name);
        return ts.isSpreadAssignment(property)
          ? provenance(property.expression)
          : [];
      });
    return [];
  };

  let factCount = 0;
  const join = <T>(
    facts: Map<T, ReadonlySet<ts.Symbol>>,
    key: T,
    origins: readonly ts.Symbol[],
  ): void => {
    const previous = facts.get(key) ?? new Set<ts.Symbol>();
    const combined = new Set([...previous, ...origins]);
    factCount += combined.size - previous.size;
    facts.set(key, combined);
  };
  // Each changing pass adds a binding/return and origin pair from finite sets.
  const passLimit =
    (new Set(bindings.map((binding) => binding.symbol)).size + functions.size) *
      (ambient.size + parameterSymbols.size) +
    1;
  for (let pass = 0; pass < passLimit; pass++) {
    const before = factCount;
    for (const binding of bindings)
      join(tainted, binding.symbol, provenance(binding.value));
    for (const returned of returns)
      join(summaries, returned.owner, provenance(returned.expression));
    if (before === factCount) break;
    if (pass === passLimit - 1)
      throw new Error('Ambient provenance did not converge');
  }
  const hasAmbient = (expression: ts.Expression): boolean =>
    provenance(expression).some((origin) => ambient.has(origin));

  const selected = new Set(sources);
  const findings: AmbientDelegationFinding[] = [];
  const report = (
    node: ts.Node,
    kind: AmbientDelegationFinding['kind'],
  ): void => {
    const file = node.getSourceFile();
    if (!selected.has(file)) return;
    const location = file.getLineAndCharacterOfPosition(node.getStart(file));
    findings.push({
      rule: 'runtime-ambient-delegation',
      file: file.fileName,
      line: location.line + 1,
      column: location.character + 1,
      kind,
    });
  };
  for (const call of calls) {
    if (
      /\.[cm]?js$/.test(call.getSourceFile().fileName) &&
      targets(call.expression).some((symbol) => ambient.has(symbol))
    )
      report(call, 'call');
    if (call.arguments?.some(hasAmbient)) report(call, 'argument');
    if (
      (ts.isPropertyAccessExpression(call.expression) ||
        ts.isElementAccessExpression(call.expression)) &&
      hasAmbient(call.expression.expression)
    )
      report(call, 'receiver');
  }
  for (const returned of returns) {
    if (hasAmbient(returned.expression)) report(returned.location, 'return');
  }
  return findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.kind.localeCompare(b.kind),
  );
}
