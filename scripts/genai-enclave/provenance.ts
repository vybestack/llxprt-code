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
  | 'helper'
  | 'helper-container'
  | 'shadow'
  | 'require-alias';

interface ScopeEntry {
  readonly kind: ProvenanceKind;
  readonly activeFrom: number;
  readonly activeTo: number;
  /**
   * Source position of the declaration that created this entry. Used to
   * distinguish a re-registration of the same declaration across fixed-point
   * passes (same declPos) from a genuinely different declaration at the same
   * scope range (different declPos). A later declPos shadows an earlier one.
   */
  readonly declPos: number;
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
    ts.isClassStaticBlockDeclaration,
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
  private readonly entries = new Map<string, readonly ScopeEntry[]>();
  private registrationRevision = 0;

  get revision(): number {
    return this.registrationRevision;
  }

  /**
   * Register a provenance or shadow entry for `name`.
   * `declPos` is the source position of the declaration that created this
   * entry; it distinguishes a re-registration of the same declaration across
   * fixed-point passes (same declPos) from a genuinely different declaration
   * at the same scope range (different declPos, later one shadows).
   */
  register(
    name: string,
    kind: ProvenanceKind,
    activeFrom: number,
    activeTo: number,
    declPos: number,
  ): boolean {
    const list = this.entries.get(name) ?? [];
    const alreadyRegistered = list.some(
      (entry) =>
        entry.kind === kind &&
        entry.activeFrom === activeFrom &&
        entry.activeTo === activeTo &&
        entry.declPos === declPos,
    );
    if (alreadyRegistered) return false;
    const entry: ScopeEntry = { kind, activeFrom, activeTo, declPos };
    this.entries.set(name, [...list, entry]);
    this.registrationRevision += 1;
    return true;
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
      // For equal ranges, the entry with the later declPos wins so that
      // a later declaration (shadowing or not) at the same scope range
      // takes precedence over an earlier one.
      if (a.declPos !== b.declPos) return b.declPos - a.declPos;
      // Finding1: only when both range and declPos are identical (same
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

  /** True if `name` resolves to a createRequire-returning helper at `pos`. */
  isHelper(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'helper';
  }

  /** True if `name` resolves to an object containing tracked helpers. */
  isHelperContainer(name: string, pos: number): boolean {
    return this.resolve(name, pos) === 'helper-container';
  }

  /**
   * Return the active range of the declaration entry for `name` that is
   * active at `pos`. This is the scope range of the binding (const/let/var/
   * function) that declares `name` at the source position.
   *
   * Used by assignment alias collection so that `r = require` inside an
   * inner block registers the alias for the lifetime of the outer `let r`
   * declaration, not just the inner block (Finding2b: assignment lifetime
   * follows outer LHS binding).
   */
  declarationRangeAt(
    name: string,
    pos: number,
  ): { readonly from: number; readonly to: number } | undefined {
    const list = this.entries.get(name);
    if (list === undefined) return undefined;
    const active = list.filter((e) => e.activeFrom <= pos && pos <= e.activeTo);
    if (active.length === 0) return undefined;
    active.sort((a, b) => {
      const aRange = a.activeTo - a.activeFrom;
      const bRange = b.activeTo - b.activeFrom;
      return aRange - bRange;
    });
    return { from: active[0].activeFrom, to: active[0].activeTo };
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
    this.shadows.register(name, 'shadow', activeFrom, activeTo, activeFrom);
  }

  /**
   * True if `name` is shadowed by a local declaration at `pos`.
   */
  isShadowed(name: string, pos: number): boolean {
    if (!CJS_GLOBAL_NAMES.has(name)) return false;
    return this.shadows.resolve(name, pos) === 'shadow';
  }
}
