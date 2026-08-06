/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository-wide test-file coverage guard (issue #2979, AC7 + AC8).
 *
 * Every CI executor that runs tests discovers its files by walking the
 * filesystem. This module derives the set of files each executor actually
 * runs from the executors' OWN discovery code — the shared root resolver
 * (`resolveBunTestFiles`) and the bespoke workspace runners — then reports:
 *
 * - **uncovered** files: a test file on disk that no executor runs (AC8);
 * - **doubly-executed** files: a file two executors both run (AC7).
 *
 * There is deliberately no allowlist, ignore list, or "expected uncovered"
 * set anywhere. If the real-repository assertions fail, the offending files
 * are a genuine finding and the root cause must be fixed (broaden a runner's
 * pattern, add a missing scanned directory, or remove a real duplicate).
 */

import { readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_TEST_ROOTS,
  type BunTestRootDependencies,
  DEFAULT_TEST_FILE_PATTERN,
  discoverTestFilesInDirectory,
  resolveBunTestFiles,
} from './bun-test-roots.js';
import { discoverTestFiles as discoverCliTestFiles } from '../packages/cli/run-bun-tests.js';
import { discoverTestFiles as discoverCoreTestFiles } from '../packages/core/run-bun-tests.js';
import { discoverTestFiles as discoverAgentsTestFiles } from '../packages/agents/run-bun-tests.js';
import { discoverTestFiles as discoverAuthTestFiles } from '../packages/auth/run-bun-tests.js';

// ---------------------------------------------------------------------------
// Dependencies (real filesystem, injectable for tests)
// ---------------------------------------------------------------------------

const defaultDependencies: BunTestRootDependencies = {
  stat: (path: string) => statSync(path),
  readDirectory: (path: string) => readdirSync(path),
  realpath: (path: string) => realpathSync(path),
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Every test file the repository considers a test, for the purpose of the
 * coverage guard. This is the shared runner's union pattern (`*.test`,
 * `*.spec`, `*.bun` across `ts`/`tsx`/`js`) plus the `*.eval.ts` suites the
 * credentialed `evals` root runs under its own pattern.
 */
const REPOSITORY_TEST_FILE_PATTERN = new RegExp(
  `${DEFAULT_TEST_FILE_PATTERN.source}|\\.eval\\.ts$`,
);

// ---------------------------------------------------------------------------
// Executor model
// ---------------------------------------------------------------------------

/**
 * One CI test executor and the absolute paths it would run for a given
 * repository root. Each `discover` function delegates to the executor's real
 * discovery code so the guard can never drift out of sync with what CI runs.
 */
export interface TestExecutor {
  readonly name: string;
  readonly discover: (repoRoot: string) => readonly string[];
}

/**
 * The shared Bun test runner resolves every root in the root table. Credentialed
 * roots (`evals`, `integration-tests`) execute too — in dedicated workflows —
 * so they count as covered and are resolved here by name.
 */
function discoverSharedRunnerFiles(repoRoot: string): readonly string[] {
  return BUN_TEST_ROOTS.flatMap((root) =>
    resolveBunTestFiles(repoRoot, root.root),
  ).map((entry) => entry.file);
}

/**
 * The complete table of executors. The covered set is the union of what every
 * entry here discovers.
 */
export const TEST_EXECUTORS: readonly TestExecutor[] = [
  {
    name: 'shared Bun test runner (scripts/run_bun_tests.ts)',
    discover: discoverSharedRunnerFiles,
  },
  {
    name: 'packages/cli test script (run-bun-tests.ts)',
    // The CLI runner (the reference bespoke runner) returns paths relative to
    // its workspace root; resolve them to absolute so they line up with the
    // repository walker and the other executors.
    discover: (repoRoot: string): readonly string[] => {
      const workspace = join(repoRoot, 'packages', 'cli');
      return discoverCliTestFiles(workspace).map((file) =>
        resolve(workspace, file),
      );
    },
  },
  {
    name: 'packages/core test script (run-bun-tests.ts)',
    discover: (repoRoot: string): readonly string[] =>
      discoverCoreTestFiles(join(repoRoot, 'packages', 'core')),
  },
  {
    name: 'packages/agents test script (run-bun-tests.ts)',
    discover: (repoRoot: string): readonly string[] =>
      discoverAgentsTestFiles(join(repoRoot, 'packages', 'agents')),
  },
  {
    name: 'packages/auth test script (run-bun-tests.ts)',
    discover: (repoRoot: string): readonly string[] =>
      discoverAuthTestFiles(join(repoRoot, 'packages', 'auth')),
  },
];

// ---------------------------------------------------------------------------
// Repository walk
// ---------------------------------------------------------------------------

/**
 * Walks the whole repository for test files, skipping build output and
 * artifact directories (`node_modules`, `dist`, `coverage`, `bundle`, `tmp`,
 * `__snapshots__` and any dot-prefixed directory — this also excludes the
 * `.integration-tests/` recording directory). Reuses the shared walker so
 * there is a single definition of "skip these directories".
 *
 * Paths are canonicalized so one real file has exactly one coverage identity,
 * matching how executor claims are recorded.
 */
export function discoverRepositoryTestFiles(
  repoRoot: string,
  deps: BunTestRootDependencies = defaultDependencies,
): readonly string[] {
  const files = discoverTestFilesInDirectory(
    repoRoot,
    REPOSITORY_TEST_FILE_PATTERN,
    deps,
  );
  return [...files].map((file) => deps.realpath(file)).sort();
}

/**
 * Collects the union of absolute paths every executor claims, preserving each
 * file's claimants so duplicate execution can be reported.
 *
 * Paths are canonicalized so one real file has exactly one coverage identity:
 * without it, a file reached through a symlink alias would look uncovered on
 * one side of the comparison and a duplicate would go unnoticed on the other.
 * `discoverRepositoryTestFiles` canonicalizes the same way.
 */
function collectExecutorClaims(
  repoRoot: string,
  executors: readonly TestExecutor[],
  deps: BunTestRootDependencies,
): { readonly files: Set<string>; readonly counts: Map<string, string[]> } {
  const files = new Set<string>();
  const counts = new Map<string, string[]>();
  for (const executor of executors) {
    for (const discovered of executor.discover(repoRoot)) {
      const file = deps.realpath(discovered);
      files.add(file);
      const claimants = counts.get(file);
      if (claimants === undefined) {
        counts.set(file, [executor.name]);
      } else {
        claimants.push(executor.name);
      }
    }
  }
  return { files, counts };
}

/**
 * Returns, sorted, every repository test file that no executor claims.
 */
export function findUncoveredTestFiles(
  repoRoot: string,
  deps: BunTestRootDependencies = defaultDependencies,
  executors: readonly TestExecutor[] = TEST_EXECUTORS,
): readonly string[] {
  const onDisk = discoverRepositoryTestFiles(repoRoot, deps);
  const { files: covered } = collectExecutorClaims(repoRoot, executors, deps);
  return [...onDisk].filter((file) => !covered.has(file)).sort();
}

/** A test file claimed by more than one executor. */
export interface DoublyExecutedFile {
  readonly file: string;
  readonly executors: readonly string[];
}

/**
 * Returns, sorted by path, every file claimed by more than one executor, each
 * with the sorted list of executors that claim it.
 *
 * This reads only the executors' own discovery, never the repository walk, but
 * still canonicalizes their paths so two aliases of one real file are reported
 * as the duplicate they are.
 */
export function findDoublyExecutedTestFiles(
  repoRoot: string,
  executors: readonly TestExecutor[] = TEST_EXECUTORS,
  deps: BunTestRootDependencies = defaultDependencies,
): readonly DoublyExecutedFile[] {
  return toDoublyExecuted(
    collectExecutorClaims(repoRoot, executors, deps).counts,
  );
}

function toDoublyExecuted(
  counts: Map<string, string[]>,
): readonly DoublyExecutedFile[] {
  const duplicates: DoublyExecutedFile[] = [];
  for (const [file, claimants] of counts) {
    if (claimants.length > 1) {
      duplicates.push({
        file,
        executors: [...claimants].sort(),
      });
    }
  }
  return duplicates.sort((left, right) => left.file.localeCompare(right.file));
}

/** Both findings, computed from a single pass over every executor. */
export interface TestFileCoverageReport {
  readonly uncovered: readonly string[];
  readonly doublyExecuted: readonly DoublyExecutedFile[];
}

/**
 * Computes both findings in one pass. Each executor's discovery walks the
 * filesystem, so running it once rather than once per finding matters.
 */
export function analyzeTestFileCoverage(
  repoRoot: string,
  deps: BunTestRootDependencies = defaultDependencies,
  executors: readonly TestExecutor[] = TEST_EXECUTORS,
): TestFileCoverageReport {
  const onDisk = discoverRepositoryTestFiles(repoRoot, deps);
  const { files: covered, counts } = collectExecutorClaims(
    repoRoot,
    executors,
    deps,
  );
  return {
    uncovered: [...onDisk].filter((file) => !covered.has(file)).sort(),
    doublyExecuted: toDoublyExecuted(counts),
  };
}

// ---------------------------------------------------------------------------
// Executable guard
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..');

/**
 * Guard entry point: fails (non-zero exit) when any test file on disk is
 * uncovered or claimed by more than one executor, prints every finding, and
 * prints a concise success line otherwise.
 */
function main(): void {
  const repoRoot = DEFAULT_REPO_ROOT;

  const { uncovered, doublyExecuted } = analyzeTestFileCoverage(repoRoot);

  if (uncovered.length > 0) {
    console.error('test-file coverage guard FAILED — uncovered files:');
    for (const file of uncovered) {
      console.error(`  ${file}`);
    }
  }

  if (doublyExecuted.length > 0) {
    console.error('test-file coverage guard FAILED — doubly-executed files:');
    for (const entry of doublyExecuted) {
      console.error(`  ${entry.file} ← ${entry.executors.join(', ')}`);
    }
  }

  if (uncovered.length > 0 || doublyExecuted.length > 0) {
    process.exit(1);
  }

  console.log(
    'test-file coverage guard PASSED: zero uncovered, zero doubly-executed.',
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
