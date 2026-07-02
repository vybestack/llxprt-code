#!/usr/bin/env node
/**
 * Boundary checker regression proof (specifier-based rules).
 *
 * P07 removed PUBLIC_AGENT_SYMBOLS and the bare-root symbol check, converting
 * the boundary checker to specifier/subpath-contract rules. This proof asserts
 * the NEW behavior so it remains a live regression guard: it would FAIL if the
 * old symbol-allowlist behavior were reintroduced.
 *
 * Asserted NEW behavior:
 *   - Bare agents root imports are ALLOWED at the specifier level (no
 *     symbol-level gating).
 *   - The internals subpath (@vybestack/llxprt-code-agents/internals.js) is
 *     FORBIDDEN as a deep import.
 *   - A deep source path (@vybestack/llxprt-code-agents/core/client.js) is
 *     FORBIDDEN as a deep import.
 *   - The old agents-internal-symbol / agents-namespace-import classifications
 *     are GONE (a bare-root internal-symbol import is now allowed, not flagged).
 *
 * Plan: PLAN-20260629-ISSUE2285.P07
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
// Proof lives at project-plans/issue2285/analysis/, repo root is 3 levels up.
const REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..');
const BOUNDARY_SCRIPT = join(
  REPO_ROOT,
  'scripts',
  'check-cli-import-boundary.mjs',
);

/**
 * Run the boundary checker against a synthetic fixture tree rooted at `root`
 * and return { code, stdout, stderr }. The script anchors its repo root to
 * CLI_BOUNDARY_ROOT when that env var is set, so we point it at the temp
 * fixture tree.
 */
function runChecker(root) {
  const result = spawnSync(process.execPath, [BOUNDARY_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, CLI_BOUNDARY_ROOT: root },
    encoding: 'utf-8',
    timeout: 15_000,
    // killSignal documents the signal used when the timeout elapses; the
    // signal check below handles ANY signal-induced termination, not just
    // the timeout case.
    killSignal: 'SIGTERM',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(
        'Boundary script timed out after 15000ms before producing a result.',
      );
    }
    throw new Error(`Failed to spawn boundary script: ${result.error.message}`);
  }
  if (result.signal !== null) {
    throw new Error(
      `Boundary script terminated by signal ${result.signal} — indicates a hang or external kill.`,
    );
  }
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Set up a synthetic CLI source tree under a fresh temp dir, invoke `fn`
 * against it, and tear the tree down in a finally block so a fixture is never
 * leaked even when an assertion throws. `fn` receives `{ root, write }`:
 * `root` is the temp dir path (to pass as CLI_BOUNDARY_ROOT), `write` writes a
 * file relative to the temp root, creating parent directories as needed.
 */
function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'p07-bcp-'));
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

/** Minimal thin packages/cli/index.ts so the thin-entry guard passes. */
function writeThinIndex(write) {
  write('packages/cli/index.ts', 'export {};\n');
}

/**
 * Assert `condition` is truthy, throwing a regression error with `message` on
 * failure. A thrown assertion means the checker does NOT behave as the new
 * specifier-based rules require — investigate (the old symbol-allowlist
 * behavior may have been reintroduced).
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`REGRESSION FAILURE: ${message}`);
  }
}

function assertContains(haystack, needle, context, stderr) {
  assert(
    haystack.includes(needle),
    `expected stdout to contain literal "${needle}" (${context}).\nActual stdout:\n${haystack}${stderr ? `\nActual stderr:\n${stderr}` : ''}`,
  );
}

function assertNotContains(haystack, needle, context, stderr) {
  assert(
    !haystack.includes(needle),
    `expected stdout to NOT contain literal "${needle}" (${context}) — the old symbol-level classification is gone.\nActual stdout:\n${haystack}${stderr ? `\nActual stderr:\n${stderr}` : ''}`,
  );
}

/**
 * A single regression assertion. `run` receives the fixture helpers and
 * returns the checker result; `expect` validates it. The fixture tree is torn
 * down after `expect` returns.
 */
const regressionFailures = [];

function regress(name, run, expect) {
  try {
    const result = withFixture(({ root, write }) => run({ root, write }));
    expect(result);
    console.log(`  [GREEN] ${name}`);
  } catch (error) {
    regressionFailures.push(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`  [RED] ${name}`);
  }
}

// ─── Regression assertions (NEW specifier-based behavior) ───────────────────

let scenariosRun = 0;

// Assertion 1: The NEW checker ALLOWS a bare-root INTERNAL-symbol import
// (AgentClient) at the specifier level. The old symbol-level gate is gone.
scenariosRun++;
regress(
  'bare-root internal-symbol import (AgentClient) is ALLOWED at the specifier level',
  ({ root, write }) => {
    write(
      'packages/cli/src/rogue.ts',
      "import { AgentClient } from '@vybestack/llxprt-code-agents';\n",
    );
    writeThinIndex(write);
    return runChecker(root);
  },
  ({ code, stdout, stderr }) => {
    assert(
      code === 0,
      `expected exit code 0 (bare root allowed), got ${code}`,
    );
    assertContains(
      stdout,
      'CLI import boundary check PASSED.',
      'overall pass message for bare-root import',
      stderr,
    );
    assertNotContains(
      stdout,
      'agents-internal-symbol',
      'old classification must be gone',
      stderr,
    );
  },
);

// Assertion 2: The NEW checker STILL flags the internals subpath
// (@vybestack/llxprt-code-agents/internals.js) as a deep-import violation.
scenariosRun++;
regress(
  'internals subpath (@vybestack/llxprt-code-agents/internals.js) is forbidden as a deep import',
  ({ root, write }) => {
    write(
      'packages/cli/src/deep.ts',
      "import { AgentClient } from '@vybestack/llxprt-code-agents/internals.js';\n",
    );
    writeThinIndex(write);
    return runChecker(root);
  },
  ({ code, stdout, stderr }) => {
    assert(code === 1, `expected exit code 1 (violation), got ${code}`);
    assertContains(
      stdout,
      '@vybestack/llxprt-code-agents/internals.js',
      'offending deep-import specifier literal',
      stderr,
    );
    assertContains(
      stdout,
      'static-import',
      'classification for internals subpath deep import',
      stderr,
    );
  },
);

// Assertion 3: The NEW checker STILL flags a deep source-path import
// (e.g. /core/client.js) as a deep-import violation.
scenariosRun++;
regress(
  'deep agents source-path import (/core/client.js) is forbidden as a deep import',
  ({ root, write }) => {
    write(
      'packages/cli/src/deepsource.ts',
      "import { AgentClient } from '@vybestack/llxprt-code-agents/core/client.js';\n",
    );
    writeThinIndex(write);
    return runChecker(root);
  },
  ({ code, stdout, stderr }) => {
    assert(code === 1, `expected exit code 1 (violation), got ${code}`);
    assertContains(
      stdout,
      '@vybestack/llxprt-code-agents/core/client.js',
      'offending deep source-path specifier literal',
      stderr,
    );
    assertContains(
      stdout,
      'static-import',
      'classification for deep source-path import',
      stderr,
    );
  },
);

// Assertion 4: The NEW checker ALLOWS a bare-root PUBLIC-symbol import
// (createAgent). This documents that the bare root remains a public specifier.
scenariosRun++;
regress(
  'bare-root public-symbol import (createAgent) is allowed at the specifier level',
  ({ root, write }) => {
    write(
      'packages/cli/src/ok.ts',
      "import { createAgent } from '@vybestack/llxprt-code-agents';\n",
    );
    writeThinIndex(write);
    return runChecker(root);
  },
  ({ code, stdout, stderr }) => {
    assert(code === 0, `expected exit code 0 (allowed), got ${code}`);
    assertContains(
      stdout,
      'CLI import boundary check PASSED.',
      'overall pass message',
      stderr,
    );
  },
);

// Assertion 5: The NEW checker ALLOWS a namespace import from the bare agents
// root at the specifier level. The old agents-namespace-import classification
// is gone.
scenariosRun++;
regress(
  'namespace import (import * as ns) from bare agents root is allowed at the specifier level',
  ({ root, write }) => {
    write(
      'packages/cli/src/ns.ts',
      "import * as agentsApi from '@vybestack/llxprt-code-agents';\n",
    );
    writeThinIndex(write);
    return runChecker(root);
  },
  ({ code, stdout, stderr }) => {
    assert(code === 0, `expected exit code 0 (allowed), got ${code}`);
    assertContains(
      stdout,
      'CLI import boundary check PASSED.',
      'overall pass message for namespace import',
      stderr,
    );
    assertNotContains(
      stdout,
      'agents-namespace-import',
      'old classification must be gone',
      stderr,
    );

  },
);

if (regressionFailures.length > 0) {
  console.error('\nRegression proof FAILED:');
  for (const failure of regressionFailures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `\nRegression proof PASSED: ${scenariosRun} scenarios confirmed the new specifier-based boundary checker behavior.`,
);
console.log(
  'Bare agents root imports are allowed at the specifier level; internals subpath and deep source paths are forbidden.',
);
process.exit(0);

