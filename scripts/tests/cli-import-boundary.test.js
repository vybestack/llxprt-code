/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-cli-import-boundary.ts (#2204).
 *
 * These tests exercise the boundary guard's classification logic directly
 * against the real CLI source AND synthetic fixtures, so regressions (a new
 * disallowed deep import, a reintroduced getConfig() escape hatch, or a
 * bloated entrypoint) are caught before merge.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-cli-import-boundary.ts');
const RUNTIME = process.env.BUN_EXECUTABLE ?? 'bun';

/** @type {boolean | undefined} */
let cachedBunAvailable;

function bunAvailable() {
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
    const isMissingOrDenied =
      error?.code === 'ENOENT' ||
      error?.code === 'EACCES' ||
      error?.code === 'ENOEXEC';
    if (!isMissingOrDenied) {
      throw error;
    }
    cachedBunAvailable = false;
  }
  return cachedBunAvailable;
}

const missingBunMessage =
  '[cli-import-boundary] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

/**
 * Runs the boundary script against `dir` (a temp fixture root or the real
 * repo root) and returns { code, stdout, stderr }.
 *
 * The script anchors its repo root to its own location (import.meta.url) by
 * default, but accepts a CLI_BOUNDARY_ROOT env-var override so this test suite
 * can point it at synthetic fixture trees under temp dirs. We pass the temp
 * root via the env var (cwd is no longer consulted by the script).
 *
 * A timeout guards against a hang in the boundary script (which would stall
 * the entire suite). stderr is captured on both success and failure paths so
 * unexpected script crashes are surfaced for diagnostics.
 *
 * `expectedCode` lets the caller declare the expected exit code. When
 * provided, `runScript` ASSERTS the exit code matches and throws on mismatch
 * (enforced centrally so callers cannot forget to assert). stderr is only
 * surfaced to the test log when the ACTUAL exit code differs from the
 * expected one — so intentional-violation tests (which expect exit 1) stay
 * quiet, while genuine crashes (syntax error, uncaught throw) fail loudly
 * with their diagnostic output instead of polluting every assertion.
 *
 * `options.useRealRepo` (default false): when true, the CLI_BOUNDARY_ROOT env
 * override is OMITTED so the script anchors to its own location (the real
 * repo) and runs the freshness guard that is skipped under synthetic fixtures.
 * Used by the allowlist-freshness test. The `dir` argument is ignored in this
 * mode, so callers MUST pass `null` (not a real path) to signal that intent —
 * passing a real path would imply it is consulted when it is not.
 *
 * @param {string | null} dir - Synthetic fixture root (cwd/env target), or
 *   `null` when `options.useRealRepo` is true (the argument is ignored in that
 *   mode).
 */
function runScript(dir, expectedCode = undefined, options = {}) {
  const { useRealRepo = false } = options;
  // When useRealRepo is true, the script must anchor to its OWN location (the
  // real repo) and run the allowlist-freshness guard that is skipped under
  // synthetic fixtures. The env is spread from process.env, so any ambient
  // CLI_BOUNDARY_ROOT (e.g. leaked from a preceding synthetic-fixture test or
  // set in the shell) would make the script treat the real repo as a
  // synthetic fixture and SKIP allowlist freshness. Explicitly delete it so
  // the real-repo path is deterministic regardless of ambient environment.
  const env = { ...process.env };
  if (useRealRepo) {
    delete env.CLI_BOUNDARY_ROOT;
  } else {
    env.CLI_BOUNDARY_ROOT = dir;
  }
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    // The boundary script is a Bun-executed TypeScript module (see
    // lint:cli-boundary in package.json). Invoke it via `bun` so the test
    // exercises the same runtime path as CI/dev.
    stdout = execFileSync(RUNTIME, [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      // An explicit maxBuffer prevents a default-buffer overflow from being
      // coerced to exit code 1 and silently passing as an intentional
      // violation (expectedCode 1). 10 MB is generous for this script's
      // output and makes the limit explicit rather than relying on the
      // implicit ~1 MB default.
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    // execFileSync surfaces a timeout with status=null and either signal
    // 'SIGTERM' or code 'ETIMEDOUT'. Without this detection, err.status ?? 1
    // would coerce the null to 1 and mask a hang as the deliberate exit(1)
    // of an intentional-violation fixture, letting expected-exit-1 tests pass
    // even when the script hung. Throw a distinct error so hangs fail loudly.
    const isTimeout =
      err.status === null &&
      (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT');
    if (isTimeout) {
      throw new Error(
        `Boundary script timed out after 15s (SIGTERM/ETIMEDOUT). This ` +
          `indicates a hang, not the deliberate exit(1) of a violation fixture.`,
      );
    }
    if (err.code === 'ENOENT') {
      throw new Error(
        `Boundary script failed with ENOENT. Either runtime "${RUNTIME}" is not on PATH ` +
          `(install Bun or set BUN_EXECUTABLE), or the script path does not exist: ${SCRIPT}. ` +
          `Original error: ${err.message}`,
        { cause: err },
      );
    }
    // A stdio maxBuffer overflow (stdout or stderr exceeding maxBuffer) is
    // surfaced with code 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'. Without this
    // detection, err.status ?? 1 would coerce it to exit 1 and mask it as a
    // deliberate violation, hiding a runaway-output bug. Throw loudly.
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error(
        `Boundary script exceeded the maxBuffer limit ` +
          `(ERR_CHILD_PROCESS_STDIO_MAXBUFFER). This indicates runaway output ` +
          `(e.g. a logging loop), not the deliberate exit(1) of a violation ` +
          `fixture.`,
      );
    }
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;
  }
  // Only surface stderr when the exit code is unexpected — a real crash,
  // not the deliberate exit(1) of an intentional-violation fixture.
  if (stderr && expectedCode !== undefined && exitCode !== expectedCode) {
    // Make the diagnostic visible in test output when a crash occurs.
    console.error(`[cli-import-boundary] script stderr:
${stderr}`);
  }
  // Enforce the expected exit code centrally so callers that pass
  // expectedCode cannot forget to assert it (the parameter would otherwise be
  // misleading — it filtered stderr but did not enforce the code). Callers
  // that omit expectedCode keep full manual control for non-exit-code-based
  // assertions.
  if (expectedCode !== undefined && exitCode !== expectedCode) {
    throw new Error(
      `Boundary script exited with code ${exitCode}, expected ${expectedCode}.` +
        (stderr
          ? `
stderr:
${stderr}`
          : ''),
    );
  }
  return { code: exitCode, stdout, stderr };
}

/**
 * Set up a synthetic CLI source tree under a fresh temp dir, run `fn` against
 * it, and tear the tree down in a `finally` so a fixture is never leaked even
 * when an assertion throws.
 *
 * `fn` receives a `write(relPath, content)` helper (writes a file relative to
 * the temp root, creating parent directories as needed) and the temp `root`
 * (to pass as cwd to `runScript`). The temp root is always removed
 * afterwards. `fn`'s return value is returned to the caller for assertions.
 */
function withCliFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'cli-boundary-'));
  try {
    const write = (relPath, content) => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    return fn({ root, write });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Write a minimal thin `packages/cli/index.ts` so the thin-entry guard passes.
 */
function thinIndex() {
  return ['packages/cli/index.ts', 'export {};\n'];
}

/**
 * Write a minimal clean production source file under packages/cli/src/ so the
 * 0-files scan guard is satisfied (the scan must find at least one production
 * .ts file). The file imports only a bare package root (always allowed).
 */
function cleanProductionFile() {
  return ['packages/cli/src/clean.ts', 'export const x = 1;\n'];
}

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-cli-import-boundary',
  () => {
    beforeAll(() => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(
          `${missingBunMessage} Boundary tests cannot run in CI.`,
        );
      }
    });

    it('the real CLI source currently passes the boundary check', () => {
      // The guard is a regression net: it must pass against the current
      // quarantined CLI source. If this fails, a new disallowed deep import or
      // getConfig() usage was introduced without an allowlist entry.
      //
      // useRealRepo is required so the script omits the CLI_BOUNDARY_ROOT env
      // override: that env var (even when set to the real repo path) makes the
      // script treat the tree as a synthetic fixture and SKIP the allowlist
      // freshness guard. Passing useRealRepo ensures the freshness guard runs.
      // `dir` is null because useRealRepo ignores it (the script anchors to its
      // own location); passing a path here would falsely imply it is consulted.
      const { code, stdout } = runScript(null, 0, { useRealRepo: true });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    }, 15000);

    it('flags a static deep import from providers/runtime not in the allowlist', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/rogue.ts',
          "import { getCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('rogue.ts');
      expect(stdout).toContain('runtimeSettings.js');
    });

    it('flags a dynamic import() of a deep core path not in the allowlist', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dynamic.ts',
          "export async function f() { return (await import('@vybestack/llxprt-code-core/scheduler/types.js')).x; }\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('dynamic.ts');
      expect(stdout).toContain('scheduler/types.js');
      expect(stdout).toContain('dynamic-import');
    });

    it('flags a non-literal dynamic import() specifier', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dynamic-variable.ts',
          'export async function f(mod: string) { return import(mod); }\n',
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('dynamic-variable.ts');
      expect(stdout).toContain('import(<non-literal>)');
    });

    it('flags a no-substitution template literal deep import specifier', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/template-mock.ts',
          "import { vi } from 'vitest'; vi.mock(`@vybestack/llxprt-code-providers/runtime/runtimeSettings.js`, () => ({}));\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('template-mock.ts');
      expect(stdout).toContain('runtimeSettings.js');
    });

    it('flags a vi.mock specifier of a deep providers path', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/mocked.ts',
          "import { vi } from 'vitest'; vi.mock('@vybestack/llxprt-code-providers/runtime/runtimeSettings.js', () => ({}));\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('mocked.ts');
      expect(stdout).toContain('runtimeSettings.js');
      expect(stdout).toContain('vi.mock');
    });

    it('flags a non-literal vi.mock specifier (dynamic specifiers can hide deep imports)', () => {
      // Production vi.mock specifiers must be static string literals so this
      // guard can analyze them. A dynamic specifier (variable, template
      // expression) cannot be inspected and could hide a deep runtime import.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dynamic-mock.ts',
          "import { vi } from 'vitest'; const mod = './some.js'; vi.mock(mod, () => ({}));\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('dynamic-mock.ts');
      expect(stdout).toContain('vi.mock(<non-literal>)');
    });

    it('flags a .getConfig() escape-hatch call', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/escape.ts',
          'export function cfg(agent: unknown) { return (agent as { getConfig(): unknown }).getConfig(); }\n',
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('getConfig() escape-hatch');
      expect(stdout).toContain('escape.ts');
    });

    it('flags a bare getConfig() escape-hatch call after destructuring', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        // The property-access guard alone misses this: getConfig is destructured
        // off the agent and then called as a bare identifier. The guard must
        // catch the bare-identifier call form too.
        write(
          'packages/cli/src/bare-escape.ts',
          'export function cfg(agent: { getConfig(): unknown }) { const { getConfig } = agent; return getConfig(); }\n',
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('getConfig() escape-hatch');
      expect(stdout).toContain('bare-escape.ts');
    });

    it('flags a getConfig extraction via destructuring without a call', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/destructure-extract.ts',
          'export function cfg(agent: { getConfig(): unknown }) { const { getConfig } = agent; return getConfig; }\n',
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('getConfig() escape-hatch');
      expect(stdout).toContain('destructure-extract.ts');
    });

    it('flags a getConfig extraction via property access without a call (const fn = agent.getConfig)', () => {
      // Shape 3: the method reference is read WITHOUT being called. The
      // extracted reference can be invoked later as fn(), bypassing the
      // call-expression shapes (1 and 2). The guard must flag the bare
      // property-access read.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/extract-escape.ts',
          'export function cfg(agent: { getConfig(): unknown }) { const fn = agent.getConfig; return fn(); }\n',
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('getConfig() escape-hatch');
      expect(stdout).toContain('extract-escape.ts');
    });

    // ── banned runtime-assembly symbols/patterns (#2378) ────────────────────
    //
    // The CLI must not import or use runtime-construction primitives, construct
    // a MessageBus directly, or call Config.initialize({ messageBus }). These
    // are owned by the core/providers/agents packages behind the public
    // agent-bootstrap / provider-composition surface. Detection is AST-based so
    // comments and string literals mentioning a banned name do NOT trip it.

    it('flags a static import of createSessionMessageBus (banned runtime-assembly symbol)', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/assembles-bus.ts',
          "import { createSessionMessageBus } from '@vybestack/llxprt-code-core';\nexport const bus = createSessionMessageBus();\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('assembles-bus.ts');
      expect(stdout).toContain('createSessionMessageBus');
      expect(stdout).toContain('runtime-assembly');
    });

    it('flags an import of executeProviderActivation (must use the public preflight instead)', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/activates.ts',
          "import { executeProviderActivation } from '@vybestack/llxprt-code-agents';\nexport const run = executeProviderActivation;\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('activates.ts');
      expect(stdout).toContain('executeProviderActivation');
    });

    it('flags each remaining banned runtime-construction symbol', () => {
      for (const symbol of [
        'createAgentRuntimeState',
        'createRuntimeStateFromConfig',
        'createProviderRuntimeContext',
        'createAgentRuntimeContext',
        'activateSettingsRuntimeContext',
      ]) {
        const { code, stdout } = withCliFixture(({ root, write }) => {
          write(
            'packages/cli/src/uses-primitive.ts',
            `import { ${symbol} } from '@vybestack/llxprt-code-core';\nexport const used = ${symbol};\n`,
          );
          write(...thinIndex());
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('uses-primitive.ts');
        expect(stdout).toContain(symbol);
      }
    });

    it('flags a literal new MessageBus() construction', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/new-bus.ts',
          "import { MessageBus } from '@vybestack/llxprt-code-core';\nexport function make(engine: unknown) { return new MessageBus(engine); }\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('new-bus.ts');
      expect(stdout).toContain('new MessageBus');
    });

    it('flags a Config.initialize({ messageBus }) call', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/init-bus.ts',
          "import type { Config } from '@vybestack/llxprt-code-core';\nexport async function go(config: Config, messageBus: unknown) { await config.initialize({ messageBus }); }\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('init-bus.ts');
      expect(stdout).toContain('messageBus');
    });

    it('flags an aliased import of a banned symbol and its aliased usage', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/aliased.ts',
          "import { createSessionMessageBus as mkBus } from '@vybestack/llxprt-code-core';\nexport const bus = mkBus();\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('aliased.ts');
      expect(stdout).toContain('createSessionMessageBus');
    });

    it('flags banned symbols accessed through namespace imports', () => {
      for (const access of [
        'core.createSessionMessageBus()',
        "core['createSessionMessageBus']()",
      ]) {
        const { code, stdout } = withCliFixture(({ root, write }) => {
          write(
            'packages/cli/src/namespace-bypass.ts',
            `import * as core from '@vybestack/llxprt-code-core';\nexport const bus = ${access};\n`,
          );
          write(...thinIndex());
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('namespace-bypass.ts');
        expect(stdout).toContain('createSessionMessageBus');
      }
    });

    it('does NOT flag a banned name that appears only in comments or string literals', () => {
      // AST-based detection: a doc-comment or string mentioning a banned
      // primitive is not a real import/usage and must not trip the guard. This
      // is why cliProviderInit.ts / postConfigRuntime.ts can reference
      // executeProviderActivation by name in prose while staying compliant.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/mentions-only.ts',
          [
            '// This module used to call executeProviderActivation and',
            '// createSessionMessageBus directly; it now uses the public surface.',
            "const doc = 'see executeProviderActivation and new MessageBus notes';",
            'export const value = doc.length;',
            '',
          ].join('\n'),
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('does NOT flag a benign initialize() call without a messageBus property', () => {
      // Only .initialize({ messageBus: ... }) is banned; an unrelated
      // initialize() call (no messageBus) is a normal API and must pass.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/benign-init.ts',
          'export async function go(x: { initialize(o: unknown): Promise<void> }) { await x.initialize({ verbose: true }); }\n',
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('excludes test files from the banned runtime-assembly scan', () => {
      // Test infrastructure may freely import/use construction primitives to
      // build fixtures; the banned-symbol rule governs PRODUCTION source only.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/__tests__/demo.test.ts',
          "import { createSessionMessageBus } from '@vybestack/llxprt-code-core';\nexport const bus = createSessionMessageBus();\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    // ── dynamic import()/require() banned-symbol coverage (#2378) ────────────
    //
    // The static-import banned-symbol scan is not enough: a runtime-assembly
    // primitive can also be pulled in via a dynamic `import()` or a CommonJS
    // `require()` of the BARE runtime package root and destructured/awaited.
    // Because the specifier is the public bare root, the deep-import scan does
    // NOT flag it, so the banned-symbol scan must catch the destructured
    // primitive itself. Otherwise dynamic import/require is a silent bypass of
    // the whole #2378 boundary.

    it('flags a banned symbol destructured from a dynamic import() of the bare core root', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dyn-banned.ts',
          "export async function f() {\n  const { createSessionMessageBus } = await import('@vybestack/llxprt-code-core');\n  return createSessionMessageBus();\n}\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('dyn-banned.ts');
      expect(stdout).toContain('createSessionMessageBus');
      expect(stdout).toContain('runtime-assembly');
    });

    it('flags a banned symbol destructured from a require() of the bare core root', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/req-banned.ts',
          "export function g() {\n  const { createAgentRuntimeState } = require('@vybestack/llxprt-code-core');\n  return createAgentRuntimeState();\n}\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('req-banned.ts');
      expect(stdout).toContain('createAgentRuntimeState');
      expect(stdout).toContain('runtime-assembly');
    });

    it('flags an aliased banned symbol destructured from a dynamic import()', () => {
      // `import()` destructuring supports renaming: the ORIGINAL exported name
      // is what is banned, so an aliased destructure must still be flagged.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dyn-aliased.ts',
          "export async function f() {\n  const { createSessionMessageBus: mkBus } = await import('@vybestack/llxprt-code-core');\n  return mkBus();\n}\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('dyn-aliased.ts');
      expect(stdout).toContain('createSessionMessageBus');
    });

    it('does NOT flag a benign symbol destructured from a dynamic import() of the bare core root', () => {
      // Only the banned runtime-assembly primitives are forbidden; a normal
      // public export pulled in dynamically must pass.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/dyn-ok.ts',
          "export async function f() {\n  const { Config } = await import('@vybestack/llxprt-code-core');\n  return Config;\n}\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    // ── banned runtime-assembly metric reporting (#2378) ────────────────────
    //
    // The banned-symbol scan must emit an aggregate count of hits (a scanned
    // metric) so CI logs surface how many boundary violations were found in a
    // single line, not just a per-file breakdown.

    it('reports the aggregate banned-symbol hit count in the failure output', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/two-hits.ts',
          "import { createSessionMessageBus, createAgentRuntimeState } from '@vybestack/llxprt-code-core';\nexport const a = createSessionMessageBus;\nexport const b = createAgentRuntimeState;\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      // Aggregate metric line: two imports + two usages = 4 hits.
      expect(stdout).toContain(
        'FAIL: 4 banned runtime-assembly symbol/pattern usage(s) found:',
      );
    });

    it('flags a bloated index.ts entrypoint exceeding the thin-entry threshold', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        // index.ts over 200 lines
        write(
          'packages/cli/index.ts',
          Array.from({ length: 201 }, (_, i) => `// line ${i}`).join('\n') +
            '\n',
        );
        write(...cleanProductionFile());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      // Assert the unique failure-path text (not the preamble 'thin-entry'
      // label) plus the threshold so a regression that changes the limit or
      // the failure message is caught.
      expect(stdout).toContain('must stay thin');
      expect(stdout).toContain('threshold 200');
    });

    it('allows bare package roots (public API) without an allowlist entry', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ok.ts',
          "import { Config } from '@vybestack/llxprt-code-core';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('excludes test files from the import scan', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        // A test file with a deep import must NOT be flagged.
        write(
          'packages/cli/src/__tests__/demo.test.ts',
          "import { x } from '@vybestack/llxprt-code-core/scheduler/types.js';\n",
        );
        write(...cleanProductionFile());
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    // ── agents specifier-level boundary checks (#2204 / #2285) ──────────────
    //
    // The boundary checker enforces agents-package imports purely via
    // specifier/subpath contracts: the bare root is allowed at the specifier
    // level, and deep subpaths (including the internals barrel) are forbidden
    // because @vybestack/llxprt-code-agents has no entry in
    // PUBLIC_SUBPATHS_BY_PACKAGE. The API-surface guard owns "what does the
    // agents root expose"; this checker owns "which specifiers may production
    // CLI import".

    it('allows a bare agents root import (specifier-level, always)', () => {
      // The bare root @vybestack/llxprt-code-agents is a public specifier and is
      // always allowed. Any symbol-level concern (an internal name leaking back
      // into the root) is owned by the API-surface guard + typecheck, NOT this
      // checker.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ok.ts',
          "import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('does not symbol-check the bare agents root (delegated to API-surface guard)', () => {
      // Characterization: the boundary checker is SPECIFIER-level, not
      // symbol-level. It allows any named import from the bare agents root
      // because the root itself is a public specifier. Enforcing WHICH names a
      // consumer may import from the root is the responsibility of the
      // API-surface guard (scripts/check-agents-api-surface.mjs) plus typecheck
      // — NOT this boundary checker. This test documents that an
      // internal-named symbol (e.g. AgentClient) imported from the BARE root
      // passes here by design, so a future change that adds symbol checking to
      // this script is caught as an intentional contract change.
      //
      // Defense-in-depth note: the API-surface guard uses TWO complementary
      // mechanisms to catch internal-symbol leaks on the agents root:
      //   (1) DENIED_INTERNAL_NAMES — a hard-deny set of 3 known historical
      //       leaks (AgentClient, CoreToolScheduler, AgenticLoop). These always
      //       fail the guard regardless of snapshot state.
      //   (2) expected-root-surface.json snapshot — a file-equality comparison
      //       that catches ANY change to the root export surface, including a
      //       NEW internal symbol leaking onto the root. A new leak causes
      //       snapshot drift (the report will have an unexpected "+" entry),
      //       which fails the guard until the snapshot is intentionally
      //       reviewed and updated.
      // The old PUBLIC_AGENT_SYMBOLS allowlist was deny-by-default; the
      // snapshot is not. A NEW internal symbol added to the root would be
      // caught by snapshot drift (requiring an intentional update), not by a
      // deny-by-default policy. Do NOT reintroduce PUBLIC_AGENT_SYMBOLS.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ok.ts',
          "import { AgentClient } from '@vybestack/llxprt-code-agents';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('flags importing from the agents internals.js subpath (deep import)', () => {
      // @vybestack/llxprt-code-agents/internals.js is a deep subpath NOT in
      // PUBLIC_SUBPATHS_BY_PACKAGE (agents has no entry there), so it is a
      // deep-import violation regardless of which named symbol is imported.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/rogue.ts',
          "import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('rogue.ts');
      // Assert the exact offending specifier literal.
      expect(stdout).toContain('@vybestack/llxprt-code-agents/internals.js');
      // Static import syntax is reported as 'static-import'; the deep nature of
      // the violation is conveyed by the offending specifier literal above.
      expect(stdout).toContain('static-import');
    });

    it('flags a namespace import from the agents internals.js subpath', () => {
      // Specifier-level enforcement must catch all static import syntaxes,
      // including namespace imports, because the checker reads the
      // ImportDeclaration moduleSpecifier independently of the import clause form.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/namespace-deep.ts',
          "import * as internals from '@vybestack/llxprt-code-agents/internals.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('namespace-deep.ts');
      expect(stdout).toContain('@vybestack/llxprt-code-agents/internals.js');
      expect(stdout).toContain('static-import');
    });

    it('flags a deep agents source path import', () => {
      // A deep source path like /core/client.js is a deep subpath NOT in
      // PUBLIC_SUBPATHS_BY_PACKAGE and is forbidden.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/deepsource.ts',
          "import { AgentClient } from '@vybestack/llxprt-code-agents/core/client.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('deepsource.ts');
      // Assert the exact offending specifier literal.
      expect(stdout).toContain('@vybestack/llxprt-code-agents/core/client.js');
      expect(stdout).toContain('static-import');
    });

    it('fails when packages/cli/src contains no TypeScript files (empty scan guard)', () => {
      // An empty fixture root has no packages/cli/src at all — walkDir returns 0
      // files, and the guard must fail loudly rather than silently passing.
      const { code, stdout } = withCliFixture(({ root }) => runScript(root, 1));
      expect(code).toBe(1);
      expect(stdout).toContain('no TypeScript source files found');
    });

    // ── self-pruning allowlist guard (#2204) ────────────────────────────────
    //
    // The allowlist must stay fresh: every allowlisted file must exist in
    // production source, and every allowlisted specifier/symbol must still be
    // imported. These tests run against the REAL repo (not synthetic fixtures)
    // because the allowlist entries reference real production files.

    it('the real CLI allowlist has no stale specifier entries', () => {
      // The self-pruning guard runs as part of the normal boundary check against
      // the real repo. Invoke the script WITHOUT the CLI_BOUNDARY_ROOT override
      // (useRealRepo) so it anchors to its own location (the real repo) and runs
      // the freshness guard that is skipped under synthetic fixtures. If any
      // allowlisted specifier is no longer imported, the check fails with a
      // "stale allowlist" message. `dir` is null because useRealRepo ignores it.
      const { code, stdout } = runScript(null, 0, { useRealRepo: true });
      expect(stdout).toContain('allowlist is fresh');
      expect(code).toBe(0);
    });

    // ── public subpath treatment (#2204 burn-down) ──────────────────────────
    //
    // auth.js and composition.js are declared package.json `exports` entrypoints
    // of the providers package with their own barrel index.ts. They are NOT deep
    // internal imports and must be allowed without an allowlist entry.

    it('allows a namespace import from the bare agents root (specifier-level)', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ok.ts',
          "import * as agentsApi from '@vybestack/llxprt-code-agents';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('allows imports from the providers auth.js public subpath without an allowlist entry', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ui/commands/authCommand.ts',
          "import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('allows imports from the providers composition.js public subpath without an allowlist entry', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ui/commands/providerCommand.ts',
          "import { createProviderManager } from '@vybestack/llxprt-code-providers/composition.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('allows imports from the providers runtime.js public barrel without an allowlist entry', () => {
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ui/commands/clearCommand.ts',
          "import { getCliRuntimeServices } from '@vybestack/llxprt-code-providers/runtime.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 0);
      });
      expect(stdout).toContain('CLI import boundary check PASSED.');
      expect(code).toBe(0);
    });

    it('still flags deep providers/runtime/* paths that are NOT the public barrel', () => {
      // runtime.js is public, but runtime/runtimeSettings.js is a deep internal
      // path that must still be flagged.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/rogue.ts',
          "import { getCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('rogue.ts');
      expect(stdout).toContain('runtimeSettings.js');
    });

    // ── shrunk ALLOWLIST guard (#2204) ──────────────────────────────────────
    //
    // The ALLOWLIST must NOT contain broad UI/hooks/commands/contexts/components/
    // layouts/utils deep-import entries. These were the prime burn-down targets
    // and have been eliminated. This synthetic-fixture test guards the boundary
    // check logic; the real-repo ALLOWLIST freshness is exercised by the tests
    // in the self-pruning section above.

    it('a synthetic ui/hooks file with a deep providers/runtime/* import is not exempt from the boundary check', () => {
      // Synthetic file guard: a file under ui/hooks importing a deep
      // providers/runtime/* path must fail. This does NOT exercise the real
      // repo ALLOWLIST — see the real-repo tests above for that.
      const { code, stdout } = withCliFixture(({ root, write }) => {
        write(
          'packages/cli/src/ui/hooks/someHook.ts',
          "import { getCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';\n",
        );
        write(...thinIndex());
        return runScript(root, 1);
      });
      expect(code).toBe(1);
      expect(stdout).toContain('someHook.ts');
      expect(stdout).toContain('runtimeSettings.js');
    });
  },
);
