/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs native Bun test files in isolated processes.
 *
 * Bun's module mocks are process-wide, unlike Vitest's per-file module graph.
 * A fresh process per file preserves the isolation expected by the existing
 * workspace suites while still executing every test with Bun's native runner.
 *
 * **Important**: This script does NOT discover test files by glob. Only files
 * explicitly listed in `scripts/bun-test-manifest.ts` are executed. Bun's
 * native test runner does not support several Vitest-specific APIs (relative
 * `vi.importActual`, `vi.resetModules`, process-wide `mock.module`), so
 * silently attempting all legacy test files would produce failures that look
 * like real regressions but are actually module-lifecycle incompatibilities.
 * The manifest ensures `test:bun` only runs files that have been verified to
 * pass under Bun, giving honest CI signal.
 *
 * Usage:
 *   bun scripts/run_bun_tests.ts [options]
 *
 * Options:
 *   --workspace <name>    Only run tests for the named workspace
 *   --tsconfig <path>     Path to tsconfig override (passed via --tsconfig-override)
 *   --timeout <ms>        Per-test timeout in milliseconds (defaults to 30000)
 *   --dry-run             List files that would be run without executing them
 */

import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveBunNativeTestFiles,
  type BunTestFile,
} from './bun-test-manifest.js';

/**
 * Bun SyncSubprocess shape for the fields used in diagnostics.  The full
 * interface includes stdout/stderr buffers and resourceUsage, but only the
 * exit-related fields matter here.
 *
 * exitCode is null when the process was terminated by a signal rather than
 * exiting voluntarily.
 */
export interface ChildExitInfo {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
}

/**
 * Returns true when the spawned child process completed successfully.
 * Bun's SyncSubprocess.exitCode is `null` when the process was terminated
 * by a signal rather than exiting voluntarily, so we also treat a null
 * exitCode as a failure.
 */
export function isChildSuccess(child: ChildExitInfo): boolean {
  return (
    child.exitCode === 0 &&
    (child.signalCode === null || child.signalCode === undefined)
  );
}

/**
 * Produces a human-readable suffix for a failed child diagnostic line.
 * When the process was killed by a signal, the signal name is included;
 * otherwise the numeric exit code is reported.
 */
export function formatFailureDiagnostic(child: ChildExitInfo): string {
  if (child.signalCode !== null && child.signalCode !== undefined) {
    return ` (signal: ${child.signalCode})`;
  }
  if (child.exitCode !== null && child.exitCode !== 0) {
    return ` (exit code: ${child.exitCode})`;
  }
  if (child.exitCode === null) {
    // exitCode is null (killed by signal) but no signalCode was recorded
    return ' (exit code: null)';
  }
  // exitCode is 0 with no signal: success, nothing to report
  return '';
}

interface CliOptions {
  workspace: string | null;
  tsconfig: string | null;
  timeout: number;
  dryRun: boolean;
}

function readOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

export function resolveTsconfigOverride(
  configuredPath: string,
  invocationDirectory: string,
): string {
  const absolutePath = resolve(invocationDirectory, configuredPath);
  try {
    if (statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  } catch {
    // The common missing and inaccessible cases share the same contract.
  }
  throw new Error(`Tsconfig override is not a file: ${absolutePath}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    workspace: null,
    tsconfig: null,
    timeout: 30_000,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--workspace':
      case '-w':
        options.workspace = readOptionValue(argv, i++, arg);
        break;
      case '--tsconfig':
        options.tsconfig = readOptionValue(argv, i++, arg);
        break;
      case '--timeout': {
        const value = readOptionValue(argv, i++, arg);
        const timeout = Number(value);
        if (!Number.isFinite(timeout) || timeout <= 0) {
          throw new Error(`Invalid --timeout value: ${value}`);
        }
        options.timeout = timeout;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export interface BunTestSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: 'inherit';
  readonly stdout: 'inherit';
  readonly stderr: 'inherit';
}

export interface BunTestRunnerDependencies {
  readonly repoRoot: string;
  readonly invocationDirectory: string;
  readonly executable: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly resolveFiles: (
    repoRoot: string,
    workspace?: string,
  ) => readonly BunTestFile[];
  readonly resolveTsconfig: (
    configuredPath: string,
    invocationDirectory: string,
  ) => string;
  readonly spawn: (
    command: readonly string[],
    options: BunTestSpawnOptions,
  ) => ChildExitInfo;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/**
 * Builds the base Bun test arguments (shared across all files in a run).
 */
function buildBaseArgs(
  tsconfigOverride: string | null,
  timeout: number,
): readonly string[] {
  const args = ['test'];
  if (tsconfigOverride) {
    args.push('--tsconfig-override', tsconfigOverride);
  }
  args.push('--max-concurrency', '1', '--timeout', String(timeout));
  return args;
}

/**
 * Builds the full spawn args for a single Bun test file, including the
 * preload script when the manifest entry defines one.
 */
function buildSpawnArgs(
  executable: string,
  baseArgs: readonly string[],
  entry: BunTestFile,
): readonly string[] {
  const args = [executable, ...baseArgs];
  if (entry.preload !== undefined) {
    args.push('--preload', entry.preload);
  }
  args.push(entry.file);
  return args;
}

export function runBunTests(
  argv: string[],
  dependencies: BunTestRunnerDependencies,
): number {
  const options = parseArgs(argv);
  const tsconfigOverride = options.tsconfig
    ? dependencies.resolveTsconfig(
        options.tsconfig,
        dependencies.invocationDirectory,
      )
    : null;
  const files = dependencies.resolveFiles(
    dependencies.repoRoot,
    options.workspace ?? undefined,
  );

  if (files.length === 0) {
    const scope = options.workspace
      ? `workspace "${options.workspace}"`
      : 'any workspace';
    dependencies.stderr(`No native Bun test files found for ${scope}.`);
    dependencies.stderr(
      'Files must be explicitly listed in scripts/bun-test-manifest.ts.',
    );
    return 1;
  }

  if (options.dryRun) {
    dependencies.stdout(`Dry run: ${files.length} files would be executed:`);
    for (const entry of files) {
      dependencies.stdout(`  [${entry.cwd}] ${entry.file}`);
    }
    return 0;
  }

  dependencies.stdout(
    `Running ${files.length} native Bun test files in isolated processes`,
  );

  const baseArgs = buildBaseArgs(tsconfigOverride, options.timeout);

  let passed = 0;
  let failed = 0;

  for (const entry of files) {
    try {
      const child = dependencies.spawn(
        buildSpawnArgs(dependencies.executable, baseArgs, entry),
        {
          cwd: entry.cwd,
          env: dependencies.environment,
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        },
      );

      if (!isChildSuccess(child)) {
        dependencies.stderr(
          `Native Bun test failed: ${entry.file}${formatFailureDiagnostic(child)}`,
        );
        failed++;
      } else {
        passed++;
      }
    } catch (error: unknown) {
      const diagnostic =
        error instanceof Error
          ? (error.stack ?? error.toString())
          : String(error);
      dependencies.stderr(
        `Native Bun test failed: ${entry.file}\n${diagnostic}`,
      );
      failed++;
    }
  }

  dependencies.stdout(
    `Passed ${passed}/${files.length} isolated native Bun test files` +
      (failed > 0 ? ` (${failed} failed)` : ''),
  );
  return failed > 0 ? 1 : 0;
}

function main(): void {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '..');
  process.exitCode = runBunTests(process.argv.slice(2), {
    repoRoot,
    invocationDirectory: process.cwd(),
    executable: process.execPath,
    environment: process.env,
    resolveFiles: resolveBunNativeTestFiles,
    resolveTsconfig: resolveTsconfigOverride,
    spawn: (command, options) => Bun.spawnSync([...command], options),
    stdout: console.log,
    stderr: console.error,
  });
}

/**
 * Determines whether the current module was invoked as the main entry point
 * (i.e. `process.argv[1]` resolves to this module's URL). Uses pathToFileURL
 * for portable cross-platform comparison that correctly handles spaces and
 * special characters in the script path — a raw string comparison against
 * `import.meta.url` would fail on paths containing spaces.
 */
export function isMainModule(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

const isMain = isMainModule(process.argv[1], import.meta.url);
if (isMain) {
  main();
}
