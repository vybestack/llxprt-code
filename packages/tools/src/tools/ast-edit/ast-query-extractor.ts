/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parse,
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from '../../utils/ast-grep-utils.js';
import { stringOrDefault } from '../../utils/stringCoalescing.js';
import type { EnhancedDeclaration, Declaration } from './types.js';
import { KEYWORDS, COMMENT_PREFIXES } from './constants.js';

/**
 * ASTQueryExtractor handles AST parsing with @ast-grep/napi and declaration extraction.
 */
type SgNode = ReturnType<ReturnType<typeof parse>['root']>;

/** Declaration-bearing AST node kinds per supported language family. */
const JS_DECLARATION_KINDS = [
  'function_declaration',
  'method_definition',
  'class_declaration',
  'variable_declarator',
  'import_statement',
] as const;

const PY_DECLARATION_KINDS = [
  'function_definition',
  'class_definition',
] as const;

const RS_DECLARATION_KINDS = [
  'function_item',
  'struct_item',
  'trait_item',
  'enum_item',
  'impl_item',
] as const;

const C_DECLARATION_KINDS = [
  'function_definition',
  'declaration',
  'struct_specifier',
  'union_specifier',
  'enum_specifier',
  'type_definition',
] as const;

/**
 * Declaration kinds for an extension, or null when the extension has no
 * declaration family and extraction falls back to line scanning.
 */
function declarationKindsFor(extension: string): ReadonlySet<string> | null {
  const family = familyOfExtension(extension);
  return family === null
    ? null
    : new Set<string>(DECLARATION_KINDS_BY_FAMILY[family]);
}

/** Declaration-mapping family names for extensions with AST mappings. */
type DeclarationFamily = 'js' | 'py' | 'rs' | 'c';

const DECLARATION_KINDS_BY_FAMILY: Readonly<
  Record<DeclarationFamily, readonly string[]>
> = {
  js: JS_DECLARATION_KINDS,
  py: PY_DECLARATION_KINDS,
  rs: RS_DECLARATION_KINDS,
  c: C_DECLARATION_KINDS,
};

/**
 * Resolve a file extension to its declaration-mapping family, or null when
 * the extension has none. An extension with an ast-grep mapping but no
 * family (cpp, ruby, go, java, ...) resolves to null so it is never
 * silently interpreted with another family's declaration kinds.
 */
function familyOfExtension(extension: string): DeclarationFamily | null {
  if (JAVASCRIPT_FAMILY_EXTENSIONS.includes(extension)) return 'js';
  if (extension === 'py') return 'py';
  if (extension === 'rs') return 'rs';
  if (extension === 'c' || extension === 'h') return 'c';
  return null;
}

const DECLARATION_FAMILIES: readonly DeclarationFamily[] = [
  'js',
  'py',
  'rs',
  'c',
];

/** Narrow a string to a declaration family name. */
function isDeclarationFamily(value: string): value is DeclarationFamily {
  return (DECLARATION_FAMILIES as readonly string[]).includes(value);
}

/**
 * Narrow an ast-grep node kind (typed generically by the napi bindings) to a
 * string before testing membership in the declaration-kind set.
 */
function kindIn(kinds: ReadonlySet<string>, kind: unknown): boolean {
  return typeof kind === 'string' && kinds.has(kind);
}

/** Map a Rust struct/trait/enum node kind to its declaration type label. */
function rustKindToType(kind: string): Declaration['type'] {
  if (kind === 'struct_item') return 'struct';
  if (kind === 'trait_item') return 'trait';
  return 'enum';
}

/** Map a C struct/union/enum node kind to its declaration type label. */
function cKindToType(kind: string): Declaration['type'] {
  if (kind === 'struct_specifier') return 'struct';
  if (kind === 'union_specifier') return 'union';
  return 'enum';
}

export class ASTQueryExtractor {
  constructor() {}

  async extractDeclarations(
    filePath: string,
    content: string,
  ): Promise<EnhancedDeclaration[]> {
    const extension = stringOrDefault(
      filePath.split('.').pop(),
      '',
    ).toLowerCase();
    const lang = LANGUAGE_MAP[extension];
    if (!lang) {
      // Unsupported/prose files (Markdown, YAML, text, ...) must not produce
      // guessed declarations from the regex fallback.
      return [];
    }

    try {
      const root = parse(lang, content);
      const declarations: EnhancedDeclaration[] = [];
      const sgRoot = root.root();

      const family = familyOfExtension(extension);
      if (family === null) {
        return this.fallbackExtraction(content);
      }
      this.extractFamilyDeclarations(family, sgRoot, declarations);

      return declarations;
    } catch {
      return this.fallbackExtraction(content);
    }
  }

  /**
   * Bounded declaration acquisition with one-over sentinel semantics.
   *
   * Acquires declarations in document order but stops as soon as `limit`
   * have been found, so at most `limit` declarations are ever materialized
   * (no unbounded wrapper array is built and truncated afterwards). Callers
   * pass remaining+1 to detect the first over-limit declaration via
   * `result.length === limit`.
   */
  async extractDeclarationsBounded(
    filePath: string,
    content: string,
    limit: number,
  ): Promise<readonly EnhancedDeclaration[]> {
    // Positive Infinity stays valid (the legacy unbounded fallback needs it);
    // every other non-finite value, NaN above all, would silently disable
    // the limit and materialize the whole file.
    if (!Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
      throw new Error(
        `extractDeclarationsBounded limit must be a number or Infinity, got: ${String(limit)}`,
      );
    }
    const boundedLimit = Math.max(0, Math.floor(limit));
    if (boundedLimit === 0) {
      return [];
    }
    const extension = stringOrDefault(
      filePath.split('.').pop(),
      '',
    ).toLowerCase();
    const lang = LANGUAGE_MAP[extension];
    if (!lang) {
      return [];
    }
    const kinds = declarationKindsFor(extension);
    try {
      const sgRoot = parse(lang, content).root();
      if (kinds === null) {
        return this.fallbackScan(content, boundedLimit);
      }
      return this.walkDeclarationsBounded(
        sgRoot,
        kinds,
        extension,
        boundedLimit,
      );
    } catch {
      return this.fallbackScan(content, boundedLimit);
    }
  }

  /**
   * Explicit-stack pre-order walk that early-exits at the limit and cannot
   * overflow the JS stack on deeply nested input. Extracted to keep the
   * caller's nesting depth within the lint policy.
   */
  private walkDeclarationsBounded(
    sgRoot: SgNode,
    kinds: ReadonlySet<string>,
    extension: string,
    boundedLimit: number,
  ): readonly EnhancedDeclaration[] {
    const declarations: EnhancedDeclaration[] = [];
    const stack: SgNode[] = [sgRoot];
    while (stack.length > 0 && declarations.length < boundedLimit) {
      const node = stack.pop();
      if (node === undefined) {
        break;
      }
      if (kindIn(kinds, node.kind())) {
        const declaration = this.declarationForNode(extension, node);
        if (declaration !== null) {
          declarations.push(declaration);
        }
      }
      const children = node.children();
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push(children[index]);
      }
    }
    return declarations;
  }

  private extractFamilyDeclarations(
    family: DeclarationFamily,
    sgRoot: SgNode,
    declarations: EnhancedDeclaration[],
  ): void {
    this.collectAllByKind(
      family,
      sgRoot,
      DECLARATION_KINDS_BY_FAMILY[family],
      declarations,
    );
  }

  /**
   * Unbounded extraction used by paths that need every declaration: visits
   * kinds in the established per-family order (which the bounded walk's
   * document order intentionally does not need to match).
   */
  private collectAllByKind(
    family: 'js' | 'py' | 'rs' | 'c',
    sgRoot: SgNode,
    kinds: readonly string[],
    declarations: EnhancedDeclaration[],
  ): void {
    for (const kind of kinds) {
      for (const node of sgRoot.findAll({ rule: { kind } })) {
        const declaration = this.declarationForNode(family, node);
        if (declaration !== null) {
          declarations.push(declaration);
        }
      }
    }
  }

  /** Map one AST node to a declaration, or null when it is not one. */
  private declarationForNode(
    familyOrExtension: string,
    node: SgNode,
  ): EnhancedDeclaration | null {
    if (isDeclarationFamily(familyOrExtension)) {
      return this.familyDeclarationForNode(familyOrExtension, node);
    }
    const family = familyOfExtension(familyOrExtension);
    return family === null ? null : this.familyDeclarationForNode(family, node);
  }

  /**
   * Map one AST node to a declaration for a resolved family. Exhaustive by
   * construction: every family is handled and an unreachable value yields
   * no declaration rather than an implicit fallthrough.
   */
  private familyDeclarationForNode(
    family: DeclarationFamily,
    node: SgNode,
  ): EnhancedDeclaration | null {
    switch (family) {
      case 'js':
        return this.jsDeclarationForNode(node);
      case 'py':
        return this.pythonDeclarationForNode(node);
      case 'rs':
        return this.rustDeclarationForNode(node);
      case 'c':
        return this.cDeclarationForNode(node);
      default:
        return null;
    }
  }

  private jsDeclarationForNode(node: SgNode): EnhancedDeclaration | null {
    switch (node.kind()) {
      case 'function_declaration':
      case 'method_definition': {
        const nameNode = node.field('name');
        if (nameNode == null) return null;
        const signature = this.buildSignature(
          node.field('parameters'),
          node.field('return_type'),
        );
        return this.nodeToDeclaration(
          node,
          nameNode.text(),
          'function',
          signature,
        );
      }
      case 'class_declaration': {
        const nameNode = node.field('name');
        return nameNode != null
          ? this.nodeToDeclaration(node, nameNode.text(), 'class')
          : null;
      }
      case 'variable_declarator': {
        const nameNode = node.field('name');
        return nameNode != null
          ? this.nodeToDeclaration(node, nameNode.text(), 'variable')
          : null;
      }
      case 'import_statement': {
        const sourceNode = node.field('source');
        return this.nodeToDeclaration(
          node,
          sourceNode != null ? sourceNode.text() : 'import',
          'import',
        );
      }
      default:
        return null;
    }
  }

  private pythonDeclarationForNode(node: SgNode): EnhancedDeclaration | null {
    switch (node.kind()) {
      case 'function_definition': {
        const nameNode = node.field('name');
        if (nameNode == null) return null;
        const signature = this.buildPythonSignature(
          node.field('parameters'),
          node.field('return_type'),
        );
        return this.nodeToDeclaration(
          node,
          nameNode.text(),
          'function',
          signature,
        );
      }
      case 'class_definition': {
        const nameNode = node.field('name');
        return nameNode != null
          ? this.nodeToDeclaration(node, nameNode.text(), 'class')
          : null;
      }
      default:
        return null;
    }
  }

  private rustDeclarationForNode(node: SgNode): EnhancedDeclaration | null {
    switch (node.kind()) {
      case 'function_item': {
        const nameNode = node.field('name');
        if (nameNode == null) return null;
        const signature = this.buildPythonSignature(
          node.field('parameters'),
          node.field('return_type'),
        );
        return this.nodeToDeclaration(
          node,
          nameNode.text(),
          'function',
          signature,
        );
      }
      case 'struct_item':
      case 'trait_item':
      case 'enum_item': {
        const nameNode = node.field('name');
        if (nameNode == null) return null;
        const type = rustKindToType(String(node.kind()));
        return this.nodeToDeclaration(node, nameNode.text(), type);
      }
      case 'impl_item': {
        const nameNode = node.field('type');
        return nameNode != null
          ? this.nodeToDeclaration(node, nameNode.text(), 'impl')
          : null;
      }
      default:
        return null;
    }
  }

  private cDeclarationForNode(node: SgNode): EnhancedDeclaration | null {
    switch (node.kind()) {
      case 'function_definition':
        return this.cFunctionForNode(node);
      case 'declaration':
        // Function prototypes: `void init(Vec *v);` parse as `declaration`
        // nodes containing a `function_declarator` child (no body).
        // Function-pointer variables (`void (*fp)(int);`) also contain a
        // `function_declarator`, but its name sits inside a
        // `parenthesized_declarator` rather than a direct `identifier`
        // child — those are variables, not prototypes, so skip them.
        return this.cPrototypeForNode(node);
      case 'struct_specifier':
      case 'union_specifier':
      case 'enum_specifier': {
        const nameNode = node
          .children()
          .find((child) => child.kind() === 'type_identifier');
        if (nameNode == null) return null;
        const type = cKindToType(String(node.kind()));
        return this.nodeToDeclaration(node, nameNode.text(), type);
      }
      case 'type_definition': {
        const name = findCTypedefName(node);
        return name !== null
          ? this.nodeToDeclaration(node, name, 'typedef')
          : null;
      }
      default:
        return null;
    }
  }

  private cFunctionForNode(node: SgNode): EnhancedDeclaration | null {
    const declarator = node.find({ rule: { kind: 'function_declarator' } });
    const nameNode = declarator?.find({ rule: { kind: 'identifier' } });
    if (nameNode == null) return null;
    const paramsNode = declarator?.find({ rule: { kind: 'parameter_list' } });
    const signature = paramsNode != null ? paramsNode.text() : '()';
    return this.nodeToDeclaration(node, nameNode.text(), 'function', signature);
  }

  private cPrototypeForNode(node: SgNode): EnhancedDeclaration | null {
    const declarator = node.find({ rule: { kind: 'function_declarator' } });
    if (declarator == null) return null;
    const nameNode = declarator
      .children()
      .find((child) => child.kind() === 'identifier');
    if (nameNode == null) return null;
    const paramsNode = declarator.find({ rule: { kind: 'parameter_list' } });
    const signature = paramsNode != null ? paramsNode.text() : '()';
    return this.nodeToDeclaration(node, nameNode.text(), 'function', signature);
  }

  private buildSignature(
    paramsNode: SgNode | null,
    returnTypeNode: SgNode | null,
  ): string {
    let signature = paramsNode != null ? paramsNode.text() : '()';
    if (returnTypeNode != null) {
      signature += returnTypeNode.text();
    }
    return signature;
  }

  private buildPythonSignature(
    paramsNode: SgNode | null,
    returnTypeNode: SgNode | null,
  ): string {
    let signature = paramsNode != null ? paramsNode.text() : '()';
    if (returnTypeNode != null) {
      signature += ` -> ${returnTypeNode.text()}`;
    }
    return signature;
  }

  private nodeToDeclaration(
    n: SgNode,
    name: string,
    type: Declaration['type'],
    signature?: string,
  ): EnhancedDeclaration {
    const range = n.range();
    return {
      name,
      type,
      line: range.start.line + 1,
      column: range.start.column,
      range: {
        start: { line: range.start.line + 1, column: range.start.column },
        end: { line: range.end.line + 1, column: range.end.column },
      },
      visibility: 'public',
      signature,
    };
  }

  private fallbackExtraction(content: string): EnhancedDeclaration[] {
    return this.fallbackScan(content, Number.POSITIVE_INFINITY);
  }

  /**
   * Line-scan fallback bounded by a declaration limit: stops scanning as
   * soon as the limit is reached so over-limit inputs never materialize
   * fully (used by the bounded working-set path and, unbounded, as the
   * legacy fallback).
   */
  private fallbackScan(content: string, limit: number): EnhancedDeclaration[] {
    const lines = content.split('\n');
    const declarations: Declaration[] = [];
    for (const [index, line] of lines.entries()) {
      if (
        declarations.length >= limit ||
        !this.isDeclarationLine(line.trim())
      ) {
        continue;
      }
      this.pushFallbackDeclaration(declarations, line, index);
    }

    return declarations.map((decl) => ({
      ...decl,
      range: {
        start: { line: decl.line, column: decl.column },
        end: { line: decl.line, column: decl.column + decl.name.length },
      },
      visibility: 'public',
      signature: decl.signature,
    }));
  }

  /**
   * True when a trimmed line is a non-blank, non-comment line that contains
   * a declaration keyword (function, def, or class). Extracted to keep the
   * scan loop's break/continue count within the lint policy.
   */
  private isDeclarationLine(trimmed: string): boolean {
    if (!trimmed) {
      return false;
    }
    const isComment = COMMENT_PREFIXES.some((prefix) =>
      trimmed.startsWith(prefix),
    );
    if (isComment) {
      return false;
    }
    return (
      trimmed.includes(KEYWORDS.FUNCTION) ||
      trimmed.includes(KEYWORDS.DEF) ||
      trimmed.includes(KEYWORDS.CLASS)
    );
  }

  /** Push one fallback declaration from a scanned declaration line. */
  private pushFallbackDeclaration(
    declarations: Declaration[],
    line: string,
    index: number,
  ): void {
    const name = this.extractNameBasic(line.trim());
    declarations.push({
      name,
      type: line.includes(KEYWORDS.CLASS) ? 'class' : 'function',
      line: index + 1,
      // Column must reflect the raw line: trimming first would report the
      // name's offset inside the trimmed text and lose the indentation.
      column: Math.max(0, line.indexOf(name)),
      signature: this.extractSignatureBasic(line.trim()),
    });
  }

  private extractNameBasic(line: string): string {
    // Use string scanning instead of regex to avoid polynomial backtracking.
    for (const keyword of ['function', 'def', 'class']) {
      const name = extractWordAfterKeyword(line, keyword);
      if (name !== null) {
        return name;
      }
    }
    return 'unknown';
  }

  private extractSignatureBasic(line: string): string {
    // Capture parameters: ( ... ). Use index scanning instead of a regex to
    // avoid polynomial backtracking on lines with many unmatched parentheses.
    const open = line.indexOf('(');
    if (open !== -1) {
      const close = line.indexOf(')', open + 1);
      if (close !== -1) {
        return `(${line.slice(open + 1, close)})`;
      }
    }
    return '';
  }
}

/**
 * Finds the identifier word immediately following a keyword in a line.
 * Uses linear scanning to avoid regex backtracking.
 * Returns null if the keyword is absent or no identifier follows it.
 */
function extractWordAfterKeyword(line: string, keyword: string): string | null {
  const idx = line.indexOf(keyword);
  if (idx === -1) {
    return null;
  }
  const after = line.slice(idx + keyword.length);
  const match = after.trimStart().match(/^[A-Za-z_$][\w$]*/);
  return match ? match[0] : null;
}

/**
 * Resolves the declared name of a C typedef.
 *
 * Tree-sitter C represents the declarator differently depending on the
 * typedef form:
 * - Simple: `typedef unsigned long size_t;` → a `type_identifier` child
 *   is the declared name.
 * - Function pointer: `typedef int (*compare_fn)(int, int);` → the name
 *   sits inside a nested `pointer_declarator`→`type_identifier`.
 * Returns null for anonymous typedefs without a declarator name.
 */
function findCTypedefName(
  typedefNode: ReturnType<ReturnType<typeof parse>['root']>,
): string | null {
  const direct = typedefNode
    .children()
    .find((c) => c.kind() === 'type_identifier');
  if (direct != null) {
    return direct.text();
  }
  const pointerDeclarator = typedefNode.find({
    rule: { kind: 'pointer_declarator' },
  });
  const pointerName = pointerDeclarator?.find({
    rule: { kind: 'type_identifier' },
  });
  if (pointerName != null) {
    return pointerName.text();
  }
  const arrayDeclarator = typedefNode.find({
    rule: { kind: 'array_declarator' },
  });
  const arrayName = arrayDeclarator?.find({
    rule: { kind: 'type_identifier' },
  });
  if (arrayName != null) {
    return arrayName.text();
  }
  // `typedef unsigned long size_t;` — the grammar assigns the declared
  // name to a trailing `primitive_type` (not `type_identifier`). The last
  // primitive_type child before the semicolon is the typedef name.
  const primitiveChildren = typedefNode
    .children()
    .filter(
      (c) => c.kind() === 'primitive_type' || c.kind() === 'type_identifier',
    );
  if (primitiveChildren.length > 0) {
    return primitiveChildren[primitiveChildren.length - 1].text();
  }
  return null;
}
