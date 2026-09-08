/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the ASTQueryExtractor line-scan fallback and its
 * bounded variant (issue #3232 remediation). The fallback is reached for
 * languages with an ast-grep mapping but no declaration family (ruby, go,
 * java, cpp, html, css, json) and whenever a native parse throws.
 */

import { describe, it, expect } from 'bun:test';
import { ASTQueryExtractor } from '../ast-query-extractor.js';

const extractor = new ASTQueryExtractor();

/** Indented fallback-declaration source with known name columns. */
const INDENTED_SOURCE = [
  'module Wrapper',
  '  class Service',
  '    def run',
  '    end',
  '  end',
  'end',
].join('\n');

/** C-shaped source whose declarations only exist in the C family mapping. */
const C_SHAPED_SOURCE = 'struct Point {\n  int x;\n};\n';

function isPointStruct(declaration: {
  readonly name: string;
  readonly type: string;
}): boolean {
  return declaration.name === 'Point' && declaration.type === 'struct';
}

describe('fallback declaration extraction columns', () => {
  it('computes declaration columns against the raw line so indentation is kept', async () => {
    const declarations = await extractor.extractDeclarations(
      '/repo/wrapper.rb',
      INDENTED_SOURCE,
    );
    const service = declarations.find((decl) => decl.name === 'Service');
    const run = declarations.find((decl) => decl.name === 'run');
    expect(service?.line).toBe(2);
    // '  class Service' → 'Service' starts at raw column 8, not 6.
    expect(service?.column).toBe(8);
    expect(run?.line).toBe(3);
    // '    def run' → 'run' starts at raw column 8, not 4.
    expect(run?.column).toBe(8);
    expect(service?.range.start.column).toBe(8);
    expect(service?.range.end.column).toBe(8 + 'Service'.length);
  });

  it('keeps raw-line columns in the bounded fallback scan', async () => {
    const declarations = await extractor.extractDeclarationsBounded(
      '/repo/wrapper.rb',
      INDENTED_SOURCE,
      10,
    );
    const service = declarations.find((decl) => decl.name === 'Service');
    expect(service?.column).toBe(8);
  });
});

describe('bounded fallback limit validation', () => {
  it('rejects a NaN limit instead of scanning unboundedly', async () => {
    await expect(
      extractor.extractDeclarationsBounded(
        '/repo/wrapper.rb',
        INDENTED_SOURCE,
        Number.NaN,
      ),
    ).rejects.toThrow(/limit/);
  });

  it('still permits a positive-infinity limit for the unbounded legacy path', async () => {
    const declarations = await extractor.extractDeclarationsBounded(
      '/repo/wrapper.rb',
      INDENTED_SOURCE,
      Number.POSITIVE_INFINITY,
    );
    expect(declarations.map((decl) => decl.name)).toStrictEqual([
      'Service',
      'run',
    ]);
  });

  it('returns no declarations for a zero limit', async () => {
    const declarations = await extractor.extractDeclarationsBounded(
      '/repo/wrapper.rb',
      INDENTED_SOURCE,
      0,
    );
    expect(declarations).toStrictEqual([]);
  });

  it('stops at the limit in document order with output identical to the unbounded scan', async () => {
    // A declaration-dense fallback file: the bounded scan must return
    // exactly the first declarations of the unbounded scan (names, lines,
    // columns, ranges) and never materialize past the limit.
    const lines = Array.from({ length: 2000 }, (_, i) => `  def method${i}`);
    const source = lines.join('\n');
    const bounded = await extractor.extractDeclarationsBounded(
      '/repo/dense.rb',
      source,
      3,
    );
    const unbounded = await extractor.extractDeclarations(
      '/repo/dense.rb',
      source,
    );
    expect(bounded).toStrictEqual(unbounded.slice(0, 3));
    expect(bounded.map((decl) => decl.name)).toStrictEqual([
      'method0',
      'method1',
      'method2',
    ]);
    // Raw-line column is preserved: '  def method0' puts the name at column 6.
    expect(bounded.every((decl) => decl.column === 6)).toBe(true);
  });
});

describe('declaration family resolution', () => {
  it('extracts C declarations for .c but does not default unmapped .cpp to the C family', async () => {
    const cDeclarations = await extractor.extractDeclarations(
      '/repo/point.c',
      C_SHAPED_SOURCE,
    );
    expect(cDeclarations.some(isPointStruct)).toBe(true);

    // '.cpp' has an ast-grep mapping but no declaration family: the same
    // source must go through the keyword line scan (no 'struct' keyword),
    // never be silently interpreted with C declaration kinds.
    const cppDeclarations = await extractor.extractDeclarations(
      '/repo/point.cpp',
      C_SHAPED_SOURCE,
    );
    expect(cppDeclarations).toStrictEqual([]);
  });

  it('uses the same family resolution in the bounded walk', async () => {
    const cDeclarations = await extractor.extractDeclarationsBounded(
      '/repo/point.c',
      C_SHAPED_SOURCE,
      5,
    );
    expect(cDeclarations.map((decl) => decl.name)).toStrictEqual(['Point']);
    const cppDeclarations = await extractor.extractDeclarationsBounded(
      '/repo/point.cpp',
      C_SHAPED_SOURCE,
      5,
    );
    expect(cppDeclarations).toStrictEqual([]);
  });
});
