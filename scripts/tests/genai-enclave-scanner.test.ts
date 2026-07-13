/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral unit tests for the genai-enclave scanner module (#2352).
 *
 * These tests exercise the real AST scanner functions directly (no mocks)
 * to verify detection of every import/export form that could smuggle
 * @google/genai or a Gemini-named export past the guard.
 *
 * Per RULES.md: tests assert behavior (does the scanner flag this source?),
 * not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
  isGenaiSpecifier,
} from '../genai-enclave/scanner.ts';

function scanImportsFor(source: string): number {
  const sf = parseSourceFile('test.ts', source);
  return scanGenaiImports(sf, 'test.ts').length;
}

function scanExportsFor(source: string): string[] {
  const sf = parseSourceFile('test.ts', source);
  return scanGeminiExports(sf, 'test.ts').map((v) => v.exportName);
}

describe('isGenaiSpecifier', () => {
  it('matches exact package name', () => {
    expect(isGenaiSpecifier('@google/genai')).toBe(true);
  });

  it('matches subpath imports', () => {
    expect(isGenaiSpecifier('@google/genai/dist/node/index')).toBe(true);
  });

  it('does NOT match @google/genai-utils', () => {
    expect(isGenaiSpecifier('@google/genai-utils')).toBe(false);
  });

  it('does NOT match unrelated packages', () => {
    expect(isGenaiSpecifier('@google/other')).toBe(false);
  });
});

describe('scanGenaiImports — static import forms', () => {
  it('detects a named import', () => {
    expect(scanImportsFor("import { GoogleGenAI } from '@google/genai';")).toBe(
      1,
    );
  });

  it('detects a default import', () => {
    expect(scanImportsFor("import genai from '@google/genai';")).toBe(1);
  });

  it('detects a namespace import', () => {
    expect(scanImportsFor("import * as genai from '@google/genai';")).toBe(1);
  });

  it('detects a type-only import', () => {
    expect(
      scanImportsFor("import type { Content } from '@google/genai';"),
    ).toBe(1);
  });

  it('detects a side-effect-only import', () => {
    expect(scanImportsFor("import '@google/genai';")).toBe(1);
  });

  it('detects a subpath import', () => {
    expect(scanImportsFor("import { x } from '@google/genai/sub';")).toBe(1);
  });
});

describe('scanGenaiImports — dynamic and require forms', () => {
  it('detects dynamic import()', () => {
    expect(scanImportsFor("const x = import('@google/genai');")).toBe(1);
  });

  it('detects dynamic import() with await', () => {
    expect(
      scanImportsFor(
        "export async function f() { return await import('@google/genai'); }",
      ),
    ).toBe(1);
  });

  it('detects import-equals require', () => {
    expect(scanImportsFor("import genai = require('@google/genai');")).toBe(1);
  });

  it('detects re-export from @google/genai', () => {
    expect(scanImportsFor("export { Part } from '@google/genai';")).toBe(1);
  });

  it('reports export * from @google/genai accurately', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "export * from '@google/genai';",
    );

    expect(scanGenaiImports(sourceFile, 'test.ts')).toEqual([
      expect.objectContaining({
        kind: 'genai-import',
        importForm: 'export * from',
      }),
    ]);
  });

  it('reports export * as namespace from @google/genai accurately', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "export * as genai from '@google/genai';",
    );

    expect(scanGenaiImports(sourceFile, 'test.ts')).toEqual([
      expect.objectContaining({
        kind: 'genai-import',
        importForm: 'export * as namespace from',
      }),
    ]);
  });

  it('detects export type from @google/genai', () => {
    expect(
      scanImportsFor("export type { Content } from '@google/genai';"),
    ).toBe(1);
  });
});

describe('scanGenaiImports — ImportTypeNode (type position)', () => {
  it('detects import() in type annotation', () => {
    expect(
      scanImportsFor("type X = import('@google/genai').GoogleGenAI;"),
    ).toBe(1);
  });

  it('detects import() type in a qualified type reference', () => {
    expect(
      scanImportsFor("type Y = import('@google/genai').Content['parts'];"),
    ).toBe(1);
  });
});

describe('scanGenaiImports — non-genai imports are ignored', () => {
  it('does not flag a different package import', () => {
    expect(scanImportsFor("import { x } from '@google/genai-utils';")).toBe(0);
  });

  it('does not flag a relative import', () => {
    expect(scanImportsFor("import { x } from './local';")).toBe(0);
  });

  it('does not flag a node: builtin', () => {
    expect(scanImportsFor("import { x } from 'node:fs';")).toBe(0);
  });
});

describe('scanGenaiImports — computed (non-string-literal) specifiers', () => {
  it('flags a variable-specifier dynamic import()', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = '@google/genai'; await import(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('flags a variable-specifier require()', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = 'anything'; require(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('flags a template-literal dynamic import()', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const mod = await import(`@google/genai/${sub}`);',
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('flags a concatenation dynamic import()', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const mod = await import('@google/' + '/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('does NOT flag a string-literal import of a non-genai package', () => {
    expect(scanImportsFor("await import('node:fs');")).toBe(0);
  });

  it('does NOT flag a string-literal import of @google/genai (it is a genai-import, not computed)', () => {
    const sf = parseSourceFile('test.ts', "await import('@google/genai');");
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('reports the correct import form for dynamic import()', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = 'x'; await import(pkg);",
    );
    const v = scanGenaiImports(sf, 'test.ts');
    expect(v[0]).toMatchObject({
      kind: 'computed-import',
      importForm: 'dynamic import()',
    });
  });

  it('reports the correct import form for require()', () => {
    const sf = parseSourceFile('test.ts', "const pkg = 'x'; require(pkg);");
    const v = scanGenaiImports(sf, 'test.ts');
    expect(v[0]).toMatchObject({
      kind: 'computed-import',
      importForm: 'require()',
    });
  });
});

describe('scanGeminiExports — direct declaration forms', () => {
  it('detects exported function', () => {
    expect(scanExportsFor('export function geminiHelper(): void {}')).toContain(
      'geminiHelper',
    );
  });

  it('detects exported class', () => {
    expect(scanExportsFor('export class GeminiProvider {}')).toContain(
      'GeminiProvider',
    );
  });

  it('detects exported interface', () => {
    expect(scanExportsFor('export interface GeminiConfig {}')).toContain(
      'GeminiConfig',
    );
  });

  it('detects exported type alias', () => {
    expect(scanExportsFor('export type GeminiResult = string;')).toContain(
      'GeminiResult',
    );
  });

  it('detects exported const', () => {
    expect(scanExportsFor('export const GEMINI_VALUE = 42;')).toContain(
      'GEMINI_VALUE',
    );
  });

  it('detects exported let', () => {
    expect(scanExportsFor('export let geminiCounter = 0;')).toContain(
      'geminiCounter',
    );
  });
});

describe('scanGeminiExports — enum and namespace forms', () => {
  it('detects exported enum', () => {
    expect(scanExportsFor('export enum GeminiMode { Fast, Slow }')).toContain(
      'GeminiMode',
    );
  });

  it('detects exported const enum', () => {
    expect(
      scanExportsFor('export const enum GeminiFlag { On, Off }'),
    ).toContain('GeminiFlag');
  });

  it('detects exported namespace declaration', () => {
    expect(
      scanExportsFor('export namespace GeminiUtils { export const x = 1; }'),
    ).toContain('GeminiUtils');
  });

  it('detects exported module declaration', () => {
    expect(
      scanExportsFor('export module GeminiMod { export const y = 2; }'),
    ).toContain('GeminiMod');
  });

  it('detects exported declared namespace', () => {
    expect(scanExportsFor('export declare namespace GeminiAPI {}')).toContain(
      'GeminiAPI',
    );
  });
});

describe('scanGeminiExports — export default', () => {
  it('detects export default of a Gemini-named identifier', () => {
    expect(
      scanExportsFor('class GeminiHandler {}\nexport default GeminiHandler;'),
    ).toContain('GeminiHandler');
  });

  it('detects export default of a Gemini-named function identifier', () => {
    expect(
      scanExportsFor('function geminiThing() {}\nexport default geminiThing;'),
    ).toContain('geminiThing');
  });

  it('does NOT flag export default of a non-Gemini identifier', () => {
    expect(scanExportsFor('class Normal {}\nexport default Normal;')).toEqual(
      [],
    );
  });
});

describe('scanGeminiExports — re-export forms', () => {
  it('detects re-export alias to a Gemini-named export', () => {
    expect(
      scanExportsFor("export { Foo as GeminiBar } from './local';"),
    ).toContain('GeminiBar');
  });

  it('detects direct named re-export of a Gemini-named identifier', () => {
    expect(scanExportsFor("export { GeminiHelper } from './local';")).toContain(
      'GeminiHelper',
    );
  });

  it('detects a Gemini-named namespace re-export', () => {
    expect(scanExportsFor("export * as GeminiSDK from './local';")).toContain(
      'GeminiSDK',
    );
  });
});

describe('scanGeminiExports — destructuring binding patterns', () => {
  it('detects a Gemini-named binding in a destructuring object export', () => {
    expect(
      scanExportsFor('export const { geminiValue, normalValue } = obj;'),
    ).toContain('geminiValue');
  });

  it('detects a Gemini-named binding in a destructuring array export', () => {
    expect(
      scanExportsFor('export const [first, geminiSecond] = arr;'),
    ).toContain('geminiSecond');
  });

  it('detects a Gemini-named nested binding in a destructuring export', () => {
    expect(
      scanExportsFor('export const { outer: { GeminiInner } } = obj;'),
    ).toContain('GeminiInner');
  });
});

describe('scanGeminiExports — non-Gemini exports are ignored', () => {
  it('does not flag non-Gemini class', () => {
    expect(scanExportsFor('export class NormalClass {}')).toEqual([]);
  });

  it('does not flag non-Gemini function', () => {
    expect(scanExportsFor('export function helper(): void {}')).toEqual([]);
  });

  it('does not flag non-Gemini enum', () => {
    expect(scanExportsFor('export enum Color { Red, Blue }')).toEqual([]);
  });
});

describe('parseSourceFile — invalid syntax produces diagnostics', () => {
  it('produces parse diagnostics for broken syntax', () => {
    const sf = parseSourceFile('broken.ts', 'export const x = ((((;\n');
    expect(sf.parseDiagnostics.length).toBeGreaterThan(0);
  });
});
