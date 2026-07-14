/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact regression tests for scanner-level findings (#2352).
 *
 * Findings covered in this file (scanner AST-level):
 *  1. createRequire provenance for require('node:module').createRequire,
 *     module.require aliases, forward hoisted helper fixed point.
 *  2. CJS exports fail closed for variable defineProperties, mixed assign
 *     unknown, call RHS, and lexical same-name binding.
 *  7. lexical shadowed require no false violation.
 *
 * Findings 3-6 (packed closure, conditional exports traversal, symlink
 * safety, protocol resolver) are covered in
 * published-closure-regressions.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
} from '../genai-enclave/scanner.ts';

// ─── Finding 1: createRequire provenance ─────────────────────────────────────

describe('Finding1: createRequire provenance — require(node:module).createRequire', () => {
  it('detects @google/genai via require(node:module).createRequire property access', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "const cr = require('node:module').createRequire;\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via require("module").createRequire (bare module specifier)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "const cr = require('module').createRequire;\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

describe('Finding1: createRequire provenance — module.require aliases', () => {
  it('detects @google/genai via module.require alias stored in a variable', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const r = module.require;\n' +
        "const cr = r('node:module').createRequire;\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via module.require direct call then .createRequire', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "const cr = module.require('node:module').createRequire;\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via module.require alias then namespace.createRequire', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const r = module.require;\n' +
        "const m = r('node:module');\n" +
        'const cr = m.createRequire;\n' +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

describe('Finding1: forward hoisted helper fixed point (transitive)', () => {
  it('detects @google/genai through a transitive createRequire-returning function chain', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getReq2(url) { return getReq(url); }\n' +
        'function getReq(url) { return createRequire(url); }\n' +
        'const req = getReq2(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(3);
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai through a 3-level transitive chain', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function a(url) { return createRequire(url); }\n' +
        'function b(url) { return a(url); }\n' +
        'function c(url) { return b(url); }\n' +
        'const req = c(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(4);
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('does NOT flag a safe non-createRequire transitive chain', () => {
    const sf = parseSourceFile(
      'test.ts',
      'function a(url) { return String(url); }\n' +
        'function b(url) { return a(url); }\n' +
        'const req = b(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });
});

// ─── Finding 2: CJS exports fail closed ──────────────────────────────────────

describe('Finding2: Object.defineProperties with a variable descriptor map fails closed', () => {
  it('flags Object.defineProperties(exports, variable) as fail-closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const desc = { GeminiProp: { value: 1 } };\n' +
        'Object.defineProperties(exports, desc);\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });
});

describe('Finding2: Object.assign with mixed literal and non-literal sources fails closed', () => {
  it('flags Object.assign(exports, { GeminiLit: 1 }, someVar) — detects GeminiLit AND fails closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const someVar = { other: 1 };\n' +
        'Object.assign(exports, { GeminiLit: 1 }, someVar);\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLit')).toBe(true);
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });

  it('flags Object.assign(exports, someVar, { GeminiLit: 1 }) — detects GeminiLit AND fails closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const someVar = { other: 1 };\n' +
        'Object.assign(exports, someVar, { GeminiLit: 1 });\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLit')).toBe(true);
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });
});

describe('Finding2: module.exports = callExpression() fails closed', () => {
  it('flags module.exports = someFunc() as fail-closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function makeExports() { return { x: 1 }; }\n' +
        'module.exports = makeExports();\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('does NOT fail-closed for module.exports = createRequire(...)(...) (handled by import side)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        "module.exports = createRequire(import.meta.url)('node:fs');\n",
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    // createRequire(...)(...) is a call expression but should NOT trigger
    // a fail-closed export violation — it's a require, not an export mutation.
    expect(
      violations.filter((v) => v.exportForm.includes('fail-closed')),
    ).toEqual([]);
  });
});

describe('Finding2: lexical same-name binding — no false violation from inner scope', () => {
  it('does NOT flag module.exports = obj when an inner-scope obj has Gemini names', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const obj = { normalName: 1 };\n' +
        'module.exports = obj;\n' +
        '{\n' +
        '  const obj = { GeminiLeak: 1 };\n' +
        '}\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    // The outer `obj` is { normalName: 1 }, the inner `obj` has GeminiLeak.
    // The flat map would wrongly resolve `obj` to the inner binding.
    // The scope-aware resolver must resolve to the outer binding — no Gemini.
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(false);
  });

  it('DOES flag module.exports = obj when the same-scope obj has Gemini names', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const obj = { GeminiLeak: 1 };\n' + 'module.exports = obj;\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });

  it('resolves the inner-scope obj correctly when module.exports is inside the inner scope', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const obj = { normalName: 1 };\n' +
        '{\n' +
        '  const obj = { GeminiInner: 1 };\n' +
        '  module.exports = obj;\n' +
        '}\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiInner')).toBe(true);
  });
});

// ─── Finding 7: lexical shadowed require no false violation ────────────────

describe('Finding7: lexical shadowed require — no false violation', () => {
  it('does NOT flag require(@google/genai) when require is shadowed in a block', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' +
        '  const require = (name) => null;\n' +
        "  require('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('does NOT flag require(@google/genai) when require is shadowed by a function parameter', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function loader(require) {\n' +
        "  return require('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('does NOT flag a shadowed require inside a nested function', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function outer() {\n' +
        '  const require = (name) => null;\n' +
        '  function inner() {\n' +
        "    require('@google/genai');\n" +
        '  }\n' +
        '  return inner();\n' +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('DOES flag require(@google/genai) when require is NOT shadowed', () => {
    const sf = parseSourceFile('test.cjs', "require('@google/genai');\n");
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('DOES flag require(@google/genai) after the shadow scope ends', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' +
        '  const require = (name) => null;\n' +
        '}\n' +
        "require('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});
