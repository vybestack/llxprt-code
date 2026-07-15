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

  it('flags a string-literal @google/genai import as genai-import, not computed', () => {
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

describe('scanGenaiImports — module.require and createRequire forms', () => {
  it('detects module.require(@google/genai)', () => {
    expect(scanImportsFor("const g = module.require('@google/genai');")).toBe(
      1,
    );
  });

  it('detects module.require(@google/genai/sub)', () => {
    expect(
      scanImportsFor("const g = module.require('@google/genai/sub');"),
    ).toBe(1);
  });

  it('detects createRequire(import.meta.url)(@google/genai)', () => {
    expect(
      scanImportsFor(
        "import { createRequire } from 'node:module'; const g = createRequire(import.meta.url)('@google/genai');",
      ),
    ).toBe(1);
  });

  it('does NOT flag module.require of a non-genai package', () => {
    expect(scanImportsFor("const g = module.require('node:fs');")).toBe(0);
  });

  it('does NOT flag createRequire of a non-genai package', () => {
    expect(
      scanImportsFor("const g = createRequire(import.meta.url)('node:path');"),
    ).toBe(0);
  });

  it('flags computed module.require with a variable specifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = 'x'; const g = module.require(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('flags computed createRequire with a variable specifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; const pkg = 'x'; const g = createRequire(import.meta.url)(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });
});

describe('scanGenaiImports — exported import-equals declarations', () => {
  it('detects export import genai = require(@google/genai)', () => {
    expect(
      scanImportsFor("export import genai = require('@google/genai');"),
    ).toBe(1);
  });

  it('detects computed import-equals (require with variable)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = 'x'; import genai = require(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });
});

describe('scanGeminiExports — export as namespace', () => {
  it('detects export as namespace with a Gemini name', () => {
    expect(scanExportsFor('export as namespace GeminiSDK;')).toContain(
      'GeminiSDK',
    );
  });

  it('does NOT flag export as namespace with a non-Gemini name', () => {
    expect(scanExportsFor('export as namespace ReactUtils;')).toEqual([]);
  });
});

describe('scanGeminiExports — CommonJS module.exports / exports property assignments', () => {
  it('detects module.exports.GeminiName assignment in a .cjs file', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports.GeminiHelper = function() {};',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.map((v) => v.exportName)).toContain('GeminiHelper');
  });

  it('detects exports.GeminiName assignment in a .js file', () => {
    const sf = parseSourceFile('legacy.js', 'exports.GeminiConfig = class {};');
    const violations = scanGeminiExports(sf, 'legacy.js');
    expect(violations.map((v) => v.exportName)).toContain('GeminiConfig');
  });

  it('detects computed CommonJS property assignments', () => {
    const sourceFile = parseSourceFile(
      'legacy.cjs',
      "exports['GeminiComputed'] = function() {};",
    );
    const violations = scanGeminiExports(sourceFile, 'legacy.cjs');
    expect(violations.map((v) => v.exportName)).toContain('GeminiComputed');
  });

  it('detects Gemini-named properties in module.exports object literals', () => {
    const sourceFile = parseSourceFile(
      'legacy.cjs',
      'module.exports = { GeminiObject: function() {}, normal: true };',
    );
    const violations = scanGeminiExports(sourceFile, 'legacy.cjs');
    expect(violations.map((v) => v.exportName)).toContain('GeminiObject');
  });

  it('does NOT flag module.exports of a non-Gemini name', () => {
    const sf = parseSourceFile(
      'normal.cjs',
      'module.exports.NormalHelper = function() {};',
    );
    expect(scanGeminiExports(sf, 'normal.cjs')).toEqual([]);
  });

  it('detects Gemini-named property on module[exports] (bracket-access)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports'].GeminiBracket = function() {};",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiBracket');
  });

  it('detects Gemini-named computed property on module[exports]', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports']['GeminiComputedBracket'] = 42;",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiComputedBracket');
  });

  it('detects Gemini-named property on exports via bracket (module[exports].name)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports'].NormalThing = 1;\nmodule['exports'].GeminiProp = 2;",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiProp');
  });

  it('detects Gemini name via Object.defineProperty on exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.defineProperty(exports, 'GeminiDefined', { value: 42 });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiDefined');
  });

  it('detects Gemini name via Object.defineProperty on module.exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.defineProperty(module.exports, 'GeminiModuleDefined', { value: 42 });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiModuleDefined');
  });

  it('detects Gemini name via Object.defineProperty with string-literal key', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.defineProperty(exports, 'GeminiODPComputed', { get() { return 1; } });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiODPComputed');
  });

  it('detects Gemini name via Object.assign on exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(exports, { GeminiAssigned: 1, normal: 2 });',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiAssigned');
  });

  it('detects Gemini name via Object.assign on module.exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(module.exports, { GeminiModuleAssigned: 1 });',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiModuleAssigned');
  });

  it('does NOT flag Object.defineProperty on a non-exports target', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.defineProperty(someObj, 'GeminiOther', { value: 1 });",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('does NOT flag Object.assign on a non-exports target', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(someObj, { GeminiOther: 1 });',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
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

  it('detects inline default class and function declarations with Gemini names', () => {
    expect(scanExportsFor('export default class GeminiHandler {}')).toContain(
      'GeminiHandler',
    );
    expect(
      scanExportsFor('export default function geminiThing() {}'),
    ).toContain('geminiThing');
  });

  it('detects parenthesized default class and function expressions', () => {
    expect(scanExportsFor('export default (class GeminiHandler {})')).toContain(
      'GeminiHandler',
    );
    expect(
      scanExportsFor('export default (function geminiThing() {})'),
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

describe('scanGenaiImports — lexical createRequire bindings', () => {
  it('detects literal @google/genai through a const-bound createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; const req = createRequire(import.meta.url); req('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
    expect(violations[0]).toMatchObject({ specifier: '@google/genai' });
  });

  it('detects computed specifier through a const-bound createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; const req = createRequire(import.meta.url); const pkg = 'x'; req(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('detects literal @google/genai through an aliased named import from node:module', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'node:module'; cr(import.meta.url)('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects literal @google/genai through a let-bound createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; let req = createRequire(import.meta.url); req('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects literal @google/genai through a var-bound createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; var req = createRequire(import.meta.url); req('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT flag a call through a non-createRequire-bound identifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const req = someOther(); req('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag a call through a createRequire-bound identifier to a non-genai package', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const req = createRequire(import.meta.url); req('node:fs');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });

  it('normalizes module[require] as equivalent to require()', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const g = module['require']('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('flags computed module[require] with a variable specifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      "const pkg = 'x'; module['require'](pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });
});

describe('scanGenaiImports — createRequire factory alias vs binding separation', () => {
  it('detects literal @google/genai through a bare createRequire import', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; createRequire(import.meta.url)('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects literal @google/genai through a binding created from an aliased factory', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'node:module'; const req = cr(import.meta.url); req('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT treat a factory alias as a bound require function', () => {
    // `cr('@google/genai')` is NOT a require call — `cr` is the factory, not
    // the returned require function. This must produce zero violations.
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'node:module'; cr('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });

  it('does NOT treat a bare createRequire import as a bound require function', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module'; createRequire('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });

  it('detects computed specifier through an aliased factory call chain', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'node:module'; const pkg = 'x'; cr(import.meta.url)(pkg);",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('does NOT flag a factory alias from a non-node:module import', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'some-lib'; cr(import.meta.url)('@google/genai');",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });
  it('does NOT treat an unrelated local createRequire as a factory', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const createRequire = (url: string) => () => ({});\n' +
        "createRequire(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(false);
  });
});
