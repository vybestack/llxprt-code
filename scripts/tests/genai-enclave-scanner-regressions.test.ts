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
    expect(violations).toHaveLength(1);
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
    expect(violations).toHaveLength(1);
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

  it('accepts createRequire-style calls with scope-aware export provenance', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        "module.exports = createRequire(import.meta.url)('node:fs');\n",
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
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

// ─── A4: assignment alias shadowed require (#2546) ─────────────────────────

describe('A4: assignment alias registration respects shadowed require', () => {
  it('does NOT flag require(@google/genai) via assignment when require is shadowed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' +
        '{\n' +
        '  const require = (name) => null;\n' +
        '  r = require;\n' +
        '}\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('DOES flag require(@google/genai) via assignment when require is global', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' + 'r = require;\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

// ─── A1: string-literal property name in destructured createRequire ─────────

describe('A1: string-literal property name in destructured createRequire', () => {
  it('detects @google/genai via destructured { "createRequire": cr } from require(node:module)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const { "createRequire": cr } = require("node:module");\n' +
        'cr(import.meta.url)("@google/genai");\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via single-quoted destructured createRequire', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "const { 'createRequire': cr } = require('node:module');\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT flag when the destructured name is a non-matching string literal', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const { "otherRequire": cr } = require("node:module");\n' +
        'cr(import.meta.url)("@google/genai");\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });
});

// ── #2: ImportTypeNode fail-closed + bracket createRequire chains ───────────

describe('#2: non-literal ImportTypeNode fails closed', () => {
  it('flags a template-literal import type as computed', () => {
    const sf = parseSourceFile('test.ts', 'type T = import(`${pkg}`);\n');
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'computed-import')).toBe(true);
  });

  it('flags a non-literal identifier argument import type as computed', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const pkg = "x";\ntype T = import(pkg);\n',
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'computed-import')).toBe(true);
  });

  it('still detects a literal @google/genai import type', () => {
    const sf = parseSourceFile(
      'test.ts',
      "type T = import('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

describe('#2: bracket namespace createRequire access', () => {
  it('detects @google/genai via m["createRequire"] bracket access', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "const m = require('node:module');\n" +
        "m['createRequire'](import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

describe('#2: provenance-safe createRequire.call/apply/bind chains', () => {
  it('detects @google/genai via createRequire.call(null, url)(spec)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        "createRequire.call(null, import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via createRequire.apply(null, [url])(spec)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        "createRequire.apply(null, [import.meta.url])('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via binding.call(null, spec)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n' +
        "req.call(null, '@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via binding.apply(null, [spec])', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n' +
        "req.apply(null, ['@google/genai']);\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via binding.bind(null)(spec)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n' +
        "req.bind(null)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

// ── Critical bug regressions ─────────────────────────────────────────────────

describe('Critical: unresolved declaration identifiers fail closed', () => {
  it('fails closed for a class identifier without scope-aware resolution', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'class Normal {}\nmodule.exports = Normal;',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('fails closed for a function identifier without scope-aware resolution', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'function normal() {}\nmodule.exports = normal;',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });
});

describe('Critical: isCreateRequireReturnExpression checks callee not full call', () => {
  it('detects function returning createRequire(url) as a factory-returning function', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const getReq = (url) => createRequire(url);\n' +
        "getReq(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

describe('Critical: isRequireCallRhs checks bare require() before call-expression guard', () => {
  it('does NOT fail-closed for module.exports = require(node:fs)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module.exports = require('node:fs');\n",
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toEqual([]);
  });
});

describe('Critical: anonymous arrow function expression RHS does NOT fail-closed', () => {
  it('does NOT flag module.exports = () => {}', () => {
    const sf = parseSourceFile('legacy.cjs', 'module.exports = () => {};\n');
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('does NOT flag module.exports = (a) => a + 1', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = (a) => a + 1;\n',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });
});

describe('Critical: string-named import specifier is handled via destructuring', () => {
  // Import specifiers use identifiers only; string-literal names apply to
  // destructuring const { "createRequire": cr } = require('node:module').
  // The A1 tests already cover the destructuring forms. This test confirms
  // the regular `import { createRequire as cr }` alias still works.
  it('detects createRequire via renamed import: import { createRequire as cr }', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire as cr } from 'node:module';\n" +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

describe('Critical: Reflect.set on exports detects Gemini names', () => {
  it('detects Reflect.set(exports, "GeminiName", value)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "Reflect.set(exports, 'GeminiName', 42);\n",
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiName')).toBe(true);
  });

  it('fail-closed for Reflect.set with computed key on exports', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const key = "dynamic";\nReflect.set(exports, key, 42);\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });

  it('does NOT flag Reflect.set on a non-exports target', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const obj = {};\nReflect.set(obj, "GeminiName", 42);\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiName')).toBe(false);
  });
});
describe('Critical: method shorthand in module.exports object literal', () => {
  it('detects Gemini-named method shorthand: module.exports = { GeminiMethod() {} }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = { GeminiMethod() {} };\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiMethod')).toBe(true);
  });
});

describe('#3: bare exports logical assignments inspect RHS', () => {
  it('detects Gemini in exports ||= { GeminiLeak: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports ||= { GeminiLeak: 1 };\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });

  it('detects Gemini in module.exports ||= { GeminiLeak: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ||= { GeminiLeak: 1 };\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });

  it('detects Gemini in exports ??= { GeminiLeak: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports ??= { GeminiLeak: 1 };\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });

  it('detects Gemini in exports &&= { GeminiLeak: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports &&= { GeminiLeak: 1 };\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });

  it('detects Gemini property in exports.GeminiName ||= value', () => {
    const sf = parseSourceFile('legacy.cjs', 'exports.GeminiName ||= 42;\n');
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiName')).toBe(true);
  });
});

describe('#3: bare require RHS exemption is correct', () => {
  it('does NOT fail-closed for module.exports = require("node:fs")', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module.exports = require('node:fs');\n",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('does not fail closed for a proven createRequire loader', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "const { createRequire } = require('node:module');\n" +
        "module.exports = createRequire(import.meta.url)('@google/genai');\n",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('fail-closed for module.exports = someUnknownFunc()', () => {
    const sf = parseSourceFile('legacy.cjs', 'module.exports = someFunc();\n');
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });
});

// ─── A5: createRequire-returning IIFEs (#2546) ──────────────────────────────

describe('A5: createRequire-returning direct arrow IIFEs', () => {
  it('detects @google/genai via arrow IIFE returning createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = (() => createRequire(import.meta.url))();\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via parameterized arrow IIFE', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = ((url) => createRequire(url))(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via function expression IIFE', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = (function(url) { return createRequire(url); })(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('does NOT flag a safe IIFE that does not return createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const val = (() => 42)();\n' + "val('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });
});

// ─── A7: assignment RHS createRequire-returning IIFE (#2546) ────────────────

describe('A7: assignment RHS createRequire-returning IIFE', () => {
  it('detects @google/genai via assignment r = arrow IIFE returning createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'let r;\n' +
        'r = (() => createRequire(import.meta.url))();\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via assignment r = parameterized arrow IIFE', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'let r;\n' +
        'r = ((url) => createRequire(url))(import.meta.url);\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via assignment r = function expression IIFE', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'let r;\n' +
        'r = (function(url) { return createRequire(url); })(import.meta.url);\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('does NOT flag assignment of a safe IIFE that does not return createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      'let r;\n' + 'r = (() => 42)();\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });
});

// ─── A8: assignment lifetime follows outer LHS binding ─────────────────────

describe('A8: assignment lifetime follows outer LHS binding', () => {
  it('detects @google/genai when require alias is assigned in inner block but used outside', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' + '{\n' + '  r = require;\n' + '}\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai when binding alias is assigned in inner block but used outside', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'let r;\n' +
        '{\n' +
        '  r = createRequire(import.meta.url);\n' +
        '}\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('does NOT flag when require is shadowed in the assignment block', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' +
        '{\n' +
        '  const require = (name) => null;\n' +
        '  r = require;\n' +
        '}\n' +
        "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('does NOT flag when a local variable shadows the alias name in a different scope', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r;\n' +
        '{\n' +
        '  r = require;\n' +
        '}\n' +
        '{\n' +
        '  const r = (name) => null;\n' +
        "  r('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });
});

// ── #4: anonymous FunctionExpression variable helper provenance ─────────────

describe('#4: anonymous FunctionExpression helper returns createRequire', () => {
  it('detects @google/genai via anonymous function expression helper', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const getReq = function(url) { return createRequire(url); };\n' +
        "getReq(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai via anonymous function expression with binding return', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n' +
        'const getReq = function() { return req; };\n' +
        "getReq()('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

describe('#4: object-literal binding restricted to identifier declarations', () => {
  it('does NOT resolve destructuring pattern to object literal binding', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'const { x } = { GeminiLeak: 1 };\nmodule.exports = x;\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    // The destructuring `const { x } = { GeminiLeak: 1 }` does NOT create
    // a binding `x` → { GeminiLeak: 1 }. Only `x`'s own name is checked.
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(false);
  });

  it('still resolves identifier declaration to object literal binding', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'const obj = { GeminiLeak: 1 };\nmodule.exports = obj;\n',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
  });
});
