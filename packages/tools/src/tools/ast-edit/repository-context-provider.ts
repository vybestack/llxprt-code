/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { RepositoryContext } from './types.js';

const GIT_TIMEOUT_MS = 3000;
const GIT_MAX_BUFFER = 1024 * 1024;
const GIT_ERROR_STDERR_LIMIT = 4096;
const RECENT_COMMIT_LIMIT = 5;

/** Outcome of a bounded working-set Git discovery run. */
export type WorkingSetDiscoveryOutcome =
  /** Every Git phase ran to exhaustion below the candidate cap. */
  | 'complete'
  /** Discovery stopped at the finite candidate cap: at least that many
   * eligible files existed and more were never observed. */
  | 'truncated'
  /** The AbortSignal fired; the exact in-flight Git child was terminated. */
  | 'aborted'
  /** A Git phase exited nonzero (or failed to spawn/timed out). */
  | 'git-error'
  /** The directory is not inside a Git work tree (or git is unavailable). */
  | 'no-working-set';

export interface WorkingSetDiscoveryOptions {
  /** Hard cap on observed candidates (finite, at least 1). */
  readonly maxCandidates: number;
  /** Cancellation signal; aborting terminates the exact in-flight child. */
  readonly signal?: AbortSignal;
  /** Absolute path excluded from candidacy (the read target itself). */
  readonly excludePath?: string;
}

export interface WorkingSetDiscoveryResult {
  /** Deduplicated absolute candidate paths, bounded by maxCandidates. */
  readonly candidates: readonly string[];
  readonly outcome: WorkingSetDiscoveryOutcome;
  /** Present iff outcome is git-error: the terminating Git failure. */
  readonly gitError?: string;
}

/** Terminal result of one NUL-delimited Git listing phase. */
interface GitPhaseResult {
  readonly status:
    | 'ok'
    | 'truncated'
    | 'aborted'
    | 'git-error'
    | 'output-overflow';
  /** Present iff status is git-error or output-overflow: the failure. */
  readonly error?: string;
}

interface GitCaptureResult {
  readonly kind: 'ok' | 'error' | 'aborted';
  readonly stdout?: string;
  readonly error?: string;
}

/**
 * RepositoryContextProvider handles git operations to collect repository context.
 */
export class RepositoryContextProvider {
  async collectRepositoryContext(
    rootPath: string,
  ): Promise<RepositoryContext | null> {
    try {
      const gitUrl = await this.getGitRemoteUrl(rootPath);
      const commitSha = await this.getCurrentCommit(rootPath);
      const branch = await this.getCurrentBranch(rootPath);

      if (!gitUrl && !commitSha) {
        return null; // Not a git repo or failed to get info
      }

      return {
        gitUrl: gitUrl ?? 'unknown',
        commitSha: commitSha ?? 'unknown',
        branch: branch ?? 'unknown',
        rootPath,
      };
    } catch {
      // Git info unavailable; not a git repo.
      return null;
    }
  }

  /**
   * Discover working-set candidates under a finite bound.
   *
   * Git phases run asynchronously and incrementally: NUL-delimited names are
   * decoded UTF-8-safely and observed one at a time, and the run stops at
   * {@link WorkingSetDiscoveryOptions.maxCandidates} candidates (the finite
   * count plus one-over sentinel semantics live with the caller's policy).
   * The provided AbortSignal terminates exactly the in-flight child process,
   * never anything broader. Git failures, truncation, and abort are surfaced
   * as outcomes instead of collapsing into an empty "complete" set. Once the
   * candidate cap is reached the observer is idempotent: stdout that was
   * already buffered when the child was killed can never add another
   * candidate past the cap.
   */
  async discoverWorkingSetFiles(
    workspaceRoot: string,
    options: WorkingSetDiscoveryOptions,
  ): Promise<WorkingSetDiscoveryResult> {
    const { maxCandidates, signal, excludePath } = options;
    if (!Number.isFinite(maxCandidates) || maxCandidates < 1) {
      throw new Error(
        `maxCandidates must be a positive finite number, got: ${String(
          maxCandidates,
        )}`,
      );
    }
    if (signal?.aborted ?? false) {
      return { candidates: [], outcome: 'aborted' };
    }

    const inside = await this.runGitCapture(
      workspaceRoot,
      ['rev-parse', '--is-inside-work-tree'],
      signal,
    );
    if (inside.kind === 'aborted') {
      return { candidates: [], outcome: 'aborted' };
    }
    if (inside.kind !== 'ok' || (inside.stdout ?? '').trim() !== 'true') {
      // A directory outside any repository has no working set. A repository
      // whose metadata is broken (e.g. an unparseable HEAD) fails the same
      // probe, so the on-disk .git presence decides between "no working set"
      // and a surfaced Git failure.
      if (inside.kind === 'error' && hasGitDirectory(workspaceRoot)) {
        return { candidates: [], outcome: 'git-error', gitError: inside.error };
      }
      return { candidates: [], outcome: 'no-working-set' };
    }

    const addName = createAddNameFn(workspaceRoot, excludePath, maxCandidates);
    const phases: string[][] = [
      ['diff', '--name-only', '-z'],
      ['diff', '--name-only', '--cached', '-z'],
    ];
    // A fresh repository without commits has no HEAD: the recent-commit
    // phase is skipped rather than reported as a Git error.
    const head = await this.runGitCapture(
      workspaceRoot,
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      signal,
    );
    if (head.kind === 'aborted') {
      return { candidates: [], outcome: 'aborted' };
    }
    if (head.kind === 'ok') {
      phases.push([
        'log',
        `-n${RECENT_COMMIT_LIMIT}`,
        '--name-only',
        '--format=',
        '-z',
      ]);
    }

    return this.collectPhaseCandidates(workspaceRoot, phases, signal, addName);
  }

  /** Run each NUL-delimited Git phase and collect candidates until one stops. */
  private async collectPhaseCandidates(
    workspaceRoot: string,
    phases: readonly string[][],
    signal: AbortSignal | undefined,
    addName: AddNameFn,
  ): Promise<WorkingSetDiscoveryResult> {
    for (const args of phases) {
      // A signal that fired between phases is already past every listener:
      // an aborted signal never re-fires, so the flag is checked directly
      // before another child is spawned.
      if (signal?.aborted ?? false) {
        return { candidates: addName.candidates, outcome: 'aborted' };
      }
      const result = await this.runGitNulPhase(
        workspaceRoot,
        args,
        signal,
        addName,
      );
      if (result.status === 'aborted') {
        return { candidates: addName.candidates, outcome: 'aborted' };
      }
      if (result.status === 'truncated') {
        return { candidates: addName.candidates, outcome: 'truncated' };
      }
      if (result.status === 'output-overflow') {
        // The listing itself exceeded its bounded output allowance. This is
        // a Git/discovery failure, not candidate-cap truncation: reporting
        // "truncated" would claim at least N eligible files were observed,
        // which was never established.
        return {
          candidates: addName.candidates,
          outcome: 'git-error',
          gitError:
            result.error ?? 'git working-set listing exceeded its output limit',
        };
      }
      if (result.status === 'git-error') {
        return {
          candidates: addName.candidates,
          outcome: 'git-error',
          gitError: result.error ?? 'git working-set listing failed',
        };
      }
    }
    return { candidates: addName.candidates, outcome: 'complete' };
  }

  /** Run one small Git command and capture stdout. Fails fast on spawn errors
   * and nonzero exit; aborts and timeouts terminate only the exact child.
   */
  private async runGitCapture(
    workspaceRoot: string,
    args: string[],
    signal: AbortSignal | undefined,
  ): Promise<GitCaptureResult> {
    return new Promise<GitCaptureResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn('git', ['-C', workspaceRoot, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        resolve({ kind: 'error', error: describeSpawnError(error) });
        return;
      }
      let aborted = false;
      let timedOut = false;
      let stdout = '';
      let stderr = '';
      const onAbort = createAbortHandler(child, () => {
        aborted = true;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, GIT_TIMEOUT_MS);
      const finish = createFinish(resolve, timer, signal, onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      // An already-aborted signal never fires a newly attached listener, so
      // the flag is checked directly after wiring: the child is killed and
      // the run settles as aborted instead of running to completion.
      if (signal?.aborted ?? false) {
        onAbort();
      }
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > GIT_MAX_BUFFER) {
          child.kill();
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < GIT_ERROR_STDERR_LIMIT) {
          stderr += chunk.toString('utf8');
        }
      });
      child.on('error', (error: Error) => {
        finish({ kind: 'error', error: describeSpawnError(error) });
      });
      child.on('close', (code: number | null) => {
        if (aborted) {
          finish({ kind: 'aborted' });
        } else if (timedOut) {
          finish({
            kind: 'error',
            error: `git timed out after ${GIT_TIMEOUT_MS}ms`,
          });
        } else if (stdout.length > GIT_MAX_BUFFER) {
          // The overflow kill leaves a signaled exit; report the actual
          // cause instead of a generic "exited with status null" line.
          finish({
            kind: 'error',
            error: 'git output exceeded the capture limit',
          });
        } else if (code === 0) {
          finish({ kind: 'ok', stdout });
        } else {
          finish({
            kind: 'error',
            error: stderr.trim() || `git exited with status ${String(code)}`,
          });
        }
      });
    });
  }

  /**
   * Run one NUL-delimited Git listing phase, feeding each decoded name to
   * the observer incrementally. Stops (terminating the exact child) when the
   * observer reports its cap or the bounded output allowance is exceeded.
   */
  private async runGitNulPhase(
    workspaceRoot: string,
    args: string[],
    signal: AbortSignal | undefined,
    onName: (name: string) => 'continue' | 'stop',
  ): Promise<GitPhaseResult> {
    const child = spawnGitChild(workspaceRoot, args);
    if (child === null) {
      return { status: 'git-error' };
    }
    return new Promise<GitPhaseResult>((resolve) => {
      wireGitNulPhase(child, signal, onName, resolve);
    });
  }

  private async getGitRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        'git',
        ['-C', repoPath, 'remote', 'get-url', 'origin'],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentCommit(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
      });
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        'git',
        ['-C', repoPath, 'branch', '--show-current'],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}

/** Render a Git spawn failure as a bounded single-line description. */
function describeSpawnError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Create an abort handler that marks the flag and kills the exact child. */
function createAbortHandler(
  child: ChildProcess,
  onAbort: () => void,
): () => void {
  return () => {
    onAbort();
    child.kill();
  };
}

/** Create a settle-once finish function that cleans up timer and signal. */
function createFinish<T>(
  resolve: (result: T) => void,
  timer: NodeJS.Timeout,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): (result: T) => void {
  let settled = false;
  return (result: T) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    resolve(result);
  };
}

/**
 * True when a .git entry exists at or above the directory. Used to separate
 * "outside any repository" from a repository whose metadata is broken: both
 * fail the same rev-parse probe, but only the latter is a Git failure.
 */
function hasGitDirectory(startDir: string): boolean {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, '.git'))) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

/**
 * Create the incremental name observer used by discovery. Deduplicates names,
 * resolves them to absolute paths, honors the exclude path, and stops when
 * the candidate count reaches the cap. The observer is idempotent once the
 * cap is reached: late names from stdout that was already buffered when the
 * child was killed are refused instead of appended, so the candidate array
 * can never exceed maxCandidates. The candidate array is captured in the
 * closure and returned by the outer {@link RepositoryContextProvider} phase
 * loop.
 */
function createAddNameFn(
  workspaceRoot: string,
  excludePath: string | undefined,
  maxCandidates: number,
): AddNameFn {
  const names = new Set<string>();
  const candidates: string[] = [];
  let capped = false;
  const fn = (name: string): 'continue' | 'stop' => {
    if (capped) {
      return 'stop';
    }
    if (!name.trim() || names.has(name)) {
      return 'continue';
    }
    names.add(name);
    const absolute = path.resolve(workspaceRoot, name);
    if (excludePath !== undefined && isSamePath(absolute, excludePath)) {
      return 'continue';
    }
    candidates.push(absolute);
    if (candidates.length >= maxCandidates) {
      capped = true;
      return 'stop';
    }
    return 'continue';
  };
  return Object.assign(fn, { candidates });
}

/** Platforms whose filesystems resolve paths case-insensitively. */
const CASE_INSENSITIVE_PATH_PLATFORMS: ReadonlySet<string> = new Set([
  'win32',
  'darwin',
]);

/**
 * True when two absolute paths denote the same file. Git reports tracked
 * names with their literal on-disk casing while a caller may hold an
 * equivalently-spelled path in different case; on Windows and macOS those
 * are the same file and must compare equal for exclusion.
 */
function isSamePath(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return (
    CASE_INSENSITIVE_PATH_PLATFORMS.has(process.platform) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

/** Add-name callback with a captured candidates array. */
interface AddNameFn {
  (name: string): 'continue' | 'stop';
  readonly candidates: string[];
}

/** Spawn a Git child process for NUL-delimited listing, or null on failure. */
function spawnGitChild(
  workspaceRoot: string,
  args: readonly string[],
): ChildProcess | null {
  try {
    return spawn('git', ['-C', workspaceRoot, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/** Why a NUL-delimited listing phase stopped consuming its stream. */
type PhaseStop = 'none' | 'capped' | 'overflow';

/** Wire all event handlers for one NUL-delimited Git listing phase. */
function wireGitNulPhase(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  onName: (name: string) => 'continue' | 'stop',
  resolve: (result: GitPhaseResult) => void,
): void {
  let aborted = false;
  let timedOut = false;
  let stop: PhaseStop = 'none';
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let observedBytes = 0;
  let stderr = '';
  const onAbort = createAbortHandler(child, () => {
    aborted = true;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, GIT_TIMEOUT_MS);
  const finish = createFinish(resolve, timer, signal, onAbort);
  signal?.addEventListener('abort', onAbort, { once: true });
  // An already-aborted signal never fires a newly attached listener, so the
  // flag is checked directly after wiring: the child is killed and the phase
  // settles as aborted instead of streaming names for a cancelled run.
  if (signal?.aborted ?? false) {
    onAbort();
  }

  const consume = (text: string): boolean => {
    pending += text;
    let separator = pending.indexOf('\0');
    while (separator !== -1) {
      const name = pending.slice(0, separator);
      pending = pending.slice(separator + 1);
      if (name.length > 0 && onName(name) === 'stop') {
        return true;
      }
      separator = pending.indexOf('\0');
    }
    return false;
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    // Idempotent stop: stdout that was already buffered when the child was
    // killed keeps arriving, but no name is observed afterwards. Without
    // this guard those late chunks push candidates past the cap.
    if (stop !== 'none') {
      return;
    }
    observedBytes += chunk.length;
    if (consume(decoder.write(chunk))) {
      stop = 'capped';
      child.kill();
      return;
    }
    if (observedBytes > GIT_MAX_BUFFER) {
      stop = 'overflow';
      child.kill();
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < GIT_ERROR_STDERR_LIMIT) {
      stderr += chunk.toString('utf8');
    }
  });
  child.on('error', () => {
    finish({ status: 'git-error' });
  });
  child.on('close', (code: number | null) => {
    finish(
      closeResult(
        code,
        aborted,
        stop,
        timedOut,
        pending,
        decoder,
        onName,
        stderr,
      ),
    );
  });
}

/** Derive the terminal result from a close event. */
function closeResult(
  code: number | null,
  aborted: boolean,
  stop: PhaseStop,
  timedOut: boolean,
  pending: string,
  decoder: StringDecoder,
  onName: (name: string) => 'continue' | 'stop',
  stderr: string,
): GitPhaseResult {
  if (aborted) {
    return { status: 'aborted' };
  }
  if (stop === 'overflow') {
    return {
      status: 'output-overflow',
      error: `git working-set listing exceeded its ${GIT_MAX_BUFFER}-byte output limit`,
    };
  }
  if (stop === 'capped') {
    return { status: 'truncated' };
  }
  if (timedOut) {
    return {
      status: 'git-error',
      error: `git timed out after ${GIT_TIMEOUT_MS}ms`,
    };
  }
  if (code !== 0) {
    return {
      status: 'git-error',
      error: stderr.trim() || `git exited with status ${String(code)}`,
    };
  }
  // Flush any trailing name emitted without a final NUL separator.
  const tail = pending + decoder.end();
  if (tail.length > 0 && onName(tail) === 'stop') {
    return { status: 'truncated' };
  }
  return { status: 'ok' };
}
