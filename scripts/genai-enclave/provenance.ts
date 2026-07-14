/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scope-aware provenance resolution for createRequire detection (#2352).
 *
 * Replaces file-global provenance tracking with scope-correct analysis.
 * Factory aliases, bindings, and namespace bindings are resolved per source
 * position, respecting lexical shadowing by nested declarations of the same
 * name.
 *
 * A name is a "factory alias" (or binding, namespace) at position P if the
 * innermost active scope entry at P declares it as such. A "shadow" entry
 * (from a local variable/function/parameter declaration) overrides any
 * broader-scope provenance entry at positions within the shadow's scope.
 *
 * Active ranges:
 * - Module-scoped declarations (ESM imports, TS import-equals): [0, fileEnd].
 * - Block-scoped declarations (const/let/class): [declPos, blockEnd].
 * - Function-scoped declarations (var, function, parameters):
 *   [funcStart, funcEnd] (hoisted).
 */

import ts from 'typescript';

/** The kind of a provenance scope entry. */
export type ProvenanceKind =
  | 'factory'
  | 'binding'
  | 'namespace'
  | 'shadow'
  | 'require-alias';

interface ScopeEntry {
  readonly kind: ProvenanceKind;
  readonly activeFrom: number;
  readonly activeTo: number;
}

/**
 * Determine whether a TS node creates a new lexical scope.
 */
function isScopeNode(node: ts.Node): boolean {
  const guards: ReadonlyArray<(candidate: ts.Node) => boolean> = [
    ts.isSourceFile,
    ts.isBlock,
    ts.isFunctionDeclaration,
    ts.isFunctionExpression,
    ts.isArrowFunction,
    ts.isMethodDeclaration,
    ts.isConstructorDeclaration,
    ts.isGetAccessorDeclaration,
    ts.isSetAccessorDeclaration,
    ts.isCatchClause,
    ts.isForStatement,
    ts.isForInStatement,
    ts.isForOfStatement,
    ts.isModuleDeclaration,
    ts.isSwitchStatement,
  ];
  return guards.some((guard) => guard(node));
}

/**
 * Get the range of the nearest enclosing scope node for `node`.
 * Returns [start, end] positions in the source file.
 */
export function getEnclosingScopeRange(node: ts.Node): {
  readonly start: number;
  readonly end: number;
} {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isScopeNode(current)) {
      return { start: current.getStart(), end: current.getEnd() };
    }
    current = current.parent;
  }
  const sf = node.getSourceFile();
  return { start: 0, end: sf.getEnd() };
}

/**
 * Get the range of the nearest enclosing function (or module) for `node`.
 * Used for var/function-declaration hoisting scope.
 */
function isFunctionScopeNode(node: ts.Node): boolean {
  const guards: ReadonlyArray<(candidate: ts.Node) => boolean> = [
    ts.isFunctionDeclaration,
    ts.isFunctionExpression,
    ts.isArrowFunction,
    ts.isMethodDeclaration,
    ts.isConstructorDeclaration,
    ts.isGetAccessorDeclaration,
    ts.isSetAccessorDeclaration,
    ts.isSourceFile,
  ];
  return guards.some((guard) => guard(node));
}

export function getEnclosingFunctionRange(node: ts.Node): {
  readonly start: number;
  readonly end: number;
} {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isFunctionScopeNode(current)) {
      return { start: current.getStart(), end: current.getEnd() };
    }
    current = current.parent;
  }
  const sf = node.getSourceFile();
  return { start: 0, end: sf.getEnd() };
}

/**
 * Determine whether a VariableDeclaration uses `var` (hoisted) rather than
 * `const` or `let` (block-scoped).
 */
export function isVarDeclaration(node: ts.VariableDeclaration): boolean {
  const list = node.parent;
  if (!ts.isVariableDeclarationList(list)) return false;
  return (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
}

/**
 * Compute the active range for a block-scoped variable declaration.
 * The binding is active from the declaration position to the end of the
 * enclosing block scope.
 */
export function blockScopedRange(node: ts.Node): {
  readonly from: number;
  readonly to: number;
} {
  const range = getEnclosingScopeRange(node);
  return { from: node.getStart(), to: range.end };
}

/**
 * Compute the active range for a hoisted declaration (var, function).
 * The binding is active from the start of the enclosing function scope.
 */
export function hoistedRange(node: ts.Node): {
  readonly from: number;
  readonly to: number;
} {
  const range = getEnclosingFunctionRange(node);
  return { from: range.start, to: range.end };
}

/**
 * Compute the active range for a module-scoped declaration (imports).
 * The binding is active for the entire source file.
 */
export function moduleRange(node: ts.Node): {
  readonly from: number;
  readonly to: number;
} {
  const sf = node.getSourceFile();
  return { from: 0, to: sf.getEnd() };
}

/**
 * Scope-aware provenance resolver. Tracks factory aliases, bindings, namespace
 * bindings, and shadows as scope entries. Resolves the active kind at any
 * source position by finding the innermost active entry.
 */
export class ProvenanceResolver {
  private readonly entries = new Map<string, ScopeEntry[]>();
  private readonly nonShadowKinds: ReadonlySet<ProvenanceKind> = new Set([
    'factory',
    'binding',
    'namespace',
    'require-alias',
  ]);

  /**
   * Register a provenance or shadow entry for `name`.
   */
  register(
    name: string,
    kind: ProvenanceKind,
    activeFrom: number,
    activeTo: number,
  ): void {
    const list = this.entries.get(name);
    const entry: ScopeEntry = { kind, activeFrom, activeTo };
    if (list === undefined) {
      this.entries.set(name, [entry]);
    } else {
      list.push(entry);
    }
  }

  /**
   * Clear all non-shadow entries (factory, binding, namespace, require-alias)
   * for all names. Used during fixed-point iteration so that entries registered
   * in previous passes don't override fresh pass results (Finding1).
   */
  clearNonShadowEntries(): void {
    for (const [name, list] of this.entries) {
      const filtered = list.filter((e) => !this.nonShadowKinds.has(e.kind));
      if (filtered.length === 0) {
        this.entries.delete(name);
      } else {
        this.entries.set(name, filtered);
      }
    }
  }

  /**
   * Resolve the provenance kind of `name` at source position `pos`.
   * Returns the kind of the innermost active entry, or undefined if the name
   * is not declared at `pos`.
   *
   * When multiple entries have the same active range (e.g. from a fixed-point
   * re-pass), non-shadow kinds (factory, binding, namespace, require-alias)
   * take precedence over shadow kinds, so a binding discovered in a later
   * pass is not overridden by a shadow from an earlier pass (Finding1).
   */
  resolve(name: string, pos: number): ProvenanceKind | undefined {
    const list = this.entries.get(name);
    if (list === undefined) return undefined;
    const active = list.filter((e) => e.activeFrom <= pos && pos <= e.activeTo);
    if (active.length === 0) return undefined;
    active.sort((a, b) => {
      const aRange = a.activeTo - a.activeFrom;
      const bRange = b.activeTo - b.activeFrom;
      if (aRange !== bRange) return aRange - bRange;
      // For equal ranges, the entry with the later activeFrom wins so that
      // later/more-nested declarations correctly shadow earlier ones.
      if (a.activeFrom !== b.activeFrom) return b.activeFrom - a.activeFrom;
      // Finding1: only when both range and activeFrom are identical (same
      // declaration re-registered across fixed-point passes) does the
      // non-shadow kind preference apply, so a binding discovered in a later
      // pass wins over a shadow from an earlier pass.
      if (a.kind !== 'shadow' && b.kind === 'shadow') return -1;
      if (a.kind === 'shadow' && b.kind !== 'shadow') return 1;
      return 0;
    });
    return active[0].kind;
  }

  /** True if `name` refers to the createRequire factory at `pos`. */
  isFactoryAlias(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'factory';
  }

  /** True if `name` holds a createRequire return value at `pos`. */
  isBinding(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'binding';
  }

  /** True if `name` is a namespace/default binding from node:module at `pos`. */
  isNamespace(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'namespace';
  }

  /** True if `name` holds a reference to the bare `require` function at `pos`. */
  isRequireAlias(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'require-alias';
  }

  /**
   * True if `name` has ANY entry of `kind` (position-independent).
   * Used for alias-chain detection where a source binding may be established
   * elsewhere in the file.
   */
  hasKindEntry(name: string, kind: ProvenanceKind): boolean {
    const list = this.entries.get(name);
    if (list === undefined) return false;
    return list.some((e) => e.kind === kind);
  }
}

/**
 * The global identifier names that the scanner treats as CommonJS builtins.
 * When any of these is shadowed by a local declaration, the scanner must
 * NOT treat references within the shadow's scope as builtin references.
 */
const CJS_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  'module',
  'exports',
  'Object',
  'require',
]);

/**
 * Tracks lexical shadows of CommonJS global identifiers (`module`,
 * `exports`, `Object`) so the scanner can avoid false positives when a
 * local variable shadows them (F3).
 *
 * A name is shadowed at position P if there is a shadow entry registered for
 * it whose active range contains P.
 */
export class GlobalShadowResolver {
  private readonly shadows = new ProvenanceResolver();

  /**
   * Register that `name` is shadowed by a local declaration in the given
   * active range. Only tracks CJS global names.
   */
  registerShadow(name: string, activeFrom: number, activeTo: number): void {
    if (!CJS_GLOBAL_NAMES.has(name)) return;
    this.shadows.register(name, 'shadow', activeFrom, activeTo);
  }

  /**
   * True if `name` is shadowed by a local declaration at `pos`.
   */
  isShadowed(name: string, pos: number): boolean {
    if (!CJS_GLOBAL_NAMES.has(name)) return false;
    return this.shadows.resolve(name, pos) === 'shadow';
  }
}
