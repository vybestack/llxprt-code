/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-copyright-year.ts (issue #2820).
 *
 * Coverage:
 *  1. Pure logic — extractCopyrightYear, parseAddedFilesFromDiff, and
 *     checkCopyrightYears classify year correctness without git or filesystem.
 *  2. End-to-end against a REAL temp git repo — adding a file with a stale
 *     copyright year FAILS, a correct year PASSES, no-header PASSES, and a
 *     modified file is ignored.
 *
 * No mock theater: tests invoke the real guard script via a temp git repo,
 * per RULES.md. Pure helpers are imported and tested directly.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkCopyrightYears,
  extractCopyrightYear,
  parseAddedFilesFromDiff,
} from '../check-copyright-year.ts';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-copyright-year.ts');
const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

// Fail fast if bun is missing rather than a cryptic ENOENT later.
try {
  execFileSync(RUNTIME, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
} catch {
  throw new Error(
    `[copyright-year] Runtime "${RUNTIME}" not found. Set BUN_EXECUTABLE or install bun.`,
  );
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const PREVIOUS_YEAR = CURRENT_YEAR - 1;

const VYBESTACK_HEADER_2026 = [
  '/**',
  ' * @license',
  ` * Copyright ${CURRENT_YEAR} Vybestack LLC`,
  ' * SPDX-License-Identifier: Apache-2.0',
  ' */',
  '',
  'export const x = 1;',
].join('\n');

const VYBESTACK_HEADER_2025 = VYBESTACK_HEADER_2026.replace(
  `Copyright ${CURRENT_YEAR}`,
  `Copyright ${PREVIOUS_YEAR}`,
);

const GOOGLE_HEADER_2026 = [
  '/**',
  ' * @license',
  ` * Copyright ${CURRENT_YEAR} Google LLC`,
  ' * SPDX-License-Identifier: Apache-2.0',
  ' */',
  '',
  'export const x = 1;',
].join('\n');

const GOOGLE_HEADER_2025 = GOOGLE_HEADER_2026.replace(
  `Copyright ${CURRENT_YEAR}`,
  `Copyright ${PREVIOUS_YEAR}`,
);

interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface TempRepo {
  readonly root: string;
  /** Write a file under the temp repo, creating parent dirs as needed. */
  write(relPath: string, content: string | Buffer): void;
}

/**
 * Run the guard script against a temp fixture root via the real script.
 * Uses `--base HEAD~1` so the diff captures only files added in the
 * test's second commit (the temp repo has no `origin/main`).
 */
async function runGuard(
  root: string,
  options: { timeout?: number } = {},
): Promise<ScriptResult> {
  const timeout = options.timeout ?? 30_000;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      RUNTIME,
      [SCRIPT, '--base', 'HEAD~1', '--head', 'HEAD'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
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

/**
 * Build a temp git repo with an initial commit, then run `fn` which adds
 * files and commits them before running the guard against the diff.
 *
 * Surfaces BOTH fn and cleanup failures (mirrors the no-new-js and
 * legacy-paths guard helper contracts).
 */
async function withTempGitRepo(
  fn: (repo: TempRepo) => Promise<ScriptResult>,
): Promise<ScriptResult> {
  const root = mkdtempSync(join(tmpdir(), 'copyright-year-'));
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

    const write = (relPath: string, content: string | Buffer): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };

    // Seed with a baseline commit so the diff has a base to compare against.
    write('README.md', '# baseline\n');
    execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    execFileSync('git', ['commit', '-q', '-m', 'baseline'], {
      cwd: root,
      encoding: 'utf8',
    });

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
      `[copyright-year] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
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
// Pure logic: extractCopyrightYear
// ---------------------------------------------------------------------------

describe('extractCopyrightYear', () => {
  it('extracts the year from a Vybestack header', () => {
    expect(extractCopyrightYear(VYBESTACK_HEADER_2026)).toBe(CURRENT_YEAR);
  });

  it('extracts the year from a Google LLC header', () => {
    expect(extractCopyrightYear(GOOGLE_HEADER_2026)).toBe(CURRENT_YEAR);
  });

  it('extracts a historical year', () => {
    expect(extractCopyrightYear(VYBESTACK_HEADER_2025)).toBe(PREVIOUS_YEAR);
  });

  it('returns null when there is no copyright header', () => {
    expect(extractCopyrightYear('export const x = 1;\n')).toBeNull();
  });

  it('returns null when the copyright line does not match Vybestack/Google LLC', () => {
    const content = ['/**', ' * Copyright 2025 Some Other Company', ' */'].join(
      '\n',
    );
    expect(extractCopyrightYear(content)).toBeNull();
  });

  it('finds the header within the first 10 lines', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `// line ${i + 1}`);
    lines.push(` * Copyright ${CURRENT_YEAR} Vybestack LLC`);
    expect(extractCopyrightYear(lines.join('\n'))).toBe(CURRENT_YEAR);
  });

  it('does not match a copyright header past line 10', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`);
    lines.push(` * Copyright ${CURRENT_YEAR} Vybestack LLC`);
    expect(extractCopyrightYear(lines.join('\n'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure logic: parseAddedFilesFromDiff
// ---------------------------------------------------------------------------

describe('parseAddedFilesFromDiff', () => {
  it('identifies a newly added file via "new file mode"', () => {
    const diff = [
      'diff --git a/scripts/new.ts b/scripts/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/scripts/new.ts',
      '@@ -0,0 +1,1 @@',
      '+export const x = 1;',
    ].join('\n');
    expect(parseAddedFilesFromDiff(diff)).toEqual(['scripts/new.ts']);
  });

  it('identifies an added file via "--- /dev/null" without mode line', () => {
    const diff = [
      'diff --git a/scripts/new.ts b/scripts/new.ts',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/scripts/new.ts',
      '@@ -0,0 +1,1 @@',
      '+export const x = 1;',
    ].join('\n');
    expect(parseAddedFilesFromDiff(diff)).toEqual(['scripts/new.ts']);
  });

  it('excludes modified files', () => {
    const diff = [
      'diff --git a/scripts/existing.ts b/scripts/existing.ts',
      'index 1111111..2222222 100644',
      '--- a/scripts/existing.ts',
      '+++ b/scripts/existing.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parseAddedFilesFromDiff(diff)).toEqual([]);
  });

  it('handles multiple added files', () => {
    const diff = [
      'diff --git a/scripts/a.ts b/scripts/a.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/scripts/a.ts',
      '@@ -0,0 +1,1 @@',
      '+a',
      'diff --git a/scripts/b.ts b/scripts/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/scripts/b.ts',
      '@@ -0,0 +1,1 @@',
      '+b',
    ].join('\n');
    expect(parseAddedFilesFromDiff(diff)).toEqual([
      'scripts/a.ts',
      'scripts/b.ts',
    ]);
  });

  it('handles a mixed diff with both added and modified files', () => {
    const diff = [
      'diff --git a/scripts/existing.ts b/scripts/existing.ts',
      'index 1111111..2222222 100644',
      '--- a/scripts/existing.ts',
      '+++ b/scripts/existing.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      'diff --git a/scripts/new.ts b/scripts/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/scripts/new.ts',
      '@@ -0,0 +1,1 @@',
      '+new',
    ].join('\n');
    expect(parseAddedFilesFromDiff(diff)).toEqual(['scripts/new.ts']);
  });

  it('returns an empty array for an empty diff', () => {
    expect(parseAddedFilesFromDiff('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure logic: checkCopyrightYears
// ---------------------------------------------------------------------------

describe('checkCopyrightYears', () => {
  it('reports a violation for a stale Vybestack year', () => {
    const violations = checkCopyrightYears(
      [{ path: 'scripts/new.ts', content: VYBESTACK_HEADER_2025 }],
      CURRENT_YEAR,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      file: 'scripts/new.ts',
      year: PREVIOUS_YEAR,
      expectedYear: CURRENT_YEAR,
    });
  });

  it('reports a violation for a stale Google LLC year', () => {
    const violations = checkCopyrightYears(
      [{ path: 'scripts/new.ts', content: GOOGLE_HEADER_2025 }],
      CURRENT_YEAR,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].year).toBe(PREVIOUS_YEAR);
  });

  it('passes a correct Vybestack year', () => {
    expect(
      checkCopyrightYears(
        [{ path: 'scripts/new.ts', content: VYBESTACK_HEADER_2026 }],
        CURRENT_YEAR,
      ),
    ).toEqual([]);
  });

  it('passes a correct Google LLC year', () => {
    expect(
      checkCopyrightYears(
        [{ path: 'scripts/new.ts', content: GOOGLE_HEADER_2026 }],
        CURRENT_YEAR,
      ),
    ).toEqual([]);
  });

  it('ignores files with no copyright header', () => {
    expect(
      checkCopyrightYears(
        [{ path: 'scripts/new.ts', content: 'export const x = 1;\n' }],
        CURRENT_YEAR,
      ),
    ).toEqual([]);
  });

  it('sorts violations by file path', () => {
    const violations = checkCopyrightYears(
      [
        { path: 'scripts/zzz.ts', content: VYBESTACK_HEADER_2025 },
        { path: 'scripts/aaa.ts', content: VYBESTACK_HEADER_2025 },
      ],
      CURRENT_YEAR,
    );
    expect(violations.map((v) => v.file)).toEqual([
      'scripts/aaa.ts',
      'scripts/zzz.ts',
    ]);
  });

  it('returns no violations for an empty file list', () => {
    expect(checkCopyrightYears([], CURRENT_YEAR)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end against a REAL temp git repo
// ---------------------------------------------------------------------------

describe('end-to-end guard behavior (temp git repo)', () => {
  it('FAILS an added file with a stale Vybestack year (B1)', async () => {
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/new.ts', VYBESTACK_HEADER_2025);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add stale'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(1);
    expect(stderr).toContain('copyright-year guard FAILED');
    expect(stderr).toContain('scripts/new.ts');
    expect(stderr).toContain(String(PREVIOUS_YEAR));
    expect(stderr).toContain(String(CURRENT_YEAR));
  }, 30_000);

  it('PASSES an added file with the correct Vybestack year (B2)', async () => {
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/new.ts', VYBESTACK_HEADER_2026);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add correct'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('copyright-year guard passed');
  }, 30_000);

  it('PASSES an added file with no copyright header (B3)', async () => {
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/no-header.ts', 'export const x = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add no header'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('copyright-year guard passed');
  }, 30_000);

  it('ignores a modified file with a stale year (B4)', async () => {
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      // Baseline: a file with a stale year committed in the first commit.
      write('scripts/existing.ts', VYBESTACK_HEADER_2025);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add stale baseline'], {
        cwd: root,
        encoding: 'utf8',
      });
      // Modify the file (still stale year, but not a new file).
      write('scripts/existing.ts', VYBESTACK_HEADER_2025 + '\n// changed\n');
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'modify existing'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('copyright-year guard passed');
  }, 30_000);

  it('FAILS an added file with a stale Google LLC year (B5)', async () => {
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/new.ts', GOOGLE_HEADER_2025);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add stale google'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(1);
    expect(stderr).toContain('copyright-year guard FAILED');
    expect(stderr).toContain('scripts/new.ts');
  }, 30_000);

  it('PASSES an added file with the correct Google LLC year (B6)', async () => {
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/new.ts', GOOGLE_HEADER_2026);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add correct google'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('copyright-year guard passed');
  }, 30_000);

  it('does not crash on an added binary file (B7)', async () => {
    // Write a fake "binary" file (a PNG-like header) and commit it.
    const { code, stdout } = await withTempGitRepo(async ({ root, write }) => {
      // Minimal PNG-like bytes
      write('assets/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add png'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(0);
    expect(stdout).toContain('copyright-year guard passed');
  }, 30_000);

  it('reports multiple violations sorted by path', async () => {
    const { code, stderr } = await withTempGitRepo(async ({ root, write }) => {
      write('scripts/zzz.ts', VYBESTACK_HEADER_2025);
      write('scripts/aaa.ts', VYBESTACK_HEADER_2025);
      execFileSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
      execFileSync('git', ['commit', '-q', '-m', 'add two stale'], {
        cwd: root,
        encoding: 'utf8',
      });
      return runGuard(root);
    });
    expect(code).toBe(1);
    const zzzIdx = stderr.indexOf('scripts/zzz.ts');
    const aaaIdx = stderr.indexOf('scripts/aaa.ts');
    expect(zzzIdx).toBeGreaterThan(-1);
    expect(aaaIdx).toBeGreaterThan(-1);
    expect(aaaIdx).toBeLessThan(zzzIdx);
  }, 30_000);
});
