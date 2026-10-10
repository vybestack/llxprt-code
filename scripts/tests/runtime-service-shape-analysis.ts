/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import { declarationExposureProof } from './runtime-service-shape-declarations.js';

export function unalias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

export function directIdentities(
  type: ts.Type,
  roots: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
  visited: ReadonlySet<ts.Type> = new Set(),
): readonly ts.Symbol[] {
  if (visited.has(type)) return [];
  const next = new Set([...visited, type]);
  if (type.isUnionOrIntersection()) {
    return type.types.flatMap((part) =>
      directIdentities(part, roots, checker, next),
    );
  }
  const symbol = type.getSymbol();
  const own =
    symbol && roots.has(unalias(symbol, checker))
      ? [unalias(symbol, checker)]
      : [];
  return [
    ...new Set([
      ...own,
      ...(type.getBaseTypes() ?? []).flatMap((base) =>
        directIdentities(base, roots, checker, next),
      ),
    ]),
  ];
}

interface ServiceSummary {
  readonly identities: ReadonlySet<ts.Symbol>;
  readonly bundle: boolean;
}
interface ServiceNode {
  readonly type: ts.Type;
  readonly parents: Set<ServiceNode>;
  children?: readonly ServiceNode[];
  mode: 'union' | 'product' | 'calls';
  summary: ServiceSummary;
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    'objectFlags' in type &&
    typeof type.objectFlags === 'number' &&
    !!(type.objectFlags & ts.ObjectFlags.Reference)
  );
}

function exposedProperty(property: ts.Symbol): boolean {
  return !(property.declarations ?? []).some((declaration) => {
    const modifiers = ts.canHaveModifiers(declaration)
      ? ts.getModifiers(declaration)
      : undefined;
    if (
      modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword,
      )
    )
      return true;
    if (
      !('name' in declaration) ||
      !declaration.name ||
      typeof declaration.name !== 'object'
    )
      return false;
    return (
      'kind' in declaration.name &&
      declaration.name.kind === ts.SyntaxKind.PrivateIdentifier
    );
  });
}

const contentContainers = new Set([
  'Array',
  'ReadonlyArray',
  'Promise',
  'PromiseLike',
  'Map',
  'ReadonlyMap',
  'WeakMap',
  'Set',
  'ReadonlySet',
  'WeakSet',
  'Iterable',
  'IterableIterator',
  'Iterator',
  'IteratorObject',
  'AsyncIterable',
  'AsyncIterableIterator',
  'AsyncIterator',
  'AsyncIteratorObject',
  'Generator',
  'AsyncGenerator',
]);

export function serviceAnalyzer(
  roots: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
  program: ts.Program,
): (
  type: ts.Type,
  location: ts.Node,
) => ServiceSummary & { incomplete: boolean } {
  const { provesType, noFixedIntroduction } = declarationExposureProof(
    roots,
    checker,
  );
  const nodes = new Map<ts.Type, ServiceNode>();
  function returns(signature: ts.Signature): readonly ts.Type[] {
    const predicate = checker.getTypePredicateOfSignature(signature);
    return [
      checker.getReturnTypeOfSignature(signature),
      ...(predicate?.type ? [predicate.type] : []),
    ];
  }

  const references = new Map<ts.Type, Map<string, ServiceNode>>();
  const calls = new Map<string, ServiceNode>();
  const identities = new Map<ts.Type | ts.Declaration, number>();
  function identity(value: ts.Type | ts.Declaration): number {
    let id = identities.get(value);
    if (id === undefined) {
      id = identities.size;
      identities.set(value, id);
    }
    return id;
  }
  // Instantiated generic methods freshen their bound parameters even when the
  // exposed return graph repeats. Rename only parameters with closed bounds,
  // alongside atomic arguments. Composite arguments may capture a parameter.
  // Target identity and repeated argument positions preserve declaration identity
  // and correlations; dependent constraints retain exact checker identity.
  function atomic(type: ts.Type): boolean {
    return !!(
      type.flags &
      (ts.TypeFlags.Any |
        ts.TypeFlags.Unknown |
        ts.TypeFlags.Never |
        ts.TypeFlags.Void |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.String |
        ts.TypeFlags.StringLiteral |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.NonPrimitive)
    );
  }
  function closedBound(type: ts.Type | undefined): boolean {
    if (!type || atomic(type)) return true;
    if (type.flags & ts.TypeFlags.TypeParameter) return false;
    if (type.isUnionOrIntersection()) return type.types.every(closedBound);
    if (isTypeReference(type) && checker.getTypeArguments(type).length)
      return false;
    const declarations = type.getSymbol()?.declarations;
    return (
      !!declarations?.length &&
      declarations.every(
        (declaration) =>
          (ts.isInterfaceDeclaration(declaration) ||
            ts.isClassDeclaration(declaration)) &&
          ts.isSourceFile(declaration.parent) &&
          !declaration.typeParameters?.length,
      )
    );
  }
  function indexed(type: ts.Type): type is ts.IndexedAccessType {
    return !!(type.flags & ts.TypeFlags.IndexedAccess);
  }
  function canRenameArgument(type: ts.Type): boolean {
    if (indexed(type))
      return (
        closedBound(type.objectType) &&
        !indexed(type.indexType) &&
        canRenameArgument(type.indexType)
      );
    return type.isTypeParameter()
      ? closedBound(type.getConstraint()) && closedBound(type.getDefault())
      : atomic(type);
  }
  function argumentKey(
    type: ts.Type,
    rename: boolean,
    parameters: ts.Type[],
  ): string {
    if (rename && indexed(type))
      return `index:${identity(type.objectType)}[${argumentKey(type.indexType, rename, parameters)}]`;
    const declaration =
      rename && type.isTypeParameter()
        ? type.getSymbol()?.declarations?.[0]
        : undefined;
    if (declaration && type.isTypeParameter()) {
      const constraint = type.getConstraint();
      const defaultType = type.getDefault();
      if (!parameters.includes(type)) parameters.push(type);
      return `parameter:${identity(declaration)}:${constraint ? identity(constraint) : '-'}:${defaultType ? identity(defaultType) : '-'}@${parameters.indexOf(type)}`;
    }
    return `type:${identity(type)}`;
  }
  const dirty = new Set<ServiceNode>();
  function get(type: ts.Type): ServiceNode {
    const reference = isTypeReference(type) ? type : undefined;
    const arguments_ = reference ? checker.getTypeArguments(reference) : [];
    const rename = arguments_.every(canRenameArgument);
    const parameters: ts.Type[] = [];
    const key = reference
      ? arguments_
          .map((argument) => argumentKey(argument, rename, parameters))
          .join(',')
      : undefined;
    const existing =
      nodes.get(type) ??
      (reference && key !== undefined
        ? references.get(reference.target)?.get(key)
        : undefined);
    if (existing) return existing;
    const identities = new Set(
      type.isUnionOrIntersection()
        ? []
        : directIdentities(type, roots, checker),
    );
    const signatures = type.getCallSignatures();
    let callKey: string | undefined;
    const callableOnly =
      !type.getProperties().length &&
      !type.getConstructSignatures().length &&
      signatures.length > 0;
    if (
      !identities.size &&
      !type.isUnionOrIntersection() &&
      !checker.getBaseConstraintOfType(type) &&
      callableOnly
    ) {
      callKey = signatures.flatMap(returns).map(identity).join(',');
    }
    const existingCall = callKey === undefined ? undefined : calls.get(callKey);
    if (existingCall) {
      nodes.set(type, existingCall);
      return existingCall;
    }
    const node: ServiceNode = {
      type,
      parents: new Set(),
      mode: 'product',
      summary: { identities, bundle: identities.size >= 2 },
    };
    nodes.set(type, node);
    if (callKey !== undefined) calls.set(callKey, node);
    if (reference && key !== undefined) {
      let instances = references.get(reference.target);
      if (!instances) {
        instances = new Map();
        references.set(reference.target, instances);
      }
      instances.set(key, node);
    }
    if (identities.size || provesType(type)) node.children = [];
    return node;
  }
  function objectChildren(
    type: ts.Type,
    location: ts.Node,
  ): readonly ts.Type[] {
    const arguments_ = isTypeReference(type)
      ? checker.getTypeArguments(type)
      : [];
    const symbol = type.getSymbol();
    const container =
      checker.isTupleType(type) ||
      (!!symbol &&
        contentContainers.has(symbol.name) &&
        !!symbol.declarations?.some((declaration) =>
          program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
        ));
    if (container && noFixedIntroduction(type)) return arguments_;
    return [
      ...(container ? arguments_ : []),
      ...type
        .getProperties()
        .filter(exposedProperty)
        .map((property) =>
          checker.getTypeOfSymbolAtLocation(
            property,
            property.valueDeclaration ?? property.declarations?.[0] ?? location,
          ),
        ),
    ];
  }
  function expand(node: ServiceNode, location: ts.Node): void {
    const type = node.type;
    let children: readonly ts.Type[];
    if (type.isUnionOrIntersection()) {
      node.mode = type.isUnion() ? 'union' : 'product';
      children = type.types;
    } else {
      const constraint = checker.getBaseConstraintOfType(type);
      const defaultType = type.isTypeParameter()
        ? type.getDefault()
        : undefined;
      const signatures = type.getCallSignatures();
      if (defaultType || (constraint && constraint !== type)) {
        children = [
          ...(constraint && constraint !== type ? [constraint] : []),
          ...(defaultType ? [defaultType] : []),
        ];
      } else if (signatures.length) {
        node.mode = 'calls';
        children = [
          ...signatures.flatMap(returns),
          ...objectChildren(type, location),
          ...type.getConstructSignatures().flatMap(returns),
        ];
      } else if (!(type.flags & ts.TypeFlags.Object)) {
        children = [];
      } else {
        children = [
          ...objectChildren(type, location),
          ...type.getConstructSignatures().flatMap(returns),
        ];
      }
    }
    node.children = children.map(get);
    for (const child of node.children) child.parents.add(node);
    dirty.add(node);
  }
  function settle(): void {
    for (const node of dirty) {
      dirty.delete(node);
      const identities = new Set(node.summary.identities);
      let bundle = node.summary.bundle;
      const previous = new Set<ts.Symbol>();
      for (const child of node.children ?? []) {
        bundle ||= child.summary.bundle;
        for (const identity of child.summary.identities) {
          bundle ||=
            node.mode === 'product' &&
            [...previous].some((other) => other !== identity);
          identities.add(identity);
        }
        for (const identity of child.summary.identities) previous.add(identity);
      }
      if (node.mode === 'calls' && identities.size >= 2) bundle = true;
      if (
        bundle !== node.summary.bundle ||
        identities.size !== node.summary.identities.size
      ) {
        node.summary = { identities, bundle };
        for (const parent of node.parents) dirty.add(parent);
      }
    }
  }
  function enqueueChildren(
    node: ServiceNode,
    pending: ServiceNode[],
    seen: Set<ServiceNode>,
    depthFirst: boolean,
  ): void {
    const children = node.children ?? [];
    for (const child of depthFirst && node.mode === 'union'
      ? [...children].reverse()
      : children) {
      if (seen.has(child)) continue;
      seen.add(child);
      pending.push(child);
    }
  }
  function conditionalAlias(location: ts.Node): boolean {
    if (!ts.isTypeAliasDeclaration(location)) return false;
    if (ts.isConditionalTypeNode(location.type)) return true;
    if (!ts.isTypeReferenceNode(location.type)) return false;
    return !!checker
      .getSymbolAtLocation(location.type.typeName)
      ?.declarations?.some(
        (declaration) =>
          ts.isTypeAliasDeclaration(declaration) &&
          ts.isConditionalTypeNode(declaration.type),
      );
  }
  return (type, location) => {
    const root = get(type);
    const depthFirst = conditionalAlias(location);
    const seen = new Set<ServiceNode>([root]);
    const pending = [root];
    let cursor = 0;
    const hasWork = (): boolean =>
      depthFirst ? pending.length > 0 : cursor < pending.length;
    for (let chunk = 0; chunk < 10 && hasWork(); chunk++) {
      for (let index = 0; index < 1000 && hasWork(); index++) {
        const node = depthFirst ? pending.pop() : pending[cursor++];
        if (!node) break;
        if (!node.children) expand(node, location);
        enqueueChildren(node, pending, seen, depthFirst);
      }
      settle();
      if (root.summary.bundle) break;
    }
    return { ...root.summary, incomplete: hasWork() && !root.summary.bundle };
  };
}
