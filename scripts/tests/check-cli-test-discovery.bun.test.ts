/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-cli-test-discovery.ts (issue #2923).
 *
 * Coverage:
 *  1. Pure comparison logic (AC1/AC3/AC4) — findUndiscoveredTestFiles and
 *     findDuplicateDiscoveries classify membership and duplication without git
 *     or the filesystem.
 *  2. End-to-end against the REAL repo (AC2) — the guard must pass today, and
 *     the direct findUndiscoveredTestFiles(<git-tracked>, <discovered>)
 *     assertion is the one that would have caught the original #2923
 *     regression.
 *  3. AC1 negative, temp git repo — a tracked test file OUTSIDE the runner's
 *     `TEST_ROOTS` fails the guard and is named in stderr.
 *  4. AC3 — duplicate detection via the pure helper.
 *  5. AC4 — the guard's pattern is genuinely independent of the runner (it
 *     classifies `.bun.ts` on its own).
 *
 * No mock theater: tests invoke the real guard script (pure helpers are
 * imported directly) and the real git via a temp repo, per dev-docs/RULES.md.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

import {
  CLI_TEST_FILE_PATTERN,
  evaluateDiscovery,
  findDuplicateDiscoveries,
  findUndiscoveredTestFiles,
} from '../check-cli-test-discovery.ts';
import { discoverTestFiles } from '../../packages/cli/run-bun-tests.ts';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-cli-test-discovery.ts');
const CLI_ROOT = join(REPO_ROOT, 'packages', 'cli');
const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

// Paths used by the temp-git-repo negative tests; the expected guard message
// is derived from them so the assertion stays in sync if a path changes.
const ROGUE_TEST_PATH = 'scripts/rogue.test.ts';
const ROGUE_BUN_PATH = 'scripts/rogue.bun.ts';

/**
 * Output cap for a guard subprocess. Named so the overflow diagnostic and the
 * limit it reports cannot drift apart.
 */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Minimal valid Bun test source used to populate temp-repo fixtures. */
const STUB_TEST_SOURCE = `import { it } from 'bun:test';
`;

/** git argv prefix that sets identity inline, so a clean CI machine can commit. */
const GIT_IDENTITY = [
  '-c',
  'user.email=test@example.com',
  '-c',
  'user.name=Test',
];

// Fail fast with a descriptive error if bun is missing, rather than a cryptic
// ENOENT deep in a child-process spawn later in the test run.
try {
  execFileSync(RUNTIME, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
} catch {
  throw new Error(
    `[cli-test-discovery] Runtime "${RUNTIME}" not found. Set BUN_EXECUTABLE or install bun.`,
  );
}

interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the guard against an arbitrary root via the real script. Mirrors the
 * reference guard's async-run helper (no mock theater).
 */
async function runGuard(
  args: readonly string[],
  options: { timeout?: number } = {},
): Promise<ScriptResult> {
  const timeout = options.timeout ?? 30_000;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(RUNTIME, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as {
      code?: number | string;
      signal?: string;
      message: string;
      stdout?: string;
      stderr?: string;
    };
    // Node kills the child with SIGTERM for BOTH a timeout and a maxBuffer
    // overflow, so the buffer case must be identified by its error code first.
    // Otherwise runaway output is misreported as a timeout and the real cause
    // is hidden.
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error(
        `Guard exceeded the ${MAX_OUTPUT_BYTES / (1024 * 1024)} MB output ` +
          `buffer — likely runaway output: ${err.message}`,
      );
    }
    if (err.signal === 'SIGTERM') {
      throw new Error(
        `Guard timed out after ${timeout / 1000}s: ${err.message}`,
      );
    }
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    exitCode = typeof err.code === 'number' ? err.code : 1;
  }
  return { code: exitCode, stdout, stderr };
}

interface TempRepo {
  readonly root: string;
  /** Write a file under the temp repo, creating parent dirs as needed. */
  write(relPath: string, content: string): void;
}

/**
 * Build a temp git repo with the minimum CLI-workspace shape (a `src/` test
 * root and git identity configured for a clean CI machine), then hand it to a
 * test. Always removes the temp dir in `finally`.
 */
async function withTempGitRepo(
  fn: (repo: TempRepo) => Promise<ScriptResult>,
): Promise<ScriptResult> {
  const root = mkdtempSync(join(tmpdir(), 'cli-test-discovery-'));
  let fnError: unknown;
  let result: ScriptResult | undefined;
  let cleanupError: unknown;
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: root,
      encoding: 'utf8',
    });
    execFileSync('git', ['config', 'user.name', 'Test'], {
      cwd: root,
      encoding: 'utf8',
    });

    const write = (relPath: string, content: string): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };

    // Seed one legitimate test file under a real test root so discovery is
    // non-empty and the rogue file is the sole cause of failure.
    write('src/legit.test.ts', "import { it } from 'bun:test';\n");

    result = await fn({ root, write });
  } catch (error) {
    fnError = error;
  }
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  if (fnError !== undefined && cleanupError !== undefined) {
    const fnMsg = fnError instanceof Error ? fnError.message : String(fnError);
    const cleanupMsg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new AggregateError(
      [fnError, cleanupError],
      `[cli-test-discovery] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
    );
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  if (fnError !== undefined) {
    throw fnError;
  }
  return result!;
}

/** Stage and commit all files in a temp repo using inline git identity. */
function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  execFileSync('git', [...GIT_IDENTITY, 'commit', '-q', '-m', message], {
    cwd: root,
    encoding: 'utf8',
  });
}

// ---------------------------------------------------------------------------
// Pure comparison logic (AC1 / AC3 / AC4)
// ---------------------------------------------------------------------------

describe('findUndiscoveredTestFiles', () => {
  it('returns tracked files missing from the discovered set, sorted', () => {
    const tracked = ['src/a.test.ts', 'test/b.spec.tsx', 'scripts/c.test.ts'];
    const discovered = ['src/a.test.ts'];
    expect(findUndiscoveredTestFiles(tracked, discovered)).toEqual([
      'scripts/c.test.ts',
      'test/b.spec.tsx',
    ]);
  });

  it('returns an empty array when every tracked file is discovered', () => {
    const tracked = ['src/a.test.ts', 'test/b.spec.tsx'];
    const discovered = ['test/b.spec.tsx', 'src/a.test.ts'];
    expect(findUndiscoveredTestFiles(tracked, discovered)).toEqual([]);
  });

  it('returns an empty array when nothing is tracked', () => {
    expect(findUndiscoveredTestFiles([], ['src/a.test.ts'])).toEqual([]);
  });

  it('normalizes backslash paths to POSIX before comparison', () => {
    const tracked = ['src\\sub\\a.test.ts'];
    const discovered = ['src/sub/a.test.ts'];
    expect(findUndiscoveredTestFiles(tracked, discovered)).toEqual([]);
  });

  it('returns results sorted by POSIX path', () => {
    // Input is deliberately NOT in sorted order, so the assertion fails if
    // sorting is ever dropped. Passing pre-sorted input would prove nothing.
    const tracked = [
      'test/mmm.spec.ts',
      'scripts/zzz.test.ts',
      'src/aaa.test.ts',
    ];
    expect(findUndiscoveredTestFiles(tracked, [])).toEqual([
      'scripts/zzz.test.ts',
      'src/aaa.test.ts',
      'test/mmm.spec.ts',
    ]);
  });
});

describe('findDuplicateDiscoveries', () => {
  it('returns paths appearing more than once', () => {
    const discovered = ['src/a.test.ts', 'src/a.test.ts', 'test/b.spec.ts'];
    expect(findDuplicateDiscoveries(discovered)).toEqual(['src/a.test.ts']);
  });

  it('returns an empty array for a clean, unique set', () => {
    const discovered = ['src/a.test.ts', 'test/b.spec.ts'];
    expect(findDuplicateDiscoveries(discovered)).toEqual([]);
  });

  it('reports every duplicate, sorted', () => {
    const discovered = [
      'test/b.spec.ts',
      'src/a.test.ts',
      'test/b.spec.ts',
      'src/a.test.ts',
    ];
    expect(findDuplicateDiscoveries(discovered)).toEqual([
      'src/a.test.ts',
      'test/b.spec.ts',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(findDuplicateDiscoveries([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real repository (AC2): current state must be fully covered
// ---------------------------------------------------------------------------

/** Lists tracked CLI test files via the same git oracle the guard uses. */
function listTrackedCliTests(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\0')
    .filter((f) => f.length > 0 && CLI_TEST_FILE_PATTERN.test(f))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

describe('real repository state (AC2)', () => {
  it('the guard PASSES against the real repo', async () => {
    const { code, stdout } = await runGuard([]);
    expect(code).toBe(0);
    expect(stdout).toContain('cli-test-discovery guard PASSED');
  }, 30_000);

  it('every tracked CLI test file is discovered — the #2923 regression guard', () => {
    // This is the assertion that would have caught the original #2923
    // regression: the git-tracked set and the runner's discovered set agree.
    const tracked = listTrackedCliTests(CLI_ROOT);
    const discovered = discoverTestFiles(CLI_ROOT);
    expect(findUndiscoveredTestFiles(tracked, discovered)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC1: a tracked test file OUTSIDE the runner's TEST_ROOTS fails the guard
// ---------------------------------------------------------------------------

describe('rogue test file outside TEST_ROOTS fails (AC1)', () => {
  it('FAILS and names the rogue file in stderr', async () => {
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write(ROGUE_TEST_PATH, "import { it } from 'bun:test';\n");
      commitAll(root, 'add rogue');
      return runGuard(['--root', root]);
    });
    expect(code).toBe(1);
    expect(stderr).toContain('cli-test-discovery guard FAILED');
    expect(stderr).toContain(ROGUE_TEST_PATH);
    // The fix message must point at TEST_ROOTS, never an exclude list.
    expect(stderr).toContain('TEST_ROOTS');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC3: duplicate discovery fails the guard
// ---------------------------------------------------------------------------

describe('duplicate discovery fails (AC3)', () => {
  it('a tracked file discovered twice is reported by the pure helper', () => {
    const tracked = ['src/a.test.ts'];
    const discovered = ['src/a.test.ts', 'src/a.test.ts'];
    expect(findDuplicateDiscoveries(discovered)).toEqual(['src/a.test.ts']);
    // And the tracked file is still "discovered" (not in the missing set)...
    expect(findUndiscoveredTestFiles(tracked, discovered)).toEqual([]);
  });

  it('a clean discovery has no duplicates', () => {
    const discovered = ['src/a.test.ts', 'test/b.spec.ts'];
    expect(findDuplicateDiscoveries(discovered)).toEqual([]);
  });

  // The guard's decision — not just the helper. `main()` is a thin shell over
  // evaluateDiscovery, so these assertions fail if the duplicate branch is ever
  // disconnected from the program. A duplicate cannot be produced through the
  // real runner (each TEST_ROOTS entry is walked once and directories are
  // de-duplicated by real path), so the decision function is the deepest level
  // at which this half of the contract can be exercised.
  it('the guard verdict REJECTS a duplicated discovery and names the path', () => {
    const verdict = evaluateDiscovery(
      ['src/a.test.ts'],
      ['src/a.test.ts', 'src/a.test.ts'],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.report).toContain('cli-test-discovery guard FAILED');
    expect(verdict.report).toContain('more than once');
    expect(verdict.report).toContain('src/a.test.ts');
  });

  it('the guard verdict REJECTS an undiscovered tracked file with the fix hint', () => {
    const verdict = evaluateDiscovery(['scripts/rogue.test.ts'], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.report).toContain('cli-test-discovery guard FAILED');
    expect(verdict.report).toContain('scripts/rogue.test.ts');
    expect(verdict.report).toContain('TEST_ROOTS');
  });

  it('reports duplicates AND missing files together in one run', () => {
    // Both halves of the contract can be broken at once; the reader should not
    // have to fix one, re-run, and only then be told about the other.
    const verdict = evaluateDiscovery(
      ['src/a.test.ts', 'scripts/rogue.test.ts'],
      ['src/a.test.ts', 'src/a.test.ts'],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.report).toContain('more than once');
    expect(verdict.report).toContain('src/a.test.ts');
    expect(verdict.report).toContain('not discovered by run-bun-tests.ts');
    expect(verdict.report).toContain('scripts/rogue.test.ts');
  });

  it('the guard verdict ACCEPTS a fully covered, duplicate-free set', () => {
    const verdict = evaluateDiscovery(
      ['src/a.test.ts'],
      ['src/a.test.ts', 'src/local-scratch.test.ts'],
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.report).toContain('cli-test-discovery guard PASSED');
    // Reports both counts: 1 tracked, 2 discovered.
    expect(verdict.report).toContain('all 1 tracked');
    expect(verdict.report).toContain('returned 2');
  });
});

// ---------------------------------------------------------------------------
// Git-oracle boundaries documented in the plan
// ---------------------------------------------------------------------------

describe('git oracle boundaries', () => {
  it('an UNTRACKED test file outside TEST_ROOTS does not fail the guard', async () => {
    // A developer's uncommitted scratch file is not part of the repo and CI
    // never sees it, so it must not break their local run.
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      commitAll(root, 'baseline');
      write(ROGUE_TEST_PATH, STUB_TEST_SOURCE);
      return runGuard(['--root', root]);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('cli-test-discovery guard PASSED');
  }, 30_000);

  it('a TRACKED test file deleted from disk fails closed', async () => {
    // Inside a real test root, so being outside TEST_ROOTS cannot be the cause:
    // the index still claims the file exists but the runner cannot find it.
    // Failing here is correct — the repo and the run disagree.
    const deletedPath = 'src/vanished.test.ts';
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write(deletedPath, STUB_TEST_SOURCE);
      commitAll(root, 'add then delete');
      rmSync(join(root, deletedPath));
      return runGuard(['--root', root]);
    });
    expect(code).toBe(1);
    expect(stderr).toContain(deletedPath);
  }, 30_000);

  it('rejects an unknown argument instead of silently checking the real repo', async () => {
    const { code, stderr } = await runGuard(['--rot', '/tmp/nowhere']);
    expect(code).toBe(1);
    expect(stderr).toContain('unknown argument');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC4: the guard's pattern is genuinely independent of the runner
// ---------------------------------------------------------------------------

describe('pattern independence (AC4)', () => {
  it('the guard classifies a .bun.ts file without deferring to the runner', () => {
    // The guard's OWN pattern must recognise every convention the runner does.
    expect(CLI_TEST_FILE_PATTERN.test('foo.bun.ts')).toBe(true);
    expect(CLI_TEST_FILE_PATTERN.test('foo.bun.tsx')).toBe(true);
    expect(CLI_TEST_FILE_PATTERN.test('foo.test.ts')).toBe(true);
    expect(CLI_TEST_FILE_PATTERN.test('foo.spec.tsx')).toBe(true);
  });

  it('rejects non-test files', () => {
    expect(CLI_TEST_FILE_PATTERN.test('config.ts')).toBe(false);
    expect(CLI_TEST_FILE_PATTERN.test('README.md')).toBe(false);
  });

  it('a tracked .bun.ts file outside TEST_ROOTS is reported (no runner help)', async () => {
    // The guard nominates this candidate from its own pattern; the runner never
    // reaches it because it is outside the roots. So the guard fails.
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write(ROGUE_BUN_PATH, "import { it } from 'bun:test';\n");
      commitAll(root, 'add rogue bun');
      return runGuard(['--root', root]);
    });
    expect(code).toBe(1);
    expect(stderr).toContain(ROGUE_BUN_PATH);
  }, 30_000);

  it('detects drift if the runner stops recognising a convention the guard knows', async () => {
    // A `.bun.ts` file INSIDE a real test root must pass today, because the
    // runner's TEST_FILE_PATTERN still matches `.bun`. This is the drift
    // detector for AC4: if someone narrows the runner's pattern, the guard
    // still nominates this file as a candidate (its own pattern is unchanged)
    // but the runner no longer discovers it, so this test flips to failing
    // instead of both sides silently shrinking together.
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      write('src/convention.bun.ts', "import { it } from 'bun:test';\n");
      commitAll(root, 'add bun-suffixed suite inside a test root');
      return runGuard(['--root', root]);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('cli-test-discovery guard PASSED');
  }, 30_000);
});
