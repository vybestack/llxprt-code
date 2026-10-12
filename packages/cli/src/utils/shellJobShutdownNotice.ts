/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

/** Signals whose default disposition kills the process without an `exit` event. */
type NoticeSignal = 'SIGTERM' | 'SIGINT';

const NOTICE_SIGNALS: readonly NoticeSignal[] = ['SIGTERM', 'SIGINT'];

/**
 * Registration target for the notice listeners. The real `process` satisfies
 * this; tests capture the listeners instead. Exit listeners receive the
 * exit code as `number | undefined` — undefined on a natural exit —
 * matching the runtime event Node and Bun emit.
 */
export interface ExitListenerTarget {
  readonly pid: number;
  on(event: 'exit', listener: (code: number | undefined) => void): unknown;
  on(event: NoticeSignal, listener: () => void): unknown;
  removeListener(event: NoticeSignal, listener: () => void): unknown;
  listenerCount(event: 'exit' | NoticeSignal): number;
  kill(pid: number, signal: NoticeSignal): unknown;
}

/**
 * Targets that already carry the notice listeners. Registration must be
 * idempotent: every call appends another `exit` and signal listener, so a
 * second registration on the same target would print the notice twice.
 */
const armedTargets = new WeakMap<
  ExitListenerTarget,
  () => ReadonlyArray<{ id: string; command: string }>
>();

/**
 * Bound on each job's command text in the notice. Job commands are
 * arbitrary text supplied by whatever the agent backgrounded, and the
 * notice is drained synchronously to fd 2, so a full pipe buffer must not
 * be reachable through job command text — an unbounded write on a blocked
 * pipe would hang the exit path.
 */
export const MAX_COMMAND_LENGTH = 200;

/**
 * Bound on how many jobs the notice lists. The job count itself is capped
 * only by settings, which may allow unlimited jobs, so the listing needs
 * its own limit to keep the whole payload far under a typical 64 KB pipe
 * buffer. The header still reports the true total.
 */
export const MAX_LISTED_JOBS = 20;

/** Marks a command that was cut short by {@link MAX_COMMAND_LENGTH}. */
const TRUNCATION_MARKER = '... [truncated]';

function truncateCommand(command: string): string {
  if (command.length <= MAX_COMMAND_LENGTH) {
    return command;
  }
  return `${command.slice(0, MAX_COMMAND_LENGTH)}${TRUNCATION_MARKER}`;
}

/**
 * Announce managed background jobs that are still running when the CLI
 * process ends (#3491, #3516). Without this, a shutdown with live jobs —
 * SIGTERM, SIGINT, or the quit path — ends silently and the user has no
 * way to tell their jobs died with the process.
 *
 * A single synchronous `process.on('exit')` writer covers every path that
 * reaches `process.exit()` (or a natural exit), because each of them fires
 * `exit`. Async work cannot run there, so the handler only reads the
 * manager state and writes synchronously.
 *
 * A signal with no JavaScript handler never reaches `exit`: the OS default
 * disposition kills the process outright. Installing a listener suppresses
 * that disposition, so the signal listeners here keep it. When another
 * listener owns the signal (the interactive handlers, the non-interactive
 * SIGINT handler), this one defers to it, because that handler runs its
 * async cleanup and then exits, and `exit` reports the jobs exactly once.
 * When this listener is the only one, it writes the notice, removes itself,
 * and re-raises the same signal so the process still dies from it with the
 * status the default disposition would have produced.
 *
 * The message is written with `fs.writeSync(2, ...)`, not
 * `process.stderr.write`: `patchStdio()` replaces that method with an
 * event-bus emitter, and the quit path calls `process.exit(0)` without
 * restoring stdio, so a stream write would be swallowed by the bus instead
 * of reaching the terminal. Writing the built message to the physical
 * descriptor also guarantees the bytes are out before the process dies.
 * The message itself is bounded — commands are truncated and the listing
 * capped — so job text cannot fill a pipe buffer and turn that synchronous
 * drain into a blocked exit.
 *
 * The reader returns only the current Agent's running shell jobs without
 * allocating a manager at exit. The exit code is left untouched.
 */
export function registerShellJobShutdownNotice(
  readRunning: () => ReadonlyArray<{ id: string; command: string }>,
  target: ExitListenerTarget = process,
): void {
  const alreadyArmed = armedTargets.has(target);
  armedTargets.set(target, readRunning);
  if (alreadyArmed) return;
  target.on('exit', () => writeShutdownNotice(target));
  for (const signal of NOTICE_SIGNALS) {
    const onSignal = (): void => {
      if (target.listenerCount(signal) > 1) {
        return;
      }
      writeShutdownNotice(target);
      target.removeListener(signal, onSignal);
      target.kill(target.pid, signal);
    };
    target.on(signal, onSignal);
  }
}

function writeShutdownNotice(target: ExitListenerTarget): void {
  try {
    const running = armedTargets.get(target)!();
    if (running.length === 0) {
      return;
    }
    const listed = running.slice(0, MAX_LISTED_JOBS);
    const jobLines = listed.map(
      (job) => `  ${job.id}: ${truncateCommand(job.command)}`,
    );
    const omitted = running.length - listed.length;
    if (omitted > 0) {
      jobLines.push(`  ...and ${omitted} more job(s) not listed`);
    }
    const message =
      `Shutting down with ${running.length} managed background job(s) still running:\n` +
      `${jobLines.join('\n')}\n`;
    // The string overload of writeSync cannot resume a partial write: its
    // third parameter is a file position, not a buffer offset. Encode once
    // and drain with the (fd, buffer, offset, length) overload, because a
    // full pipe or pty buffer may accept fewer bytes than requested.
    const payload = Buffer.from(message, 'utf8');
    let written = 0;
    while (written < payload.length) {
      const accepted = fs.writeSync(
        2,
        payload,
        written,
        payload.length - written,
      );
      if (accepted <= 0) {
        // No progress on a non-empty request: the descriptor will not
        // take more bytes, so give up on the rest instead of spinning.
        break;
      }
      written += accepted;
    }
  } catch {
    // The notice is best effort end to end. Inside an exit listener a
    // throw has no useful failure mode: it cannot be caught from the
    // exit path, it replaces the notice with a stack trace, and it
    // stops later exit listeners (including the terminal-protocol
    // restore) from running. The same holds in a signal listener, where
    // a throw would also skip the re-raise. The fd-2 write can fail
    // because the descriptor is outside this program's control (EPIPE
    // with the reader gone, EAGAIN on a non-blocking pty); the same
    // reasoning keeps the manager read and message build inside the guard.
  }
}
