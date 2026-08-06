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
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
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

// Resolve vitest via Node's module resolution rather than a hardcoded relative
// depth or an assumed root-hoisted layout. `createRequire` is anchored at THIS
// file, so it honours whatever node_modules actually resolves vitest for the
// test-utils package — hoisted to the repo root, nested per-package, or a
// pnpm-style store. If this file ever moves to a different package depth, or a
// different package manager changes the install layout, resolution still finds
// the installed vitest instead of silently breaking on a stale relative path.
const require = createRequire(import.meta.url);

/**
 * Absolute path to the installed `vitest` CLI entry (its `bin`).
 *
 * `require.resolve('vitest/vitest.mjs')` returns the real bin file directly, so
 * we never assume it is hoisted to a specific node_modules. Throws a
 * descriptive error (rather than letting a later spawn fail with an opaque
 * ENOENT) if vitest cannot be resolved at all.
 */
function resolveVitestEntry(): string {
  try {
    return require.resolve('vitest/vitest.mjs');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to resolve the vitest CLI entry ('vitest/vitest.mjs') from ` +
        `${import.meta.url}. Is vitest installed for @vybestack/llxprt-code-` +
        `test-utils? Underlying resolver error: ${detail}`,
    );
  }
}

/**
 * Absolute path to the Node executable the nested vitest run must use.
 *
 * `process.execPath` is whatever runs THIS file, and this package's suites run
 * under Bun. Vitest is a Node tool: its forks pool spawns workers expecting a
 * Node runtime, which holds under Bun on POSIX but not on Windows, where the
 * nested run dies outright — publishing no sentinel and exiting non-zero for a
 * reason that has nothing to do with the quota guard (issue #3061). Pinning the
 * child to Node removes the host runtime from what these tests measure.
 *
 * Throws descriptively rather than letting a later spawn fail with an opaque
 * ENOENT, matching how the vitest entry is resolved above.
 */
function resolveNodeExecutable(): string {
  const fromNpm = process.env['npm_node_execpath'];
  if (fromNpm !== undefined && fromNpm !== '' && existsSync(fromNpm)) {
    return fromNpm;
  }
  // `node.exe` only: a `.cmd` shim cannot be spawned without `shell: true`
  // (it fails EINVAL), and every real Windows Node install ships `node.exe`.
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  const searchPath = process.env['PATH'] ?? '';
  for (const dir of searchPath.split(delimiter)) {
    if (dir === '') {
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error(
    'Unable to locate a Node executable to run the nested vitest with. ' +
      'These tests spawn a real vitest run, which requires Node (the host ' +
      'runtime here is ' +
      `${process.execPath}). Checked npm_node_execpath and PATH.`,
  );
}

const NODE_EXECUTABLE = resolveNodeExecutable();

/**
 * Absolute path to the node_modules directory that actually provides vitest.
 *
 * Derived from the resolved `vitest/package.json` (`.../node_modules/vitest/
 * package.json` → `.../node_modules`) so the fixture symlinks in the SAME
 * install tree the child `vitest` will load from — no root-hoist assumption and
 * no directory-depth walking. Throws descriptively when vitest is unresolvable.
 */
function resolveNodeModulesDir(): string {
  try {
    // dirname(vitest/package.json) => .../node_modules/vitest
    // dirname(that)                => .../node_modules
    return dirname(dirname(require.resolve('vitest/package.json')));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to resolve 'vitest/package.json' from ${import.meta.url} to ` +
        `locate the node_modules that provides vitest. Underlying resolver ` +
        `error: ${detail}`,
    );
  }
}

const VITEST_ENTRY = resolveVitestEntry();
const REPO_NODE_MODULES = resolveNodeModulesDir();
// file:// URL so the fixture (which lives outside the repo tree) can import the
// real guard module by absolute specifier on every platform, including Windows.
const QUOTA_GUARD_MODULE_URL = new URL('./quota-guard.js', import.meta.url)
  .href;

const MARKER_FILENAME = 'test-two-body-ran.marker';
const SKIP_NOTE = 'E2E aborted: provider quota/rate-limit exhausted';
const ORIGINAL_FAILURE_MARKER = 'ORIGINAL_FAILURE_PRESERVED';
const TRIP_REASON = 'matched HTTP 429 status: "simulated provider wall"';

// Number of concurrent worker processes for the atomic-publication race. Each
// runs in its own forked vitest child and calls tripQuotaGuard with a distinct
// reason, so publication is genuinely contended across real OS processes.
const RACE_WORKER_COUNT = 8;
const RACE_REASON_PREFIX = 'matched HTTP 429 status: "race worker ';

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
 * Link the real install's node_modules into a fixture root so the child vitest
 * (and `vitest/config`) resolves without a local install.
 *
 * On Windows a 'dir' symlink needs administrator privileges or developer mode
 * and fails EPERM in ordinary CI/contributor shells; a 'junction' needs neither
 * and works for an ABSOLUTE target — which {@link REPO_NODE_MODULES} always is
 * (it comes from require.resolve, not a relative guess) — so it is the correct
 * cross-platform choice here. Elsewhere a directory symlink is retained.
 * Centralised so both {@link createFixture} and {@link createRaceFixture} share
 * one definition of the target, destination, and platform-specific link type.
 */
function linkNodeModules(root: string): void {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(REPO_NODE_MODULES, join(root, 'node_modules'), linkType);
}

/**
 * Materialize a self-contained vitest project in an OS temp dir. Returns the
 * fixture root and its sentinel state dir.
 */
function createFixture(): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'quota-guard-vitest-'));
  fixtureRoots.push(root);

  linkNodeModules(root);

  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });

  writeFileSync(join(root, 'setup.ts'), setupFileSource());
  writeFileSync(join(root, 'cases.fixture.ts'), fixtureTestSource());
  writeFileSync(join(root, 'vitest.config.ts'), fixtureConfigSource());

  return { root, stateDir };
}

/**
 * One worker fixture file for the atomic-publication race. Each worker runs in
 * its OWN forked vitest process. To force genuine contention rather than a
 * happens-to-be-serial sequence, every worker first announces readiness (a
 * `ready-N` file) then synchronously barrier-waits until all workers are ready
 * before calling {@link tripQuotaGuard}, so the publications fire together and
 * actually race for the single sentinel.
 */
function raceWorkerSource(index: number): string {
  const reason = `${RACE_REASON_PREFIX}${index}"`;
  return `import { it, expect } from 'vitest';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tripQuotaGuard } from ${JSON.stringify(QUOTA_GUARD_MODULE_URL)};

// Local blocking sleep while filesystem ready files implement the barrier.
const sab = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms: number) {
  Atomics.wait(sab, 0, 0, ms);
}

it('race worker ${index} publishes under contention', () => {
  const stateDir = process.env['INTEGRATION_TEST_FILE_DIR'];
  if (stateDir === undefined) {
    throw new Error('INTEGRATION_TEST_FILE_DIR not set in race worker ${index}');
  }
  writeFileSync(join(stateDir, 'ready-${index}'), '1');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = readdirSync(stateDir).filter((f) =>
      f.startsWith('ready-'),
    ).length;
    if (ready >= ${RACE_WORKER_COUNT}) {
      break;
    }
    sleep(10);
  }
  tripQuotaGuard(${JSON.stringify(reason)});
  expect(true).toBe(true);
});
`;
}

/**
 * vitest config for the race fixture. A forks pool with fileParallelism and
 * min/max workers pinned to the worker count launches all worker files as
 * concurrent OS processes, so the sentinel publication is genuinely contended.
 */
function raceConfigSource(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['race-*.fixture.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    fileParallelism: true,
    minWorkers: ${RACE_WORKER_COUNT},
    maxWorkers: ${RACE_WORKER_COUNT},
    reporters: ['default'],
  },
});
`;
}

/**
 * Materialize a self-contained vitest project whose {@link RACE_WORKER_COUNT}
 * worker files each trip the guard from a separate forked process. Shares the
 * same node_modules symlink strategy as {@link createFixture}.
 */
function createRaceFixture(): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'quota-guard-race-'));
  fixtureRoots.push(root);

  linkNodeModules(root);

  const stateDir = join(root, 'state');
  mkdirSync(stateDir, { recursive: true });

  for (let i = 0; i < RACE_WORKER_COUNT; i++) {
    writeFileSync(join(root, `race-${i}.fixture.ts`), raceWorkerSource(i));
  }
  writeFileSync(join(root, 'vitest.config.ts'), raceConfigSource());

  return { root, stateDir };
}

/**
 * The set of complete reason strings any race worker could legitimately have
 * published. Used to assert the winning sentinel holds a WHOLE, valid reason
 * (never a truncated or empty payload), which is the crux of atomic
 * publication.
 */
function expectedRaceReasons(): ReadonlySet<string> {
  const reasons = new Set<string>();
  for (let i = 0; i < RACE_WORKER_COUNT; i++) {
    reasons.add(`${RACE_REASON_PREFIX}${i}"`);
  }
  return reasons;
}

/** Names of any leftover atomic-publication temp files in the state dir. */
function leftoverTempFiles(stateDir: string): string[] {
  return readdirSync(stateDir).filter(
    (name) => name.startsWith(SENTINEL_FILENAME) && name.endsWith('.tmp'),
  );
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

/**
 * Remove a fixture root, best-effort, with a short retry for transient
 * EBUSY/EPERM (an orphaned vitest worker may briefly hold the fixture cwd
 * after a SIGKILL timeout). A transient retry that eventually succeeds is
 * silent. Only an error that persists (or is not a known transient code)
 * produces a test-diagnostics warning so a genuinely broken cleanup is
 * visible rather than silently swallowed. The remaining fixture roots are
 * always processed regardless of any individual failure.
 */
const CLEANUP_RETRY_COUNT = 3;
const CLEANUP_RETRY_DELAY_MS = 200;

// Synchronous sleep for the cleanup retry backoff (no async in afterEach).
// Atomics.wait blocks the thread efficiently (no busy-wait CPU burn).
const cleanupSab = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(cleanupSab, 0, 0, ms);
}

function isTransientCleanupError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';
}

function removeFixtureRoot(root: string): void {
  for (let attempt = 0; attempt <= CLEANUP_RETRY_COUNT; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt < CLEANUP_RETRY_COUNT && isTransientCleanupError(error)) {
        sleepSync(CLEANUP_RETRY_DELAY_MS);
        continue;
      }
      // Non-transient error or retries exhausted — surface a diagnostic
      // warning so the failure is visible rather than silently swallowed.
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[quota-guard-vitest-integration] WARNING: failed to clean up fixture root ${root}: ${detail}
`,
      );
      return;
    }
  }
}

/**
 * Assert a property of the nested run, reporting the child's OWN output when it
 * does not hold. A nested run that dies for an unrelated reason (a runtime that
 * cannot host vitest, a missing fixture) is otherwise indistinguishable in CI
 * from one that failed for the reason under test — that ambiguity is what made
 * the Windows failures in issue #3061 unreadable from the log.
 */
function requireOrReport(
  condition: boolean,
  message: string,
  childOutput: string,
): void {
  if (!condition) {
    throw new Error(`${message}. Child output:\n${childOutput}`);
  }
}

describe('quota guard vitest acceptance semantics', () => {
  afterEach(() => {
    for (const root of fixtureRoots) {
      removeFixtureRoot(root);
    }
    fixtureRoots.length = 0;
  });

  it('skips fresh tests, preserves the original failure on retry, and exits non-zero', () => {
    const { root, stateDir } = createFixture();

    const result = spawnSync(
      NODE_EXECUTABLE,
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
    // failure, never masked as success. Report the child's own output on a
    // miss: a nested run that dies for an unrelated reason is otherwise
    // indistinguishable from one that failed for the intended reason.
    requireOrReport(
      result.status !== 0,
      'expected the nested vitest run to exit non-zero, got 0',
      combinedOutput,
    );

    // (a) Test two's body never executed: its marker file was never written,
    // proving `ctx.skip` short-circuited before the API-touching body.
    expect(existsSync(join(stateDir, MARKER_FILENAME))).toBe(false);

    // The sentinel was actually tripped inside the child (real cross-process
    // file handshake, not a simulation).
    requireOrReport(
      existsSync(join(stateDir, SENTINEL_FILENAME)),
      'the nested run published no sentinel',
      combinedOutput,
    );

    // The reporter surfaced the quota skip note for the skipped test...
    expect(combinedOutput).toContain(SKIP_NOTE);
    // ...and the original failure was preserved (not erased by the retry).
    expect(combinedOutput).toContain(ORIGINAL_FAILURE_MARKER);
  }, 120000);

  it('atomically publishes exactly one complete sentinel under real multi-process contention, leaving no temp files', () => {
    const { root, stateDir } = createRaceFixture();

    // Launch one vitest run whose forks pool spawns RACE_WORKER_COUNT worker
    // PROCESSES; each barrier-waits for the others, then calls tripQuotaGuard
    // simultaneously, so publication is genuinely contended across real OS
    // processes rather than a lucky serial order.
    const result = spawnSync(
      NODE_EXECUTABLE,
      [VITEST_ENTRY, 'run', '--root', root],
      {
        cwd: root,
        env: childEnv(stateDir),
        encoding: 'utf8',
        timeout: 90000,
        killSignal: 'SIGKILL',
      },
    );

    expect(result.error).toBeUndefined();

    // Every worker's own `it` passes (tripQuotaGuard never throws), so the race
    // run exits zero — this is a plain multi-process publication race, not the
    // suite-abort acceptance scenario above.
    const combinedOutput = `${result.stdout}
${result.stderr}`;
    requireOrReport(
      result.status === 0,
      `expected the nested vitest run to exit 0, got ${result.status}`,
      combinedOutput,
    );

    // All workers actually reached the barrier — i.e. we really did have
    // RACE_WORKER_COUNT concurrent processes contending, not a degenerate one.
    const readyFiles = readdirSync(stateDir).filter((name) =>
      name.startsWith('ready-'),
    );
    expect(readyFiles.length).toBe(RACE_WORKER_COUNT);

    // First-writer-wins: exactly ONE sentinel exists after the race.
    const sentinelPath = join(stateDir, SENTINEL_FILENAME);
    expect(existsSync(sentinelPath)).toBe(true);

    // Complete publication: the sentinel parses and holds a WHOLE, valid reason
    // from one specific worker — never a truncated/empty payload. This is the
    // property the atomic temp-write + hard-link guarantees and the old
    // `writeFileSync(..., 'wx')` could not (a reader could catch a 0-byte file).
    const raw = readFileSync(sentinelPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    const record = parsed as Record<string, unknown>;
    expect(typeof record['reason']).toBe('string');
    expect(expectedRaceReasons().has(record['reason'] as string)).toBe(true);
    expect(typeof record['timestamp']).toBe('string');

    // No leftover temp files: every staged temp (winner's and losers') was
    // cleaned up in the finally block, so the state dir holds no `*.tmp`.
    expect(leftoverTempFiles(stateDir)).toStrictEqual([]);

    // Surface child output if the run somehow misbehaved (kept last so the
    // structural assertions above report first).
    expect(combinedOutput).not.toContain('ERR_');
  }, 120000);
});
