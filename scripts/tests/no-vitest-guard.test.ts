/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-no-vitest.ts (issue #2970).
 *
 * These tests exercise the guard's real behavior end-to-end against
 * SYNTHETIC temp fixtures and the REAL repo. They follow the fixture-tree
 * style of scripts/tests/legacy-paths-guard.test.ts: the guard is invoked as
 * a real subprocess (no mock theater) against a real temp tree.
 *
 * Test table (issue #2970 plan, B10):
 *  1. clean fixture tree → exit 0, no findings
 *  2. import of 'vitest' specifier → exit non-zero
 *  3. import of 'vitest/config' subpath → exit non-zero
 *  4. "vitest" in devDependencies → exit non-zero
 *  5. "@vitest/coverage-v8" dependency → exit non-zero
 *  6. "@fast-check/vitest" dependency → exit non-zero
 *  7. "@stryker-mutator/vitest-runner" dependency → exit non-zero
 *  8. a vitest.config.ts file → exit non-zero
 *  9. a vitest.config.native-keyring.ts file → exit non-zero
 * 10. script "test:vitest": "vitest run" → exit non-zero
 * 11. the word "vitest" in prose/comment only → exit 0 (no false positive)
 * 12. two distinct violations → both reported, not just the first
 *
 * Tests use bun:test (this project is Bun-only).
 */

import { describe, expect, it } from 'bun:test';
import {
  bunAvailable,
  runScript,
  runScriptRealRepo,
  withFixture,
} from './no-vitest-guard-helpers.ts';

const missingBunMessage =
  '[no-vitest] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-no-vitest',
  () => {
    // CI Bun availability guard: fails loudly when Bun is missing in CI,
    // without using describe.only (which can suppress sibling suites).
    it('Bun is available in CI (required for guard tests)', () => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      }
    });

    // ── Real repo must be clean ─────────────────────────────────────────
    describe('real repo (current state must be clean)', () => {
      it('passes against the real repository', () => {
        const { code, stdout } = runScriptRealRepo(0);
        expect(code).toBe(0);
        expect(stdout).toContain('no-vitest guard PASSED');
      }, 90_000);
    });

    // ── Fixture-based positives (clean tree) ────────────────────────────
    describe('clean fixture tree (positive case #1)', () => {
      it('exit 0 with no findings on a clean tree', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
        expect(stdout).not.toContain('violation');
      });
    });

    // ── Import / require detection (#2, #3) ─────────────────────────────
    describe('vitest import/require detection', () => {
      it('#2 FAILS an import of the vitest specifier', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.ts',
            "import { it } from 'vitest';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.ts');
        expect(stdout).toContain('no-vitest guard FAILED');
      });

      it('#3 FAILS an import of a vitest/* subpath', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue-config.ts',
            "import { defineConfig } from 'vitest/config';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-config.ts');
      });

      it('FAILS a require() of the vitest specifier', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue-require.cjs',
            "const { it } = require('vitest');\nmodule.exports = {};\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-require.cjs');
      });
    });

    // ── Triple-slash reference detection (issue #2970 gap) ─────────────
    describe('triple-slash reference detection', () => {
      it('FAILS a /// <reference types="vitest/globals" /> directive', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue-ref.ts',
            '/// <reference types="vitest/globals" />\nexport const x = 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-ref.ts');
        expect(stdout).toContain('triple-slash reference');
        expect(stdout).toContain('no-vitest guard FAILED');
      });

      it('FAILS a /// <reference types="vitest" /> directive', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue-ref.ts',
            '/// <reference types="vitest" />\nexport const x = 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-ref.ts');
      });

      it('FAILS a single-quoted triple-slash vitest reference', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue-ref.ts',
            "/// <reference types='vitest/config' />\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-ref.ts');
      });

      it('does NOT flag a prose mention of vitest in a comment', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/explanation.ts',
            '// This file used to have /// triple slash but now mentions vitest in prose only.\n' +
              'export const note = "no vitest directive here";\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Manifest dependency detection (#4–#7) ──────────────────────────
    describe('manifest dependency detection', () => {
      it('#4 FAILS "vitest" in devDependencies', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: { vitest: '^3.2.6' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue/package.json');
        expect(stdout).toContain('vitest');
      });

      it('#5 FAILS "@vitest/coverage-v8" dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: { '@vitest/coverage-v8': '^3.2.6' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('@vitest/coverage-v8');
      });

      it('#6 FAILS "@fast-check/vitest" dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: { '@fast-check/vitest': '^0.2.2' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('@fast-check/vitest');
      });

      it('#7 FAILS "@stryker-mutator/vitest-runner" dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: {
                  '@stryker-mutator/vitest-runner': '^9.6.1',
                },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('@stryker-mutator/vitest-runner');
      });

      it('FAILS "vitest" in regular dependencies too', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                dependencies: { vitest: '^3.2.6' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest');
      });

      it('reports the real line number for a manifest dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          // The "vitest" key is on line 5 (0-indexed JSON.stringify below).
          const pkg = [
            '{',
            '  "name": "rogue",',
            '  "devDependencies": {',
            '    "lodash": "^4.0.0",',
            '    "vitest": "^3.2.6"',
            '  }',
            '}',
            '',
          ].join('\n');
          write('packages/rogue/package.json', pkg);
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        // Line 5 is where "vitest" lives — NOT line 1.
        expect(stdout).toContain('rogue/package.json:5:');
      });
    });

    // ── Config file detection (#8, #9) ─────────────────────────────────
    describe('vitest config file detection', () => {
      it('#8 FAILS a vitest.config.ts file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('packages/rogue/vitest.config.ts', 'export default {};\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.config.ts');
      });

      it('#9 FAILS a vitest.config.native-keyring.ts file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/vitest.config.native-keyring.ts',
            'export default {};\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.config.native-keyring.ts');
      });

      it('FAILS a vitest.*.config.* file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/vitest.coverage.config.mjs',
            'export default {};\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.coverage.config.mjs');
      });
    });

    // ── Package script detection (#10) ─────────────────────────────────
    describe('package script detection', () => {
      it('#10 FAILS a script invoking the vitest binary', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                scripts: { 'test:vitest': 'vitest run' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue/package.json');
        expect(stdout).toContain('vitest run');
      });

      it('FAILS a script that invokes vitest as a subcommand', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                scripts: { check: 'npx vitest run --coverage' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest');
      });
    });

    // ── No false positives on prose (#11) ──────────────────────────────
    describe('no false positive on prose/comment (#11)', () => {
      it('passes when the word "vitest" appears only in prose/comment', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/explanation.ts',
            '// This module used to be tested with vitest but now uses bun:test.\n' +
              'export const note = "We migrated away from vitest already.";\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes when a markdown doc mentions vitest in prose', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'docs/migration.md',
            '# Migration\n\nThe project previously used vitest.\nNow all tests use bun:test.\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Detection, not counting (#12) ──────────────────────────────────
    describe('detection reports every violation (#12)', () => {
      it('reports two distinct violations, not just the first', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/a.ts',
            "import { it } from 'vitest';\nexport const a = 1;\n",
          );
          write(
            'packages/cli/src/b.ts',
            "import { describe } from 'vitest';\nexport const b = 2;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('a.ts');
        expect(stdout).toContain('b.ts');
      });
    });

    // ── Adversarial: bypass #2a — local binary path in a package script ──
    describe('bypass #2a: path-qualified binary in a package script', () => {
      it('FAILS a script with ./node_modules/.bin/vitest', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                scripts: { test: './node_modules/.bin/vitest run' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest');
      });
    });

    // ── Adversarial: bypass #2b — vitest invoked from non-code files ────
    describe('bypass #2b: vitest invoked from non-code files', () => {
      it('FAILS npx vitest in a workflow YAML file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            '.github/workflows/ci.yml',
            'jobs:\n  test:\n    runs-on: ubuntu-latest\n' +
              '    steps:\n' +
              '      - run: npx vitest run --config vitest.cfg.ts\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('ci.yml');
      });

      it('FAILS npx vitest in a Makefile', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('Makefile', 'test:\n\tnpx vitest run\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('Makefile');
      });

      it('FAILS npx vitest in a shell script', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('run-tests.sh', '#!/bin/bash\nnpx vitest run\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('run-tests.sh');
      });

      it('FAILS a vitest preload reference in a TOML file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bunfig.toml', 'preload = ["./vitest-shim.ts"]\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bunfig.toml');
      });

      it('FAILS a bare vitest command (no subcommand) in a Makefile', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('Makefile', 'test:\n\tvitest\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('Makefile');
      });

      it('FAILS a bare vitest command (no subcommand) in a workflow YAML', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            '.github/workflows/ci.yml',
            'jobs:\n  test:\n    runs-on: ubuntu-latest\n' +
              '    steps:\n' +
              '      - run: vitest\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('ci.yml');
      });

      it('does NOT flag a prose mention of vitest in a YAML comment', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            '.github/workflows/ci.yml',
            '# This workflow used vitest but now uses bun:test\n' +
              'jobs:\n  test:\n    runs-on: ubuntu-latest\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag a YAML comment containing "vitest run"', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            '.github/workflows/ci.yml',
            '# Run vitest run for local testing (migrated to bun:test)\n' +
              'jobs:\n  test:\n    runs-on: ubuntu-latest\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Adversarial: bypass #2c — config filenames not covered ─────────
    describe('bypass #2c: additional vitest config filenames', () => {
      it('FAILS a vitest.workspace.ts file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('vitest.workspace.ts', 'export default [];\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.workspace.ts');
      });

      it('FAILS a vitest.setup.ts file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('packages/rogue/vitest.setup.ts', 'export const setup = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.setup.ts');
      });

      it('FAILS a bare vitest.mts config file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('packages/rogue/vitest.mts', 'export const config = {};\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vitest.mts');
      });

      it('FAILS a vite.config.ts file containing a test block', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/vite.config.ts',
            'import { defineConfig } from "vite";\n' +
              'export default defineConfig({\n' +
              '  test: {\n' +
              '    environment: "node",\n' +
              '  },\n' +
              '});\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('vite.config.ts');
        expect(stdout).toContain('test block');
      });

      it('does NOT flag a vite.config.ts without a test block', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/vite.config.ts',
            'import { defineConfig } from "vite";\n' +
              'export default defineConfig({\n' +
              '  build: { outDir: "dist" },\n' +
              '});\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Adversarial: bypass #2d — npm alias dependencies ────────────────
    describe('bypass #2d: npm alias dependencies', () => {
      it('FAILS an npm:aliased vitest dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: { testrunner: 'npm:vitest@^3.0.0' },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('npm alias');
        expect(stdout).toContain('npm:vitest');
      });

      it('FAILS an npm:aliased @vitest dependency', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/rogue/package.json',
            JSON.stringify(
              {
                name: 'rogue',
                devDependencies: {
                  cov: 'npm:@vitest/coverage-v8@^3.0.0',
                },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('npm alias');
      });
    });

    // ── Adversarial: bypass #2e — lockfile scanning ─────────────────────
    describe('bypass #2e: lockfile scanning', () => {
      it('FAILs a package-lock.json containing a vitest package', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'package-lock.json',
            JSON.stringify(
              {
                name: 'root',
                lockfileVersion: 3,
                packages: {
                  'node_modules/vitest': {
                    version: '3.2.6',
                  },
                },
              },
              null,
              2,
            ) + '\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('package-lock.json');
      });

      it('FAILs a bun.lock containing a vitest package', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bun.lock', '{\n  "vitest@3.2.6": {}\n}\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bun.lock');
      });
    });

    // ── Adversarial: bypass #2f — multi-line dynamic import ─────────────
    describe('bypass #2f: multi-line dynamic import', () => {
      it('FAILS a multi-line dynamic import of vitest', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.ts',
            'const v = await import(\n  "vitest"\n);\nexport const x = v;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.ts');
        expect(stdout).toContain('vitest');
      });
    });

    // ── False positive fix: vitest.config.md ───────────────────────────
    describe('false positive fix: vitest.config.md is NOT a config file', () => {
      it('passes on a documentation file named vitest.config.md', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/vitest.config.md',
            '# Vitest config docs\n\nThis is just documentation.\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Finding A: vitest import syntax in comments/strings ───────────
    describe('finding A: vitest import syntax in comments/strings is NOT a violation', () => {
      it("passes when `import ... from 'vitest'` is inside a line comment", () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/note.ts',
            "// import { it } from 'vitest'\nexport const x = 1;\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it("passes when `import 'vitest'` is inside a block comment", () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/note.ts',
            "/* import 'vitest' for debugging */\nexport const x = 1;\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes when vitest import syntax is inside a string literal', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/note.ts',
            'export const msg = "from \'vitest\' to bun:test";\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes when vitest import syntax is inside a template literal', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/note.ts',
            "export const note = `migrating import 'vitest' away`;\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS a real import of vitest (control)', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.ts',
            "import { it } from 'vitest';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.ts');
      });
    });

    // ── Finding B: additional binary invocation forms ─────────────────
    describe('finding B: additional vitest binary invocation forms in non-code files', () => {
      const forms: ReadonlyArray<readonly [string, string]> = [
        ['npm run vitest', 'npm run vitest'],
        ['pnpm exec vitest', 'pnpm exec vitest'],
        ['yarn exec vitest', 'yarn exec vitest'],
        ['yarn run vitest', 'yarn run vitest'],
        ['bun run vitest', 'bun run vitest'],
        ['bunx --bun vitest', 'bunx --bun vitest'],
      ];
      for (const [label, invocation] of forms) {
        it(`FAILS ${label} in a workflow YAML file`, () => {
          const { code, stdout } = withFixture(({ root, write }) => {
            write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
            write(
              '.github/workflows/ci.yml',
              'jobs:\n  test:\n    runs-on: ubuntu-latest\n' +
                '    steps:\n' +
                `      - run: ${invocation}\n`,
            );
            return runScript(root, 1);
          });
          expect(code).toBe(1);
          expect(stdout).toContain('ci.yml');
        });
      }

      it('does NOT flag npm run vitest inside a YAML comment', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            '.github/workflows/ci.yml',
            '# migrated: npm run vitest is gone\n' +
              'jobs:\n  test:\n    runs-on: ubuntu-latest\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Finding C1: TOML pattern word boundary ─────────────────────────
    describe('finding C1: TOML pattern word boundary', () => {
      it('does NOT flag avitest-shim.ts in a TOML preload', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bunfig.toml', 'preload = ["./avitest-shim.ts"]\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag myvitest-helper.ts in a TOML preload', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bunfig.toml', 'preload = ["./myvitest-helper.ts"]\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS vitest-shim.ts in a TOML preload (still detected)', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bunfig.toml', 'preload = ["./vitest-shim.ts"]\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bunfig.toml');
      });
    });

    // ── Finding C2: bare TOML reference without extension ──────────────
    describe('finding C2: bare vitest reference in TOML', () => {
      it('FAILS a bare preload = ["./vitest"] with no extension', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('bunfig.toml', 'preload = ["./vitest"]\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bunfig.toml');
      });
    });

    // ── Finding D: malformed manifest is fail-closed ──────────────────
    describe('finding D: malformed package.json is fail-closed', () => {
      it('FAILS (non-zero) and explains why on a syntactically invalid package.json', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          // Valid JSON object opening, then broken — JSON.parse throws.
          write(
            'packages/rogue/package.json',
            '{\n  "name": "rogue"\n oops not json\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue/package.json');
        expect(stdout).toContain('Cannot parse manifest');
      });
    });

    // ── Self-exclusion ─────────────────────────────────────────────────
    describe('self-exclusion', () => {
      it('does not flag its own source or test fixtures', () => {
        // The real repo contains the guard source and its tests, which
        // legitimately reference the vitest specifier in string literals and
        // prose. The real-repo test above (exit 0) already proves this.
        // This fixture test mirrors that contract explicitly.
        const { code } = runScriptRealRepo(0);
        expect(code).toBe(0);
      }, 90_000);
    });
  },
);
