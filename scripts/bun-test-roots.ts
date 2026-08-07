/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem-discovery-based test-root table for the shared Bun test runner.
 *
 * Replaces the former manifest allowlist (`scripts/bun-test-manifest.ts`).
 * Each root declares the directories to scan and the execution settings
 * (preload, tsconfig, timeout, retries, globalSetup, credentialed). There is
 * deliberately **no** `files`, `include`, or `exclude` member: a root selects
 * its test files by walking the filesystem, so a newly added test file is
 * picked up automatically and can never be silently dropped.
 */

import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-file timeout override keyed by a path pattern. */
export interface BunTestTimeoutOverride {
  /**
   * Matched against the resolved ABSOLUTE path of a discovered file, not its
   * basename, so a pattern may scope itself to a directory. Anchor the end
   * (`/name\.test\.ts$/`) rather than the start when targeting one file.
   */
  readonly pattern: RegExp;
  readonly timeout: number;
}

export interface BunTestRoot {
  /** The `--root` / `--workspace` token. */
  readonly root: string;
  /** Repo-relative cwd; default `packages/<root>`. */
  readonly cwd?: string;
  /** Scanned directories under cwd; default: cwd itself. */
  readonly directories?: readonly string[];
  /** Test-file pattern; default DEFAULT_TEST_FILE_PATTERN. */
  readonly pattern?: RegExp;
  /** Bun `--preload` script path(s), relative to cwd. */
  readonly preload?: string | readonly string[];
  /** Tsconfig (relative to cwd) passed as `--tsconfig-override`. */
  readonly tsconfig?: string;
  /** Per-test timeout in milliseconds, overriding the runner's `--timeout`. */
  readonly timeout?: number;
  /** Number of retries for a failing file before reporting it as failed. */
  readonly retries?: number;
  /** Module (relative to cwd) with `setup()` / `teardown()`, run once per root. */
  readonly globalSetup?: string;
  /** Marks a root that needs real credentials; excluded from unfiltered runs. */
  readonly credentialed?: boolean;
  /**
   * Per-file timeout overrides keyed by an absolute-path pattern. An override
   * changes only the budget for the matching file, never whether it is
   * executed. The first matching entry wins.
   */
  readonly timeoutOverrides?: readonly BunTestTimeoutOverride[];
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
  /** Resolved absolute preload paths for this root (empty when none declared). */
  readonly preloads: readonly string[];
  /** Resolved absolute tsconfig path, when the root declares one. */
  readonly tsconfig?: string;
  /** Per-test timeout in milliseconds, when the root declares one. */
  readonly timeout?: number;
  /** Retry budget, when the root declares one. */
  readonly retries?: number;
  /** Resolved absolute global-setup module path, when declared. */
  readonly globalSetup?: string;
}

/**
 * Injectable filesystem operations so the resolver and walker stay testable
 * against temp fixtures rather than the live repository tree.
 */
export interface BunTestRootDependencies {
  readonly stat: (path: string) => {
    isFile(): boolean;
    isDirectory(): boolean;
  };
  readonly readDirectory: (path: string) => readonly string[];
  readonly realpath: (path: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Union of the naming conventions in use across the repository: `*.test.*`,
 * `*.spec.*`, and `*.bun.*` for suites importing `bun:test` directly.
 */
export const DEFAULT_TEST_FILE_PATTERN = /\.(test|spec|bun)\.(ts|tsx|js)$/;

const DECLARATION_FILE_PATTERN = /\.d\.ts$/;

const SKIPPED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  'bundle',
  '__snapshots__',
]);

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export class BunTestRootStatError extends Error {
  readonly path: string;
  readonly code: string | undefined;

  constructor(path: string, code: string | undefined, cause: unknown) {
    super(
      `Unable to inspect Bun test root path: ${path}${
        code ? ` (${code})` : ''
      }`,
      { cause },
    );
    this.name = 'BunTestRootStatError';
    this.path = path;
    this.code = code;
  }
}

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

// ---------------------------------------------------------------------------
// Root table
// ---------------------------------------------------------------------------

export const BUN_TEST_ROOTS: readonly BunTestRoot[] = [
  {
    root: 'a2a-server',
    preload: ['bun-preload-storage-isolation.ts'],
  },
  {
    root: 'agents',
    directories: ['test-bun'],
  },
  {
    root: 'providers',
  },
  {
    root: 'tools',
    preload: 'test-setup-storage-isolation.ts',
  },
  {
    root: 'mcp',
    preload: 'test-setup-storage-isolation.ts',
  },
  {
    root: 'telemetry',
    preload: ['test-setup-storage-isolation.ts'],
  },
  {
    // Both preloads are explicit because run_bun_tests.ts passes them as
    // --preload args and does NOT read packages/storage/bunfig.toml, so a
    // preload declared only there would be silently dropped and the
    // process-wide keyring latch would leak between test files.
    root: 'storage',
    preload: [
      'test-setup-storage-isolation.ts',
      'test-setup-bun-session-reset.ts',
    ],
  },
  {
    root: 'test-utils',
  },
  {
    root: 'settings',
    preload: ['test-setup-storage-isolation.ts'],
  },
  {
    root: 'ide-integration',
    preload: ['test-setup-storage-isolation.ts', 'test-setup.ts'],
  },
  {
    root: 'vscode-ide-companion',
    preload: ['test-setup-storage-isolation.ts'],
    tsconfig: 'tsconfig.bun-test.json',
  },
  {
    root: 'policy',
  },
  {
    root: 'lsp',
  },
  {
    root: 'scripts-tests',
    cwd: '.',
    directories: ['scripts/tests'],
    preload: ['scripts/tests/test-setup.ts'],
    timeoutOverrides: [
      { pattern: /issue-2603-release-install\.test\.ts$/, timeout: 300_000 },
    ],
  },
  {
    root: 'evals',
    cwd: 'evals',
    pattern: /\.eval\.ts$/,
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    credentialed: true,
  },
  {
    root: 'integration-tests',
    cwd: 'integration-tests',
    preload: ['setup-quota-guard.ts'],
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    retries: 2,
    credentialed: true,
  },
];

// ---------------------------------------------------------------------------
// Default dependencies (real filesystem)
// ---------------------------------------------------------------------------

const defaultDependencies: BunTestRootDependencies = {
  stat: (path: string) => statSync(path),
  readDirectory: (path: string) => readdirSync(path),
  realpath: (path: string) => realpathSync(path),
};

// ---------------------------------------------------------------------------
// Root selection and cwd resolution
// ---------------------------------------------------------------------------

export function resolveRootCwd(repoRoot: string, root: BunTestRoot): string {
  if (root.cwd === undefined) {
    return join(repoRoot, 'packages', root.root);
  }
  return join(repoRoot, root.cwd);
}

/**
 * Decides whether a root participates in this run.
 *
 * A named filter selects exactly that root, credentialed or not. An
 * unfiltered run covers every root that does not require provider credentials.
 */
export function selectsRoot(root: BunTestRoot, rootFilter?: string): boolean {
  if (rootFilter !== undefined) {
    return root.root === rootFilter;
  }
  return root.credentialed !== true;
}

// ---------------------------------------------------------------------------
// File discovery (walker)
// ---------------------------------------------------------------------------

export function isTestFileName(
  name: string,
  pattern: RegExp = DEFAULT_TEST_FILE_PATTERN,
): boolean {
  return pattern.test(name) && !DECLARATION_FILE_PATTERN.test(name);
}

/**
 * Canonicalizes a path, converting a failure into the module's contextual
 * error so every filesystem fault in the walker is reported the same way.
 */
function resolveRealPath(path: string, deps: BunTestRootDependencies): string {
  try {
    return deps.realpath(path);
  } catch (error: unknown) {
    throw new BunTestRootStatError(path, getErrorCode(error), error);
  }
}

/**
 * Walks a directory recursively, collecting absolute paths of test files.
 *
 * Skips `node_modules`, `dist`, `coverage`, `tmp`, `bundle`, `__snapshots__`
 * and any directory starting with `.`. Files are selected purely by the
 * test-file pattern, so a dot-prefixed file that matches (e.g.
 * `.hidden.test.ts`) IS included. Follows directories by real path and visits
 * each real path only once so a symlink cycle terminates.
 *
 * Filesystem errors (unreadable directory, unstattable entry, broken
 * realpath) propagate as `BunTestRootStatError` so a dropped test file is
 * always loud, never silent.
 */
function walkDirectory(
  dir: string,
  pattern: RegExp,
  deps: BunTestRootDependencies,
  results: string[],
  visited: Set<string>,
  seenFiles: Set<string>,
): void {
  let entries: readonly string[];
  try {
    entries = deps.readDirectory(dir);
  } catch (error: unknown) {
    throw new BunTestRootStatError(dir, getErrorCode(error), error);
  }
  for (const entry of entries) {
    processDirectoryEntry(
      dir,
      entry,
      pattern,
      deps,
      results,
      visited,
      seenFiles,
    );
  }
}

function processDirectoryEntry(
  dir: string,
  entry: string,
  pattern: RegExp,
  deps: BunTestRootDependencies,
  results: string[],
  visited: Set<string>,
  seenFiles: Set<string>,
): void {
  const fullPath = join(dir, entry);
  let stats: { isFile(): boolean; isDirectory(): boolean };
  try {
    stats = deps.stat(fullPath);
  } catch (error: unknown) {
    throw new BunTestRootStatError(fullPath, getErrorCode(error), error);
  }
  if (stats.isDirectory()) {
    if (entry.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(entry)) {
      return;
    }
    const realPath = resolveRealPath(fullPath, deps);
    if (visited.has(realPath)) {
      return;
    }
    visited.add(realPath);
    walkDirectory(fullPath, pattern, deps, results, visited, seenFiles);
  } else if (isTestFileName(entry, pattern)) {
    const realFile = resolveRealPath(fullPath, deps);
    if (!seenFiles.has(realFile)) {
      seenFiles.add(realFile);
      results.push(fullPath);
    }
  }
}

/**
 * Discovers test files under a single directory using the given pattern.
 * Exported so tests can exercise the walker against temp fixtures.
 */
export function discoverTestFilesInDirectory(
  directory: string,
  pattern: RegExp,
  deps: BunTestRootDependencies,
): readonly string[] {
  const results: string[] = [];
  const visited = new Set<string>();
  const seenFiles = new Set<string>();
  visited.add(resolveRealPath(directory, deps));
  walkDirectory(directory, pattern, deps, results, visited, seenFiles);
  return results;
}

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

function toPreloadList(
  preload: string | readonly string[] | undefined,
): readonly string[] {
  if (preload === undefined) {
    return [];
  }
  return typeof preload === 'string' ? [preload] : preload;
}

function resolveTimeoutForFile(
  root: BunTestRoot,
  file: string,
): number | undefined {
  if (root.timeoutOverrides !== undefined) {
    for (const override of root.timeoutOverrides) {
      if (override.pattern.test(file)) {
        return override.timeout;
      }
    }
  }
  return root.timeout;
}

function resolveRootConfigPaths(
  root: BunTestRoot,
  resolvedCwd: string,
): readonly string[] {
  const paths: string[] = [];
  for (const preload of toPreloadList(root.preload)) {
    paths.push(join(resolvedCwd, preload));
  }
  if (root.tsconfig !== undefined) {
    paths.push(join(resolvedCwd, root.tsconfig));
  }
  if (root.globalSetup !== undefined) {
    paths.push(join(resolvedCwd, root.globalSetup));
  }
  return paths;
}

/**
 * Resolves a single root into its `BunTestFile` entries, discovering test
 * files by walking the filesystem and validating that every declared preload,
 * tsconfig, and globalSetup path exists.
 *
 * Exported so tests exercise root resolution against temp fixtures.
 */
export function resolveRoot(
  root: BunTestRoot,
  repoRoot: string,
  deps: BunTestRootDependencies = defaultDependencies,
): BunTestFile[] {
  const resolvedCwd = resolveRootCwd(repoRoot, root);

  for (const configPath of resolveRootConfigPaths(root, resolvedCwd)) {
    validateConfigPathExists(configPath, deps);
  }

  const resolvedPreloads = toPreloadList(root.preload).map((preload) =>
    join(resolvedCwd, preload),
  );
  const resolvedTsconfig =
    root.tsconfig !== undefined ? join(resolvedCwd, root.tsconfig) : undefined;
  const resolvedGlobalSetup =
    root.globalSetup !== undefined
      ? join(resolvedCwd, root.globalSetup)
      : undefined;
  const pattern = root.pattern ?? DEFAULT_TEST_FILE_PATTERN;

  const scanDirectories =
    root.directories !== undefined
      ? root.directories.map((dir) => join(resolvedCwd, dir))
      : [resolvedCwd];

  const discovered: string[] = [];
  const visited = new Set<string>();
  const seenFiles = new Set<string>();
  for (const dir of scanDirectories) {
    visited.add(resolveRealPath(dir, deps));
    walkDirectory(dir, pattern, deps, discovered, visited, seenFiles);
  }

  if (discovered.length === 0) {
    throw new Error(
      `Bun test root "${root.root}" discovered no test files under ${scanDirectories.join(', ')}.`,
    );
  }

  return discovered.map((file) => ({
    cwd: resolvedCwd,
    file,
    preloads: resolvedPreloads,
    tsconfig: resolvedTsconfig,
    timeout: resolveTimeoutForFile(root, file),
    retries: root.retries,
    globalSetup: resolvedGlobalSetup,
  }));
}

// ---------------------------------------------------------------------------
// Config-path validation (preload / tsconfig / globalSetup)
// ---------------------------------------------------------------------------

function validateConfigPathExists(
  path: string,
  deps: BunTestRootDependencies,
): void {
  try {
    if (!deps.stat(path).isFile()) {
      throw new BunTestRootStatError(path, undefined, new Error('not a file'));
    }
  } catch (error: unknown) {
    if (error instanceof BunTestRootStatError) {
      throw error;
    }
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      throw new Error(
        `Bun test root declares a missing preload/config path: ${path}`,
      );
    }
    throw new BunTestRootStatError(path, code, error);
  }
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the set of `BunTestFile` entries for the given repository root.
 *
 * When `rootFilter` is omitted, every non-credentialed root is resolved.
 * When provided, only the matching root is resolved (credentialed or not).
 * Directory walking and file-stats use `deps` (defaulting to the real
 * filesystem) so tests exercise the resolver against temp fixtures.
 */
export function resolveBunTestFiles(
  repoRoot: string,
  rootFilter?: string,
  deps: BunTestRootDependencies = defaultDependencies,
): BunTestFile[] {
  const files = BUN_TEST_ROOTS.filter((root) =>
    selectsRoot(root, rootFilter),
  ).flatMap((root) => resolveRoot(root, repoRoot, deps));
  return [...files].sort((left, right) => left.file.localeCompare(right.file));
}
