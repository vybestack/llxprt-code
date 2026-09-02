/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import type { Config } from '@vybestack/llxprt-code-core';

/**
 * Registration target for the exit listener. The real `process` satisfies
 * this; tests capture the listener instead. Exit listeners receive the
 * exit code as `number | undefined` — undefined on a natural exit —
 * matching the runtime event Node and Bun emit.
 */
export interface ExitListenerTarget {
  on(event: 'exit', listener: (code: number | undefined) => void): unknown;
}

/**
 * Targets that already carry the notice listener. Registration must be
 * idempotent: every call appends another `exit` listener, so a second
 * registration on the same target would print the notice twice on exit.
 */
const armedTargets = new WeakSet<ExitListenerTarget>();

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
 * process exits (#3491). Without this, a shutdown with live jobs — SIGTERM,
 * SIGINT, or the quit path — ends silently with status 0 and the user has no
 * way to tell their jobs died with the process.
 *
 * A single synchronous `process.on('exit')` writer covers every exit path,
 * because each of them reaches `process.exit()` (or a natural exit), which
 * fires `exit`. Async work cannot run there, so the handler only reads the
 * manager state and writes synchronously.
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
 * The manager is read through the non-creating `peekShellJobManager`: the
 * creating `getShellJobManager` would construct a manager (and its
 * `shell-jobs-*` temp log directory) during exit on sessions that never
 * backgrounded a job. The exit code is left untouched.
 */
export function registerShellJobShutdownNotice(
  config: Pick<Config, 'peekShellJobManager'>,
  target: ExitListenerTarget = process,
): void {
  if (armedTargets.has(target)) {
    return;
  }
  armedTargets.add(target);
  target.on('exit', () => {
    try {
      const running = config.peekShellJobManager()?.getRunningJobs() ?? [];
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
      // restore) from running. The fd-2 write can fail because the
      // descriptor is outside this program's control (EPIPE with the
      // reader gone, EAGAIN on a non-blocking pty); the same reasoning
      // keeps the manager read and message build inside the guard.
    }
  });
}
