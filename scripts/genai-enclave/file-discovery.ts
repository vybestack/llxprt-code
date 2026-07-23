/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * File-discovery module for the genai-enclave boundary guard.
 *
 * Architectural rationale (issue #2352 / #2606):
 *
 * The guard must scan every scannable source file under `packages/` so that
 * a `@google/genai` import cannot be smuggled past CI. Discovery combines
 * two git signals:
 *
 * 1. `git ls-files` — all tracked scannable files. This includes files that
 *    have been committed but are currently DELETED from the working tree or
 *    index (status ` D` / `D `). Reading such a path fails with ENOENT.
 *
 * 2. `git status --porcelain --untracked-files=all` — untracked non-ignored
 *    files (`??`) that exist on disk but are not yet committed, plus the
 *    deletion markers above.
 *
 * To avoid treating an intentionally-deleted tracked file as an operational
 * read error (TOCTOU / fail-closed false-positive), discovery must EXCLUDE
 * paths that git reports as deleted (staged `D` or unstaged ` D`) before
 * handing the file list to the scanner. This keeps the fail-closed behavior
 * intact for genuinely unexpected read failures: a path that is NOT marked
 * deleted but still fails to read remains a hard error.
 *
 * The module is split into pure, testable functions so behavioral tests can
 * drive real temporary git repositories through the same code path the guard
 * uses at runtime (no mock theater).
 */

import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

/** A scannable source extension (TS + JS variants). */
const SCANNABLE_FILE_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i;

/**
 * Glob-style pathspecs passed to `git ls-files` to enumerate tracked
 * scannable files under `packages/`.
 */
const SCANNABLE_TRACKED_PATHSPECS: readonly string[] = [
  'packages/**/*.ts',
  'packages/**/*.tsx',
  'packages/**/*.mts',
  'packages/**/*.cts',
  'packages/**/*.js',
  'packages/**/*.jsx',
  'packages/**/*.mjs',
  'packages/**/*.cjs',
];

export interface OperationalError {
  readonly message: string;
}

export interface DiscoveredFiles {
  /** Absolute, deduplicated, deletion-filtered scannable file paths. */
  readonly files: readonly string[];
  /** Operational errors encountered during discovery (fail-closed). */
  readonly errors: readonly OperationalError[];
}

function isScannableFile(relPath: string): boolean {
  return SCANNABLE_FILE_RE.test(relPath);
}

export function rel(repoRoot: string, filePath: string): string {
  return relative(repoRoot, filePath).replace(/\\/g, '/');
}

/**
 * Deduplicate an array of paths, preserving first-seen order. Tracked +
 * untracked git outputs can overlap (e.g. a file re-added without staging),
 * producing duplicate scan entries.
 */
export function dedupePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p);
    }
  }
  return result;
}

/**
 * Run a git command in `repoRoot` and return its stdout, or throw on failure.
 */
function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Collect the set of repo-relative paths that git reports as DELETED (either
 * staged `D ` in the index, or unstaged ` D` in the working tree). Renames
 * are out of scope for this guard because a renamed-and-modified file is
 * still scanned under its new tracked path.
 *
 * Returns paths relative to `repoRoot` using forward slashes.
 */
export function collectDeletedPaths(repoRoot: string): Set<string> {
  return collectStatusSets(repoRoot).deleted;
}

/**
 * Parse a single `git status -z` entry. Returns the status category and the
 * repo-relative path. For renames, the old path is returned as the path with
 * status `R`-derived.
 */
function parseStatusEntry(
  entry: string,
): { x: string; y: string; pathPart: string } | undefined {
  if (entry.length < 3) return undefined;
  const x = entry.charAt(0);
  const y = entry.charAt(1);
  // Path starts at index 3 ("XY <path>").
  let pathPart = entry.slice(3);
  // Renames encode "old\tnew" — only consider the old path as the
  // unreadable one if it is gone from disk; but git already represents
  // the new path under its own tracked entry. Drop the rename alt path.
  const tabIdx = pathPart.indexOf('\t');
  if (tabIdx >= 0) {
    pathPart = pathPart.slice(0, tabIdx);
  }
  // git status -z does NOT quote paths (NUL-separated), so no quote
  // stripping is needed. Stripping quotes would corrupt a literal quoted path.
  return { x, y, pathPart };
}

/**
 * Run `git status -z` once and parse both the deleted-paths set and the
 * untracked scannable list from a single output stream. This avoids a
 * duplicate subprocess spawn and a TOCTOU window between two separate calls.
 */
function collectStatusSets(repoRoot: string): {
  deleted: Set<string>;
  untracked: string[];
  error?: OperationalError;
} {
  let status: string;
  try {
    status = runGit(repoRoot, [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '-z',
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      deleted: new Set(),
      untracked: [],
      error: {
        message: `git status failed — untracked files not checked: ${msg}`,
      },
    };
  }

  const deleted = new Set<string>();
  const untracked: string[] = [];
  for (const entry of status.split('\0')) {
    const parsed = entry.length > 0 ? parseStatusEntry(entry) : undefined;
    if (parsed === undefined) {
      continue;
    }
    const { x, y, pathPart } = parsed;
    if (x === 'D' || y === 'D') {
      deleted.add(pathPart);
    }
    if (
      x === '?' &&
      y === '?' &&
      pathPart.startsWith('packages/') &&
      isScannableFile(pathPart)
    ) {
      untracked.push(pathPart);
    }
  }
  return { deleted, untracked };
}

/**
 * Enumerate tracked scannable files via `git ls-files`. Returns repo-relative
 * paths. On git failure, throws so the caller can record an operational
 * error (fail-closed).
 */
function listTrackedScannable(repoRoot: string): string[] {
  const raw = runGit(repoRoot, [
    'ls-files',
    '-z',
    ...SCANNABLE_TRACKED_PATHSPECS,
  ]);
  return raw
    .split('\0')
    .filter((p) => p.length > 0)
    .filter((p) => isScannableFile(p));
}

/**
 * Discover scannable source files under `packages/` for the genai-enclave
 * guard. Combines tracked files (`git ls-files`) with untracked non-ignored
 * files (`git status`), then EXCLUDES any path git reports as deleted
 * (staged or unstaged) so the guard does not attempt to read a file that
 * was intentionally removed from the worktree.
 *
 * Fail-closed contract: any git command failure is returned as an operational
 * error with an empty file set (or the partial set already gathered), so the
 * guard never silently passes when discovery is compromised. A genuinely
 * unexpected read failure (TOCTOU) on a non-deleted path remains a hard
 * error because the scanner still calls `readFileSync` and fails closed.
 *
 * @param repoRoot Absolute path to the repository root.
 */
export function discoverScannableFiles(repoRoot: string): DiscoveredFiles {
  const errors: OperationalError[] = [];

  // ── Tracked files ───────────────────────────────────────────────────
  let tracked: string[];
  try {
    tracked = listTrackedScannable(repoRoot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push({ message: `git ls-files failed: ${msg}` });
    return { files: [], errors };
  }

  // ── Untracked + deleted in a single git status call ────────────────
  const statusSets = collectStatusSets(repoRoot);
  if (statusSets.error !== undefined) {
    errors.push(statusSets.error);
  }
  const untracked = statusSets.untracked;
  const deleted = statusSets.deleted;

  const combined = dedupePaths([...tracked, ...untracked]).filter((p) => {
    const relPath = rel(repoRoot, join(repoRoot, p));
    return !deleted.has(relPath) && !deleted.has(p);
  });

  const files = combined.map((p) => join(repoRoot, p));
  return { files, errors };
}
