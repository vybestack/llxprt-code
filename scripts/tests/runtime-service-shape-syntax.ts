/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';

export interface DeclarationSummary {
  readonly roots: Set<ts.Symbol>;
  readonly receiverParameters: Set<ts.Symbol>;
  readonly deferredParameters: Set<ts.Symbol>;
  readonly unsupported: Set<ts.Node>;
  erased: boolean;
}
export interface DeclarationEquation {
  readonly summary: DeclarationSummary;
  readonly dependencies: Set<ts.Symbol>;
  readonly valueDependencies: Set<ts.Symbol>;
}
export function emptySummary(
  roots: Iterable<ts.Symbol> = [],
): DeclarationSummary {
  return {
    roots: new Set(roots),
    receiverParameters: new Set(),
    deferredParameters: new Set(),
    unsupported: new Set(),
    erased: false,
  };
}
export function resolveSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol {
  return checker.getMergedSymbol(
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol,
  );
}
function hidden(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  if (
    modifiers?.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  )
    return true;
  if (!('name' in node) || !node.name || typeof node.name !== 'object')
    return false;
  return (
    'kind' in node.name && node.name.kind === ts.SyntaxKind.PrivateIdentifier
  );
}
const scalars = new Set([
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.ObjectKeyword,
]);

export function declarationEquation(
  symbol: ts.Symbol,
  roots: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
  valueSide = false,
): DeclarationEquation {
  const summary = emptySummary(roots.has(symbol) ? [symbol] : []);
  const dependencies = new Set<ts.Symbol>();
  const valueDependencies = new Set<ts.Symbol>();
  const unsupported = (node: ts.Node): void => {
    summary.unsupported.add(node);
  };
  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    resolveSymbol(symbol, checker);
  function parameters(
    declarations: readonly ts.TypeParameterDeclaration[],
    bound: ReadonlySet<ts.Symbol>,
    method: boolean,
    receiver: ts.Symbol | undefined,
  ): ReadonlySet<ts.Symbol> {
    const inner = new Set(bound);
    for (const declaration of declarations) {
      const parameter = checker.getSymbolAtLocation(declaration.name);
      if (!parameter) {
        unsupported(declaration);
        continue;
      }
      inner.add(parameter);
      (method ? summary.deferredParameters : summary.receiverParameters).add(
        parameter,
      );
    }
    for (const declaration of declarations) {
      if (declaration.constraint)
        syntax(declaration.constraint, inner, receiver);
      if (declaration.default) syntax(declaration.default, inner, receiver);
    }
    return inner;
  }
  function named(
    node: ts.Node,
    bound: ReadonlySet<ts.Symbol>,
    value = false,
  ): void {
    const referenced = checker.getSymbolAtLocation(node);
    if (!referenced) {
      unsupported(node);
      return;
    }
    const target = resolve(referenced);
    if (target.flags & ts.SymbolFlags.TypeParameter) {
      if (!bound.has(target)) unsupported(node);
    } else (value ? valueDependencies : dependencies).add(target);
  }
  function scalar(node: ts.Node): boolean {
    if (scalars.has(node.kind) || ts.isLiteralTypeNode(node)) return true;
    if (
      node.kind === ts.SyntaxKind.AnyKeyword ||
      node.kind === ts.SyntaxKind.UnknownKeyword
    ) {
      summary.erased = true;
      return true;
    }
    if (node.kind !== ts.SyntaxKind.IntrinsicKeyword) return false;
    const type = checker.getTypeAtLocation(node);
    if (
      !(
        type.flags &
        (ts.TypeFlags.Undefined |
          ts.TypeFlags.Never |
          ts.TypeFlags.String |
          ts.TypeFlags.Any |
          ts.TypeFlags.Unknown)
      )
    )
      unsupported(node);
    summary.erased ||= !!(
      type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown)
    );
    return true;
  }
  function conditional(
    node: ts.ConditionalTypeNode,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): void {
    const inferred: ts.TypeParameterDeclaration[] = [];
    function collect(part: ts.Node): void {
      if (ts.isInferTypeNode(part)) inferred.push(part.typeParameter);
      ts.forEachChild(part, collect);
    }
    collect(node.extendsType);
    const inner = parameters(inferred, bound, false, receiver);
    syntax(node.checkType, bound, receiver);
    syntax(node.extendsType, inner, receiver);
    syntax(node.trueType, inner, receiver);
    syntax(node.falseType, bound, receiver);
  }
  function importSelector(
    node: ts.ImportTypeNode,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): void {
    if (
      !ts.isLiteralTypeNode(node.argument) ||
      !ts.isStringLiteral(node.argument.literal) ||
      (!node.qualifier && !node.isTypeOf)
    )
      unsupported(node);
    else named(node.qualifier ?? node.argument.literal, bound, node.isTypeOf);
    for (const argument of node.typeArguments ?? [])
      syntax(argument, bound, receiver);
  }
  function binding(
    node: ts.Node,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): boolean {
    if (
      ts.isTypeReferenceNode(node) ||
      ts.isExpressionWithTypeArguments(node)
    ) {
      named(
        ts.isTypeReferenceNode(node) ? node.typeName : node.expression,
        bound,
      );
      for (const argument of node.typeArguments ?? [])
        syntax(argument, bound, receiver);
    } else if (ts.isThisTypeNode(node)) {
      if (receiver) dependencies.add(receiver);
      else unsupported(node);
    } else if (ts.isConditionalTypeNode(node))
      conditional(node, bound, receiver);
    else if (ts.isInferTypeNode(node)) {
      if (node.typeParameter.constraint)
        syntax(node.typeParameter.constraint, bound, receiver);
    } else if (ts.isMappedTypeNode(node)) {
      const inner = parameters([node.typeParameter], bound, false, receiver);
      if (node.nameType) syntax(node.nameType, inner, receiver);
      if (node.type) syntax(node.type, inner, receiver);
      else unsupported(node);
      if (node.members?.length) unsupported(node);
    } else if (ts.isTypeQueryNode(node)) {
      named(node.exprName, bound, true);
      for (const argument of node.typeArguments ?? [])
        syntax(argument, bound, receiver);
    } else if (ts.isImportTypeNode(node)) {
      importSelector(node, bound, receiver);
    } else return false;
    return true;
  }
  function key(name: ts.PropertyName): void {
    if (!ts.isComputedPropertyName(name)) return;
    const type = checker.getTypeAtLocation(name.expression);
    if (!(type.flags & ts.TypeFlags.UniqueESSymbol) && !type.isLiteral())
      unsupported(name);
  }
  function constructor(
    node: ts.ConstructorDeclaration,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): void {
    for (const parameter of node.parameters) {
      const stored = ts
        .getModifiers(parameter)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.PublicKeyword ||
            modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
        );
      if (!hidden(parameter) && stored) {
        if (parameter.type) syntax(parameter.type, bound, receiver);
        else unsupported(parameter);
      }
    }
  }
  function members(
    node: ts.Node,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): boolean {
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) syntax(member, bound, receiver);
    } else if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
      if (!hidden(node)) {
        key(node.name);
        if (node.type) syntax(node.type, bound, receiver);
        else unsupported(node);
      }
    } else if (ts.isConstructorDeclaration(node))
      constructor(node, bound, receiver);
    else if (ts.isSetAccessorDeclaration(node)) return true;
    else if (ts.isFunctionLike(node)) {
      if (!hidden(node)) {
        if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node))
          key(node.name);
        const inner = parameters(
          node.typeParameters ?? [],
          bound,
          true,
          receiver,
        );
        if (node.type) syntax(node.type, inner, receiver);
        else unsupported(node);
      }
    } else if (ts.isTypePredicateNode(node)) {
      if (node.type) syntax(node.type, bound, receiver);
    } else if (ts.isIndexSignatureDeclaration(node)) {
      if (node.type) syntax(node.type, bound, receiver);
      else unsupported(node);
    } else return false;
    return true;
  }
  function array(
    node: ts.ArrayTypeNode | ts.TupleTypeNode,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): void {
    const type = checker.getTypeAtLocation(node);
    const containers = [type, ...(type.getBaseTypes() ?? [])];
    const symbols = containers.flatMap((container) => {
      const symbol = container.getSymbol();
      if (symbol) return [resolve(symbol)];
      return container.getProperties().flatMap((property) =>
        (property.declarations ?? []).flatMap((declaration) => {
          const owner = declaration.parent;
          if (!ts.isInterfaceDeclaration(owner)) return [];
          const symbol = checker.getSymbolAtLocation(owner.name);
          return symbol ? [resolve(symbol)] : [];
        }),
      );
    });
    if (!symbols.length) unsupported(node);
    for (const symbol of symbols) dependencies.add(symbol);
    if (ts.isArrayTypeNode(node)) syntax(node.elementType, bound, receiver);
    else for (const element of node.elements) syntax(element, bound, receiver);
  }
  function operators(
    node: ts.Node,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): boolean {
    if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node))
      array(node, bound, receiver);
    else if (
      ts.isNamedTupleMember(node) ||
      ts.isParenthesizedTypeNode(node) ||
      ts.isTypeOperatorNode(node)
    )
      syntax(node.type, bound, receiver);
    else if (ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node))
      syntax(node.type, bound, receiver);
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const type of node.types) syntax(type, bound, receiver);
    } else if (ts.isIndexedAccessTypeNode(node)) {
      syntax(node.objectType, bound, receiver);
      syntax(node.indexType, bound, receiver);
    } else if (ts.isTemplateLiteralTypeNode(node)) {
      for (const span of node.templateSpans) syntax(span.type, bound, receiver);
    } else return false;
    return true;
  }
  function syntax(
    node: ts.Node,
    bound: ReadonlySet<ts.Symbol>,
    receiver: ts.Symbol | undefined,
  ): void {
    if (scalar(node) || binding(node, bound, receiver)) return;
    if (members(node, bound, receiver) || operators(node, bound, receiver))
      return;
    unsupported(node);
  }
  function namespace(node: ts.ModuleDeclaration | ts.SourceFile): void {
    if (!valueSide) {
      if (!(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)))
        unsupported(node);
      return;
    }
    for (const exported of checker.getExportsOfModule(symbol)) {
      const target = resolve(exported);
      if (
        target.flags & ts.SymbolFlags.Prototype &&
        symbol.flags & ts.SymbolFlags.Class
      )
        dependencies.add(symbol);
      else if (target.flags & ts.SymbolFlags.Value)
        valueDependencies.add(target);
    }
  }
  function staticMember(node: ts.Node): boolean {
    return (
      ts.canHaveModifiers(node) &&
      !!ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
    );
  }
  function classValue(node: ts.ClassDeclaration): void {
    dependencies.add(symbol);
    const bases = (node.heritageClauses ?? [])
      .filter((base) => base.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((base) => [...base.types]);
    for (const type of bases) named(type.expression, new Set(), true);
    for (const member of node.members.filter(staticMember))
      syntax(member, new Set(), undefined);
  }
  function declaration(node: ts.Declaration): void {
    if (ts.isModuleDeclaration(node) || ts.isSourceFile(node)) {
      namespace(node);
      return;
    }
    if (valueSide && ts.isInterfaceDeclaration(node)) return;
    if (valueSide && ts.isClassDeclaration(node)) {
      classValue(node);
      return;
    }
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      const bound = parameters(
        node.typeParameters ?? [],
        new Set(),
        false,
        symbol,
      );
      if (ts.isTypeAliasDeclaration(node)) syntax(node.type, bound, undefined);
      else {
        const bases = (node.heritageClauses ?? []).flatMap((clause) => [
          ...clause.types,
        ]);
        for (const type of bases) syntax(type, bound, symbol);
        for (const member of node.members.filter(
          (member) => !staticMember(member),
        ))
          syntax(member, bound, symbol);
      }
    } else if (ts.isEnumDeclaration(node) || ts.isEnumMember(node)) {
      // Enum values are scalar; their containing symbol still has exact identity.
    } else if (ts.isVariableDeclaration(node)) {
      if (node.type) syntax(node.type, new Set(), undefined);
      else unsupported(node);
    } else if (
      ts.isFunctionLike(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isTypeLiteralNode(node)
    ) {
      syntax(node, new Set(), undefined);
    } else unsupported(node);
  }
  for (const node of symbol.declarations ?? []) declaration(node);
  return { summary, dependencies, valueDependencies };
}
