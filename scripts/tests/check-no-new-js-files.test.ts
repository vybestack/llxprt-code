/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-no-new-js-files.ts (issue #2745).
 *
 * Coverage:
 *  1. Pure comparison logic — findUnallowedJsFiles / findStaleAllowlistEntries
 *     classify tracked-vs-allowlist membership and stale entries without git
 *     or the filesystem.
 *  2. End-to-end against the REAL repo — the guard must pass today (every
 *     tracked JS/MJS file is in the committed baseline), the baseline is not
 *     stale, and .cjs files are never queried.
 *  3. Against a temp git repo — adding a new .js or .mjs file FAILS with the
 *     exact acceptance-criteria message, while a .cjs file does not.
 *
 * No mock theater: tests invoke the real guard script (pure helpers are
 * imported directly) and the real git via a temp repo, per RULES.md.
 */

import { execFile, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  findStaleAllowlistEntries,
  findUnallowedJsFiles,
} from '../check-no-new-js-files.ts';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-no-new-js-files.ts');
const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts', 'no-new-js-allowlist.json');
const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

// Path used by the temp-git-repo negative test; the expected guard message is
// derived from it so the assertion stays in sync if the path changes.
const ROGUE_JS_PATH = 'scripts/new-rogue.js';
const EXPECTED_MESSAGE_START = `New JS file detected: ${ROGUE_JS_PATH}. All new files must be TypeScript (.ts).`;

// Fail fast with a descriptive error if bun is missing, rather than a cryptic
// ENOENT deep in a child-process spawn later in the test run.
try {
  execFileSync(RUNTIME, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
} catch {
  throw new Error(
    `[no-new-js] Runtime "${RUNTIME}" not found. Set BUN_EXECUTABLE or install bun.`,
  );
}

interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the guard against an arbitrary root/allowlist via the real script.
 * Mirrors the legacy-paths-guard async-run helper (no mock theater).
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
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as {
      code?: number;
      signal?: string;
      message: string;
      stdout?: string;
      stderr?: string;
    };
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
  readonly allowlistPath: string;
  /** Write a file under the temp repo, creating parent dirs as needed. */
  write(relPath: string, content: string): void;
}

/**
 * Build a temp git repo with a baseline allowlist and an initial tracked .js
 * file, then hand it to a test. Surfaces both fn and cleanup failures
 * (mirrors the legacy-paths guard helper contract).
 */
async function withTempGitRepo(
  fn: (repo: TempRepo) => Promise<ScriptResult>,
): Promise<ScriptResult> {
  const root = mkdtempSync(join(tmpdir(), 'no-new-js-'));
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

    // Seed the baseline: one pre-existing tracked .js file in the allowlist.
    write('scripts/existing.js', '// pre-existing\n');
    const baseline = { files: ['scripts/existing.js'] };
    const allowlistPath = join(root, 'scripts', 'no-new-js-allowlist.json');
    writeFileSync(allowlistPath, `${JSON.stringify(baseline, null, 2)}\n`);
    execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    execFileSync('git', ['commit', '-q', '-m', 'baseline'], {
      cwd: root,
      encoding: 'utf8',
    });
    result = await fn({ root, allowlistPath, write });
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
      `[no-new-js] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
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

// ---------------------------------------------------------------------------
// Pure comparison logic
// ---------------------------------------------------------------------------

describe('findUnallowedJsFiles', () => {
  it('returns files present in tracked set but missing from allowlist', () => {
    const tracked = ['scripts/a.js', 'scripts/b.js', 'scripts/c.js'];
    const allowlist = new Set(['scripts/a.js']);
    expect(findUnallowedJsFiles(tracked, allowlist)).toEqual([
      'scripts/b.js',
      'scripts/c.js',
    ]);
  });

  it('returns an empty array when every tracked file is allowlisted', () => {
    const tracked = ['scripts/a.js', 'scripts/b.js'];
    const allowlist = new Set(tracked);
    expect(findUnallowedJsFiles(tracked, allowlist)).toEqual([]);
  });

  it('returns an empty array when nothing is tracked', () => {
    expect(findUnallowedJsFiles([], new Set())).toEqual([]);
  });

  it('flags .mjs files that are not allowlisted', () => {
    const tracked = ['scripts/x.mjs'];
    expect(findUnallowedJsFiles(tracked, new Set())).toEqual(['scripts/x.mjs']);
  });

  it('normalizes backslash paths to POSIX before comparison', () => {
    const tracked = ['scripts\\sub\\a.js'];
    const allowlist = new Set(['scripts/sub/a.js']);
    expect(findUnallowedJsFiles(tracked, allowlist)).toEqual([]);
  });

  it('returns results sorted by POSIX path', () => {
    const tracked = ['scripts/zzz.js', 'scripts/aaa.js', 'scripts/mmm.js'];
    expect(findUnallowedJsFiles(tracked, new Set())).toEqual([
      'scripts/aaa.js',
      'scripts/mmm.js',
      'scripts/zzz.js',
    ]);
  });
});

describe('findStaleAllowlistEntries', () => {
  it('returns allowlist entries no longer tracked', () => {
    const tracked = ['scripts/a.js'];
    const allowlist = ['scripts/a.js', 'scripts/deleted.js'];
    expect(findStaleAllowlistEntries(tracked, allowlist)).toEqual([
      'scripts/deleted.js',
    ]);
  });

  it('returns an empty array when every allowlisted file is tracked', () => {
    const tracked = ['scripts/a.js', 'scripts/b.js'];
    const allowlist = ['scripts/a.js', 'scripts/b.js'];
    expect(findStaleAllowlistEntries(tracked, allowlist)).toEqual([]);
  });

  it('returns results sorted', () => {
    const tracked: string[] = [];
    const allowlist = ['scripts/zzz.js', 'scripts/aaa.js'];
    expect(findStaleAllowlistEntries(tracked, allowlist)).toEqual([
      'scripts/aaa.js',
      'scripts/zzz.js',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Real repository (current state must be clean and in sync)
// ---------------------------------------------------------------------------

function loadCommittedAllowlist(): string[] {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as {
    files: unknown;
  };
  expect(Array.isArray(raw.files)).toBe(true);
  return raw.files as string[];
}

/** POSIX-path comparator matching the guard's sortPosix (localeCompare). */
const posixSort = (a: string, b: string): number => {
  const pa = a.split('\\').join('/');
  const pb = b.split('\\').join('/');
  // Fixed 'en' locale for deterministic ordering across environments.
  return pa.localeCompare(pb, 'en');
};

function listTrackedJs(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.startsWith('node_modules/'));
  return files.sort(posixSort);
}

describe('real repository state', () => {
  it('the guard PASSES against the real repo (B1, B8)', async () => {
    const { code, stdout } = await runGuard([]);
    expect(code).toBe(0);
    expect(stdout).toContain('no-new-js guard PASSED');
  }, 30_000);

  it('the committed allowlist matches the current tracked JS/MJS set (B5)', () => {
    const tracked = listTrackedJs(REPO_ROOT);
    const committed = [...loadCommittedAllowlist()].sort(posixSort);
    expect(tracked).toEqual(committed);
  });

  it('the committed allowlist is not stale (no removed-file entries)', async () => {
    const { stdout } = await runGuard([]);
    expect(stdout).not.toContain('stale allowlist');
  }, 30_000);

  it('the allowlist never contains a .cjs path (CJS is exempt)', () => {
    const committed = loadCommittedAllowlist();
    expect(committed.some((f) => f.endsWith('.cjs'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// --update regenerates the baseline deterministically (B6)
// ---------------------------------------------------------------------------

describe('--update regenerates the baseline', () => {
  it('writes a sorted, deduplicated allowlist from tracked files', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'no-new-js-update-'));
    const tmpAllow = join(tmpDir, 'allowlist.json');
    try {
      const { code, stdout } = await runGuard([
        '--update',
        '--allowlist',
        tmpAllow,
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain('wrote');
      const written = JSON.parse(readFileSync(tmpAllow, 'utf8')) as {
        files: string[];
      };
      const tracked = listTrackedJs(REPO_ROOT);
      expect(written.files).toEqual(tracked);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// New .js / .mjs files FAIL (B2, B3); .cjs is never flagged (B4)
// ---------------------------------------------------------------------------

describe('new JS files fail the guard', () => {
  it('FAILS a new tracked .js file not in the allowlist (B2)', async () => {
    const { code, stderr } = await withTempGitRepo(
      async ({ root, allowlistPath, write }) => {
        write(ROGUE_JS_PATH, '// rogue\n');
        execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
        execFileSync('git', ['commit', '-q', '-m', 'add rogue'], {
          cwd: root,
          encoding: 'utf8',
        });
        return runGuard(['--root', root, '--allowlist', allowlistPath]);
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('no-new-js guard FAILED');
    expect(stderr).toContain(EXPECTED_MESSAGE_START);
  }, 30_000);

  it('FAILS a new tracked .mjs file not in the allowlist (B3)', async () => {
    const { code, stderr } = await withTempGitRepo(
      async ({ root, allowlistPath, write }) => {
        write('scripts/new-rogue.mjs', '// rogue\n');
        execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
        execFileSync('git', ['commit', '-q', '-m', 'add rogue mjs'], {
          cwd: root,
          encoding: 'utf8',
        });
        return runGuard(['--root', root, '--allowlist', allowlistPath]);
      },
    );
    expect(code).toBe(1);
    expect(stderr).toContain('new-rogue.mjs');
    expect(stderr).toContain('must be TypeScript (.ts)');
  }, 30_000);

  it('does NOT flag a new tracked .cjs file (B4)', async () => {
    const { code, stdout } = await withTempGitRepo(
      async ({ root, allowlistPath, write }) => {
        write('scripts/lifecycle.cjs', '// lifecycle script\n');
        execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
        execFileSync('git', ['commit', '-q', '-m', 'add cjs'], {
          cwd: root,
          encoding: 'utf8',
        });
        return runGuard(['--root', root, '--allowlist', allowlistPath]);
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain('no-new-js guard PASSED');
    expect(stdout).not.toContain('lifecycle.cjs');
  }, 30_000);

  it('passes a new tracked .ts file (new code must be TypeScript)', async () => {
    const { code, stdout } = await withTempGitRepo(
      async ({ root, allowlistPath, write }) => {
        write('scripts/new-script.ts', 'export const x = 1;\n');
        execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
        execFileSync('git', ['commit', '-q', '-m', 'add ts'], {
          cwd: root,
          encoding: 'utf8',
        });
        return runGuard(['--root', root, '--allowlist', allowlistPath]);
      },
    );
    expect(code).toBe(0);
    expect(stdout).toContain('no-new-js guard PASSED');
  }, 30_000);
});
