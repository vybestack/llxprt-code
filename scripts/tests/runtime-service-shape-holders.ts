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
  /** The configured roots the analysed type reaches. */
  readonly identities: ReadonlySet<ts.Symbol>;
  readonly bundle: boolean;
  readonly incomplete: boolean;
}

export type ServiceAnalysis = (
  type: ts.Type,
  location: ts.Node,
) => ServiceAnalysisSummary;

/**
 * The two readings a declared type gets. `services` counts the configured
 * service roots, which is the definition of a bag that hands services out.
 * `merged` counts every configured runtime capability, services plus separately
 * configured runtime objects, which is what a flattened aggregate exposes: the
 * capabilities themselves behind their operations.
 */
export interface ServiceAnalyses {
  readonly services: ServiceAnalysis;
  readonly merged: ServiceAnalysis;
}

/**
 * What a stored or declared position holds: a bag, a shape the analysis could
 * not finish, or neither. A limit is never folded into "not a bag", because a
 * scan that gives up must report that it gave up.
 */
export interface StoredVerdict {
  readonly bundle: boolean;
  readonly incomplete: boolean;
}

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
 * wants when those collaborators stay private. Each stored position is also
 * judged on its own declared type, independently of the public class surface.
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
 * Answers whether a declared type stores a bag, meaning a type that groups two
 * or more configured runtime services.
 *
 * An interface, type alias, object-literal type or mapped type is a bag when
 * the exposure analysis over the services finds two or more of them, which is
 * the definition the guard already uses for its declarations. An intersection
 * groups every part at once, so the same analysis reads it as a product; that
 * is how a flat aggregate such as `A & B`, an `Object.assign` result or a spread
 * of several services reads. A union is an alternative, so it stores a bag only
 * when one of its branches does, which covers an optional bag such as
 * `Ports | undefined` without calling `Scheduler | Context` a bag.
 *
 * A class type is a bag when its public instance surface exposes two or more
 * runtime services, read exactly as an interface is: public fields, public
 * getters and public methods whose return type carries a service. An owner that
 * keeps its collaborators private, protected or `#` and publishes operations
 * instead exposes none, which is the design the boundary wants; that is why
 * BaseProvider and the workspace owners are not findings. A class handed a bag
 * as a type argument is still a bag through that argument, so `Cell<Bundle>`
 * remains a finding.
 *
 * An unfinished analysis of any branch is reported rather than dropped, so the
 * caller learns that the position is undecided instead of reading it as clean.
 */
export function storedServiceVerdict(
  type: ts.Type,
  checker: ts.TypeChecker,
  analyze: ServiceAnalysis,
  location: ts.Node,
  visited: ReadonlySet<ts.Type> = new Set(),
): StoredVerdict {
  if (visited.has(type)) return { bundle: false, incomplete: false };
  const path = new Set([...visited, type]);
  if (type.isUnion()) {
    const branches = type.types.map((branch) =>
      storedServiceVerdict(branch, checker, analyze, location, path),
    );
    return {
      bundle: branches.some((branch) => branch.bundle),
      incomplete: branches.some((branch) => branch.incomplete),
    };
  }
  if (type.isIntersection()) return analyze(type, location);
  if (isClassType(type)) {
    const surface = analyze(type, location);
    const arguments_ = isTypeReference(type)
      ? checker
          .getTypeArguments(type)
          .map((argument) =>
            storedServiceVerdict(argument, checker, analyze, location, path),
          )
      : [];
    return {
      bundle: surface.bundle || arguments_.some((argument) => argument.bundle),
      incomplete:
        surface.incomplete ||
        arguments_.some((argument) => argument.incomplete),
    };
  }
  return analyze(type, location);
}

/**
 * The parts a type merges. Only an intersection merges parts for this rule.
 * `Object.assign({}, a, b)` and `{ ...a, ...b }` type as an intersection, so the
 * flat object a builder hands out is exactly the intersection case. Interface
 * heritage is a different construct: it names one port that includes other
 * ports, which is composition the boundary asks for, and a class with several
 * bases is an owner implementing capabilities. Neither is a flattened
 * aggregate, so neither is judged here.
 */
function mergedParts(type: ts.Type): readonly ts.Type[] | undefined {
  if (!type.isIntersection()) return undefined;
  return type.types.flatMap((part) =>
    part.isIntersection() ? [...part.types] : [part],
  );
}

/**
 * A named shape that exposes at least one operation: an interface, type alias,
 * object-literal type or mapped type with a callable member. A class is an owner
 * rather than a surface, so its type is not one.
 *
 * An optional member such as `restartExtension?: () => Promise<void>` has the
 * type `(() => Promise<void>) | undefined`, and a union of a function with
 * `undefined` has no call signatures. The operation is still there when the
 * member is present, so null and undefined are removed before asking. Otherwise
 * a whole part of a flattened aggregate reads as data and the aggregate goes
 * unreported, which is exactly the CliUiRuntime shape.
 */
function operationSurface(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnionOrIntersection()) return false;
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const symbol = type.getSymbol();
  if (symbol?.declarations?.some(ts.isClassDeclaration)) return false;
  const named =
    !symbol ||
    !!symbol.declarations?.some(
      (declaration) =>
        ts.isInterfaceDeclaration(declaration) ||
        ts.isTypeAliasDeclaration(declaration) ||
        ts.isTypeLiteralNode(declaration),
    );
  if (!named) return false;
  return type.getProperties().some((property) => {
    const member = checker.getTypeOfSymbol(property);
    return checker.getNonNullableType(member).getCallSignatures().length > 0;
  });
}

/**
 * Answers whether a declared type is a flattened aggregate: two or more of its
 * merged parts each expose operations and each independently reach a configured
 * runtime capability, and together they reach at least two different ones. That
 * is the whole-bag carrier the boundary forbids, because one object then hands a
 * consumer several unrelated capabilities.
 *
 * The rule is about composition, never about a name or a path. A part that
 * exposes no operation is data, and data does not carry a capability. A single
 * capable part is one port, however wide, which is the shape the boundary wants.
 * Two parts that reach the same capability are one capability read two ways, so
 * they are not reported either.
 *
 * A part reaches a capability through the merged reading, services and
 * separately configured runtime objects together, because a flattened aggregate
 * re-exports the capability behind its operation rather than handing the service
 * itself out.
 */
export function mergesServiceSurfaces(
  type: ts.Type,
  checker: ts.TypeChecker,
  analyses: ServiceAnalyses,
  location: ts.Node,
): StoredVerdict {
  const parts = mergedParts(type);
  if (!parts) return { bundle: false, incomplete: false };
  const readings = parts.map((part) => ({
    surface: operationSurface(part, checker),
    summary: analyses.merged(part, location),
  }));
  const capable = readings.filter(
    (reading) => reading.surface && reading.summary.identities.size > 0,
  );
  const reached = new Set(
    capable.flatMap((reading) => [...reading.summary.identities]),
  );
  return {
    bundle: capable.length >= 2 && reached.size >= 2,
    incomplete: readings.some((reading) => reading.summary.incomplete),
  };
}
