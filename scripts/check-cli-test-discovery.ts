#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * check-cli-test-discovery.ts
 *
 * Issue #2923 — guard that every tracked CLI test file is actually discovered
 * by the structural test runner.
 *
 * Background: the CLI workspace used to run under Vitest with a large
 * `baseExclude` glob list plus a separate integration-only command
 * (`SELECTED_FILE_COUNT`). Files matching either were silently never run, and
 * they drifted out of sync with the product with no signal. PR #3056 replaced
 * that setup with `packages/cli/run-bun-tests.ts`, which discovers test files
 * purely structurally — no manifest, no allow-list, no exclude-list.
 *
 * The remaining failure mode is NOT a list: it is that the runner walks a
 * hardcoded `TEST_ROOTS` list (`['src', 'test', 'test-bun', 'test-utils']`).
 * A tracked test file added anywhere else under `packages/cli` (`scripts/`,
 * `bin/`, the workspace root, or a brand-new directory) is silently never run,
 * and every existing test still passes. This guard compares the git-tracked
 * test files against the runner's `discoverTestFiles()` and fails loudly when
 * the two sets disagree — keeping structural discovery honest.
 *
 * Design (mirrors scripts/check-no-new-js-files.ts):
 *   - **Tracked files only.** `git ls-files` is the source of truth for what is
 *     committed; untracked/generated files never produce a false positive.
 *   - **Own pattern.** Candidates are classified by this guard's OWN
 *     `CLI_TEST_FILE_PATTERN`, deliberately NOT imported from the runner.
 *     Importing it would let both sides of the comparison shrink together
 *     (e.g. dropping `.bun` from the runner) and defeat the guard.
 *   - **Real runner.** The discovered set comes from the REAL
 *     `discoverTestFiles` in `packages/cli/run-bun-tests.ts`, not a copy.
 *
 * Usage:
 *   bun scripts/check-cli-test-discovery.ts              # enforce (CI)
 *   bun scripts/check-cli-test-discovery.ts --root <dir> # alternate CLI workspace (tests)
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTestFiles } from '../packages/cli/run-bun-tests.ts';

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI_ROOT = resolve(__dirname, '..', 'packages', 'cli');

/**
 * The test-file naming convention this guard looks for. This is a DELIBERATE
 * duplicate of `TEST_FILE_PATTERN` in `packages/cli/run-bun-tests.ts`. It is
 * NOT imported from there on purpose: if the runner's pattern were narrowed
 * (e.g. `.bun` dropped), importing it would make both the "candidate" side and
 * the "discovered" side shrink together, and a dropped file would silently
 * pass. Duplicating keeps the two sides independent so a narrowing fails here.
 *
 * Exported so the test suite can assert the pattern classifies candidates
 * without deferring to the runner (AC4).
 */
export const CLI_TEST_FILE_PATTERN = /\.(test|spec|bun)\.(ts|tsx)$/;

interface ParsedArgs {
  readonly root: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let root = DEFAULT_CLI_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const value = argv[++i];
      if (value === undefined) {
        failWith('--root requires a directory argument.');
      }
      root = resolve(value);
    } else {
      // Fail fast: silently ignoring an unknown flag would let a typo such as
      // `--rot /tmp/fixture` run against the default repo root and report a
      // PASS for a workspace the caller never meant to check.
      failWith(`unknown argument "${a}". Supported: --root <dir>.`);
    }
  }
  return { root };
}

/** Print an error and exit(1). Kept tiny so arg-validation stays readable. */
function failWith(message: string): never {
  console.error(`cli-test-discovery guard: ${message}`);
  process.exit(EXIT_FAIL);
}

// ─── Git interaction ────────────────────────────────────────────────────────

/**
 * List tracked test files (by the guard's own pattern) under `cliRoot`.
 * Returns POSIX paths relative to `cliRoot`, sorted.
 *
 * `git ls-files` is the source of truth for what is committed: untracked and
 * generated files are never reported. Paths are returned exactly as Git
 * reports them (POSIX, no surrounding whitespace). Git stores paths with
 * forward slashes even on Windows and the NUL-delimited `-z` output has no
 * trailing whitespace, so neither `trim()` nor backslash normalization is
 * applied — both could mask distinct filenames and let a missing file slip by.
 */
function listTrackedTestFiles(cliRoot: string): string[] {
  let out: string;
  try {
    out = execFileSync('git', ['ls-files', '-z'], {
      cwd: cliRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `cli-test-discovery guard: \`git ls-files\` failed in ${cliRoot} ` +
        `(is this a git repository and is git on PATH?): ${msg}`,
    );
  }
  const files = out
    .split('\0')
    .filter((f) => f.length > 0 && CLI_TEST_FILE_PATTERN.test(f));
  return sortPosix(files);
}

// ─── Pure comparison logic (exported for unit tests) ────────────────────────

/**
 * Returns the tracked test files that are NOT returned by the runner's
 * `discoverTestFiles()`, sorted POSIX. This is the single "every tracked test
 * is discovered" decision (the AC1 half of the contract); pure so it can be
 * unit-tested without git or the filesystem.
 */
export function findUndiscoveredTestFiles(
  trackedTestFiles: readonly string[],
  discoveredFiles: readonly string[],
): string[] {
  const discovered = new Set(discoveredFiles.map(toPosix));
  const missing: string[] = [];
  for (const f of trackedTestFiles) {
    const normalized = toPosix(f);
    if (!discovered.has(normalized)) {
      missing.push(normalized);
    }
  }
  return sortPosix(missing);
}

/**
 * Returns paths the runner returned more than once, sorted POSIX. This is the
 * "exactly one" half of the contract (AC3): a duplicate discovery would either
 * double a file's run or, after a dedupe, silently hide that two roots overlap.
 */
export function findDuplicateDiscoveries(
  discoveredFiles: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const raw of discoveredFiles) {
    const normalized = toPosix(raw);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const dups: string[] = [];
  for (const [file, count] of counts) {
    if (count > 1) {
      dups.push(file);
    }
  }
  return sortPosix(dups);
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

const FIX_HINT =
  'Fix: move the file under an existing entry of `TEST_ROOTS` in ' +
  'packages/cli/run-bun-tests.ts (src, test, test-bun, test-utils), or add its ' +
  'parent directory to `TEST_ROOTS`. Never add it to an exclude list — the ' +
  'whole point of structural discovery is that nothing is excluded.';

// ─── Decision (exported for behavioural tests) ──────────────────────────────

export interface DiscoveryVerdict {
  /** True when every tracked test file is discovered exactly once. */
  readonly ok: boolean;
  /** The exact text the guard prints — to stdout on pass, stderr on fail. */
  readonly report: string;
}

/**
 * The guard's whole decision: given the tracked set and the runner's discovered
 * set, is the discovery contract upheld, and what should be printed?
 *
 * `main()` is deliberately a thin shell over this function (gather inputs,
 * print `report`, exit on `ok`) so that both halves of the contract — "every
 * tracked test is discovered" and "each is discovered exactly once" — are
 * covered by tests of real decision-making rather than of helpers that the
 * program might not actually consult.
 */
export function evaluateDiscovery(
  trackedTestFiles: readonly string[],
  discoveredFiles: readonly string[],
): DiscoveryVerdict {
  const duplicates = findDuplicateDiscoveries(discoveredFiles);
  if (duplicates.length > 0) {
    const plural = duplicates.length === 1 ? '' : 's';
    return {
      ok: false,
      report: [
        `\ncli-test-discovery guard FAILED: discoverTestFiles() returned ` +
          `${duplicates.length} path${plural} more than once:\n`,
        ...duplicates.map((d) => `  ${d}`),
        '\nEach file must be discovered exactly once. Check for overlapping ' +
          '`TEST_ROOTS` or nested roots in packages/cli/run-bun-tests.ts.',
      ].join('\n'),
    };
  }

  const missing = findUndiscoveredTestFiles(trackedTestFiles, discoveredFiles);
  if (missing.length > 0) {
    const plural = missing.length === 1 ? '' : 's';
    return {
      ok: false,
      report: [
        `\ncli-test-discovery guard FAILED: ${missing.length} tracked CLI ` +
          `test file${plural} not discovered by run-bun-tests.ts:\n`,
        ...missing.map((m) => `  ${m}`),
        `\n${FIX_HINT}`,
      ].join('\n'),
    };
  }

  // Both counts are reported because they answer different questions:
  // `tracked` is what the repo contains, `discovered` is what the runner will
  // execute. Discovered may legitimately exceed tracked when a developer has
  // an uncommitted local test file, which is not a failure.
  return {
    ok: true,
    report:
      `cli-test-discovery guard PASSED: all ${trackedTestFiles.length} tracked ` +
      `CLI test files are discovered by run-bun-tests.ts ` +
      `(discoverTestFiles returned ${discoveredFiles.length}).`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const verdict = evaluateDiscovery(
    listTrackedTestFiles(args.root),
    discoverTestFiles(args.root),
  );

  if (verdict.ok) {
    console.log(verdict.report);
    process.exit(EXIT_PASS);
  }
  console.error(verdict.report);
  process.exit(EXIT_FAIL);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (e) {
    // Fail-closed: any operational error (git unavailable, not a repo) exits 1
    // with a clear message instead of a raw stack trace, so CI misconfiguration
    // is immediately diagnosable.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`cli-test-discovery guard FAILED: ${msg}`);
    process.exit(EXIT_FAIL);
  }
}
