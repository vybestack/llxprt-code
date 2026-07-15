/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for require/createRequire alias tracking, wrappers, bracket/dynamic
 * acquisition, and later assignment (#2352 F2, F3, F4).
 *
 * Exercises edge cases in how an attacker might disguise require() or
 * createRequire() to smuggle @google/genai imports, and verifies correct
 * lexical shadow resolution and fail-closed dynamic export mutations.
 */

import { describe, it, expect } from 'vitest';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
} from '../genai-enclave/scanner.ts';

describe('scanGenaiImports — F2: require alias tracking', () => {
  it('detects a require alias: const r = require; r("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const r = require;\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects require through a wrapper function (computed specifier)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function load(name) { return require(name); }\n' +
        "load('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    // The wrapper calls require(name) with a computed parameter, so the
    // scanner flags the computed require form. The outer load() call cannot
    // be statically traced to require, but the computed import is caught.
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('detects createRequire returned from a helper function', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getReq(url) { return createRequire(url); }\n' +
        'const req = getReq(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

describe('scanGenaiImports — F2: bracket and dynamic acquisition', () => {
  it('detects module["require"]("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "module['require']('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects dynamic import() with a variable specifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const pkg = "@google/genai";\n' + 'import(pkg);\n',
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });
});

describe('scanGenaiImports — F2: later assignment and reassignment', () => {
  it('detects when require is assigned later: let r; r = require; r("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' + 'r = require;\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects require aliased via variable swap: const a = require; const b = a; b("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const a = require;\n' + 'const b = a;\n' + "b('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

describe('scanGenaiImports — F3: lexical shadow resolution', () => {
  it('preserves top-level createRequire despite nested shadow', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n' +
        'function shadowed() {\n' +
        '  const req = () => null;\n' +
        "  req('safe');\n" +
        '}\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT flag a shadowed require alias inside a block', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const r = require;\n' +
        '{\n' +
        '  const r = () => null;\n' +
        "  r('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('does NOT flag "module" when shadowed by a local variable', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' +
        '  const module = { require: () => null };\n' +
        "  module.require('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });
});

describe('scanGeminiExports — F3: lexical shadow resolution for exports', () => {
  it('does NOT flag "exports" when shadowed by a local variable', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' + '  const exports = {};\n' + '  exports.GeminiLeak = 1;\n' + '}\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('does NOT flag "Object" when shadowed by a local variable', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' +
        '  const Object = { defineProperty: () => {} };\n' +
        '  Object.defineProperty(exports, "GeminiLeak", {});\n' +
        '}\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });
});

describe('scanGeminiExports — F4: static ESM/CJS export value/alias flows', () => {
  it('detects export default of a Gemini-named identifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const GeminiDefault = 42;\nexport default GeminiDefault;\n',
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations.map((v) => v.exportName)).toContain('GeminiDefault');
  });

  it('detects export { foo as GeminiBar }', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const foo = 1;\nexport { foo as GeminiBar };\n',
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations.map((v) => v.exportName)).toContain('GeminiBar');
  });

  it('detects nested object literal in module.exports', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'module.exports = { nested: { GeminiDeep: 1 } };',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.map((v) => v.exportName)).toContain('GeminiDeep');
  });
});

describe('scanGeminiExports — F4: dynamic export mutations fail closed', () => {
  it('flags Object.defineProperty with a computed key variable on exports', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const key = "GeminiDynamic";\n' +
        'Object.defineProperty(exports, key, {});\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('flags module.exports[computedKey] assignment', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const key = "GeminiComputed";\n' + 'module.exports[key] = 1;\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('flags Object.assign with a computed spread source', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const src = { GeminiSpread: 1 };\n' + 'Object.assign(exports, src);\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });
});
