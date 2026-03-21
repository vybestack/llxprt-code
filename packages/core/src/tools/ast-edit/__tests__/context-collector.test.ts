/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { prioritizeSymbolsFromDeclarations } from '../context-collector.js';
import type { EnhancedDeclaration } from '../types.js';

describe('prioritizeSymbolsFromDeclarations', () => {
  it('should rank classes above functions above variables', () => {
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

    expect(result.indexOf('MyClass')).toBeLessThan(result.indexOf('myHelper'));
    expect(result.indexOf('myHelper')).toBeLessThan(result.indexOf('someVar'));
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

    // ASTConfig.MAX_RELATED_SYMBOLS is 10
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('should return empty array for empty declarations', () => {
    const result = prioritizeSymbolsFromDeclarations([]);

    expect(result).toEqual([]);
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
