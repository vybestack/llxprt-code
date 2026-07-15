/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bypass-detection tests for the genai-enclave scanner (#2352).
 *
 * These tests specifically exercise forms that a fresh code review flagged as
 * potential bypass vectors:
 *
 * 1. **Source-order-independent createRequire** — calls that appear lexically
 *    BEFORE the binding or import that establishes the createRequire factory.
 *    The scanner does a provenance pre-pass, so detection must not depend on
 *    source order.
 *
 * 2. **Namespace/default imports from node:module** — `import * as m` and
 *    `import m from 'node:module'` then `m.createRequire(...)('@google/genai')`.
 *
 * 3. **CommonJS direct-assignment export forms** — `module.exports = <id>`,
 *    `module.exports = class GeminiName {}`, `module.exports = function
 *    geminiName() {}`.
 *
 * 4. **export import = require** — ImportEqualsDeclaration with an export
 *    modifier and a Gemini-containing name.
 */

import { describe, it, expect } from 'vitest';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
} from '../genai-enclave/scanner.ts';

describe('scanGenaiImports — source-order-independent createRequire forms', () => {
  it('detects @google/genai when the binding call appears BEFORE the import', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const req = cr(import.meta.url);\n' +
        "import { createRequire as cr } from 'node:module';\n" +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai when a call appears BEFORE the binding declaration', () => {
    const sf = parseSourceFile(
      'test.ts',
      "req('@google/genai');\n" +
        "import { createRequire } from 'node:module';\n" +
        'const req = createRequire(import.meta.url);\n',
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai through a namespace import from node:module', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import * as m from 'node:module';\n" +
        "m.createRequire(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai through a namespace import from bare "module"', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import * as m from 'module';\n" +
        "m.createRequire(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai through a default import from node:module', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import m from 'node:module';\n" +
        "m.createRequire(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai through a binding created from a namespace createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import * as m from 'node:module';\n" +
        'const req = m.createRequire(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT flag a namespace createRequire from a non-module import', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import * as m from 'some-lib';\n" +
        "m.createRequire(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(0);
  });
});

describe('scanGeminiExports — CommonJS direct-assignment export forms', () => {
  it('detects module.exports = <GeminiIdentifier>', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'class GeminiHandler {}\nmodule.exports = GeminiHandler;',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiHandler');
  });

  it('detects module.exports = class GeminiName { }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = class GeminiClass { };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiClass');
  });

  it('detects module.exports = function geminiName() { }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = function geminiFn() { };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('geminiFn');
  });

  it('fails closed for module.exports = <unresolved nonGeminiIdentifier>', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'class Normal {}\nmodule.exports = Normal;',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toBe(
      'computed export mutation (fail-closed)',
    );
  });

  it('does NOT flag module.exports = anonymous class/function', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = class { };\nmodule.exports = function() { };',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });
});

describe('scanGeminiExports — export = object literal (TS export-equals)', () => {
  it('detects export = { GeminiTs: 1 }', () => {
    const sf = parseSourceFile('test.ts', 'export = { GeminiTs: 1 };');
    expect(scanGeminiExports(sf, 'test.ts').map((v) => v.exportName)).toContain(
      'GeminiTs',
    );
  });

  it('detects export = { GeminiA: 1, GeminiB: 2 } (multiple properties)', () => {
    const sf = parseSourceFile(
      'test.ts',
      'export = { GeminiA: 1, GeminiB: 2, normal: 3 };',
    );
    const names = scanGeminiExports(sf, 'test.ts').map((v) => v.exportName);
    expect(names).toContain('GeminiA');
    expect(names).toContain('GeminiB');
  });

  it('does NOT flag export = { normalName: 1 }', () => {
    const sf = parseSourceFile('test.ts', 'export = { normalName: 1 };');
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });
});

describe('scanGeminiExports — chained CommonJS export assignments', () => {
  it('detects exports = module.exports = { GeminiCjs: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports = module.exports = { GeminiCjs: 1 };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiCjs');
  });

  it('detects exports = module.exports = { GeminiX: 1, GeminiY: 2 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports = module.exports = { GeminiX: 1, GeminiY: 2 };',
    );
    const names = scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName);
    expect(names).toContain('GeminiX');
    expect(names).toContain('GeminiY');
  });

  it('does NOT flag exports = module.exports = { normalName: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'exports = module.exports = { normalName: 1 };',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('detects module.exports = exports = { GeminiReversed: 1 }', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = exports = { GeminiReversed: 1 };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiReversed');
  });
});

describe('scanGeminiExports — export import = require forms', () => {
  it('detects export import GeminiName = require(...)', () => {
    const sf = parseSourceFile(
      'test.ts',
      "export import GeminiSdk = require('./local');",
    );
    expect(scanGeminiExports(sf, 'test.ts').map((v) => v.exportName)).toContain(
      'GeminiSdk',
    );
  });

  it('does NOT flag non-exported import = require', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import GeminiSdk = require('./local');",
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });
});

describe('scanGenaiImports — require.call/bind and module.require.call (F1)', () => {
  it('detects @google/genai via require.call(this, specifier)', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require.call(this, '@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via require.bind(null)(specifier)', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require.bind(null)('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via module.require.call(this, specifier)', () => {
    const sf = parseSourceFile(
      'test.ts',
      `module.require.call(this, '@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via module.require.bind(null)(specifier)', () => {
    const sf = parseSourceFile(
      'test.ts',
      `module.require.bind(null)('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via require.apply(null, [specifier])', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require.apply(null, ['@google/genai']);\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects computed specifier via require.call(this, variable)', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const pkg = String.fromCharCode(...[97]);\nrequire.call(this, pkg);\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('does NOT flag require.call(this, "safe-package")', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require.call(this, 'safe-package');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });

  it('detects @google/genai via comma-loader: (0, require)(specifier)', () => {
    const sf = parseSourceFile('test.ts', `(0, require)('@google/genai');\n`);
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  // ── Finding3: stored require.bind / module.require.bind aliases ──
  it('detects @google/genai via stored require.bind alias', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const boundReq = require.bind(null);\nboundReq('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via stored module.require.bind alias', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const boundModReq = module.require.bind(null);\nboundModReq('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects computed specifier via stored require.bind alias', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const boundReq = require.bind(null);\nconst pkg = 'dynamic';\nboundReq(pkg);\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('computed-import');
  });

  it('does NOT flag a safe stored require.bind alias with a string specifier', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const boundReq = require.bind(null);\nboundReq('safe-package');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });

  // ── Bracket-notation bypass vectors ────────────────────────────────
  it('detects @google/genai via require["call"] bracket-notation', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require['call'](this, '@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via require["apply"] bracket-notation', () => {
    const sf = parseSourceFile(
      'test.ts',
      `require['apply'](null, ['@google/genai']);\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via stored require["bind"] bracket-notation', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const r = require['bind'](null);\nr('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects @google/genai via module["require"]["bind"] bracket chain', () => {
    const sf = parseSourceFile(
      'test.ts',
      `const r = module['require']['bind'](null);\nr('@google/genai');\n`,
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});
