/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';

/** A position where a class keeps a declared value. */
export interface StoredDeclaration {
  /** The field or parameter property, which is where a finding belongs. */
  readonly node: ts.Node;
  readonly type: ts.Type;
}

/** Verdict of the exposure analysis over the configured service roots. */
export interface ServiceAnalysisSummary {
  readonly bundle: boolean;
  readonly incomplete: boolean;
}

export type ServiceAnalysis = (
  type: ts.Type,
  location: ts.Node,
) => ServiceAnalysisSummary;

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    'objectFlags' in type &&
    typeof type.objectFlags === 'number' &&
    !!(type.objectFlags & ts.ObjectFlags.Reference)
  );
}

function isClassType(type: ts.Type): boolean {
  return !!type.getSymbol()?.declarations?.some(ts.isClassDeclaration);
}

/**
 * The declared types a class keeps: its fields and its constructor parameter
 * properties. Visibility does not matter, because private, protected and `#`
 * storage keeps the value just as public storage does.
 *
 * A class that owns several collaborators is the design the runtime boundary
 * wants, so the class itself is never a bundle. Each stored position is judged
 * on its own declared type instead.
 */
export function classStoredDeclarations(
  node: ts.ClassDeclaration,
  checker: ts.TypeChecker,
): readonly StoredDeclaration[] {
  const stored: StoredDeclaration[] = [];
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member))
      stored.push({ node: member, type: checker.getTypeAtLocation(member) });
    if (!ts.isConstructorDeclaration(member)) continue;
    for (const parameter of member.parameters) {
      if (!parameter.modifiers?.length) continue;
      stored.push({
        node: parameter,
        type: checker.getTypeAtLocation(parameter),
      });
    }
  }
  return stored;
}

/**
 * Answers whether a declared type stores a bundle, meaning a type that groups
 * two or more configured runtime services.
 *
 * An interface, type alias, object-literal type or mapped type is a bundle when
 * the exposure analysis over the services finds two or more of them, which is
 * the definition the guard already uses for its declarations. An intersection
 * groups every part at once, so it is judged as a product by the same analysis,
 * which is how a flat aggregate like `A & B` or `{ ...a, ...b }` reads. A union
 * stores one alternative at a time, so it is not a bundle. A class type is an
 * owner rather than a grouping: it is a bundle only through the type arguments
 * it was given, because an owner holding several single-service collaborators
 * is the shape the boundary wants.
 */
export function storedServiceBundle(
  type: ts.Type,
  checker: ts.TypeChecker,
  analyze: ServiceAnalysis,
  location: ts.Node,
  visited: ReadonlySet<ts.Type> = new Set(),
): boolean {
  if (visited.has(type)) return false;
  const path = new Set([...visited, type]);
  if (type.isUnion()) return false;
  if (type.isIntersection()) return analyze(type, location).bundle;
  return isClassType(type)
    ? !!isTypeReference(type) &&
        checker
          .getTypeArguments(type)
          .some((argument) =>
            storedServiceBundle(argument, checker, analyze, location, path),
          )
    : analyze(type, location).bundle;
}
