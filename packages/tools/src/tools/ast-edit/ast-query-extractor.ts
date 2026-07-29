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
      return this.fallbackExtraction(content, 'unknown');
    }

    try {
      const root = parse(lang, content);
      const declarations: EnhancedDeclaration[] = [];
      const sgRoot = root.root();

      if (JAVASCRIPT_FAMILY_EXTENSIONS.includes(extension)) {
        this.extractJsFamilyDeclarations(sgRoot, declarations);
      } else if (extension === 'py') {
        this.extractPythonDeclarations(sgRoot, declarations);
      } else if (extension === 'rs') {
        this.extractRustDeclarations(sgRoot, declarations);
      } else if (extension === 'c' || extension === 'h') {
        this.extractCDeclarations(sgRoot, declarations);
      } else {
        return this.fallbackExtraction(content, extension);
      }

      return declarations;
    } catch {
      return this.fallbackExtraction(content, extension);
    }
  }

  private extractJsFamilyDeclarations(
    sgRoot: ReturnType<ReturnType<typeof parse>['root']>,
    declarations: EnhancedDeclaration[],
  ): void {
    // Functions
    sgRoot.findAll({ rule: { kind: 'function_declaration' } }).forEach((n) => {
      const nameNode = n.field('name');
      const paramsNode = n.field('parameters');
      const returnTypeNode = n.field('return_type');
      if (nameNode != null) {
        const signature = this.buildSignature(paramsNode, returnTypeNode);
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
        );
      }
    });

    // Methods
    sgRoot.findAll({ rule: { kind: 'method_definition' } }).forEach((n) => {
      const nameNode = n.field('name');
      const paramsNode = n.field('parameters');
      const returnTypeNode = n.field('return_type');
      if (nameNode != null) {
        const signature = this.buildSignature(paramsNode, returnTypeNode);
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
        );
      }
    });

    // Classes
    sgRoot.findAll({ rule: { kind: 'class_declaration' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'class'));
      }
    });

    // Variables
    sgRoot.findAll({ rule: { kind: 'variable_declarator' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'variable'),
        );
      }
    });

    // Imports
    sgRoot.findAll({ rule: { kind: 'import_statement' } }).forEach((n) => {
      const sourceNode = n.field('source');
      declarations.push(
        this.nodeToDeclaration(
          n,
          sourceNode != null ? sourceNode.text() : 'import',
          'import',
        ),
      );
    });
  }

  private extractPythonDeclarations(
    sgRoot: ReturnType<ReturnType<typeof parse>['root']>,
    declarations: EnhancedDeclaration[],
  ): void {
    sgRoot.findAll({ rule: { kind: 'function_definition' } }).forEach((n) => {
      const nameNode = n.field('name');
      const paramsNode = n.field('parameters');
      const returnTypeNode = n.field('return_type');
      if (nameNode != null) {
        const signature = this.buildPythonSignature(paramsNode, returnTypeNode);
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
        );
      }
    });

    sgRoot.findAll({ rule: { kind: 'class_definition' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'class'));
      }
    });
  }

  private extractRustDeclarations(
    sgRoot: ReturnType<ReturnType<typeof parse>['root']>,
    declarations: EnhancedDeclaration[],
  ): void {
    sgRoot.findAll({ rule: { kind: 'function_item' } }).forEach((n) => {
      const nameNode = n.field('name');
      const paramsNode = n.field('parameters');
      const returnTypeNode = n.field('return_type');
      if (nameNode != null) {
        const signature = this.buildPythonSignature(paramsNode, returnTypeNode);
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
        );
      }
    });

    sgRoot.findAll({ rule: { kind: 'struct_item' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'struct'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'trait_item' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'trait'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'enum_item' } }).forEach((n) => {
      const nameNode = n.field('name');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'enum'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'impl_item' } }).forEach((n) => {
      const nameNode = n.field('type');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'impl'));
      }
    });
  }

  private extractCDeclarations(
    sgRoot: ReturnType<ReturnType<typeof parse>['root']>,
    declarations: EnhancedDeclaration[],
  ): void {
    sgRoot.findAll({ rule: { kind: 'function_definition' } }).forEach((n) => {
      const fdec = n.find({ rule: { kind: 'function_declarator' } });
      const nameNode = fdec?.find({ rule: { kind: 'identifier' } });
      const paramsNode = fdec?.find({ rule: { kind: 'parameter_list' } });
      if (nameNode != null) {
        const signature = paramsNode != null ? paramsNode.text() : '()';
        declarations.push(
          this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
        );
      }
    });

    // Function prototypes: `void init(Vec *v);` parse as `declaration` nodes
    // containing a `function_declarator` child (no body). Function-pointer
    // variables (`void (*fp)(int);`) also contain a `function_declarator`, but
    // its name sits inside a `parenthesized_declarator` rather than a direct
    // `identifier` child — those are variables, not prototypes, so skip them.
    sgRoot.findAll({ rule: { kind: 'declaration' } }).forEach((n) => {
      const fdec = n.find({ rule: { kind: 'function_declarator' } });
      if (fdec == null) return;
      const nameNode = fdec.children().find((c) => c.kind() === 'identifier');
      if (nameNode == null) return;
      const paramsNode = fdec.find({ rule: { kind: 'parameter_list' } });
      const signature = paramsNode != null ? paramsNode.text() : '()';
      declarations.push(
        this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
      );
    });

    sgRoot.findAll({ rule: { kind: 'struct_specifier' } }).forEach((n) => {
      const nameNode = n.children().find((c) => c.kind() === 'type_identifier');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'struct'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'union_specifier' } }).forEach((n) => {
      const nameNode = n.children().find((c) => c.kind() === 'type_identifier');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'union'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'enum_specifier' } }).forEach((n) => {
      const nameNode = n.children().find((c) => c.kind() === 'type_identifier');
      if (nameNode != null) {
        declarations.push(this.nodeToDeclaration(n, nameNode.text(), 'enum'));
      }
    });

    sgRoot.findAll({ rule: { kind: 'type_definition' } }).forEach((n) => {
      const name = findCTypedefName(n);
      if (name !== null) {
        declarations.push(this.nodeToDeclaration(n, name, 'typedef'));
      }
    });
  }

  private buildSignature(
    paramsNode: ReturnType<ReturnType<typeof parse>['root']> | null,
    returnTypeNode: ReturnType<ReturnType<typeof parse>['root']> | null,
  ): string {
    let signature = paramsNode != null ? paramsNode.text() : '()';
    if (returnTypeNode != null) {
      signature += returnTypeNode.text();
    }
    return signature;
  }

  private buildPythonSignature(
    paramsNode: ReturnType<ReturnType<typeof parse>['root']> | null,
    returnTypeNode: ReturnType<ReturnType<typeof parse>['root']> | null,
  ): string {
    let signature = paramsNode != null ? paramsNode.text() : '()';
    if (returnTypeNode != null) {
      signature += ` -> ${returnTypeNode.text()}`;
    }
    return signature;
  }

  private nodeToDeclaration(
    n: ReturnType<ReturnType<typeof parse>['root']>,
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

  private fallbackExtraction(
    content: string,
    _language: string,
  ): EnhancedDeclaration[] {
    // Keep the regex-based fallback for robustness
    const declarations: Declaration[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isComment = COMMENT_PREFIXES.some((prefix) =>
        trimmed.startsWith(prefix),
      );
      if (!trimmed || isComment) return;

      if (
        line.includes(KEYWORDS.FUNCTION) ||
        line.includes(KEYWORDS.DEF) ||
        line.includes(KEYWORDS.CLASS)
      ) {
        const name = this.extractNameBasic(trimmed);
        const column = Math.max(0, line.indexOf(name));
        declarations.push({
          name,
          type: trimmed.includes(KEYWORDS.CLASS) ? 'class' : 'function',
          line: index + 1,
          column,
          signature: this.extractSignatureBasic(trimmed),
        });
      }
    });

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
