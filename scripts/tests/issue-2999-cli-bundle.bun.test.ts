/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2999 — the bundle must be genuinely launchable.
 *
 * This is the anti-mock-theater test: it actually builds the CLI bundle via
 * the same `scripts/bun-build.config.ts` machinery used at publish time, then
 * executes the artifact with the repo's Bun, asserting it prints the version
 * and exits 0. This proves:
 *   - externals resolve (node-pty, keyring, @ast-grep/*, opentui/UI);
 *   - no top-level-await breakage;
 *   - no broken import.meta/__dirname/require semantics in a bundle;
 *   - the artifact is genuinely launchable, not just syntactically valid.
 *
 * The build takes ~21s, so it is gated behind
 * `LLXPRT_RUN_BUNDLE_BUILD_TEST=1` to keep it off the default test shard. It
 * MUST run somewhere in CI (nightly) so externals drift is caught.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dependenciesInstalled,
  requireDependenciesInstalled,
} from '../bun-build.config.ts';
import { spawnSyncWithFileCapture } from './memory/sync-process.ts';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
// The Bun running this test, not `node_modules/bun/bin/<bun>`: that path is
// materialised by the `bun` package's postinstall, and npm >= 11.16 no longer
// runs install scripts by default, so it does not exist in CI. `bun test`
// always sets execPath to a Bun binary, and CI pins it via `.bun-version`.
const repoBun = process.execPath;
const bundlePath = join(repoRoot, 'packages', 'cli', 'bundle', 'llxprt.js');
const expectedVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
    version: string;
  }
).version;

const RUN_BUILD_TEST = process.env.LLXPRT_RUN_BUNDLE_BUILD_TEST === '1';

/**
 * Renders a failed child process in full: status, signal, spawn error and both
 * streams. The build and the launch both run as subprocesses, and reporting
 * only an exit code discards the diagnostics that say what actually broke.
 */
interface ProcessResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stdout: string;
  readonly stderr: string;
}

function describeProcessFailure(label: string, proc: ProcessResult): string {
  return [
    `${label} failed (status ${proc.status}, signal ${proc.signal})`,
    proc.error ? `spawn error: ${String(proc.error)}` : '',
    // Guarded: on a spawn failure these are null, not empty strings, so an
    // unguarded template would print the literal "null" precisely when the
    // spawn error is the whole story.
    proc.stdout ? `stdout: ${proc.stdout}` : '',
    proc.stderr ? `stderr: ${proc.stderr}` : '',
  ]
    .filter(Boolean)
    .join('\n  ');
}

describe.skipIf(!RUN_BUILD_TEST)(
  'issue #2999: prebuilt CLI bundle launches',
  () => {
    // Build plus launch runs two Bun subprocesses; give CI a generous floor.
    it('builds the bundle and executes --version successfully', async () => {
      // Clean any stale bundle first so we prove the build produces a fresh one.
      rmSync(join(repoRoot, 'packages', 'cli', 'bundle'), {
        recursive: true,
        force: true,
      });

      // Build through the real publish path -- packages/cli prepack, which is
      // `bun scripts/bun-build.config.ts --cli-only` -- rather than calling
      // `Bun.build` in this process. Only the subprocess exercises what
      // `npm pack` actually runs, and an in-process build additionally cannot
      // resolve the CLI entry own imports: under the test runner Bun bundler
      // does not rewrite `./src/cli.js` to `src/cli.tsx`, so it fails with
      // "Could not resolve" on code that publishing bundles fine (issue #3061).
      const build = spawnSync(
        repoBun,
        [join(repoRoot, 'scripts', 'bun-build.config.ts'), '--cli-only'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          timeout: 180_000,
          env: { ...process.env, CI: 'true' },
        },
      );
      if (build.error !== undefined || build.status !== 0) {
        throw new Error(describeProcessFailure('bundle build', build));
      }
      // Not `expect(existsSync(...))`: the build can exit 0 having built
      // nothing (runBuilds skips the bundle when node_modules is absent), and a
      // bare "expected false to be true" would discard the subprocess output
      // that says which path was taken.
      if (!existsSync(bundlePath)) {
        throw new Error(
          describeProcessFailure('bundle build produced no artifact', build),
        );
      }

      // Execute the artifact with the same Bun that resolves 4,274 modules
      // when running raw TypeScript. A 0 exit with version output proves the
      // bundled module graph loads cleanly.
      const proc = spawnSyncWithFileCapture(
        join(repoRoot, 'tmp'),
        repoBun,
        [bundlePath, '--version'],
        {
          cwd: repoRoot,
          timeout: 60_000,
          env: { ...process.env, CI: 'true' },
        },
      );

      // Surface the child's own output: a bundle that fails to load reports the
      // offending module on stderr, and asserting the exit code alone discards
      // it.
      if (proc.status !== 0) {
        throw new Error(describeProcessFailure('bundle launch', proc));
      }
      // Assert the exact version rather than a shape-matching regex: this also
      // proves the CLI_VERSION define was applied to the bundled artifact.
      expect(proc.stdout.trim()).toBe(expectedVersion);
    }, 240_000);

    // afterAll rather than a trailing `it`: cleanup must run even when the
    // build test fails or the runner aborts, otherwise the gitignored artifact
    // lingers and affects other tests (e.g. publish-integrity packing).
    afterAll(() => {
      rmSync(join(repoRoot, 'packages', 'cli', 'bundle'), {
        recursive: true,
        force: true,
      });
    });
  },
);

// Ungated: this must always run because publishable packages require freshly
// built CLI and profiler artifacts.
describe('issue #2999: prepack requires dependencies', () => {
  it('rejects a bundle build when node_modules is absent', () => {
    const empty = mkdtempSync(join(tmpdir(), 'llxprt-nodeps-'));
    try {
      expect(dependenciesInstalled(empty)).toBe(false);
      expect(() => requireDependenciesInstalled(empty)).toThrow(
        /cannot build publishable CLI bundles without node_modules/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('accepts a bundle build once node_modules exists', () => {
    const populated = mkdtempSync(join(tmpdir(), 'llxprt-deps-'));
    try {
      mkdirSync(join(populated, 'node_modules'));
      expect(dependenciesInstalled(populated)).toBe(true);
      expect(() => requireDependenciesInstalled(populated)).not.toThrow();
    } finally {
      rmSync(populated, { recursive: true, force: true });
    }
  });

  it('defaults to the repo root, which has dependencies installed', () => {
    expect(dependenciesInstalled()).toBe(true);
    expect(() => requireDependenciesInstalled()).not.toThrow();
  });
});
