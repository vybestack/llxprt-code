/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import {
  declarationEquation,
  emptySummary,
  resolveSymbol,
  type DeclarationEquation,
  type DeclarationSummary,
} from './runtime-service-shape-syntax.js';

function referenceType(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    'objectFlags' in type &&
    typeof type.objectFlags === 'number' &&
    !!(type.objectFlags & ts.ObjectFlags.Reference)
  );
}

// These equations prove only absence of fixed named typed exposures. Method
// variables remain deferred obligations at checked use sites, even without an
// input producer. Erasure is recorded, never used to certify siblings. The
// declaration closure and every actual receiver argument must both pass.
export function declarationExposureProof(
  roots: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): {
  readonly provesType: (type: ts.Type) => boolean;
  readonly noFixedIntroduction: (type: ts.Type) => boolean;
} {
  const equations = new Map<ts.Symbol, DeclarationEquation>();
  const valueEquations = new Map<ts.Symbol, DeclarationEquation>();
  const settled = new Map<DeclarationEquation, DeclarationSummary>();
  const resolve = (symbol: ts.Symbol): ts.Symbol =>
    resolveSymbol(symbol, checker);
  function equation(symbol: ts.Symbol, value = false): DeclarationEquation {
    const cache = value ? valueEquations : equations;
    let result = cache.get(symbol);
    if (!result) {
      result = declarationEquation(symbol, roots, checker, value);
      cache.set(symbol, result);
    }
    return result;
  }
  function closure(
    start: ts.Symbol,
    value = false,
  ): DeclarationSummary | undefined {
    if (!start.declarations?.length) return undefined;
    const initial = equation(start, value);
    const cached = settled.get(initial);
    if (cached) return cached;
    const pending = new Set([initial]);
    for (const item of pending) {
      if (pending.size > 10000) return undefined;
      for (const dependency of item.dependencies) {
        if (!dependency.declarations?.length) return undefined;
        pending.add(equation(dependency));
      }
      for (const dependency of item.valueDependencies) {
        if (!dependency.declarations?.length) return undefined;
        pending.add(equation(dependency, true));
      }
    }
    // A closure-wide union is a conservative scalar fixed point. No recursive
    // back-edge is a certificate and no partially built equation is cached clean.
    const summary = emptySummary();
    for (const item of pending) {
      const local = item.summary;
      for (const root of local.roots) summary.roots.add(root);
      for (const parameter of local.receiverParameters)
        summary.receiverParameters.add(parameter);
      for (const parameter of local.deferredParameters)
        summary.deferredParameters.add(parameter);
      for (const node of local.unsupported) summary.unsupported.add(node);
      summary.erased ||= local.erased;
    }
    settled.set(initial, summary);
    return summary;
  }
  function noFixedIntroduction(type: ts.Type): boolean {
    const symbol = type.getSymbol();
    if (!symbol) return false;
    const summary = closure(
      resolve(symbol),
      !referenceType(type) &&
        !!(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Module)),
    );
    return !!summary && !summary.roots.size && !summary.unsupported.size;
  }
  function deferredParameter(type: ts.Type, pending: Set<ts.Type>): boolean {
    if (!type.isTypeParameter()) return false;
    const declaration = type.getSymbol()?.declarations?.[0];
    if (
      !declaration ||
      !ts.isTypeParameterDeclaration(declaration) ||
      !ts.isFunctionLike(declaration.parent)
    )
      return false;
    const constraint = type.getConstraint();
    const defaultType = type.getDefault();
    if (constraint) pending.add(constraint);
    if (defaultType) pending.add(defaultType);
    return true;
  }
  function emptyLiteral(type: ts.Type, symbol: ts.Symbol): boolean {
    if (
      !(symbol.flags & ts.SymbolFlags.TypeLiteral) ||
      symbol.declarations?.length
    )
      return false;
    return (
      !type.getProperties().length &&
      !type.getCallSignatures().length &&
      !type.getConstructSignatures().length &&
      !checker.getIndexInfosOfType(type).length
    );
  }
  function tuple(type: ts.TypeReference, pending: Set<ts.Type>): boolean {
    for (const argument of checker.getTypeArguments(type))
      pending.add(argument);
    const owners = new Set<ts.Symbol>();
    for (const property of type.getProperties()) {
      if (/^(0|[1-9][0-9]*)$/.test(property.name) || property.name === 'length')
        continue;
      if (!property.declarations?.length) return false;
      for (const declaration of property.declarations) {
        const owner = declaration.parent;
        if (!ts.isInterfaceDeclaration(owner)) return false;
        const symbol = checker.getSymbolAtLocation(owner.name);
        if (!symbol) return false;
        owners.add(resolve(symbol));
      }
    }
    return (
      owners.size > 0 &&
      [...owners].every((owner) => {
        const summary = closure(owner);
        return !!summary && !summary.roots.size && !summary.unsupported.size;
      })
    );
  }
  function materializedObject(type: ts.Type, symbol: ts.Symbol): boolean {
    if (!(type.flags & ts.TypeFlags.Object) || referenceType(type))
      return false;
    return !!(
      symbol.flags & ts.SymbolFlags.ObjectLiteral ||
      symbol.declarations?.some(ts.isMappedTypeNode)
    );
  }
  function object(
    type: ts.Type,
    symbol: ts.Symbol,
    pending: Set<ts.Type>,
  ): boolean {
    if (symbol?.declarations?.some(ts.isMappedTypeNode)) {
      const materialized = checker.typeToTypeNode(
        type,
        undefined,
        ts.NodeBuilderFlags.InTypeAlias | ts.NodeBuilderFlags.NoTruncation,
      );
      if (!materialized || !ts.isTypeLiteralNode(materialized)) return false;
    }
    for (const argument of type.aliasTypeArguments ?? []) pending.add(argument);
    for (const property of type.getProperties()) {
      const location = property.valueDeclaration ?? property.declarations?.[0];
      if (!location) return false;
      pending.add(checker.getTypeOfSymbolAtLocation(property, location));
    }
    for (const signature of [
      ...type.getCallSignatures(),
      ...type.getConstructSignatures(),
    ]) {
      pending.add(checker.getReturnTypeOfSignature(signature));
      const predicate = checker.getTypePredicateOfSignature(signature);
      if (predicate?.type) pending.add(predicate.type);
    }
    for (const index of checker.getIndexInfosOfType(type))
      pending.add(index.type);
    return true;
  }
  function check(type: ts.Type, pending: Set<ts.Type>): boolean {
    if (pending.size > 10000) return false;
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) pending.add(part);
      return true;
    }
    if (
      type.flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Void |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Never |
        ts.TypeFlags.Any |
        ts.TypeFlags.Unknown)
    )
      return true;
    if (type.flags & ts.TypeFlags.TypeParameter)
      return deferredParameter(type, pending);
    if (checker.isTupleType(type) && referenceType(type))
      return tuple(type, pending);
    const symbol = type.getSymbol();
    if (symbol && roots.has(resolve(symbol))) return false;
    if (
      symbol &&
      symbol.flags & ts.SymbolFlags.Enum &&
      symbol.declarations?.length &&
      symbol.declarations.every(ts.isEnumDeclaration)
    )
      return true;
    if (symbol && materializedObject(type, symbol))
      return object(type, symbol, pending);
    if (!symbol) return false;
    if (emptyLiteral(type, symbol)) return true;
    if (!noFixedIntroduction(type)) return false;
    if (referenceType(type)) {
      for (const argument of checker.getTypeArguments(type))
        pending.add(argument);
      return true;
    }
    return !!(
      symbol.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.Class |
        ts.SymbolFlags.TypeLiteral |
        ts.SymbolFlags.Module)
    );
  }
  function provesType(start: ts.Type): boolean {
    const pending = new Set([start]);
    for (const type of pending) if (!check(type, pending)) return false;
    return true;
  }
  return { provesType, noFixedIntroduction };
}
