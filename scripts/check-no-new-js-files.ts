#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-no-new-js-files.ts
 *
 * Issue #2745 — repo-wide guard against newly added `.js`/`.mjs` files.
 *
 * The repo underwent a deliberate port to TypeScript + Bun, with strict lint
 * and complexity rules tuned for `.ts`. Plain `.js`/`.mjs` files bypass
 * TypeScript type checking, skip `@typescript-eslint` complexity/typing rules,
 * and evade the `tsconfig.scripts.json` include gate. This guard fails CI when
 * a tracked `.js`/`.mjs` file exists that is not in the committed baseline
 * allowlist — pinning the current JS surface so every new file must be `.ts`.
 *
 * Design:
 *   - **Tracked files only.** Uses `git ls-files` so untracked/generated files
 *     never produce a false positive (and `node_modules` is never tracked).
 *   - **`.cjs` is exempt.** Lifecycle scripts (`preinstall.cjs`, etc.) must
 *     remain CommonJS to run during npm/bun hooks before any build step. The
 *     constraint is `.js`/`.mjs` escape-hatching, not CJS.
 *   - **Baseline + ratchet.** The committed allowlist pins every pre-existing
 *     JS/MJS file. The guard only fails on a file NOT in the baseline. Removing
 *     a file never fails (the allowlist may go stale, reported informationally).
 *
 * Allowlist: `scripts/no-new-js-allowlist.json` — a JSON object with a `files`
 * array of repo-relative paths. Regenerate with `--update`.
 *
 * Usage:
 *   scripts/check-no-new-js-files.ts              # enforce (CI)
 *   scripts/check-no-new-js-files.ts --update     # regenerate baseline
 *   scripts/check-no-new-js-files.ts --root <dir> # override repo root (tests)
 *   scripts/check-no-new-js-files.ts --allowlist <path> # override baseline (tests)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_ALLOWLIST_PATH = join(__dirname, 'no-new-js-allowlist.json');

// ─── Types ──────────────────────────────────────────────────────────────────

interface Allowlist {
  readonly files: readonly string[];
}

interface ParsedArgs {
  readonly update: boolean;
  readonly root: string;
  readonly allowlistPath: string;
}

// ─── Args ───────────────────────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): ParsedArgs {
  const update = argv.includes('--update') || argv.includes('--regenerate');
  let root = DEFAULT_REPO_ROOT;
  let allowlistPath = DEFAULT_ALLOWLIST_PATH;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      root = resolve(argv[++i] ?? '');
    } else if (a === '--allowlist') {
      allowlistPath = resolve(argv[++i] ?? '');
    }
  }
  return { update, root, allowlistPath };
}

// ─── Git interaction ────────────────────────────────────────────────────────

/**
 * List tracked `.js` and `.mjs` files under `repoRoot`, excluding
 * `node_modules`. Returns repo-relative POSIX paths, sorted.
 *
 * `git ls-files` is the source of truth for what is committed: untracked and
 * generated files are never reported, and `node_modules` is excluded defensively
 * (it is gitignored and not tracked, but the exclude keeps the output stable
 * even in unusual checkouts).
 */
function listTrackedJsFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const files = out
    .split('\0')
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && !f.startsWith('node_modules/'));
  return sortPosix(files);
}

// ─── Allowlist I/O ──────────────────────────────────────────────────────────

function loadAllowlist(path: string): Allowlist {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot read allowlist ${path}: ${msg}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot parse allowlist JSON: ${msg}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error(
      `Allowlist ${path} must be a JSON object with a "files" array.`,
    );
  }
  const files = (parsed as { files: unknown[] }).files;
  for (const f of files) {
    if (typeof f !== 'string') {
      throw new Error(
        `Allowlist ${path}: every entry in "files" must be a string.`,
      );
    }
  }
  return { files: files as string[] };
}

/**
 * Build the allowlist object from the current tracked JS/MJS set, sorted and
 * de-duplicated for deterministic output.
 */
function buildAllowlistObject(trackedFiles: readonly string[]): Allowlist {
  return { files: sortPosix([...new Set(trackedFiles)]) };
}

function writeAllowlist(path: string, allowlist: Allowlist): void {
  const json = JSON.stringify(allowlist, null, 2) + '\n';
  writeFileSync(path, json, 'utf8');
}

// ─── Pure comparison logic (exported for unit tests) ────────────────────────

/**
 * Returns the tracked JS/MJS files that are NOT covered by the allowlist.
 *
 * A file is covered when its POSIX-normalized path appears in the allowlist
 * set. This is the single decision function the guard enforces; it is pure so
 * it can be unit-tested without git or the filesystem.
 */
export function findUnallowedJsFiles(
  trackedJsFiles: readonly string[],
  allowlistedFiles: ReadonlySet<string>,
): string[] {
  const violations: string[] = [];
  for (const f of trackedJsFiles) {
    const normalized = toPosix(f);
    if (!allowlistedFiles.has(normalized)) {
      violations.push(normalized);
    }
  }
  return sortPosix(violations);
}

/**
 * Returns allowlist entries whose path is not currently tracked. These are
 * stale (a JS file was removed/renamed) and reported informationally so the
 * baseline can be pruned, but they never fail the guard: the constraint is
 * "no NEW JS files", and a shrinking JS surface is the desired direction.
 */
export function findStaleAllowlistEntries(
  trackedJsFiles: readonly string[],
  allowlistedFiles: readonly string[],
): string[] {
  const tracked = new Set(trackedJsFiles.map(toPosix));
  const stale: string[] = [];
  for (const f of allowlistedFiles) {
    const normalized = toPosix(f);
    if (!tracked.has(normalized)) {
      stale.push(normalized);
    }
  }
  return sortPosix(stale);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function sortPosix(files: readonly string[]): string[] {
  // Fixed 'en' locale for deterministic ordering across environments
  // (developer machines vs CI with different LANG/LC_ALL settings).
  return [...files].sort((a, b) => toPosix(a).localeCompare(toPosix(b), 'en'));
}

const VIOLATION_MESSAGE =
  'New JS file detected: %s. All new files must be TypeScript (.ts). ' +
  'If this is a legitimate exception, add it to ' +
  'scripts/no-new-js-allowlist.json with a justification.';

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const trackedFiles = listTrackedJsFiles(args.root);

  // --update regenerates the baseline from the current tracked set, then exits.
  if (args.update) {
    const allowlist = buildAllowlistObject(trackedFiles);
    writeAllowlist(args.allowlistPath, allowlist);
    console.log(
      `no-new-js guard: wrote ${allowlist.files.length} files to ` +
        relativeToCwd(args.allowlistPath),
    );
    process.exit(EXIT_PASS);
  }

  const allowlist = loadAllowlist(args.allowlistPath);
  const allowlistSet = new Set(allowlist.files.map(toPosix));

  const violations = findUnallowedJsFiles(trackedFiles, allowlistSet);
  const stale = findStaleAllowlistEntries(trackedFiles, allowlist.files);

  if (stale.length > 0) {
    console.log(
      `\nno-new-js guard: ${stale.length} stale allowlist entr${stale.length === 1 ? 'y' : 'ies'} ` +
        `(JS file no longer tracked — safe to prune with --update):`,
    );
    for (const s of stale) console.log(`  ${s}`);
  }

  if (violations.length === 0) {
    console.log(
      `no-new-js guard PASSED: ${allowlist.files.length} JS/MJS files allowlisted, ` +
        `${trackedFiles.length} tracked.`,
    );
    process.exit(EXIT_PASS);
  }

  console.error(
    `\nno-new-js guard FAILED: ${violations.length} new JS/MJS file${violations.length === 1 ? '' : 's'} detected:\n`,
  );
  for (const v of violations) {
    console.error('  ' + VIOLATION_MESSAGE.replace('%s', v));
  }
  console.error(
    '\nTo migrate an existing file, rename it to .ts and run ' +
      '`scripts/check-no-new-js-files.ts --update`.\n' +
      'All new files must be TypeScript (.ts).',
  );
  process.exit(EXIT_FAIL);
}

function relativeToCwd(p: string): string {
  const cwd = process.cwd();
  const posix = toPosix(p);
  const posixCwd = toPosix(cwd);
  if (posix.startsWith(posixCwd + '/')) {
    return posix.slice(posixCwd.length + 1);
  }
  return posix;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
