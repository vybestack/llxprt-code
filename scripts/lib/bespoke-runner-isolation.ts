/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session isolation and real-home sentinel wiring shared by the bespoke
 * workspace runners (packages/{cli,core,agents,auth}/run-bun-tests.ts,
 * issue #3622).
 * Only one isolation instance may be created per process.
 *
 * Unlike the shared runner (scripts/run_bun_tests.ts), which runs files
 * serially, these runners use worker pools: when a file settles, sibling
 * files may still be in flight, so a guard assertion names the file that just
 * finished and its active peers. Attribution is best-effort: another process
 * may have caused the change. The teardown assertion checks for late changes.
 */

import { spawnSync, type ChildProcess } from 'node:child_process';
import {
  buildSessionEnv,
  createTestSessionRoot,
  removeSessionRoot,
} from './test-session-isolation.js';
import {
  createRealHomeSentinelGuard,
  RealHomeSentinelViolation,
  type SentinelGuard,
} from './real-home-sentinel.js';

/** What a bespoke runner needs from one isolated run. */
export interface BespokeRunnerIsolation {
  /** Env every spawned test file runs with (fake HOME/TMPDIR/XDG). */
  readonly sessionEnv: NodeJS.ProcessEnv;
  /**
   * Asserts the real home dirs are untouched after a file settles. A
   * violation is logged and counted; the run continues so one leak does not
   * hide the remaining files' results.
   */
  noteFileSettled(relativeFile: string): void;
  runFile<T>(relativeFile: string, run: () => Promise<T>): Promise<T>;
  /**
   * Final assertion after the whole run, counting any late violation.
   * Cleanup ALWAYS runs so sentinels never outlive the runner.
   */
  finalize(): number;
}

let instantiated = false;

export function createBespokeRunnerIsolation(
  env: NodeJS.ProcessEnv,
  createGuard: (
    env: NodeJS.ProcessEnv,
  ) => SentinelGuard = createRealHomeSentinelGuard,
  log: (message: string) => void = console.error,
): BespokeRunnerIsolation {
  if (instantiated)
    throw new Error('bespoke runner isolation is single-instance per process');
  instantiated = true;
  const session = createTestSessionRoot();
  const sessionEnv = buildSessionEnv(env, session);
  const guard = createGuard(env);
  try {
    guard.captureBaseline();
  } catch (error) {
    try {
      guard.cleanup();
    } finally {
      removeSessionRoot(session);
    }
    throw error;
  }
  const inFlight = new Set<string>();
  let violations = 0;
  let finalized = false;

  const recordViolation = (error: RealHomeSentinelViolation): void => {
    log(error.message);
    violations++;
  };

  const noteFileSettled = (relativeFile: string): void => {
    try {
      const peers = [...inFlight];
      const label =
        peers.length === 0
          ? relativeFile
          : `${relativeFile} (in-flight: ${peers.join(', ')})`;
      guard.assertUnchanged(label);
    } catch (error: unknown) {
      if (!(error instanceof RealHomeSentinelViolation)) {
        throw error;
      }
      recordViolation(error);
    }
  };

  return {
    sessionEnv,
    async runFile<T>(relativeFile: string, run: () => Promise<T>): Promise<T> {
      assertRunnerActive();
      inFlight.add(relativeFile);
      try {
        return await run();
      } finally {
        inFlight.delete(relativeFile);
        noteFileSettled(relativeFile);
      }
    },
    noteFileSettled,
    finalize(): number {
      if (finalized) return violations;
      finalized = true;
      try {
        guard.assertUnchanged('run teardown');
      } catch (error: unknown) {
        if (!(error instanceof RealHomeSentinelViolation)) {
          throw error;
        }
        recordViolation(error);
      } finally {
        try {
          guard.cleanup();
        } finally {
          removeSessionRoot(session);
        }
      }
      return violations;
    },
  };
}

const runnerChildren = new Set<ChildProcess>();
let runnerTerminating = false;

/** Returns whether cancellation has not yet started. */
export function isRunnerActive(): boolean {
  return !runnerTerminating;
}

/** Refuses new test work once cancellation has started. */
export function assertRunnerActive(): void {
  if (runnerTerminating) throw new Error('Test runner is terminating');
}

/** Tracks a detached test child until its pipes and process have closed. */
export function trackRunnerChild(child: ChildProcess): void {
  runnerChildren.add(child);
  child.once('close', () => runnerChildren.delete(child));
}

/** Kills the POSIX test process group, including descendants. */
export function killRunnerChild(child: ChildProcess): void {
  if (process.platform === 'win32') {
    killWindowsRunnerChild(child);
    return;
  }
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}

function killWindowsRunnerChild(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      const result = spawnSync('taskkill', [
        '/PID',
        String(child.pid),
        '/T',
        '/F',
      ]);
      if (result.error) throw result.error;
      if (result.status === 0) return;
      console.error(
        `Failed to kill test child tree ${child.pid}: taskkill exited with status ${result.status}`,
      );
    } catch (error) {
      console.error(
        `Failed to kill test child tree ${child.pid}: ${String(error)}`,
      );
    }
  }
  child.kill('SIGKILL');
}

function waitForChildClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      child.off('close', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once('close', finish);
  });
}

/** Kills every tracked child and bounds pipe-drain waits during shutdown. */
export async function stopRunnerChildren(
  children: readonly ChildProcess[],
  log: (message: string) => void = console.error,
  timeoutMs = 5000,
): Promise<void> {
  await Promise.all(
    children.map((child) => {
      const closed = waitForChildClose(child, timeoutMs);
      try {
        killRunnerChild(child);
      } catch (error) {
        log(`Failed to kill test child ${child.pid}: ${String(error)}`);
      }
      return closed;
    }),
  );
}

/** Logs every worker rejection before propagating the first failure. */
export function throwWorkerFailures<T>(
  results: ReadonlyArray<PromiseSettledResult<T>>,
): T[] {
  const failures = results.filter((result) => result.status === 'rejected');
  for (const settledWorker of failures) console.error(settledWorker.reason);
  if (failures.length > 0) throw failures[0].reason;
  // No rejected results remain after the failure check above.
  return results
    .filter(
      (result): result is PromiseFulfilledResult<T> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);
}

/** Installs catchable-signal teardown; SIGKILL cannot run user-space cleanup. */
export function installRunnerSignalHandlers(
  finalize: () => void | Promise<void>,
): () => void {
  const stop = async (exitCode: number): Promise<void> => {
    if (runnerTerminating) return;
    runnerTerminating = true;
    try {
      await stopRunnerChildren([...runnerChildren]);
    } finally {
      try {
        await finalize();
      } finally {
        process.exit(exitCode);
      }
    }
  };
  const terminate = (): void => {
    void stop(143);
  };
  const interrupt = (): void => {
    void stop(130);
  };
  const hangup = (): void => {
    void stop(129);
  };
  process.on('SIGTERM', terminate);
  process.on('SIGINT', interrupt);
  process.on('SIGHUP', hangup);
  return () => {
    process.off('SIGTERM', terminate);
    process.off('SIGINT', interrupt);
    process.off('SIGHUP', hangup);
  };
}
