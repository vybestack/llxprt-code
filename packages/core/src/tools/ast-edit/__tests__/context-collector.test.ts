/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { prioritizeSymbolsFromDeclarations } from '../context-collector.js';
import { ASTConfig } from '../ast-config.js';
import type { EnhancedDeclaration } from '../types.js';

describe('prioritizeSymbolsFromDeclarations', () => {
  it('should rank classes above functions and exclude zero-score types', () => {
    const decls: EnhancedDeclaration[] = [
      {
        name: 'myHelper',
        type: 'function',
        line: 11,
        column: 1,
        range: {
          start: { line: 11, column: 1 },
          end: { line: 12, column: 1 },
        },
        visibility: 'public',
      },
      {
        name: 'MyClass',
        type: 'class',
        line: 1,
        column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } },
        visibility: 'public',
      },
      {
        name: 'someVar',
        type: 'variable',
        line: 13,
        column: 1,
        range: {
          start: { line: 13, column: 1 },
          end: { line: 13, column: 10 },
        },
        visibility: 'public',
      },
    ];

    const result = prioritizeSymbolsFromDeclarations(decls);

    expect(result).toStrictEqual(
      expect.arrayContaining(['MyClass', 'myHelper']),
    );
    expect(result.indexOf('MyClass')).toBeLessThan(result.indexOf('myHelper'));
    // Variables (score 0) are excluded to avoid low-value workspace lookups
    expect(result).not.toContain('someVar');
  });

  it('should exclude short symbol names (length < MIN_SYMBOL_LENGTH)', () => {
    const decls: EnhancedDeclaration[] = [
      {
        name: 'ab',
        type: 'class',
        line: 1,
        column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } },
        visibility: 'public',
      },
      {
        name: 'LongEnoughName',
        type: 'function',
        line: 11,
        column: 1,
        range: {
          start: { line: 11, column: 1 },
          end: { line: 12, column: 1 },
        },
        visibility: 'public',
      },
    ];

    const result = prioritizeSymbolsFromDeclarations(decls);

    expect(result).not.toContain('ab');
    expect(result).toContain('LongEnoughName');
  });

  it('should boost public visibility declarations', () => {
    const decls: EnhancedDeclaration[] = [
      {
        name: 'privateFunc',
        type: 'function',
        line: 1,
        column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 5, column: 1 } },
        visibility: undefined,
      },
      {
        name: 'publicFunc',
        type: 'function',
        line: 6,
        column: 1,
        visibility: 'public',
        range: { start: { line: 6, column: 1 }, end: { line: 10, column: 1 } },
      },
    ];

    const result = prioritizeSymbolsFromDeclarations(decls);

    expect(result).toStrictEqual(
      expect.arrayContaining(['publicFunc', 'privateFunc']),
    );
    expect(result.indexOf('publicFunc')).toBeLessThan(
      result.indexOf('privateFunc'),
    );
  });

  it('should limit results to MAX_RELATED_SYMBOLS', () => {
    // Create 100 declarations
    const decls: EnhancedDeclaration[] = [];
    for (let i = 0; i < 100; i++) {
      decls.push({
        name: `Symbol${i.toString().padStart(3, '0')}`,
        type: 'function',
        line: i + 1,
        column: 1,
        range: {
          start: { line: i + 1, column: 1 },
          end: { line: i + 1, column: 10 },
        },
        visibility: 'public',
      });
    }

    const result = prioritizeSymbolsFromDeclarations(decls);

    expect(result.length).toBeLessThanOrEqual(ASTConfig.MAX_RELATED_SYMBOLS);
  });

  it('should return empty array for empty declarations', () => {
    const result = prioritizeSymbolsFromDeclarations([]);

    expect(result).toStrictEqual([]);
  });

  it('should handle declarations with no visibility', () => {
    const decls: EnhancedDeclaration[] = [
      {
        name: 'noVisibility',
        type: 'function',
        line: 1,
        column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 5, column: 1 } },
      },
    ];

    const result = prioritizeSymbolsFromDeclarations(decls);

    expect(result).toContain('noVisibility');
  });
});
