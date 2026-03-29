/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@ast-grep/napi';
import {
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from '../../utils/ast-grep-utils.js';
import type { EnhancedDeclaration, Declaration, SgNode } from './types.js';
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
    const extension = (filePath.split('.').pop() || '').toLowerCase();
    const lang = LANGUAGE_MAP[extension];
    if (!lang) {
      return this.fallbackExtraction(content, 'unknown');
    }

    try {
      const root = parse(lang, content);
      const declarations: EnhancedDeclaration[] = [];
      const sgRoot = root.root();

      // Define extraction rules per language grouping
      if (JAVASCRIPT_FAMILY_EXTENSIONS.includes(extension)) {
        // Functions
        sgRoot
          .findAll({ rule: { kind: 'function_declaration' } })
          .forEach((n) => {
            const nameNode = n.field('name');
            const paramsNode = n.field('parameters');
            const returnTypeNode = n.field('return_type'); // Typical TS naming
            if (nameNode != null) {
              let signature = paramsNode != null ? paramsNode.text() : '()';
              if (returnTypeNode != null) {
                signature += returnTypeNode.text();
              }
              declarations.push(
                this.nodeToDeclaration(
                  n,
                  nameNode.text(),
                  'function',
                  signature,
                ),
              );
            }
          });

        // Methods
        sgRoot.findAll({ rule: { kind: 'method_definition' } }).forEach((n) => {
          const nameNode = n.field('name');
          const paramsNode = n.field('parameters');
          const returnTypeNode = n.field('return_type');
          if (nameNode != null) {
            let signature = paramsNode != null ? paramsNode.text() : '()';
            if (returnTypeNode != null) {
              signature += returnTypeNode.text();
            }
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'function', signature),
            );
          }
        });

        // Classes
        sgRoot.findAll({ rule: { kind: 'class_declaration' } }).forEach((n) => {
          const nameNode = n.field('name');
          if (nameNode != null) {
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'class'),
            );
          }
        });

        // Variables
        sgRoot
          .findAll({ rule: { kind: 'variable_declarator' } })
          .forEach((n) => {
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
      } else if (extension === 'py') {
        // Python
        sgRoot
          .findAll({ rule: { kind: 'function_definition' } })
          .forEach((n) => {
            const nameNode = n.field('name');
            const paramsNode = n.field('parameters');
            const returnTypeNode = n.field('return_type');
            if (nameNode != null) {
              let signature = paramsNode != null ? paramsNode.text() : '()';
              if (returnTypeNode != null) {
                signature += ` -> ${returnTypeNode.text()}`;
              }
              declarations.push(
                this.nodeToDeclaration(
                  n,
                  nameNode.text(),
                  'function',
                  signature,
                ),
              );
            }
          });

        sgRoot.findAll({ rule: { kind: 'class_definition' } }).forEach((n) => {
          const nameNode = n.field('name');
          if (nameNode != null) {
            declarations.push(
              this.nodeToDeclaration(n, nameNode.text(), 'class'),
            );
          }
        });
      } else {
        // Fallback for other languages: just find symbols that look like declarations
        return this.fallbackExtraction(content, extension);
      }

      return declarations;
    } catch (_error) {
      return this.fallbackExtraction(content, extension);
    }
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
    const match = RegExp(/(?:function|def|class)\s+(\w+)/).exec(line);
    return match != null ? match[1] : 'unknown';
  }

  private extractSignatureBasic(line: string): string {
    // Try to capture parameters: ( ... )
    const match = RegExp(/\(([^)]*)\)/).exec(line);
    if (match != null) {
      return `(${match[1]})`;
    }
    return '';
  }
}
