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

// Generous per-test budget: the Node launcher re-execs the CLI under Bun, so
// the first cold spawn can be slow on CI runners.
const SMOKE_TEST_TIMEOUT_MS = 30_000;

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
  });
  if (result.error) {
    // Surface spawn failures (e.g. missing launcher) explicitly; otherwise a
    // null status with empty stderr makes the CI failure undiagnosable.
    throw new Error(`Failed to spawn CLI launcher: ${result.error.message}`);
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
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
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
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
    SMOKE_TEST_TIMEOUT_MS,
  );
});
