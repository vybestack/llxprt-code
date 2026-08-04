#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical lint runner (issue #2710).
 *
 * A single root ESLint invocation handles the full tree (including
 * integration-tests). Scoped runs (CI PRs) consume an explicit JSON target
 * list and always include integration-tests as an explicit target so the
 * separate integration-test ESLint pass is covered after collapsing duplicate
 * traversals. Cache is opt-in (CI only) and never silently enabled locally.
 *
 * `lint`, `lint:ci`, and `lint:fix` delegate to this runner. The LSP package's
 * separate lint step is intentionally preserved.
 */

import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execa } from 'execa';
import { messageOf, propertyValue } from './utils/error-guards.ts';

const DEFAULT_HEAP_MB = 12288;
const ESLINT_CACHE_LOCATION = 'node_modules/.cache/eslint';
const INTEGRATION_TESTS_TARGET = 'integration-tests';
const FULL_TARGET = '.';
const LINT_TARGETS_ENV = 'LLXPRT_LINT_TARGETS';

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
}

/** Parameters for the exported command builder. */
export interface BuildCommandsParams {
  /** Explicit scoped targets, or null for a full root run. */
  readonly targets: readonly string[] | null;
  readonly forwardedArgs: readonly string[];
  readonly cache: boolean;
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
 * the commands sequentially with fail-fast exit/signal propagation.
 */
export function buildLintCommands({
  targets,
  forwardedArgs,
  cache,
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

  const cacheArgs: readonly string[] = cache
    ? [
        '--cache',
        '--cache-strategy',
        'content',
        '--cache-location',
        ESLINT_CACHE_LOCATION,
      ]
    : [];

  // Full run: a single root invocation covers the whole tree including
  // integration-tests. No duplicate integration-test pass.
  if (targets === null) {
    return [
      {
        cmd: eslintBin,
        args: [FULL_TARGET, ...forwardedArgs, ...cacheArgs],
        nodeOptions: resolvedNodeOptions,
      },
    ];
  }

  // Scoped run: forward the explicit target list, always including
  // integration-tests (deduplicated).
  const targetSet = new Set<string>(targets);
  targetSet.add(INTEGRATION_TESTS_TARGET);
  const orderedTargets = [...targetSet].sort();

  return [
    {
      cmd: eslintBin,
      args: [...orderedTargets, ...forwardedArgs, ...cacheArgs],
      nodeOptions: resolvedNodeOptions,
    },
  ];
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

async function runLint(): Promise<void> {
  // Forward CLI args to ESLint, stripping runner-managed flags (see
  // stripRunnerArgs) so they are not duplicated.
  const rawArgs = process.argv.slice(2);
  const forwardedArgs = stripRunnerArgs(rawArgs);

  const targets = resolveTargets(rawArgs);
  const cache = isCacheEnabled(rawArgs);

  const commands = buildLintCommands({
    targets,
    forwardedArgs,
    cache,
  });

  // Fail-fast: stop at the first failing scope (matches package-script &&).
  for (const { cmd, args, nodeOptions } of commands) {
    await execa(cmd, [...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
    });
  }
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

/** A classified runner termination: an exit code and optional diagnostic. */
export interface RunnerFailure {
  readonly exitCode: number;
  readonly message?: string;
}

function buildSignalDiagnostic(signal: string, signum: number): string {
  const base = `Lint runner: ESLint was terminated by ${signal} (signal ${signum}). This is an interruption/kill (e.g. harness watchdog or OOM killer), not a lint failure.`;
  if (signal === 'SIGKILL') {
    return `${base} An out-of-memory kill is a likely cause given the full-tree run's memory profile.`;
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
