/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Adversarial regression tests for all 11 reproduced findings (#2352).
 *
 * Each test is an exact adversarial case that was confirmed as a gap via
 * probe tests. Tests are organized by finding number and cover both
 * positive (must detect) and negative (must NOT false-positive) cases.
 *
 * Findings:
 *  1.  indirect require element/call and bound createRequire call
 *  2.  scope-keyed unbounded helper worklist including arrow helpers
 *      without nested-return false positives
 *  3.  CJS target aliases/Reflect.defineProperty/correct nested-call
 *      fail-closed
 *  4.  reject symlink package entries in production walks
 *  5.  packed closure roots from every recursive export leaf and error
 *      packed-absent
 *  6.  verify every export leaf
 *  7.  AST runtime edges module.require/template/createRequire
 *  8.  consumer-relative canonical real protocol resolver integrated
 *  9.  root peers + workspace duplicate rejection
 *  10. complete lexical shadows/reassignment and distinguish static
 *      empty spreads
 *  11. variant config filename classification
 */

import { describe, it, expect } from 'vitest';
import {
  scanGenaiImports,
  scanGeminiExports,
  parseSourceFile,
} from '../genai-enclave/scanner.ts';
import { isRuntimeExportSurface } from '../genai-enclave/config.ts';
import {
  type WorkspaceManifest,
  verifyTransitiveSourceClosure,
  verifyExportedSubpaths,
  discoverPackageWorkspaces,
} from './workspace-source-helpers.ts';
import {
  createRealProtocolResolver,
  detectRootDuplicateDependencies,
} from './publish-dependency-helpers.ts';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Finding 1: indirect require element/call and bound createRequire call ─

describe('Finding1: indirect require element/call — comma-loader with module["require"]', () => {
  it('detects (0, module["require"])("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '(0, module["require"])("@google/genai");\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('detects (0, module.require)("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '(0, module.require)("@google/genai");\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });

  it('does NOT flag (0, module["require"])("safe-pkg")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '(0, module["require"])("safe-pkg");\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });
});

describe('Finding1: bound createRequire call — arrow helper returning createRequire', () => {
  it('detects @google/genai through an arrow function returning createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const getReq = (url) => createRequire(url);\n' +
        'const req = getReq(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('detects @google/genai through an arrow function with expression body', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const cr = (url) => createRequire(url);\n' +
        "cr(import.meta.url)('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });
});

// ─── Finding 2: scope-keyed helper worklist, arrow helpers, nested-return ──

describe('Finding2: no nested-return false positive for createRequire helper', () => {
  it('traces through a function whose NESTED function returns createRequire', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getReq(url) {\n' +
        '  function helper() { return createRequire(url); }\n' +
        '  return helper();\n' +
        '}\n' +
        'const req = getReq(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    // The scanner traces getReq → helper() → createRequire transitively,
    // so req is classified as a bound createRequire. The genai call is
    // detected. This is correct behavior — the scanner follows the chain.
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations.some((v) => v.kind === 'genai-import')).toBe(true);
  });

  it('does NOT classify a safe arrow function with nested createRequire return', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const safeFn = (url) => {\n' +
        '  const inner = () => createRequire(url);\n' +
        '  return String(url);\n' +
        '};\n' +
        'const req = safeFn(import.meta.url);\n' +
        "req('@google/genai');\n",
    );
    // safeFn returns String(url), NOT createRequire. The nested arrow `inner`
    // returns createRequire, but that's a nested function — safeFn's actual
    // return is String(url). So safeFn should NOT be classified as
    // createRequire-returning, and req should NOT be a binding.
    // The call `req('@google/genai')` should NOT be detected as genai-import
    // because req is not a known binding.
    const violations = scanGenaiImports(sf, 'test.ts');
    expect(violations).toEqual([]);
  });
});

// ─── Finding 3: CJS target aliases / Reflect.defineProperty / nested-call ──

describe('Finding3: Reflect.defineProperty on exports', () => {
  it('detects Reflect.defineProperty(exports, "GeminiLeak", {value: 1})', () => {
    const sf = parseSourceFile(
      'test.cjs',
      "Reflect.defineProperty(exports, 'GeminiLeak', {value: 1});\n",
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiLeak');
  });

  it('detects Reflect.defineProperty(exports, "GeminiLeak", {...}) fail-closed for computed key', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const key = "GeminiLeak";\n' +
        'Reflect.defineProperty(exports, key, {value: 1});\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('does NOT flag Reflect.defineProperty on a non-exports target', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const obj = {};\n' +
        "Reflect.defineProperty(obj, 'GeminiLeak', {value: 1});\n",
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(false);
  });

  it('detects exports mutation even when Reflect is shadowed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      '{\n' +
        '  const Reflect = { defineProperty(o, k, d) { o[k] = d.value; } };\n' +
        "  Reflect.defineProperty(exports, 'GeminiLeak', {value: 1});\n" +
        '}\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    // Shadowed Reflect — the global Reflect.defineProperty check must NOT
    // fire. The export is still detected through the exports property
    // assignment path (exports['GeminiLeak'] = ...), which is correct
    // behavior. The key point: the violation comes from the exports
    // mutation, NOT from the shadowed Reflect global.
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiLeak');
    expect(violations[0].exportForm).not.toContain('Reflect');
  });
});

describe('Finding3: correct nested-call fail-closed', () => {
  it('flags module.exports = makeExports()() as fail-closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function makeExports() { return () => ({ x: 1 }); }\n' +
        'module.exports = makeExports()();\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('flags module.exports = factory()()() (triple nested call) as fail-closed', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function factory() { return () => () => ({ x: 1 }); }\n' +
        'module.exports = factory()()();\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('does NOT fail-closed for module.exports = createRequire(url)("node:fs")', () => {
    const sf = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        "module.exports = createRequire(import.meta.url)('node:fs');\n",
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(
      violations.filter((v) => v.exportForm.includes('fail-closed')),
    ).toEqual([]);
  });
});

// ─── Finding 4: reject symlink package entries in production walks ──────────

describe('Finding4: walkPackages rejects symlink package entries', () => {
  it('rejects symlinked package dirs pointing outside repo root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-sym-prod-'));
    const externalDir = mkdtempSync(join(tmpdir(), 'ext-sym-'));
    try {
      mkdirSync(join(repoRoot, 'packages'), { recursive: true });
      symlinkSync(
        externalDir,
        join(repoRoot, 'packages', 'evil'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const dirs = discoverPackageWorkspaces(repoRoot);
      expect(dirs).not.toContain('packages/evil');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('safely follows symlinks pointing within repo root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-safe-sym-'));
    try {
      mkdirSync(join(repoRoot, 'packages', 'real'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'real', 'package.json'),
        JSON.stringify({ name: 'real' }),
      );
      symlinkSync(
        join(repoRoot, 'packages', 'real'),
        join(repoRoot, 'packages', 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const dirs = discoverPackageWorkspaces(repoRoot);
      expect(dirs).toContain('packages/linked');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 5: packed closure roots from every export leaf + packed-absent ─

describe('Finding5: packed closure roots from every export leaf', () => {
  it('uses every export leaf as a closure root', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub.js': { bun: './sub.ts' },
      },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-roots-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), "export { x } from './shared.js';\n");
    writeFileSync(join(dir, 'sub.ts'), "export { y } from './shared.js';\n");
    writeFileSync(
      join(dir, 'shared.ts'),
      'export const x = 1; export const y = 2;\n',
    );
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/sub.ts',
        'packages/test-pkg/shared.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reports missing shared file when only one leaf is packed but shared is not', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub.js': { bun: './sub.ts' },
      },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-missing-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), "export { x } from './shared.js';\n");
    writeFileSync(join(dir, 'sub.ts'), "export { y } from './shared.js';\n");
    writeFileSync(join(dir, 'shared.ts'), 'export const x = 1;\n');
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/sub.ts',
        // shared.ts is NOT packed — should be reported as missing
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toHaveLength(1);
      expect(missing.some((m) => m.missingFile.includes('shared'))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('errors on packed-absent: reports a packed file that does not exist on disk', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-absent-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), "export { x } from './helper.js';\n");
    // helper.ts does NOT exist on disk but IS in the packed set
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/helper.ts', // absent on disk
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      // The packed-absent file should be reported — it's packed but
      // doesn't exist on disk, so its imports can't be verified.
      expect(missing).toHaveLength(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 6: verify every export leaf ships ───────────────────────────────

describe('Finding6: verify every export leaf ships', () => {
  it('reports a missing export leaf that is not packed', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub.js': { bun: './sub.ts' },
      },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-leaf-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'sub.ts'), 'export const y = 2;\n');
    try {
      const packed = new Set(['packages/test-pkg/index.ts']);
      const missing = verifyExportedSubpaths(
        'packages/test-pkg',
        manifest,
        packed,
      );
      expect(missing).toHaveLength(1);
      expect(missing.some((m) => m.missingFile.includes('sub'))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('passes when every export leaf is packed', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub.js': { bun: './sub.ts' },
        './feature.js': {
          import: { default: './dist/feature.js' },
          require: './dist/feature.cjs',
        },
      },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-all-leaves-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'sub.ts'), 'export const y = 2;\n');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'feature.js'), 'export const z = 3;\n');
    writeFileSync(
      join(dir, 'dist', 'feature.cjs'),
      'module.exports = { z: 3 };\n',
    );
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/sub.ts',
        'packages/test-pkg/dist/feature.js',
        'packages/test-pkg/dist/feature.cjs',
      ]);
      const missing = verifyExportedSubpaths(
        'packages/test-pkg',
        manifest,
        packed,
      );
      expect(missing).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 7: AST runtime edges module.require/template/createRequire ────

describe('Finding7: AST runtime edges in closure walk', () => {
  it('follows module.require("./relative") in closure walk', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-modreq-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.ts'),
      "const h = module.require('./helper.js');\n",
    );
    writeFileSync(join(dir, 'helper.ts'), 'export const x = 42;\n');
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/helper.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('follows createRequire(url)("./relative") in closure walk', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-cr-'));
    const dir = join(repoRoot, 'packages/test-pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.ts'),
      "import { createRequire } from 'node:module';\n" +
        'const r = createRequire(import.meta.url);\n' +
        "const h = r('./helper.js');\n",
    );
    writeFileSync(join(dir, 'helper.ts'), 'export const x = 42;\n');
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/helper.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 8: consumer-relative canonical real protocol resolver ──────────

describe('Finding8: consumer-relative canonical protocol resolver', () => {
  it('resolves file:../core relative to the consumer workspace dir', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-consumer-'));
    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@scope/core' }),
      );
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      // file:../core from packages/cli consumer → packages/core
      const result = resolver('@scope/core', 'file:../core', 'packages/cli');
      expect(result.resolved).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects file:../core when the resolved path does not match the expected workspace', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-mismatch-'));
    try {
      mkdirSync(join(repoRoot, 'packages', 'core'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@scope/core' }),
      );
      mkdirSync(join(repoRoot, 'packages', 'tools'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'tools', 'package.json'),
        JSON.stringify({ name: '@scope/tools' }),
      );
      const nameToDir = new Map([
        ['@scope/core', 'packages/core'],
        ['@scope/tools', 'packages/tools'],
      ]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      // file:../tools from packages/core → packages/tools, but depName is
      // @scope/core which maps to packages/core — mismatch.
      const result = resolver('@scope/core', 'file:../tools', 'packages/core');
      expect(result.resolved).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 9: root peers + workspace duplicate rejection ───────────────────

describe('Finding9: root peers + workspace duplicate rejection', () => {
  it('detects workspace package in both root dependencies and peerDependencies', () => {
    const root = {
      dependencies: { '@scope/core': 'workspace:*' },
      peerDependencies: { '@scope/core': 'workspace:*' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(1);
    expect(dups[0].name).toBe('@scope/core');
  });

  it('detects duplicate across all three root sections', () => {
    const root = {
      dependencies: { '@scope/core': 'workspace:*' },
      optionalDependencies: { '@scope/core': 'workspace:*' },
      peerDependencies: { '@scope/core': 'workspace:*' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(1);
    expect(dups[0].sections.length).toBe(3);
  });

  it('does NOT flag packages in only one section', () => {
    const root = {
      dependencies: { '@scope/core': 'workspace:*' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    expect(detectRootDuplicateDependencies(root)).toEqual([]);
  });
});

// ─── Finding 10: lexical shadows/reassignment + static empty spreads ────────

describe('Finding10: lexical shadow reassignment — no false positive', () => {
  it('detects require call after block-scoped shadow scope ends', () => {
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

  it('does NOT flag require shadowed by function parameter', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'function loader(require) {\n' +
        "  return require('@google/genai');\n" +
        '}\n',
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toEqual([]);
  });

  it('detects reassignment of require alias: let r = require; r = require; r("@google/genai")', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'let r = require;\n' + 'r = require;\n' + "r('@google/genai');\n",
    );
    const violations = scanGenaiImports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('genai-import');
  });
});

describe('Finding10: static empty spread — no false positive', () => {
  it('does NOT flag module.exports = { ...{} } as fail-closed', () => {
    const sf = parseSourceFile('test.cjs', 'module.exports = { ...{} };\n');
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(
      violations.filter((v) => v.exportForm.includes('fail-closed')),
    ).toEqual([]);
  });

  it('does NOT flag export = { ...{} } as fail-closed (ESM export-equals)', () => {
    const sf = parseSourceFile('test.ts', 'export = { ...{} };\n');
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(
      violations.filter((v) => v.exportForm.includes('fail-closed')),
    ).toEqual([]);
  });

  it('DOES flag module.exports = { ...someVar } as fail-closed (non-literal)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'const someVar = { GeminiLeak: 1 };\n' +
        'module.exports = { ...someVar };\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('DOES flag module.exports = { ...{GeminiLeak: 1} } (inline literal spread with Gemini name)', () => {
    const sf = parseSourceFile(
      'test.cjs',
      'module.exports = { ...{ GeminiLeak: 1 } };\n',
    );
    const violations = scanGeminiExports(sf, 'test.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiLeak');
  });
});

// ─── Finding 11: variant config filename classification ─────────────────────

describe('Finding11: variant config filename classification', () => {
  it('classifies standard vitest.config.ts as NOT a runtime export surface', () => {
    expect(isRuntimeExportSurface('vitest.config.ts')).toBe(false);
  });

  it('classifies variant vitest.unit.config.ts as NOT a runtime export surface', () => {
    expect(isRuntimeExportSurface('vitest.unit.config.ts')).toBe(false);
  });

  it('classifies vite.worker.config.mjs as NOT a runtime export surface', () => {
    expect(isRuntimeExportSurface('vite.worker.config.mjs')).toBe(false);
  });

  it('classifies a non-config file as a runtime export surface', () => {
    expect(isRuntimeExportSurface('index.ts')).toBe(true);
  });

  it('does NOT classify a file with a similar but non-config name as config', () => {
    expect(isRuntimeExportSurface('vitest-helper.ts')).toBe(true);
  });
});
