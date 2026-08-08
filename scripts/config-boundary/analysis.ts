/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import ts from 'typescript';

/** Returns the class symbol containing a declaration by walking up the tree. */
function containingClassSymbol(
  checker: ts.TypeChecker,
  declaration: ts.Node,
): ts.Symbol | undefined {
  let node: ts.Node | undefined = declaration;
  while (node) {
    if (ts.isClassDeclaration(node) && node.name) {
      return checker.getSymbolAtLocation(node.name);
    }
    node = node.parent;
  }
  return undefined;
}

/** True when a member symbol is declared anywhere on the Config hierarchy. */
function memberOriginatesFromConfig(
  checker: ts.TypeChecker,
  member: ts.Symbol,
  hierarchy: ReadonlySet<ts.Symbol>,
): boolean {
  return (
    member.declarations?.some((declaration) => {
      const container = containingClassSymbol(checker, declaration);
      return container !== undefined && hierarchy.has(container);
    }) ?? false
  );
}

/**
 * Resolves a member on a possibly-union/intersection receiver by decomposing
 * it (the P01 method). `getPropertyOfType` returns nothing for `Config |
 * undefined` because the property is not on every constituent; recursing into
 * each constituent recovers optional-chaining (`config?.x`) accesses.
 */
function resolveConfigMember(
  checker: ts.TypeChecker,
  receiver: ts.Type,
  name: string,
): ts.Symbol | undefined {
  if (receiver.isUnion() || receiver.isIntersection()) {
    for (const constituent of receiver.types) {
      const resolved = resolveConfigMember(checker, constituent, name);
      if (resolved) return resolved;
    }
    return undefined;
  }
  return checker.getPropertyOfType(receiver, name);
}

export interface MemberRead {
  readonly name: string;
  readonly line: number;
}

/**
 * Collects the distinct Config members read in a source file by resolving each
 * property access's receiver type. This is what makes the guard immune to the
 * three syntactic failure modes: deps-property receivers (`this.deps.config.x`),
 * forwarding (unannotated locals), and optional chaining are all resolved by
 * the checker rather than by text binding.
 */
export function collectConfigMemberReads(
  program: ts.Program,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  identity: {
    readonly memberNames: ReadonlySet<string>;
    readonly hierarchySymbols: ReadonlySet<ts.Symbol>;
  },
): MemberRead[] {
  const reads: MemberRead[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      identity.memberNames.has(node.name.text)
    ) {
      const receiverType = checker.getTypeAtLocation(node.expression);
      const resolved = resolveConfigMember(
        checker,
        receiverType,
        node.name.text,
      );
      if (
        resolved &&
        memberOriginatesFromConfig(
          checker,
          resolved,
          identity.hierarchySymbols,
        ) &&
        !seen.has(node.name.text)
      ) {
        seen.add(node.name.text);
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.name.getStart(),
        );
        reads.push({ name: node.name.text, line: position.line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  void program;
  return reads;
}

/** Follows the alias chain on an import symbol to its final target. */
function followAliases(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  let depth = 0;
  while (current.flags & ts.SymbolFlags.Alias && depth < 12) {
    try {
      current = checker.getAliasedSymbol(current);
    } catch {
      break;
    }
    depth++;
  }
  return current;
}

/** True when an imported local resolves (through re-exports) to the Config symbol. */
function resolvesToConfig(
  checker: ts.TypeChecker,
  localSymbol: ts.Symbol,
  configSymbol: ts.Symbol,
): boolean {
  return followAliases(checker, localSymbol) === configSymbol;
}

/** Detects whether a file imports the Config type by name (any specifier). */
export function importsConfigType(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  configSymbol: ts.Symbol,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const specifier of node.importClause.namedBindings.elements) {
        const local = checker.getSymbolAtLocation(specifier.name);
        if (local && resolvesToConfig(checker, local, configSymbol)) {
          found = true;
          return;
        }
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/** Detects whether a file constructs `new Config(...)` (a legitimate factory). */
export function constructsNewConfig(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  configSymbol: ts.Symbol,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isNewExpression(node)) {
      const constructed = resolveExpressionSymbol(checker, node.expression);
      if (constructed && followAliases(checker, constructed) === configSymbol) {
        found = true;
        return;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/** Extracts the symbol for a type-level entity (identifier or qualified name). */
function symbolOfTypeEntity(
  checker: ts.TypeChecker,
  node: ts.EntityName,
): ts.Symbol | undefined {
  return checker.getSymbolAtLocation(node);
}

/** True when a symbol resolves (through aliases) to the Config class symbol. */
function symbolIsConfig(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
  configSymbol: ts.Symbol,
): boolean {
  if (!symbol) return false;
  return followAliases(checker, symbol) === configSymbol;
}

export interface TypeLevelReference {
  readonly form: string;
  readonly line: number;
}

/**
 * Detects type-level references to Config that the member-read walker misses.
 *
 * Catches every form listed in P07b: indexed access (`Config['x']`), `typeof
 * Config`, `keyof Config`, generic arguments (`Foo<Config>`), heritage clauses
 * (`extends Config` / `implements Config`), type alias RHS (`type T = Config`),
 * and mapped/utility types (`Pick<Config, ...>`, `Omit<Config, ...>`,
 * `Partial<Config>`).
 *
 * The implementation walks the full AST. A `TypeReferenceNode` whose
 * `typeName` resolves to Config covers direct annotations, indexed-access
 * objects, nested generic arguments, and utility-type arguments in one pass.
 * `TypeQueryNode` catches `typeof Config`. `ExpressionWithTypeArguments`
 * catches heritage-clause references.
 */
export function collectConfigTypeReferences(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  configSymbol: ts.Symbol,
): TypeLevelReference[] {
  const refs: TypeLevelReference[] = [];
  const seen = new Set<number>();
  const record = (node: ts.Node, form: string): void => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!seen.has(line)) {
      seen.add(line);
      refs.push({ form, line });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const symbol = symbolOfTypeEntity(checker, node.typeName);
      if (symbolIsConfig(checker, symbol, configSymbol)) {
        record(node, 'type-reference');
      }
    }
    if (ts.isTypeQueryNode(node)) {
      const symbol = symbolOfTypeEntity(checker, node.exprName);
      if (symbolIsConfig(checker, symbol, configSymbol)) {
        record(node, 'typeof');
      }
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (symbolIsConfig(checker, symbol, configSymbol)) {
        record(node, 'heritage');
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return refs;
}

function resolveExpressionSymbol(
  checker: ts.TypeChecker,
  expression: ts.LeftHandSideExpression,
): ts.Symbol | undefined {
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression)
  ) {
    return checker.getSymbolAtLocation(expression);
  }
  return undefined;
}
