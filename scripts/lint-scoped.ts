#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scoped lint CLI (issue #2994).
 *
 * Surfaces the ALREADY EXISTING scoped-target mode of `scripts/run-lint.ts`
 * for local developers. It composes an argv for the runner and spawns it
 * (`bun scripts/run-lint.ts ...` with inherited stdio), propagating the
 * child's exit code and signal exit code (128 + signum) exactly. It does NOT
 * reimplement the runner's target dedup/sort/integration-tests logic, nor
 * ESLint invocation.
 *
 * Two modes:
 *  - Explicit targets (`bun scripts/lint-scoped.ts <target> ...`): forwards a
 *    JSON array on `--targets`. No `--max-warnings 0` is injected; this is
 *    `npm run lint`, scoped.
 *  - Changed-files (`--changed`): derives changed paths vs the merge base and
 *    delegates target selection to the REAL `selectLintTargets` from
 *    `./affected-lint-targets.ts`, honoring its fail-closed decisions.
 *
 * Pure, exportable logic (`parseScopedArgs`, `buildRunnerArgs`, plan
 * formatters) is separated from the thin git I/O so behavior is testable
 * without spawning ESLint.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageOf, propertyValue } from './utils/error-guards.ts';
import { selectLintTargets } from './affected-lint-targets.ts';

const RUNNER_SCRIPT = fileURLToPath(new URL('./run-lint.ts', import.meta.url));
const PULL_REQUEST_EVENT = 'pull_request';
const BASE_CANDIDATES = ['origin/main', 'main'] as const;
/**
 * Env var the runner reads as a fallback scoped-target list. The wrapper
 * always decides targets itself and forwards them on `--targets`, so this
 * variable must be stripped from the child environment (see buildRunnerEnv).
 */
const LINT_TARGETS_ENV = 'LLXPRT_LINT_TARGETS';
/**
 * Generously sized child-process stdout buffer. A large changed-path list can
 * exceed Node's default 1 MiB cap (ENOBUFS); 64 MiB matches the repo
 * convention (e.g. scripts/eslint-guard, scripts/genai-enclave).
 */
const GIT_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

/** Parsed scoped-lint options. */
export interface ScopedLintOptions {
  readonly changed: boolean;
  readonly base: string | null;
  readonly fix: boolean;
  readonly cache: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly targets: readonly string[];
}

/** Thrown by {@link parseScopedArgs} for every invalid invocation. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * A resolved lint plan. Discriminated so every branch returns honestly:
 * `nothing` (changed-files mode found no changes) is a real outcome the caller
 * reports and exits on, not a hidden `process.exit` inside the resolver.
 */
type LintPlan =
  | { readonly kind: 'scoped'; readonly targets: readonly string[] }
  | { readonly kind: 'full'; readonly reason: string }
  | { readonly kind: 'nothing'; readonly message: string };

const USAGE_TEXT = `Usage: bun scripts/lint-scoped.ts [options] [<target> ...]

Surfaces the scoped-target mode of scripts/run-lint.ts for local use.

Options:
  --changed          Derive targets from files changed vs the merge base
  --base <ref>       Base ref for --changed (requires --changed)
  --fix              Forward --fix to ESLint
  --cache            Enable the opt-in ESLint cache (forwarded to the runner)
  --dry-run          Print the resolved plan and exit 0 without spawning ESLint
  -h, --help         Print this usage and exit 0

Targets are forwarded to the runner as a JSON array on --targets. The runner
always includes integration-tests and deduplicates/sorts targets.

Examples:
  npm run lint:scoped -- packages/cli
  npm run lint:scoped -- packages/cli/ packages/core/ --fix
  npm run lint:changed -- --base origin/main`;

// ---------------------------------------------------------------------------
// Pure logic (exported for behavioral tests)
// ---------------------------------------------------------------------------

/**
 * Normalizes a positional target by trimming trailing slashes/backslashes so
 * shell tab-completion output (e.g. `packages/cli/`) works. Throws
 * {@link UsageError} for a target that is empty after normalization.
 */
function normalizeTarget(target: string): string {
  let end = target.length;
  while (end > 0 && isPathSeparator(target[end - 1])) {
    end--;
  }
  const normalized = target.slice(0, end);
  if (normalized.length === 0) {
    throw new UsageError(
      `Invalid target '${target}' (empty after normalizing trailing slashes).`,
    );
  }
  return normalized;
}

function isPathSeparator(char: string): boolean {
  return char === '/' || char === '\\';
}

/**
 * Parses scoped-lint argv. Throws {@link UsageError} for every invalid case:
 * unknown flag, `--base` without `--changed`, `--base` with a missing or
 * flag-looking value, `--changed` combined with explicit targets, or an
 * invocation with neither `--changed` nor any positional target. `--help`
 * short-circuits and returns help=true.
 */
export function parseScopedArgs(argv: readonly string[]): ScopedLintOptions {
  let changed = false;
  let base: string | null = null;
  let fix = false;
  let cache = false;
  let dryRun = false;
  const targets: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--changed') {
      changed = true;
    } else if (arg === '--fix') {
      fix = true;
    } else if (arg === '--cache') {
      cache = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      return {
        changed: false,
        base: null,
        fix: false,
        cache: false,
        dryRun: false,
        help: true,
        targets: [],
      };
    } else if (arg === '--base') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new UsageError(
          '--base requires a value (e.g. --base origin/main).',
        );
      }
      if (value.startsWith('-')) {
        throw new UsageError(
          `--base value '${value}' looks like an option, not a ref.`,
        );
      }
      base = value;
      i++;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else {
      targets.push(normalizeTarget(arg));
    }
  }

  if (base !== null && !changed) {
    throw new UsageError('--base can only be used with --changed.');
  }
  if (changed && targets.length > 0) {
    throw new UsageError('--changed cannot be combined with explicit targets.');
  }
  if (!changed && targets.length === 0) {
    throw new UsageError('Specify at least one target, or use --changed.');
  }

  return { changed, base, fix, cache, dryRun, help: false, targets };
}

/**
 * Composes the argv forwarded to `scripts/run-lint.ts`. `targets === null`
 * means a full-tree run (no `--targets`). `--fix` and `--cache` are forwarded
 * only when set. No `--max-warnings 0` is injected.
 */
export function buildRunnerArgs(params: {
  readonly targets: readonly string[] | null;
  readonly fix: boolean;
  readonly cache: boolean;
}): string[] {
  const args: string[] = [];
  if (params.targets !== null) {
    args.push('--targets', JSON.stringify([...params.targets]));
  }
  if (params.fix) {
    args.push('--fix');
  }
  if (params.cache) {
    args.push('--cache');
  }
  return args;
}

/** Formats the loud plan line for a scoped (explicit-target) run. */
export function formatScopedPlan(targets: readonly string[]): string {
  return `lint-scoped: scoped run — targets: ${targets.join(', ')}`;
}

/** Formats the loud plan line for a full-tree run, with its reason. */
export function formatFullRunPlan(reason: string): string {
  return `lint-scoped: full run — ${reason}`;
}

// ---------------------------------------------------------------------------
// Thin git I/O
// ---------------------------------------------------------------------------

function signalNumber(signal: string): number | undefined {
  const number = (osConstants.signals as Record<string, number | undefined>)[
    signal
  ];
  return typeof number === 'number' ? number : undefined;
}

/**
 * Runs git and returns stdout. stderr is captured rather than inherited so a
 * probe that is expected to fail (e.g. `origin/main` missing during base
 * resolution) does not leak a scary `fatal:` line on an otherwise successful
 * run; the captured text is surfaced by {@link gitFailureDetail} when a
 * failure is genuinely fatal.
 */
function gitText(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Returns null when the ref resolves, or git's own failure text when it does not. */
function refFailure(ref: string): string | null {
  try {
    gitText(['rev-parse', '--verify', `${ref}^{commit}`]);
    return null;
  } catch (error) {
    return gitFailureDetail(error);
  }
}

/**
 * Resolves the base ref: an explicit `--base` wins and must resolve; otherwise
 * the first of `origin/main`, `main` that resolves. Throws a clear, ref-naming
 * error when nothing resolves.
 */
function resolveBaseRef(explicit: string | null): string {
  if (explicit !== null) {
    const failure = refFailure(explicit);
    if (failure === null) {
      return explicit;
    }
    throw new Error(
      `Could not resolve base ref '${explicit}'. Pass --base <ref> to specify a valid base. git: ${failure}`,
    );
  }
  for (const candidate of BASE_CANDIDATES) {
    if (refFailure(candidate) === null) {
      return candidate;
    }
  }
  throw new Error(
    `Could not resolve a base ref (tried ${BASE_CANDIDATES.join(', ')}). Pass --base <ref> to specify a valid base.`,
  );
}

/**
 * Extracts git's own stderr from a failed `execFileSync` so the wrapper's
 * error message keeps the underlying diagnostic (shallow clone, permissions,
 * corrupted repo) instead of discarding it.
 */
function gitFailureDetail(error: unknown): string {
  const stderr = propertyValue(error, 'stderr');
  const detail = typeof stderr === 'string' ? stderr.trim() : '';
  return detail.length > 0 ? detail : messageOf(error);
}

function resolveMergeBase(base: string): string {
  let out: string;
  try {
    out = gitText(['merge-base', base, 'HEAD']);
  } catch (error) {
    throw new Error(
      `Could not compute merge-base of '${base}' and HEAD. Pass --base <ref> to specify a valid base. git: ${gitFailureDetail(error)}`,
    );
  }
  return out.trim();
}

/**
 * Splits NUL-delimited git output (from `-z`) into records, dropping only the
 * genuinely empty trailing record. Unlike newline splitting + trim(), this
 * preserves leading/trailing spaces and other legal pathname bytes, and `-z`
 * disables git's quoting of unusual pathnames (core.quotePath).
 */
function splitNullDelimited(text: string): string[] {
  return text.split('\0').filter((record) => record.length > 0);
}

/**
 * Changed paths = union of `git diff -z --no-renames --name-only <mergeBase>`
 * (committed, staged and unstaged work, since it diffs the working tree) and
 * untracked files from `git ls-files -z --others --exclude-standard`.
 * `--no-renames` reports BOTH endpoints of a rename so a moved package file
 * keeps its old owner classified. NUL-delimited output preserves legal
 * pathname bytes without depending on user git config. Deduped and sorted.
 */
function collectChangedPaths(mergeBase: string): string[] {
  const tracked = splitNullDelimited(
    gitText(['diff', '--no-renames', '--name-only', '-z', mergeBase]),
  );
  const untracked = splitNullDelimited(
    gitText(['ls-files', '-z', '--others', '--exclude-standard']),
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Resolves a changed-files lint plan, honoring the selector's fail-closed. */
function runChanged(options: ScopedLintOptions): LintPlan {
  const base = resolveBaseRef(options.base);
  const mergeBase = resolveMergeBase(base);
  const changedPaths = collectChangedPaths(mergeBase);
  if (changedPaths.length === 0) {
    return {
      kind: 'nothing',
      message: `No files changed relative to ${base} (merge-base ${mergeBase}); nothing to lint.`,
    };
  }
  const selection = selectLintTargets({
    event: PULL_REQUEST_EVENT,
    changedPaths,
  });
  if (selection.fullRun) {
    return {
      kind: 'full',
      reason:
        selection.fullRunReason ?? 'affected selection chose a full-tree run',
    };
  }
  return { kind: 'scoped', targets: selection.targets };
}

/**
 * Builds the child environment for the runner. The wrapper always decides
 * targets itself (explicit `--targets`, or the selector for `--changed`), so
 * an inherited `LLXPRT_LINT_TARGETS` must never reach the runner's
 * `resolveTargets` — it would silently turn a fail-closed full run into a
 * scoped subset (AC2). `LLXPRT_LINT_CACHE` is deliberately preserved: it is
 * an intentional, documented opt-in. Exported for behavioral tests.
 */
export function buildRunnerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[LINT_TARGETS_ENV];
  return env;
}

/** Renders the exact argv the runner receives, as an honest JSON vector. */
function formatRunnerArgv(runnerArgs: readonly string[]): string {
  const argv = [process.execPath, RUNNER_SCRIPT, ...runnerArgs];
  return `lint-scoped: dry-run — runner argv: ${JSON.stringify(argv)}`;
}

/** Spawns the runner with inherited stdio, returning the propagated exit code. */
function spawnRunner(runnerArgs: readonly string[]): number {
  const result = spawnSync(process.execPath, [RUNNER_SCRIPT, ...runnerArgs], {
    stdio: 'inherit',
    env: buildRunnerEnv(),
  });
  if (result.error !== undefined) {
    throw new Error(`Failed to spawn lint runner: ${messageOf(result.error)}`);
  }
  if (result.signal !== null) {
    const signum = signalNumber(result.signal);
    return signum === undefined ? 1 : 128 + signum;
  }
  return result.status ?? 1;
}

/** Prints the loud plan line, then either dry-run argv or spawns the runner. */
function executePlan(
  plan: LintPlan,
  fix: boolean,
  cache: boolean,
  dryRun: boolean,
): void {
  if (plan.kind === 'nothing') {
    process.stdout.write(`${plan.message}\n`);
    return;
  }
  const targets = plan.kind === 'scoped' ? plan.targets : null;
  const runnerArgs = buildRunnerArgs({ targets, fix, cache });
  const planLine =
    plan.kind === 'scoped'
      ? formatScopedPlan(plan.targets)
      : formatFullRunPlan(plan.reason);
  process.stdout.write(`${planLine}\n`);
  if (dryRun) {
    process.stdout.write(`${formatRunnerArgv(runnerArgs)}\n`);
    return;
  }
  process.exit(spawnRunner(runnerArgs));
}

function main(): void {
  let options: ScopedLintOptions;
  try {
    options = parseScopedArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${USAGE_TEXT}\n${error.message}\n`);
    } else {
      process.stderr.write(`lint-scoped: ${messageOf(error)}\n`);
    }
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(`${USAGE_TEXT}\n`);
    process.exit(0);
  }

  let plan: LintPlan;
  try {
    plan = options.changed
      ? runChanged(options)
      : { kind: 'scoped', targets: options.targets };
  } catch (error) {
    process.stderr.write(`lint-scoped: ${messageOf(error)}\n`);
    process.exit(2);
  }

  executePlan(plan, options.fix, options.cache, options.dryRun);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
