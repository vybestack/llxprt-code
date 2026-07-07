/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const launcher = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt.cjs');

// spawnSync blocks the event loop, so Vitest's per-test timeout cannot
// interrupt a hung child; the spawnSync `timeout` below is the real guard. Keep
// it generous — the Node launcher re-execs the CLI under Bun, so a cold spawn on
// a loaded CI runner takes seconds — while still bounding a genuine hang.
const SPAWN_KILL_TIMEOUT_MS = 120_000;

// Vitest per-test budget. Kept above SPAWN_KILL_TIMEOUT_MS so the spawnSync
// timeout fires first and surfaces a diagnosable error, rather than Vitest
// aborting the test with no cause.
const SMOKE_TEST_TIMEOUT_MS = SPAWN_KILL_TIMEOUT_MS + 30_000;

// `--version` prints exactly a semver line: a release ("0.10.0") or a
// prerelease ("0.1.13-nightly.250727.2261021c"). Anchor both ends so trailing
// garbage (e.g. an error appended after the version) fails the assertion, while
// still accepting the optional "-<prerelease>" suffix nightly builds emit.
const VERSION_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function runLauncherVersion(env: NodeJS.ProcessEnv): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [launcher, '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env,
    // Kill a hung child here (spawnSync blocks the event loop, so Vitest's
    // per-test timeout cannot). Generous enough to absorb a cold Bun re-exec on
    // a loaded CI runner, tight enough to bound a genuine hang.
    timeout: SPAWN_KILL_TIMEOUT_MS,
  });
  if (result.error) {
    // Surface spawn failures (e.g. missing launcher or a timeout kill)
    // explicitly; otherwise a null status with empty stderr makes the CI
    // failure undiagnosable.
    throw new Error(`Failed to spawn CLI launcher: ${result.error.message}`);
  }
  if (result.signal) {
    // A signal-killed child (e.g. the OOM killer's SIGKILL) leaves result.error
    // unset with a null status. Surface the signal so CI shows the real cause
    // instead of a confusing "Expected null to be 0".
    throw new Error(`CLI launcher was killed by signal ${result.signal}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI entry smoke guard (issue #2435)', () => {
  // Regression guard for https://github.com/vybestack/llxprt-code/issues/2435.
  //
  // The smoke-test.yml workflow does a fresh checkout + `npm ci` (no build, no
  // generate step), then runs `node ./packages/cli/bin/llxprt.cjs --version`.
  // Previously this crashed at module-load time because AboutBox.tsx and
  // bugCommand.ts had a hard static ESM import of a gitignored, build-generated
  // `git-commit.ts`. With the resilient loader, the CLI must print its version
  // and exit 0 even when no git-commit artifact can be found anywhere.
  //
  // Hermeticity: the env override `LLXPRT_GIT_COMMIT_INFO_PATH` is treated by
  // the loader as the ONLY candidate when set (override-exclusivity). Pointing
  // it at a guaranteed-missing temp path deterministically reproduces the
  // fresh-checkout "no generated artifact" state without deleting any real
  // on-disk file, so the test is reproducible on developer machines where the
  // generated JSON already exists.
  it(
    'prints the version and exits 0 when the git-commit artifact is missing',
    () => {
      // randomUUID (not process.pid) guards against PID recycling leaving a
      // stale file at this path, which would defeat the missing-artifact intent.
      const missingArtifact = join(
        tmpdir(),
        `definitely-missing-git-commit-${randomUUID()}.json`,
      );

      const { status, stdout, stderr } = runLauncherVersion({
        ...process.env,
        LLXPRT_GIT_COMMIT_INFO_PATH: missingArtifact,
        LLXPRT_BUN_RELAUNCHED: 'true',
      });

      expect(
        status,
        `CLI exited ${status} (expected 0). stderr:\n${stderr}`,
      ).toBe(0);
      expect(stdout.trim()).toMatch(VERSION_REGEX);
    },
    SMOKE_TEST_TIMEOUT_MS,
  );

  // Covers the non-override default-candidate lookup path of candidatePaths():
  // with the env override unset (empty), the loader consults its default
  // candidate paths. On CI (fresh checkout, no build) no artifact exists, so
  // this exercises graceful degradation; on a built/dev tree it finds the real
  // artifact. Either way the CLI must print its version and exit 0. The
  // hermetic graceful-degradation guarantee is proven by the first test above.
  it(
    'prints the version and exits 0 with no override set',
    () => {
      const { status, stdout, stderr } = runLauncherVersion({
        ...process.env,
        LLXPRT_GIT_COMMIT_INFO_PATH: '',
        LLXPRT_BUN_RELAUNCHED: 'true',
      });

      expect(
        status,
        `CLI exited ${status} (expected 0). stderr:\n${stderr}`,
      ).toBe(0);
      expect(stdout.trim()).toMatch(VERSION_REGEX);
    },
    SMOKE_TEST_TIMEOUT_MS,
  );
});
