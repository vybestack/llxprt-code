/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-genai-enclave.ts (#2352).
 *
 * These tests exercise the guard's real behavior end-to-end:
 *
 * 1. Against the REAL repo — the guard must pass today (only enclaves import
 *    @google/genai; no new Gemini-named exports outside the allowlist;
 *    manifests are correct; no computed imports in production code).
 * 2. Against SYNTHETIC temp fixtures — proving that a scratch
 *    packages/cli import of @google/genai FAILS, a new Gemini-named export
 *    outside the allowlist FAILS, allowed enclave examples PASS, sibling-prefix
 *    paths FAIL, computed imports FAIL, manifest violations FAIL, operational
 *    errors FAIL (closed).
 *
 * Tests invoke the real guard script via a non-blocking async child process
 * (no mock theater).
 *
 * Per RULES.md: positive tests ISOLATE the enclave under test — they do NOT
 * write filler files from the other enclave. Negative tests verify the exact
 * file that should be flagged.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  bunAvailable,
  runScript,
  runScriptRealRepo,
  withFixture,
  writeRequiredManifests,
  GEMINI_IMPORT,
} from './genai-enclave-guard-helpers.ts';

const missingBunMessage =
  '[genai-enclave] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-genai-enclave',
  () => {
    beforeAll(() => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      }
    });

    // ── Non-blocking execution ──────────────────────────────────────────
    describe('non-blocking execution', () => {
      it('keeps the worker event loop responsive during a guard invocation', async () => {
        const guardPromise = withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/providers/src/gemini/geminiProvider.ts',
            GEMINI_IMPORT,
          );
          for (let i = 0; i < 200; i++) {
            write(
              `packages/cli/src/workload/module${i}.ts`,
              `import { randomBytes } from 'node:crypto';\n` +
                `export const token${i}: string = randomBytes(16).toString('hex');\n` +
                `export interface Config${i} { id: number; label: string; }\n` +
                `export class Service${i} {\n` +
                `  private data: Config${i}[] = [];\n` +
                `  add(c: Config${i}): void { this.data.push(c); }\n` +
                `  count(): number { return this.data.length; }\n` +
                `}\n`,
            );
          }
          return runScript(root, 0);
        });
        const timerPromise = new Promise<string>((resolve) =>
          setImmediate(() => resolve('timer')),
        );
        expect(await Promise.race([guardPromise, timerPromise])).toBe('timer');
        await guardPromise;
      }, 60_000);
    });

    // ── Real repo must be clean ─────────────────────────────────────────
    describe('real repo (current state must be clean)', () => {
      it('passes against the real repository', async () => {
        const { code, stdout } = await runScriptRealRepo(0);
        expect(code).toBe(0);
        expect(stdout).toContain('genai-enclave guard PASSED');
      }, 90000);
    });

    // ── Allowed enclaves (ISOLATED positive cases) ──────────────────────
    // Each positive test writes ONLY the enclave file under test — no filler
    // from the other enclave — so the test proves the guard allows that
    // specific enclave path, not that it was masked by the other.
    describe('allowed enclaves (isolated positive cases)', () => {
      it('allows @google/genai import in packages/providers/src/gemini/', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/providers/src/gemini/geminiProvider.ts',
            GEMINI_IMPORT,
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows @google/genai import in packages/core/src/code_assist/', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write('packages/core/src/code_assist/codeAssist.ts', GEMINI_IMPORT);
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows a Gemini-named export inside the gemini enclave', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/providers/src/gemini/GeminiProvider.ts',
            'export class GeminiProvider {}\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows a Gemini-named export in code_assist enclave', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/core/src/code_assist/GeminiCredentialHelper.ts',
            'export class GeminiCredentialHelper {}\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Sibling-prefix negatives ────────────────────────────────────────
    // The enclave prefix has a trailing slash. A sibling directory that
    // shares the prefix stem but NOT the slash boundary must be flagged.
    describe('sibling-prefix negatives', () => {
      it('FAILS @google/genai in packages/providers/src/gemini-backup/', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini-backup/converter.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('converter.ts');
      });

      it('FAILS @google/genai in packages/providers/src/geminiprovider/', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/providers/src/geminiprovider/handler.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('handler.ts');
      });

      it('FAILS @google/genai in packages/core/src/code_assist-old/', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/core/src/code_assist-old/legacy.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy.ts');
      });

      it('FAILS a Gemini-named export in packages/providers/src/gemini-backup/', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini-backup/GeminiHelper.ts',
            'export class GeminiHelper {}\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('GeminiHelper');
      });

      it('does NOT match the gemini directory path without trailing slash', async () => {
        // A file literally at 'packages/providers/src/gemini' (no trailing
        // slash) does NOT match the enclave prefix.
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('gemini.ts');
      });
    });

    // ── Disallowed @google/genai imports ───────────────────────────────
    describe('disallowed @google/genai imports (negative cases)', () => {
      it('FAILS a static import in packages/cli', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.ts',
            "import { Part } from '@google/genai';\nexport const p: Part | null = null;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.ts');
        expect(stdout.toLowerCase()).toContain('@google/genai');
      });

      it('FAILS a type-only import in packages/cli', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/type-only.ts',
            "import type { Content } from '@google/genai';\nexport type T = Content;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('type-only.ts');
      });

      it('FAILS a dynamic import() in packages/agents', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/agents/src/dynamic.ts',
            "export async function f() { return await import('@google/genai'); }\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('dynamic.ts');
      });

      it('FAILS an import-equals (require) in packages/tools', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/tools/src/legacy.ts',
            "import genai = require('@google/genai');\nexport { genai };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy.ts');
      });

      it('FAILS a re-export from @google/genai outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/re-export.ts',
            "export { Part } from '@google/genai';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('re-export.ts');
      });

      it('FAILS export * from @google/genai outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/star-export.ts',
            "export * from '@google/genai';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('star-export.ts');
      });

      it('FAILS a subpath import from @google/genai in packages/mcp', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/mcp/src/sub.ts',
            "import { x } from '@google/genai/sub';\nexport { x };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('sub.ts');
      });

      it('does NOT match @google/genai-utils (different package)', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/utils-import.ts',
            "export { } from '@google/genai-utils';\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS a @google/genai import in a .js file', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.js',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.js');
        expect(stdout.toLowerCase()).toContain('@google/genai');
      });

      it('FAILS a @google/genai import in a .mjs file', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.mjs',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.mjs');
      });

      it('FAILS a @google/genai import in a .cjs file', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.cjs',
            "const { GoogleGenAI } = require('@google/genai');\nmodule.exports = { x: 1 };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.cjs');
      });
    });

    // ── Computed dynamic imports ───────────────────────────────────────
    describe('computed dynamic imports (negative cases)', () => {
      it('FAILS a variable-specifier dynamic import() outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/computed.ts',
            "const pkg = 'anything'; export async function f() { return await import(pkg); }\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('computed.ts');
        expect(stdout).toContain('computed');
      });

      it('FAILS a variable-specifier require() outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/agents/src/computed-require.ts',
            "const pkg = 'anything'; require(pkg);\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('computed-require.ts');
      });

      it('FAILS a GenAI load through a bound createRequire alias', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/bound-require.ts',
            "import { createRequire as makeRequire } from 'node:module';\nconst load = makeRequire(import.meta.url);\nexport const sdk = load('@google/genai');\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bound-require.ts');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS a computed load through a bound createRequire alias', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/computed-bound-require.ts',
            "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nconst specifier = 'anything';\nexport const value = load(specifier);\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('computed-bound-require.ts');
        expect(stdout).toContain('computed');
      });

      it('FAILS a template-literal dynamic import() outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/core/src/utils/template-import.ts',
            'export async function f() { return await import(`pkg/${sub}`); }\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('template-import.ts');
      });

      it('FAILS computed imports in test files (no exemption)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.test.ts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('module.test.ts');
        expect(stdout).toContain('computed');
      });

      it('FAILS computed imports in .mts test files (no exemption)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.test.mts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('module.test.mts');
      });

      it('FAILS computed imports in .cts spec files (no exemption)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.spec.cts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('module.spec.cts');
      });

      it('does NOT flag computed imports in enclave files', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/providers/src/gemini/dynamic-loader.ts',
            "const pkg = '@google/genai'; export async function f() { return await import(pkg); }\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag string-literal dynamic imports of non-genai packages', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/safe-dynamic.ts',
            "export async function f() { return await import('node:fs'); }\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Disallowed Gemini-named exports ────────────────────────────────
    describe('disallowed Gemini-named exports (negative cases)', () => {
      it('FAILS a new Gemini-named class export in packages/cli', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/hook.ts', 'export class useGeminiFoo {}\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('hook.ts');
        expect(stdout).toContain('useGeminiFoo');
      });

      it('FAILS a Gemini-named function export in packages/agents', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/agents/src/util.ts',
            'export function geminiHelper(): void {}\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('util.ts');
      });

      it('FAILS a Gemini-named re-export alias outside enclaves', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/alias.ts',
            "export { Foo as GeminiBar } from './local';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('alias.ts');
        expect(stdout).toContain('GeminiBar');
      });

      it('FAILS a CommonJS defineProperty Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/legacy.cjs',
            "Object.defineProperty(exports, 'GeminiLegacy', { value: 1 });\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy.cjs');
        expect(stdout).toContain('GeminiLegacy');
      });

      it('FAILS a CommonJS Object.assign Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/assigned.cjs',
            "Object.assign(module['exports'], { GeminiAssigned: 1 });\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('assigned.cjs');
        expect(stdout).toContain('GeminiAssigned');
      });

      it('FAILS a TypeScript export = object literal with a Gemini name', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/export-equals.ts',
            'export = { GeminiTs: 1 };\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('export-equals.ts');
        expect(stdout).toContain('GeminiTs');
      });

      it('FAILS a chained CJS export assignment with a Gemini name', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/chained-exports.cjs',
            'exports = module.exports = { GeminiCjs: 1 };\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('chained-exports.cjs');
        expect(stdout).toContain('GeminiCjs');
      });

      it('FAILS an inline spread with a Gemini name in module.exports', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/spread-export.cjs',
            'module.exports = { ...{ GeminiLeak: 1 } };\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('spread-export.cjs');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS an inline spread with a Gemini name in TS export-equals', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/spread-export-equals.ts',
            'export = { ...{ GeminiLeak: 1 } };\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('spread-export-equals.ts');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS a logical-assignment (||=) Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/logical-or.cjs',
            'exports.GeminiLeak ||= 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('logical-or.cjs');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS a logical-assignment (??=) Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/logical-coalesce.cjs',
            'exports.GeminiLeak ??= 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('logical-coalesce.cjs');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS a logical-assignment (&&=) Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/logical-and.cjs',
            'exports.GeminiLeak &&= 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('logical-and.cjs');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS a bracket-access Object[defineProperty] Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/bracket-odp.cjs',
            "Object['defineProperty'](exports, 'GeminiLeak', { value: 1 });\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bracket-odp.cjs');
        expect(stdout).toContain('GeminiLeak');
      });

      it('FAILS a bracket-access Object[assign] Gemini export', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/bracket-assign.cjs',
            "Object['assign'](exports, { GeminiStatic: 1 });\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('bracket-assign.cjs');
        expect(stdout).toContain('GeminiStatic');
      });

      it('allows non-Gemini-named exports outside enclaves', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write('packages/cli/src/normal.ts', 'export class NormalClass {}\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS export default of a Gemini-named identifier in packages/cli', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/default-export.ts',
            'class GeminiConfig {}\nexport default GeminiConfig;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('default-export.ts');
        expect(stdout).toContain('GeminiConfig');
      });
    });

    // ── Finding1: fail-closed violations are NOT filtered ──────────────
    // Computed object keys and every unknown assign source must fail closed,
    // even when the detail string does NOT contain "Gemini". The guard must
    // NOT silently drop these — they could smuggle a Gemini-named export.
    describe('fail-closed export violations (no guard filtering)', () => {
      it('FAILS a computed-key module.exports assignment even without "Gemini"', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/computed-key.cjs',
            'const key = "someDynamicName";\nmodule.exports[key] = 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('computed-key.cjs');
        expect(stdout).toContain('fail-closed');
      });

      it('FAILS Object.assign with a non-literal source even without "Gemini"', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/assign-src.cjs',
            'const src = { normalName: 1 };\nObject.assign(exports, src);\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('assign-src.cjs');
        expect(stdout).toContain('fail-closed');
      });

      it('allows export default with a non-literal spread and no Gemini name', async () => {
        const { code } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/spread-default.ts',
            'const base = { foo: 1 };\nexport default { ...base };\n',
          );
          return runScript(root);
        });
        expect(code).toBe(0);
      });

      it('FAILS Object.defineProperty with computed key even without "Gemini"', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/odp-computed.cjs',
            'const key = "dynamicProp";\nObject.defineProperty(exports, key, {});\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('odp-computed.cjs');
        expect(stdout).toContain('fail-closed');
      });

      it('FAILS export = with non-literal spread even without "Gemini"', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          writeRequiredManifests(write);
          write(
            'packages/cli/src/spread-export-equals.ts',
            'const base = { foo: 1 };\nexport = { ...base };\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('spread-export-equals.ts');
        expect(stdout).toContain('fail-closed');
      });
    });
  },
);
