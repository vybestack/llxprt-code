/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SENTINEL_FILENAME } from './quota-guard.js';

/**
 * Real-process proof of the vitest-level acceptance mechanism.
 *
 * The quota guard's promise is that once the sentinel trips, the remainder of
 * the E2E suite (a) SKIPS fresh tests via `ctx.skip` in the shared beforeEach
 * hook, (b) THROWS on retries so an original failure is preserved, and (c)
 * makes the overall run exit non-zero. Those are vitest runtime semantics, not
 * pure functions — the only faithful way to verify them is to run a real nested
 * `vitest` against a fixture that mirrors integration-tests/setup-quota-guard.ts
 * and observe the process outcome, the reporter output, and the filesystem side
 * effects. That is exactly what this test does.
 */

// From packages/test-utils/src/ up to the repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPO_NODE_MODULES = join(REPO_ROOT, 'node_modules');
const VITEST_ENTRY = join(REPO_NODE_MODULES, 'vitest', 'vitest.mjs');
// file:// URL so the fixture (which lives outside the repo tree) can import the
// real guard module by absolute specifier on every platform, including Windows.
const QUOTA_GUARD_MODULE_URL = new URL('./quota-guard.js', import.meta.url)
  .href;

const MARKER_FILENAME = 'test-two-body-ran.marker';
const SKIP_NOTE = 'E2E aborted: provider quota/rate-limit exhausted';
const ORIGINAL_FAILURE_MARKER = 'ORIGINAL_FAILURE_PRESERVED';
const TRIP_REASON = 'matched HTTP 429 status: "simulated provider wall"';

const fixtureRoots: string[] = [];

/**
 * Setup file for the fixture. Mirrors the retry/skip contract of the real
 * integration-tests/setup-quota-guard.ts: fresh attempts skip with the quota
 * note; retries throw so the original failure is not erased and the run stays
 * non-zero.
 */
function setupFileSource(): string {
  return `import { beforeEach } from 'vitest';
import { getQuotaGuardTrip } from ${JSON.stringify(QUOTA_GUARD_MODULE_URL)};

beforeEach((ctx) => {
  const trip = getQuotaGuardTrip();
  if (!trip) {
    return;
  }
  const retryCount = ctx.task.result?.retryCount ?? 0;
  if (retryCount === 0) {
    ctx.skip('${SKIP_NOTE} — ' + trip.reason);
  } else {
    throw new Error('${SKIP_NOTE} — failing retry fast: ' + trip.reason);
  }
});
`;
}

/**
 * The fixture test file. Test one trips the guard then fails for real (proving
 * the original failure survives retries). Test two writes a marker file from its
 * body — if the skip works, that body never runs and the marker never appears.
 */
function fixtureTestSource(): string {
  return `import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tripQuotaGuard } from ${JSON.stringify(QUOTA_GUARD_MODULE_URL)};

describe('quota guard acceptance fixture', () => {
  it('test one: trips the guard then fails for real', () => {
    tripQuotaGuard('${TRIP_REASON}');
    throw new Error('${ORIGINAL_FAILURE_MARKER}');
  });

  it('test two: body must never run once the guard is tripped', () => {
    const stateDir = process.env['INTEGRATION_TEST_FILE_DIR'];
    if (stateDir === undefined) {
      throw new Error('INTEGRATION_TEST_FILE_DIR not set in fixture child');
    }
    writeFileSync(join(stateDir, '${MARKER_FILENAME}'), 'ran');
    expect(true).toBe(true);
  });
});
`;
}

/**
 * vitest config for the fixture. retry >= 1 exercises the retry-throw branch;
 * fileParallelism:false and a single include keep ordering deterministic so the
 * tripping test always precedes the skip candidate, exactly like the real suite.
 */
function fixtureConfigSource(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['cases.fixture.ts'],
    setupFiles: ['./setup.ts'],
    retry: 1,
    fileParallelism: false,
    reporters: ['default'],
  },
});
`;
}

/**
 * Materialize a self-contained vitest project in an OS temp dir. The repo's
 * node_modules is symlinked in so the child `vitest` (and `vitest/config`)
 * resolves without a local install. Returns the fixture root and its sentinel
 * state dir.
 */
function createFixture(): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'quota-guard-vitest-'));
  fixtureRoots.push(root);

  symlinkSync(REPO_NODE_MODULES, join(root, 'node_modules'), 'dir');

  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });

  writeFileSync(join(root, 'setup.ts'), setupFileSource());
  writeFileSync(join(root, 'cases.fixture.ts'), fixtureTestSource());
  writeFileSync(join(root, 'vitest.config.ts'), fixtureConfigSource());

  return { root, stateDir };
}

/**
 * Child environment for the nested vitest. Points the guard at the fixture's
 * own sentinel dir and neutralizes GitHub Actions annotation env so a tripped
 * guard inside the fixture can never write to the OUTER run's real CI step
 * summary. Inherited VITEST_* worker vars are stripped so the child starts a
 * clean runner rather than mistaking itself for a nested worker.
 */
function childEnv(stateDir: string): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...process.env };
  // `Object.keys` snapshots the keys up front, so deleting entries from `next`
  // while iterating that snapshot is safe (we never mutate the array we loop).
  for (const key of Object.keys(next)) {
    if (key.startsWith('VITEST')) {
      delete next[key];
    }
  }
  next['INTEGRATION_TEST_FILE_DIR'] = stateDir;
  delete next['GITHUB_ACTIONS'];
  delete next['GITHUB_STEP_SUMMARY'];
  delete next['LLXPRT_QUOTA_GUARD_DISABLED'];
  return next;
}

describe('quota guard vitest acceptance semantics', () => {
  afterEach(() => {
    for (const root of fixtureRoots) {
      // Best-effort: an orphaned vitest worker may still hold the fixture cwd
      // for a beat after a SIGKILL timeout, so a rmSync can hit EBUSY/EPERM.
      // Swallow it so the remaining fixture roots are still cleaned up; the OS
      // temp dir is reclaimed regardless.
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Ignore — leftover temp dirs are harmless and OS-reclaimed.
      }
    }
    fixtureRoots.length = 0;
  });

  it('skips fresh tests, preserves the original failure on retry, and exits non-zero', () => {
    const { root, stateDir } = createFixture();

    const result = spawnSync(
      process.execPath,
      [VITEST_ENTRY, 'run', '--root', root],
      {
        cwd: root,
        env: childEnv(stateDir),
        encoding: 'utf8',
        timeout: 90000,
        // On timeout, SIGKILL (not the default SIGTERM) the vitest child so it
        // cannot linger in a graceful-shutdown handler; SIGTERM alone reaches
        // only the direct child, letting vitest worker processes orphan and
        // race the afterEach rmSync of their cwd. SIGKILL plus best-effort
        // cleanup below is the practical mitigation (a post-hoc process-group
        // kill is not possible with spawnSync).
        killSignal: 'SIGKILL',
      },
    );

    // Surface spawn failures / timeouts as a clear error rather than a
    // confusing downstream content-assertion miss.
    expect(result.error).toBeUndefined();

    // spawnSync with `encoding: 'utf8'` types stdout/stderr as string.
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    // (c) The overall run must exit non-zero — the outage is surfaced as a
    // failure, never masked as success.
    expect(result.status).not.toBe(0);

    // (a) Test two's body never executed: its marker file was never written,
    // proving `ctx.skip` short-circuited before the API-touching body.
    expect(existsSync(join(stateDir, MARKER_FILENAME))).toBe(false);

    // The sentinel was actually tripped inside the child (real cross-process
    // file handshake, not a simulation).
    expect(existsSync(join(stateDir, SENTINEL_FILENAME))).toBe(true);

    // The reporter surfaced the quota skip note for the skipped test...
    expect(combinedOutput).toContain(SKIP_NOTE);
    // ...and the original failure was preserved (not erased by the retry).
    expect(combinedOutput).toContain(ORIGINAL_FAILURE_MARKER);
  }, 120000);
});
