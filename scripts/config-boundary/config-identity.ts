/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import ts from 'typescript';

/** Locates the `Config` class declaration across all non-declaration source files. */
export function findConfigClass(
  program: ts.Program,
): ts.ClassDeclaration | undefined {
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    let found: ts.ClassDeclaration | undefined;
    ts.forEachChild(sf, (node) => {
      if (found) return;
      if (ts.isClassDeclaration(node) && node.name?.text === 'Config') {
        found = node;
      }
    });
    if (found) return found;
  }
  return undefined;
}

/** Returns the class symbol for a class declaration, following alias chains. */
export function classSymbol(
  checker: ts.TypeChecker,
  node: ts.ClassDeclaration,
): ts.Symbol | undefined {
  return node.name ? checker.getSymbolAtLocation(node.name) : undefined;
}

/** Walks the `extends` chain from a class, collecting every class symbol. */
export function collectHierarchySymbols(
  checker: ts.TypeChecker,
  start: ts.ClassDeclaration,
): Set<ts.Symbol> {
  const hierarchy = new Set<ts.Symbol>();
  const visited = new Set<ts.ClassDeclaration>();
  let current: ts.ClassDeclaration | undefined = start;
  while (current && !visited.has(current)) {
    visited.add(current);
    const sym = classSymbol(checker, current);
    if (sym) hierarchy.add(sym);
    current = resolveBaseClass(checker, current);
  }
  return hierarchy;
}

function resolveBaseClass(
  checker: ts.TypeChecker,
  cls: ts.ClassDeclaration,
): ts.ClassDeclaration | undefined {
  const extendsClause = cls.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const expr = extendsClause?.types[0]?.expression;
  if (!expr) return undefined;
  let symbol = checker.getSymbolAtLocation(expr);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration && ts.isClassDeclaration(declaration)) return declaration;
  return undefined;
}

export interface ConfigIdentity {
  readonly classNode: ts.ClassDeclaration;
  readonly classSymbol: ts.Symbol;
  readonly hierarchySymbols: ReadonlySet<ts.Symbol>;
  readonly memberNames: ReadonlySet<string>;
}

/** Resolves the Config identity: class node, hierarchy symbols, member names. */
export function resolveConfigIdentity(
  program: ts.Program,
  checker: ts.TypeChecker,
): ConfigIdentity | undefined {
  const classNode = findConfigClass(program);
  if (!classNode || !classNode.name) return undefined;
  const classSym = checker.getSymbolAtLocation(classNode.name);
  if (!classSym) return undefined;
  const hierarchySymbols = collectHierarchySymbols(checker, classNode);
  const instanceType = checker.getDeclaredTypeOfSymbol(classSym);
  const memberNames = new Set(
    instanceType.getApparentProperties().map((member) => member.name),
  );
  return { classNode, classSymbol: classSym, hierarchySymbols, memberNames };
}
