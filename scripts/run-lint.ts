#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical lint runner (issues #2710, #3387).
 *
 * A full run is partitioned into one ESLint process per `packages/<pkg>`
 * directory plus one process for the rest of the tree, so peak memory is the
 * largest single group rather than the whole monorepo at once (#3387). The
 * partition is derived from the filesystem and is exhaustive: the package
 * targets cover exactly what lives under `packages/`, and the final target is
 * `.` with those same paths ignored, so the union is the file set of
 * `eslint .`. A new package is picked up without editing this runner.
 *
 * Scoped runs (CI PRs) consume an explicit JSON target list and always include
 * integration-tests as an explicit target so the separate integration-test
 * ESLint pass is covered after collapsing duplicate traversals. They are
 * partitioned the same way, one process per target, so the heap default is
 * safe on that path too. Cache is opt-in (CI only) and never silently enabled
 * locally.
 *
 * `lint` and `lint:fix` delegate to this runner. `lint:ci` and the LSP
 * package's separate lint step are intentionally preserved.
 */

import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execa } from 'execa';
import { messageOf, propertyValue } from './utils/error-guards.ts';

/**
 * Heap ceiling for each ESLint process. Sized to the largest single group
 * (`packages/cli`), not to the whole tree. See project-plans/issue3387 for the
 * measurements behind this number.
 */
const DEFAULT_HEAP_MB = 6144;
const ESLINT_CACHE_LOCATION = 'node_modules/.cache/eslint';
const INTEGRATION_TESTS_TARGET = 'integration-tests';
const FULL_TARGET = '.';
const PACKAGES_DIR = 'packages';
/**
 * Ignore pattern that makes the rest-of-tree group the exact complement of the
 * package groups. It matches the CONTENTS of each immediate subdirectory, not
 * everything under `packages/`: a plain `packages/**` would also drop a file
 * sitting directly in `packages/`, which no package group covers because
 * {@link readPackageDirs} yields directories only. Verified against ESLint 9
 * with a fixture containing such a file.
 */
const PACKAGES_IGNORE_PATTERN = `${PACKAGES_DIR}/*/**`;
const LINT_TARGETS_ENV = 'LLXPRT_LINT_TARGETS';
/**
 * Applied only to the per-package groups of a full run, whose targets are
 * derived from the filesystem. A package matching only ignored files is
 * legitimate there (eslint.config.js ignores `packages/lsp` wholesale) and
 * would otherwise be a hard error. Scoped targets and the rest-of-tree group
 * do not get this: an unmatched target there is a real misconfiguration.
 */
const NO_ERROR_ON_UNMATCHED = '--no-error-on-unmatched-pattern';

/** Cache flags that take a value; the runner owns these centrally. */
const CACHE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--cache-strategy',
  '--cache-location',
]);

/** Boolean cache flags; consumed by isCacheEnabled, never forwarded. */
const CACHE_BOOL_FLAGS: ReadonlySet<string> = new Set(['--cache']);

/** A single ESLint invocation the runner would spawn. */
export interface LintCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly nodeOptions: string;
  /** Human-readable name of the group, used for progress output. */
  readonly label: string;
}

/** Parameters for the exported command builder. */
export interface BuildCommandsParams {
  /** Explicit scoped targets, or null for a full root run. */
  readonly targets: readonly string[] | null;
  readonly forwardedArgs: readonly string[];
  readonly cache: boolean;
  /**
   * Directories under `packages/` to partition a full run across, as paths
   * relative to the repo root (e.g. `packages/cli`). Supplied by the caller so
   * the builder stays pure and testable. An empty list means there is nothing
   * to partition and a full run stays a single root invocation.
   */
  readonly packageDirs?: readonly string[];
  readonly heapMb?: number;
  readonly nodeOptions?: string;
}

function nodeOptionsWithoutMemoryLimit(nodeOptions: string): string[] {
  const options = nodeOptions
    .split(/\s+/)
    .filter((option) => option.length > 0);
  const keptOptions: string[] = [];
  let skipNext = false;
  for (const option of options) {
    if (skipNext) {
      // The token after a space-separated --max-old-space-size is the numeric
      // value and must be dropped, not preserved as a stray argument.
      skipNext = false;
    } else if (option === '--max-old-space-size') {
      skipNext = true;
    } else if (!/^--max-old-space-size=/.test(option)) {
      keptOptions.push(option);
    }
  }
  return keptOptions;
}

function nodeOptionsWithMemoryLimit(
  heapMb: number,
  inherited?: string,
): string {
  return [
    ...nodeOptionsWithoutMemoryLimit(
      inherited ?? process.env.NODE_OPTIONS ?? '',
    ),
    `--max-old-space-size=${heapMb}`,
  ].join(' ');
}

/**
 * Builds the concrete ESLint command(s) for a full or scoped run.
 *
 * Exported for behavioral tests so the command structure can be asserted
 * without spawning ESLint. The CLI entry point calls this and then executes
 * the commands sequentially: lint failures accumulate so no group hides
 * another's findings, and a signal termination aborts the rest.
 */
export function buildLintCommands({
  targets,
  forwardedArgs,
  cache,
  packageDirs = [],
  heapMb = DEFAULT_HEAP_MB,
  nodeOptions,
}: BuildCommandsParams): readonly LintCommand[] {
  const eslintBin = fileURLToPath(
    new URL('../node_modules/.bin/eslint', import.meta.url),
  );
  // The exported builder can be called from tests/automation with any heap
  // value; clamp non-finite or non-positive input to the default so an
  // invalid --max-old-space-size never reaches Node.js and produces a
  // confusing startup failure (NaN/Infinity would crash Node at boot).
  const safeHeap =
    Number.isFinite(heapMb) && heapMb > 0 ? heapMb : DEFAULT_HEAP_MB;
  const resolvedNodeOptions = nodeOptionsWithMemoryLimit(safeHeap, nodeOptions);

  // All groups share one cache file, which is what .github/workflows/ci.yml
  // saves and restores. ESLint merges into an existing cache rather than
  // pruning entries for files the current run did not visit, so sequential
  // groups accumulate instead of clobbering each other.
  const cacheArgs: readonly string[] = cache
    ? [
        '--cache',
        '--cache-strategy',
        'content',
        '--cache-location',
        ESLINT_CACHE_LOCATION,
      ]
    : [];

  /** Assembles one group's command: targets, group-specific flags, then the shared ones. */
  const makeCommand = (
    label: string,
    targetArgs: readonly string[],
    extraArgs: readonly string[] = [],
  ): LintCommand => ({
    cmd: eslintBin,
    args: [...targetArgs, ...extraArgs, ...forwardedArgs, ...cacheArgs],
    nodeOptions: resolvedNodeOptions,
    label,
  });

  if (targets === null) {
    return fullRunCommands(packageDirs, makeCommand);
  }
  // Scoped run: one process per target, always including integration-tests
  // (deduplicated), so a scoped run never holds several package type programs
  // at once either. Scoped targets come from CI's affected-target selector, so
  // an unmatched one is a stale or mistyped target and must still fail loudly.
  return scopedTargets(targets).map((target) => makeCommand(target, [target]));
}

/** Factory that turns a group label plus its ESLint targets into a command. */
type CommandFactory = (
  label: string,
  targetArgs: readonly string[],
  extraArgs?: readonly string[],
) => LintCommand;

/**
 * Partitions a full run: one command per package directory, then one command
 * for everything else. The two halves are exact complements, so the union is
 * the file set of `eslint .`.
 *
 * With no package directories there is nothing to partition and the run stays
 * a single root invocation, which is still complete.
 */
function fullRunCommands(
  packageDirs: readonly string[],
  makeCommand: CommandFactory,
): readonly LintCommand[] {
  if (packageDirs.length === 0) {
    return [makeCommand(FULL_TARGET, [FULL_TARGET])];
  }
  const ordered = [...new Set(packageDirs)].sort();
  return [
    ...ordered.map((dir) => makeCommand(dir, [dir], [NO_ERROR_ON_UNMATCHED])),
    makeCommand(`${FULL_TARGET} (excluding ${PACKAGES_DIR}/)`, [
      FULL_TARGET,
      '--ignore-pattern',
      PACKAGES_IGNORE_PATTERN,
    ]),
  ];
}

/** Deduplicated, sorted scoped targets, always including integration-tests. */
function scopedTargets(targets: readonly string[]): readonly string[] {
  const targetSet = new Set<string>(targets);
  targetSet.add(INTEGRATION_TESTS_TARGET);
  return [...targetSet].sort();
}

/**
 * Lists the package directories a full run is partitioned across, as paths
 * relative to the repo root. Reading the filesystem keeps the partition
 * exhaustive without a hand-maintained list: a new package is linted the day
 * it appears.
 *
 * A missing `packages/` directory is a broken checkout, not a condition to
 * paper over, so the underlying error propagates.
 */
export function readPackageDirs(repoRoot: string): readonly string[] {
  return readdirSync(resolve(repoRoot, PACKAGES_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${PACKAGES_DIR}/${entry.name}`)
    .sort();
}

/**
 * Parses the scoped-target input. A JSON array from CI (via env or --targets)
 * selects the scoped run; any parse failure, empty array, or missing input
 * falls back to a full run (null).
 *
 * Exported for behavioral tests so env-vs-argv precedence and malformed input
 * can be asserted without spawning ESLint.
 */
export function resolveTargets(
  argv: readonly string[],
): readonly string[] | null {
  // --targets <json> takes precedence.
  const targetsIdx = argv.indexOf('--targets');
  if (targetsIdx !== -1) {
    const raw = argv[targetsIdx + 1];
    if (raw === undefined) return null;
    return parseTargets(raw);
  }
  // CI passes the target list via environment.
  const envTargets = process.env[LINT_TARGETS_ENV];
  if (envTargets !== undefined && envTargets.length > 0) {
    return parseTargets(envTargets);
  }
  return null;
}

function parseTargets(raw: string): readonly string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((v): v is string => typeof v === 'string');
    if (strings.length === 0) return null;
    return strings;
  } catch {
    return null;
  }
}

function isCacheEnabled(argv: readonly string[]): boolean {
  return argv.includes('--cache') || process.env.LLXPRT_LINT_CACHE === 'true';
}

/**
 * Removes runner-managed flags from a raw argument list, returning only the
 * args that should be forwarded to ESLint. The runner owns caching centrally
 * (buildLintCommands derives cache args from the `cache` param) and consumes
 * `--targets` itself, so all cache flags and `--targets` are stripped here to
 * prevent eslint from receiving them twice when a caller passes them on the
 * CLI. Exported for behavioral testing.
 *
 * A value-flag with no following value (end of args, or the next token looks
 * like another flag) is treated as a boolean and stripped alone, so a malformed
 * sequence like `['--targets', '--fix']` does not consume the legitimate
 * `--fix`.
 */
export function stripRunnerArgs(rawArgs: readonly string[]): string[] {
  const forwardedArgs: string[] = [];
  const valueFlags = new Set<string>(['--targets', ...CACHE_VALUE_FLAGS]);
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (valueFlags.has(a)) {
      const next = rawArgs[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        i++; // skip flag and its value
      }
      // else: malformed/boolean value flag; strip flag alone, do not consume next
    } else if (CACHE_BOOL_FLAGS.has(a)) {
      // boolean cache flag; consumed by isCacheEnabled, not forwarded
    } else {
      forwardedArgs.push(a);
    }
  }
  return forwardedArgs;
}

/**
 * Runs each group in turn, with ESLint's output inherited.
 *
 * A lint failure in one group must not hide findings in the others, so every
 * group runs and the first failure is re-thrown at the end, preserving its
 * exit code. An interruption (Ctrl-C, watchdog, OOM kill) is not a lint result
 * and aborts the remaining groups immediately.
 *
 * Exported so this behavior can be tested against real child processes.
 */
export async function executeLintCommands(
  commands: readonly LintCommand[],
): Promise<void> {
  let firstFailure: unknown;
  for (const [index, command] of commands.entries()) {
    process.stdout.write(
      `\nLint ${index + 1}/${commands.length}: ${command.label}\n`,
    );
    try {
      await execa(command.cmd, [...command.args], {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_OPTIONS: command.nodeOptions,
        },
      });
    } catch (error) {
      if (terminationSignal(error) !== undefined) {
        throw error;
      }
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) {
    throw firstFailure;
  }
}

/** CLI entry point: resolves the run shape from argv and executes every group. */
async function runLint(): Promise<void> {
  // Forward CLI args to ESLint, stripping runner-managed flags (see
  // stripRunnerArgs) so they are not duplicated.
  const rawArgs = process.argv.slice(2);
  const forwardedArgs = stripRunnerArgs(rawArgs);

  const targets = resolveTargets(rawArgs);
  const cache = isCacheEnabled(rawArgs);
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

  await executeLintCommands(
    buildLintCommands({
      targets,
      forwardedArgs,
      cache,
      packageDirs: targets === null ? readPackageDirs(repoRoot) : [],
    }),
  );
}

/** Maps a signal name to its POSIX number, or undefined when unknown. */
function signalNumber(signal: unknown): number | undefined {
  if (typeof signal !== 'string') {
    return undefined;
  }
  const number = (osConstants.signals as Record<string, number | undefined>)[
    signal
  ];
  return typeof number === 'number' ? number : undefined;
}

/**
 * The signal that terminated the child, or undefined when it exited normally.
 * Distinguishes an interruption (which aborts the whole partitioned run) from
 * an ordinary lint failure (which does not).
 */
function terminationSignal(error: unknown): string | undefined {
  const signal =
    propertyValue(error, 'signalCode') ?? propertyValue(error, 'signal');
  return signalNumber(signal) === undefined ? undefined : String(signal);
}

/** A classified runner termination: an exit code and optional diagnostic. */
export interface RunnerFailure {
  readonly exitCode: number;
  readonly message?: string;
}

function buildSignalDiagnostic(signal: string, signum: number): string {
  const base = `Lint runner: ESLint was terminated by ${signal} (signal ${signum}). This is an interruption/kill (e.g. harness watchdog or OOM killer), not a lint failure.`;
  if (signal === 'SIGKILL') {
    return `${base} An out-of-memory kill is possible; each group runs with a ${DEFAULT_HEAP_MB} MB heap, so a kill means the machine could not supply that.`;
  }
  return base;
}

/**
 * Classifies a runner termination into an exit code plus an optional
 * user-facing diagnostic. Exported so the signal-interruption diagnostic
 * (issue #2994 / AC4) is testable without spawning ESLint.
 */
export function classifyRunnerFailure(error: unknown): RunnerFailure {
  const exitCode = propertyValue(error, 'exitCode');
  if (typeof exitCode === 'number') {
    return { exitCode };
  }
  const signal =
    propertyValue(error, 'signalCode') ?? propertyValue(error, 'signal');
  const signum = signalNumber(signal);
  if (signum !== undefined) {
    return {
      exitCode: 128 + signum,
      message: buildSignalDiagnostic(String(signal), signum),
    };
  }
  return {
    exitCode: 1,
    message: `Lint runner failed unexpectedly: ${messageOf(error)}`,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runLint().catch((error: unknown) => {
    const failure = classifyRunnerFailure(error);
    if (failure.message !== undefined) {
      console.error(failure.message);
    }
    // The unexpected-error path (generic exit 1 with a diagnostic) keeps the
    // stack trace so a crash is debuggable. Signal and ordinary-lint-failure
    // terminations already produced output on the inherited stdio.
    if (
      failure.exitCode === 1 &&
      failure.message !== undefined &&
      error instanceof Error &&
      error.stack !== undefined
    ) {
      console.error(error.stack);
    }
    process.exit(failure.exitCode);
  });
}
