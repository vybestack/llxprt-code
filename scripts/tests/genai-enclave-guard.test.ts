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
 * Tests invoke the real guard script via execFileSync (no mock theater).
 *
 * Per RULES.md: positive tests ISOLATE the enclave under test — they do NOT
 * write filler files from the other enclave. Negative tests verify the exact
 * file that should be flagged.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-genai-enclave.ts');
const RUNTIME = process.env.BUN_EXECUTABLE ?? 'bun';

let cachedBunAvailable: boolean | undefined;

function bunAvailable(): boolean {
  if (cachedBunAvailable !== undefined) {
    return cachedBunAvailable;
  }
  try {
    execFileSync(RUNTIME, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    cachedBunAvailable = true;
  } catch (error) {
    const err = error as { code?: string };
    const isMissingOrDenied =
      err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'ENOEXEC';
    if (!isMissingOrDenied) {
      throw error;
    }
    cachedBunAvailable = false;
  }
  return cachedBunAvailable;
}

const missingBunMessage =
  '[genai-enclave] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the guard script against `root` (a temp fixture root). Returns exit
 * code, stdout, stderr.
 */
function runScript(root: string, expectedCode?: number): ScriptResult {
  const env = { ...process.env, GENAI_ENCLAVE_ROOT: root };
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(RUNTIME, [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as {
      status: number | null;
      signal?: string;
      code?: string;
      message: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const isTimeout =
      err.status === null &&
      (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT');
    if (isTimeout) {
      throw new Error(
        'Guard script timed out after 30s (SIGTERM/ETIMEDOUT). ' +
          'This indicates a hang, not a deliberate exit(1).',
      );
    }
    if (err.code === 'ENOENT') {
      throw new Error(
        `Guard script failed with ENOENT. Runtime "${RUNTIME}" not on PATH ` +
          `or script missing: ${SCRIPT}. Original: ${err.message}`,
      );
    }
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;
  }
  if (expectedCode !== undefined && exitCode !== expectedCode) {
    throw new Error(
      `Guard script exited with code ${exitCode}, expected ${expectedCode}.` +
        (stderr ? `\nstderr:\n${stderr}` : '') +
        (stdout ? `\nstdout:\n${stdout}` : ''),
    );
  }
  return { code: exitCode, stdout, stderr };
}

function runScriptRealRepo(expectedCode?: number): ScriptResult {
  const env = { ...process.env };
  delete env.GENAI_ENCLAVE_ROOT;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(RUNTIME, [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as {
      status: number | null;
      signal?: string;
      code?: string;
      message: string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const isTimeout =
      err.status === null &&
      (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT');
    if (isTimeout) {
      throw new Error('Guard script timed out against real repo.');
    }
    if (err.code === 'ENOENT') {
      throw new Error(
        `Guard script failed with ENOENT against real repo. Runtime "${RUNTIME}" not on PATH ` +
          `or script missing: ${SCRIPT}. Original: ${err.message}`,
      );
    }
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;
  }
  if (expectedCode !== undefined && exitCode !== expectedCode) {
    throw new Error(
      `Guard script exited with code ${exitCode}, expected ${expectedCode}.` +
        (stderr ? `\nstderr:\n${stderr}` : '') +
        (stdout ? `\nstdout:\n${stdout}` : ''),
    );
  }
  return { code: exitCode, stdout, stderr };
}

interface FixtureHelpers {
  readonly root: string;
  write(relPath: string, content: string): void;
}

function withFixture(
  fn: (helpers: FixtureHelpers) => ScriptResult,
): ScriptResult {
  const root = mkdtempSync(join(tmpdir(), 'genai-enclave-'));
  let result: ScriptResult;
  try {
    const write = (relPath: string, content: string): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    result = fn({ root, write });
  } finally {
    // Cleanup errors must not mask test failures. Wrap in try/catch and
    // emit a warning to stderr instead of throwing.
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (cleanupError) {
      const msg =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      console.warn(
        `[genai-enclave] Warning: temp cleanup failed for ${root}: ${msg}`,
      );
    }
  }
  return result;
}

// ─── Fixture content helpers ────────────────────────────────────────────────

const GEMINI_IMPORT =
  "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n";

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-genai-enclave',
  () => {
    beforeAll(() => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      }
    });

    // ── Real repo must be clean ─────────────────────────────────────────
    describe('real repo (current state must be clean)', () => {
      it('passes against the real repository', () => {
        const { code, stdout } = runScriptRealRepo(0);
        expect(code).toBe(0);
        expect(stdout).toContain('genai-enclave guard PASSED');
      }, 90000);
    });

    // ── Allowed enclaves (ISOLATED positive cases) ──────────────────────
    // Each positive test writes ONLY the enclave file under test — no filler
    // from the other enclave — so the test proves the guard allows that
    // specific enclave path, not that it was masked by the other.
    describe('allowed enclaves (isolated positive cases)', () => {
      it('allows @google/genai import in packages/providers/src/gemini/', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini/geminiProvider.ts',
            GEMINI_IMPORT,
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows @google/genai import in packages/core/src/code_assist/', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/core/src/code_assist/codeAssist.ts', GEMINI_IMPORT);
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows a Gemini-named export inside the gemini enclave', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini/GeminiProvider.ts',
            'export class GeminiProvider {}\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows a Gemini-named export in code_assist enclave', () => {
        const { code } = withFixture(({ root, write }) => {
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
      it('FAILS @google/genai in packages/providers/src/gemini-backup/', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini-backup/converter.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('converter.ts');
      });

      it('FAILS @google/genai in packages/providers/src/geminiprovider/', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/geminiprovider/handler.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('handler.ts');
      });

      it('FAILS @google/genai in packages/core/src/code_assist-old/', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/core/src/code_assist-old/legacy.ts',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy.ts');
      });

      it('FAILS a Gemini-named export in packages/providers/src/gemini-backup/', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini-backup/GeminiHelper.ts',
            'export class GeminiHelper {}\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('GeminiHelper');
      });

      it('does NOT match the gemini directory path without trailing slash', () => {
        // A file literally at 'packages/providers/src/gemini' (no trailing
        // slash) does NOT match the enclave prefix.
        const { code, stdout } = withFixture(({ root, write }) => {
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
      it('FAILS a static import in packages/cli', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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

      it('FAILS a type-only import in packages/cli', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/type-only.ts',
            "import type { Content } from '@google/genai';\nexport type T = Content;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('type-only.ts');
      });

      it('FAILS a dynamic import() in packages/agents', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/agents/src/dynamic.ts',
            "export async function f() { return await import('@google/genai'); }\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('dynamic.ts');
      });

      it('FAILS an import-equals (require) in packages/tools', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/tools/src/legacy.ts',
            "import genai = require('@google/genai');\nexport { genai };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy.ts');
      });

      it('FAILS a re-export from @google/genai outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/re-export.ts',
            "export { Part } from '@google/genai';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('re-export.ts');
      });

      it('FAILS export * from @google/genai outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/star-export.ts',
            "export * from '@google/genai';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('star-export.ts');
      });

      it('FAILS a subpath import from @google/genai in packages/mcp', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/mcp/src/sub.ts',
            "import { x } from '@google/genai/sub';\nexport { x };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('sub.ts');
      });

      it('does NOT match @google/genai-utils (different package)', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/utils-import.ts',
            "export { } from '@google/genai-utils';\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS a @google/genai import in a .js file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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

      it('FAILS a @google/genai import in a .mjs file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.mjs',
            "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.mjs');
      });

      it('FAILS a @google/genai import in a .cjs file', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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
      it('FAILS a variable-specifier dynamic import() outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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

      it('FAILS a variable-specifier require() outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/agents/src/computed-require.ts',
            "const pkg = 'anything'; require(pkg);\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('computed-require.ts');
      });

      it('FAILS a template-literal dynamic import() outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/core/src/utils/template-import.ts',
            'export async function f() { return await import(`pkg/${sub}`); }\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('template-import.ts');
      });

      it('does NOT flag computed imports in test files', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.test.ts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag computed imports in .mts test files', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.test.mts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag computed imports in .cts spec files', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/module.spec.cts',
            "const mod = await import('./mod?t=' + Date.now());\nexport { mod };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag computed imports in enclave files', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/providers/src/gemini/dynamic-loader.ts',
            "const pkg = '@google/genai'; export async function f() { return await import(pkg); }\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag string-literal dynamic imports of non-genai packages', () => {
        const { code } = withFixture(({ root, write }) => {
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
      it('FAILS a new Gemini-named class export in packages/cli', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/hook.ts', 'export class useGeminiFoo {}\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('hook.ts');
        expect(stdout).toContain('useGeminiFoo');
      });

      it('FAILS a Gemini-named function export in packages/agents', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/agents/src/util.ts',
            'export function geminiHelper(): void {}\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('util.ts');
      });

      it('FAILS a Gemini-named re-export alias outside enclaves', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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

      it('allows non-Gemini-named exports outside enclaves', () => {
        const { code } = withFixture(({ root, write }) => {
          write('packages/cli/src/normal.ts', 'export class NormalClass {}\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('FAILS export default of a Gemini-named identifier in packages/cli', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
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

    // ── Manifest violations ────────────────────────────────────────────
    // Each fixture includes a minimal scannable source file so the guard
    // reaches the manifest check and fails specifically on the manifest
    // violation (not on "no scannable files found").
    describe('manifest violations', () => {
      it('FAILS when root package.json declares @google/genai', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'package.json',
            JSON.stringify({
              name: 'test-root',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('@google/genai');
        expect(stdout).toContain('not in the sanctioned workspace allowlist');
      });

      it('FAILS when packages/cli declares @google/genai', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-cli',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('packages/cli');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when packages/core declares wrong version of @google/genai', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.29.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('does not match');
        expect(stdout).toContain('1.30.0');
      });

      it('FAILS when packages/cli declares @google/genai in optionalDependencies', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-cli',
              optionalDependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('optionalDependencies');
        expect(stdout).toContain('@google/genai');
      });

      it('FAILS when root package.json is malformed JSON (fail-closed)', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'package.json',
            '{ "name": "broken", "dependencies": { "@google/genai": ',
          );
          write('packages/cli/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('fail-closed');
      });

      it('allows packages/core to declare @google/genai at 1.30.0', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/core/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-core',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/core/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('allows packages/providers to declare @google/genai at 1.30.0', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/providers/package.json',
            JSON.stringify({
              name: '@vybestack/llxprt-code-providers',
              dependencies: { '@google/genai': '1.30.0' },
            }) + '\n',
          );
          write('packages/providers/src/index.ts', 'export const x = 1;\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Operational failures (fail-closed) ─────────────────────────────
    describe('operational failures (fail-closed)', () => {
      it('FAILS when zero TypeScript files are found (temp root with no packages)', () => {
        // No files written — packages/ dir does not exist
        const { code, stdout } = withFixture(({ root }) => runScript(root));
        expect(code).toBe(1);
        expect(stdout).toContain('no scannable files found');
      });

      it('FAILS on source with parse diagnostics (invalid syntax)', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/broken-syntax.ts',
            'export const x = ((((;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('broken-syntax.ts');
        expect(stdout).toContain('fail-closed');
      });
    });

    // ── Allowlist consistency ──────────────────────────────────────────
    describe('allowlist consistency', () => {
      it('GEMINI_NAME_EXPLICIT_ALLOWLIST has no duplicate path::name keys', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        const keys = GEMINI_NAME_EXPLICIT_ALLOWLIST.map(
          (e) => `${e.path}::${e.name}`,
        );
        const seen = new Set<string>();
        const dups = keys.filter((k) => {
          if (seen.has(k)) return true;
          seen.add(k);
          return false;
        });
        expect(dups, `Duplicate allowlist entries: ${dups.join(', ')}`).toEqual(
          [],
        );
      });

      it('every allowlist entry has path, name, and justification', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        for (const entry of GEMINI_NAME_EXPLICIT_ALLOWLIST) {
          expect(entry.path.length).toBeGreaterThan(0);
          expect(entry.name.length).toBeGreaterThan(0);
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('GENAI_DEPENDENCY_MANIFESTS has exactly core and providers at 1.30.0', async () => {
        const { GENAI_DEPENDENCY_MANIFESTS } = await import(
          '../genai-enclave/config.ts'
        );
        const dirs = GENAI_DEPENDENCY_MANIFESTS.map(
          (e) => e.workspaceDir,
        ).sort();
        expect(dirs).toEqual(['packages/core', 'packages/providers']);
        for (const entry of GENAI_DEPENDENCY_MANIFESTS) {
          expect(entry.version).toBe('1.30.0');
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('GENAI_IMPORT_ENCLAVES has exactly gemini and code_assist with justifications', async () => {
        const { GENAI_IMPORT_ENCLAVES } = await import(
          '../genai-enclave/config.ts'
        );
        const prefixes = GENAI_IMPORT_ENCLAVES.map((e) => e.prefix).sort();
        expect(prefixes).toEqual([
          'packages/core/src/code_assist/',
          'packages/providers/src/gemini/',
        ]);
        for (const entry of GENAI_IMPORT_ENCLAVES) {
          expect(entry.justification.length).toBeGreaterThan(0);
        }
      });

      it('every allowlist path::name refers to a real file in the repo (liveness)', async () => {
        const { GEMINI_NAME_EXPLICIT_ALLOWLIST } = await import(
          '../genai-enclave/config.ts'
        );
        const stale: string[] = [];
        for (const entry of GEMINI_NAME_EXPLICIT_ALLOWLIST) {
          const abs = join(REPO_ROOT, entry.path);
          if (!existsSync(abs)) {
            stale.push(`${entry.path}::${entry.name} (file not found)`);
          }
        }
        expect(
          stale,
          `Stale allowlist entries (file no longer exists): ${stale.join(', ')}`,
        ).toEqual([]);
      });
    });
  },
);
