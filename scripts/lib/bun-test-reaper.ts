/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-run reaping of stale orphaned `bun test` processes, extracted from
 * `scripts/run_bun_tests.ts` (which re-exports `reapStaleBunTestProcesses`
 * so its public import surface is unchanged).
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { killRunnerChild } from './bespoke-runner-isolation.js';

/** Basenames the reaper accepts as the bun executable. */
const BUN_BASENAMES: ReadonlySet<string> = new Set(['bun', 'bun.exe']);

/**
 * Whether a path token names the bun binary itself: its basename must be
 * `bun`, or `bun.exe` (the name the bundled runtime ships under).
 */
function isBunToken(token: string): boolean {
  const basename = token.split('/').pop() ?? '';
  return BUN_BASENAMES.has(basename);
}

/**
 * Detects and kills stale orphaned `bun test` processes (PPID=1) before
 * starting a new run. When a parent test runner is killed (e.g. by OOM),
 * child `bun test` processes reparent to PID 1 and keep spinning
 * indefinitely — consuming CPU and memory. This guard prevents that
 * accumulation by reaping orphans at the start of every run.
 *
 * The executable identity comes from two independent `ps` captures,
 * because the argument string alone is not trustworthy: `ps -eo args=`
 * renders argv as a display string without quoting, so a session prompt
 * that mentions a path ending in `/bun` followed by the word `test` is
 * indistinguishable from a real `<bun> test` argv. That exact shape reaped
 * the sandboxed CLI under `podman --init` (PPID 1, argv starting with
 * `node`, the word `test` riding in the prompt) and killed the session
 * mid-task with a silent status-0 exit (#3491). `ps -eo pid=,comm=`
 * reports the binary independently of argv — macOS prints the full
 * executable path, where the llxprt shim shows as `node`; Linux prints
 * the base command name — so no prompt content can forge it.
 *
 * A candidate is reaped only when every check holds:
 *
 * - `ppid === 1` and `pid !== ownPid` (an orphan, never this process)
 * - the basename of that pid's `comm` is `bun` or `bun.exe` — this alone
 *   excludes the CLI shim, whose comm is `node`, no matter what the
 *   prompt says
 * - in `args`, the token immediately after the FIRST token whose basename
 *   is `bun` or `bun.exe` is exactly `test`, the exact argv shape this
 *   runner spawns (`buildSpawnArgs`: `<bun-executable> test [flags...]
 *   <file>`). Anchoring on the bun-basename token rather than token 0
 *   keeps executables whose paths contain spaces reaped, because `ps
 *   args=` renders those unquoted. A path whose interior directory
 *   segment itself ends in `bun` fails to match and is simply not reaped;
 *   failing closed there is correct.
 * - the final argv token is exactly the owner token this checkout's runner
 *   appends to every `bun test` it spawns (issue #3514). PPID 1 and the
 *   argv shape say nothing about which checkout, user, or CI job started
 *   the process, so an orphan without this checkout's token is left alone.
 *   That includes this checkout's own orphans from a runner that predates
 *   the token and manual `bun test` runs: they need a one-time manual kill.
 *
 * Exposed as a standalone function for testability.
 */
function isOrphanedTestProcess(
  ppid: number,
  pid: number,
  args: string,
  executable: string | undefined,
  ownPid: number,
  ownerToken: string,
): boolean {
  if (ppid !== 1 || pid === ownPid) return false;
  if (executable === undefined || !isBunToken(executable)) return false;
  const tokens = args.trim().split(/\s+/);
  if (tokens.at(-1) !== ownerToken) return false;
  const bunIndex = tokens.findIndex((token) => isBunToken(token));
  if (bunIndex < 0) return false;
  return tokens[bunIndex + 1] === 'test';
}

/** How long SIGTERM'd orphans get to exit before ownership is revalidated. */
const TERM_GRACE_MS = 2_000;
/** How long SIGKILL'd orphans get to disappear before they are left uncounted. */
const KILL_GRACE_MS = 1_000;
const EXIT_POLL_INTERVAL_MS = 50;

/**
 * Pids of the orphans that currently pass `isOrphanedTestProcess` for this
 * checkout's owner token. A failing `ps` yields none, so nothing is signalled
 * on evidence that could not be gathered.
 */
function findOwnedOrphans(
  spawnSync: (cmd: readonly string[]) => { stdout: string | null },
  ownPid: number,
  ownerToken: string,
): number[] {
  let commOutput: string;
  let output: string;
  try {
    commOutput = spawnSync(['ps', '-eo', 'pid=,comm=']).stdout ?? '';
    // -ww lifts the width limit: procps ps truncates piped output to
    // COLUMNS, and the owner token is the final args token.
    output = spawnSync(['ps', '-ww', '-eo', 'pid=,ppid=,args=']).stdout ?? '';
  } catch {
    return [];
  }

  // The comm table maps each pid to its kernel-reported executable. comm
  // is the last field, so a line is a pid followed by the rest of the
  // line; that keeps a macOS full executable path containing spaces
  // intact. Linux reports only the base command name, which the basename
  // check handles identically.
  const executables = new Map<number, string>();
  for (const line of commOutput.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    if (Number.isFinite(pid)) {
      executables.set(pid, parts.slice(1).join(' '));
    }
  }

  const owned: number[] = [];
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    const ppid = parseInt(parts[1] ?? '', 10);
    const args = parts.slice(2).join(' ');
    if (
      Number.isFinite(pid) &&
      Number.isFinite(ppid) &&
      isOrphanedTestProcess(
        ppid,
        pid,
        args,
        executables.get(pid),
        ownPid,
        ownerToken,
      )
    ) {
      owned.push(pid);
    }
  }
  return owned;
}

function trySignal(
  kill: (pid: number, signal: string | number) => void,
  pid: number,
  signal: 'SIGTERM' | 'SIGKILL',
): boolean {
  try {
    kill(pid, signal);
    return true;
  } catch {
    // Process may have already exited, or we may not be permitted to signal
    // it; either way this reaper did not terminate it.
    return false;
  }
}

/** Signal 0 raising ESRCH is the only evidence that a process is gone. */
function hasExited(
  kill: (pid: number, signal: string | number) => void,
  pid: number,
): boolean {
  try {
    kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}

/**
 * Polls until every pid has exited or the grace elapses, and returns the pids
 * still running. Sleeps only while something is pending.
 */
function awaitExits(
  pids: readonly number[],
  graceMs: number,
  kill: (pid: number, signal: string | number) => void,
  sleep: (ms: number) => void,
): number[] {
  let pending = [...pids];
  for (let waitedMs = 0; ; waitedMs += EXIT_POLL_INTERVAL_MS) {
    pending = pending.filter((pid) => !hasExited(kill, pid));
    if (pending.length === 0 || waitedMs >= graceMs) return pending;
    sleep(EXIT_POLL_INTERVAL_MS);
  }
}

/**
 * SIGTERMs this checkout's owned orphans, escalates to SIGKILL for those still
 * running after the grace (revalidating ownership first), and returns how many
 * signal 0 confirmed gone. `sleep` blocks synchronously; it is injected so
 * callers own the clock.
 */
export function reapStaleBunTestProcesses(
  spawnSync: (cmd: readonly string[]) => { stdout: string | null },
  kill: (pid: number, signal: string | number) => void,
  ownPid: number,
  ownerToken: string,
  sleep: (ms: number) => void,
  stderr?: (line: string) => void,
): number {
  const terminated = findOwnedOrphans(spawnSync, ownPid, ownerToken).filter(
    (pid) => trySignal(kill, pid, 'SIGTERM'),
  );
  const survivors = awaitExits(terminated, TERM_GRACE_MS, kill, sleep);
  let confirmed = terminated.length - survivors.length;

  if (survivors.length > 0) {
    // The pid may have been reused during the grace; SIGKILL only what is
    // still an owned orphan.
    const stillOwned = new Set(findOwnedOrphans(spawnSync, ownPid, ownerToken));
    const killed = survivors.filter(
      (pid) => stillOwned.has(pid) && trySignal(kill, pid, 'SIGKILL'),
    );
    confirmed +=
      killed.length - awaitExits(killed, KILL_GRACE_MS, kill, sleep).length;
  }

  if (confirmed > 0 && stderr) {
    stderr(
      `[run_bun_tests] Reaped ${confirmed} stale orphaned test process(es) (PPID=1) before run.`,
    );
  }
  return confirmed;
}

export interface CoreReapOptions {
  readonly reapTimeoutMs?: number;
  readonly taskkillTimeoutMs?: number;
}
export interface AttemptCleanupOptions {
  readonly cleanupAttempts?: number;
  readonly cleanupRetryDelayMs?: number;
  readonly removeAttemptDir?: (attemptDir: string) => void;
}
const REAP_TIMEOUT_MS = 10_000;
const TASKKILL_TIMEOUT_MS = 10_000;

// Windows can transiently refuse removal of a directory whose report file
// was just closed (AV scanners, search indexers, reporter teardown still
// holding handles), reporting EBUSY/EPERM/EACCES/ENOTEMPTY. Removal gets a
// bounded number of retries for exactly those errors; anything else
// propagates immediately.
const RETRYABLE_CLEANUP_ERROR_CODES: ReadonlySet<string> = new Set([
  'EBUSY',
  'EPERM',
  'EACCES',
  'ENOTEMPTY',
]);
const DEFAULT_CLEANUP_ATTEMPTS = 3;
const DEFAULT_CLEANUP_RETRY_DELAY_MS = 100;

function isRetryableCleanupError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    RETRYABLE_CLEANUP_ERROR_CODES.has(error.code)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function cleanupAttemptDirectory(
  attemptDir: string,
  options: AttemptCleanupOptions,
): Promise<void> {
  const remove =
    options.removeAttemptDir ??
    ((dir: string) => {
      rmSync(dir, { recursive: true, force: true });
    });
  const attempts = options.cleanupAttempts ?? DEFAULT_CLEANUP_ATTEMPTS;
  const retryDelayMs =
    options.cleanupRetryDelayMs ?? DEFAULT_CLEANUP_RETRY_DELAY_MS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      remove(attemptDir);
      return;
    } catch (error) {
      if (!isRetryableCleanupError(error)) throw error;
      lastError = error;
      if (attempt < attempts) {
        await delay(retryDelayMs);
      }
    }
  }
  const lastDetail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`removal failed after ${attempts} attempts: ${lastDetail}`, {
    cause: lastError,
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function observeChildClose(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });
}

export async function killChildTreeAndWait(
  child: ChildProcess,
  childClosed: Promise<void>,
  options: CoreReapOptions = {},
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('Cannot reap test process without a PID');
  }

  if (process.platform === 'win32') {
    await killWindowsTreeAndWait(pid, childClosed, options);
    return;
  }
  const timeoutMs = options.reapTimeoutMs ?? REAP_TIMEOUT_MS;
  const deadlineAt = performance.now() + timeoutMs;
  const owned = new Map<number, ProcessIdentity>();
  for (const [memberPid, identity] of readProcessTable(timeoutMs)) {
    if (identity.group === pid) owned.set(memberPid, identity);
  }
  // POSIX: kill the entire per-test process group by negative PID. The
  // child was spawned with detached: true (see runTestFile) so it leads
  // its own group; this sends SIGKILL to every descendant that inherited
  // it (e.g. grandchildren spawned via Bun.spawn), which child.kill()
  // alone would orphan.
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ESRCH') throw error;
  }

  await waitForPosixTreeClose(pid, childClosed, owned, timeoutMs, deadlineAt);
}

interface ProcessIdentity {
  readonly group: number;
  readonly started: string;
}

function readProcessTable(timeoutMs: number): Map<number, ProcessIdentity> {
  const result = spawnSync('ps', ['-axo', 'pid=,pgid=,lstart='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Math.max(1, Math.ceil(timeoutMs)),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Cannot observe owned test processes: ${result.stderr}`);
  }
  const table = new Map<number, ProcessIdentity>();
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [pid, group, ...started] = line.trim().split(/\s+/);
    const memberPid = Number(pid);
    const processGroup = Number(group);
    if (
      !Number.isSafeInteger(memberPid) ||
      !Number.isSafeInteger(processGroup) ||
      started.length === 0
    )
      throw new Error(`Invalid process identity: ${line}`);
    table.set(memberPid, {
      group: processGroup,
      started: started.join(' '),
    });
  }
  return table;
}

function waitForPosixTreeClose(
  pid: number,
  childClosed: Promise<void>,
  owned: ReadonlyMap<number, ProcessIdentity>,
  timeoutMs: number,
  deadlineAt: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      finished = true;
      clearTimeout(deadline);
      clearTimeout(poll);
    };
    const fail = (error: unknown): void => {
      finish();
      reject(error);
    };
    const deadline = setTimeout(
      () => {
        fail(
          new Error(
            `Timed-out child (pid ${pid}) process group close lifecycle did not complete within ${timeoutMs}ms`,
          ),
        );
      },
      Math.max(0, deadlineAt - performance.now()),
    );
    const observeGroupExit = (): void => {
      try {
        const current = readProcessTable(deadlineAt - performance.now());
        // A descendant's kernel entry can outlive the direct child's close.
        // Retain its start identity so PID reuse cannot adopt unrelated work.
        if (
          [...owned].every(
            ([memberPid, identity]) =>
              current.get(memberPid)?.started !== identity.started,
          )
        ) {
          finish();
          resolve();
          return;
        }
      } catch (error) {
        fail(error);
        return;
      }
      poll = setTimeout(observeGroupExit, EXIT_POLL_INTERVAL_MS);
    };
    childClosed.then(() => {
      if (!finished) observeGroupExit();
    }, fail);
  });
}

function killCliProcessTree(child: {
  pid?: number;
  kill: (s: NodeJS.Signals) => boolean;
}): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Group already gone, or the child never became a group leader.
    }
  }
  child.kill('SIGKILL');
}
export function killTimedOutChild(
  input:
    | {
        readonly runner: 'cli';
        readonly child: {
          pid?: number;
          kill: (signal: NodeJS.Signals) => boolean;
        };
      }
    | {
        readonly runner: 'agents' | 'auth' | 'shared';
        readonly child: ChildProcess;
      },
): void {
  if (input.runner === 'cli') {
    killCliProcessTree(input.child);
  } else {
    killRunnerChild(input.child);
  }
}

async function killWindowsTreeAndWait(
  pid: number,
  childClosed: Promise<void>,
  options: CoreReapOptions,
): Promise<void> {
  const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  let taskkillError: Error | null = null;
  killer.once('error', (error: Error) => {
    taskkillError = error;
  });
  const killerClosed = new Promise<number | null>((resolve) => {
    killer.once('close', resolve);
  });
  let taskkillCode: number | null;
  try {
    taskkillCode = await withTimeout(
      killerClosed,
      options.taskkillTimeoutMs ?? TASKKILL_TIMEOUT_MS,
      `taskkill for test process ${pid}`,
    );
  } catch (error) {
    await terminateTimedOutTaskkill(killer, killerClosed, pid, options, error);
    throw error;
  }
  if (taskkillError !== null) {
    throw taskkillError;
  }
  // A nonzero taskkill code is not by itself a reap failure: the usual cause
  // is that the tree already exited between the timeout firing and taskkill
  // running, which is the POSIX ESRCH case handled below. What matters is
  // the invariant — that nothing is left alive holding the child's pipes —
  // so verify that directly by waiting for close, and report the code only
  // if the tree genuinely outlives the reap.
  if (taskkillCode !== 0) {
    try {
      await withTimeout(
        childClosed,
        options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
        `Timed-out child (pid ${pid}) close lifecycle`,
      );
    } catch (closeError) {
      throw new AggregateError(
        [
          new Error(
            `taskkill /T /F /PID ${pid} exited with code ${taskkillCode}`,
          ),
          closeError,
        ],
        `taskkill for test process ${pid} reported failure and its tree did not close`,
      );
    }
    return;
  }

  await withTimeout(
    childClosed,
    options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
    `Timed-out child (pid ${pid}) close lifecycle`,
  );
}

async function terminateTimedOutTaskkill(
  killer: ChildProcess,
  killerClosed: Promise<number | null>,
  pid: number,
  options: CoreReapOptions,
  error: unknown,
): Promise<never> {
  let forcedKillError: Error | null = null;
  const recordForcedKillError = (killError: Error): void => {
    forcedKillError = killError;
  };
  killer.once('error', recordForcedKillError);
  try {
    if (killer.exitCode === null && killer.signalCode === null) {
      killer.kill('SIGKILL');
    }
    await withTimeout(
      killerClosed,
      options.reapTimeoutMs ?? REAP_TIMEOUT_MS,
      `Timed-out taskkill (pid ${killer.pid ?? 'unknown'}) close lifecycle`,
    );
  } catch (closeError) {
    throw new AggregateError(
      [error, closeError],
      `taskkill for test process ${pid} failed and did not close`,
    );
  } finally {
    killer.off('error', recordForcedKillError);
  }
  if (forcedKillError !== null) {
    throw new AggregateError(
      [error, forcedKillError],
      `taskkill for test process ${pid} timed out and could not be terminated`,
    );
  }
  throw error;
}
