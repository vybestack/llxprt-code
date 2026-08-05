/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { debugLogger } from '../utils/debugLogger.js';

/**
 * Error codes Node documents as transient for recursive removal on Windows,
 * where a handle may still be closing when the removal is issued.
 */
const TRANSIENT_REMOVAL_CODES: ReadonlySet<string> = new Set([
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOTEMPTY',
  'EPERM',
]);

function isTransientRemovalError(e: unknown): boolean {
  if (!(e instanceof Error) || !('code' in e)) {
    return false;
  }
  const { code } = e;
  return typeof code === 'string' && TRANSIENT_REMOVAL_CODES.has(code);
}

/**
 * Maximum total time destroy() will spend retrying directory removal on Windows
 * before giving up best-effort.
 *
 * Budget arithmetic: the concurrency test asserts total dispose completes under
 * 16s. That budget covers cancellation (~5s), survivor reap (~5s), and
 * verification (~0.6s). This 2000ms absolute deadline keeps worst-case log
 * removal well within the remaining ~5s headroom, and replaces the previous
 * nested-retry scheme that could blow the 16s budget on its own. The old
 * scheme was 10 outer iterations, each calling fs.rmSync with maxRetries: 5
 * and retryDelay: 50ms. Because Node's fs.rmSync uses LINEAR backoff
 * (wait = retryNumber × retryDelay), the per-call wait was
 * (1+2+3+4+5) × 50ms = 750ms, not the flat 5 × 50ms = 250ms one might expect.
 * With 9 inter-iteration delays of 50ms (450ms), the worst-case total was
 * 10 × 750ms + 450ms = 7950ms ≈ 7.95s.
 */
export const LOG_DESTROY_BUDGET_MS = 2000;

/** Delay between removal attempts during the Windows retry window. */
const LOG_DESTROY_RETRY_DELAY_MS = 50;

/**
 * Manages the private temp directory and per-job log files. Each manager owns
 * one mkdtemp dir (mode 0700) with exclusive (wx) log files (mode 0600).
 */
export class ShellJobLogStore {
  private readonly baseDir: string;
  private tempDir: string | null = null;
  private readonly dirTracker: Set<string> = new Set();
  private readonly errDirTracker: Set<string> = new Set();

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'shell-jobs-'));
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.chmodSync(this.baseDir, 0o700);
    this.tempDir = this.baseDir;
  }

  /**
   * Lazily ensure the temp dir exists. Returns the temp dir path, creating
   * it (mode 0700) if this is the first use.
   */
  ensureDir(): string {
    if (this.tempDir !== null) {
      return this.tempDir;
    }
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.chmodSync(this.baseDir, 0o700);
    this.tempDir = this.baseDir;
    return this.tempDir;
  }

  /**
   * Open an exclusive log file for a job. Uses 'wx' so it fails if the file
   * already exists. The fd is returned for passing to spawn stdio.
   */
  openLog(jobId: string): { fd: number; logPath: string } {
    const dir = this.ensureDir();
    const logPath = path.join(dir, `${jobId}.log`);
    const fd = fs.openSync(logPath, 'wx', 0o600);
    this.dirTracker.add(logPath);
    return { fd, logPath };
  }

  /**
   * Open an exclusive stdout/stderr log pair for a Windows background job.
   * Both files are created empty (mode 0600, 'wx'). Start-Process redirects
   * stdout and stderr to them separately.
   */
  openLogPaths(jobId: string): { logPath: string; errLogPath: string } {
    const dir = this.ensureDir();
    const logPath = path.join(dir, `${jobId}.log`);
    const errLogPath = path.join(dir, `${jobId}.err.log`);
    // Create both files exclusively, then release the descriptors: only
    // Start-Process writes to them, so holding the fds would leak one pair
    // per background job.
    const logFd = fs.openSync(logPath, 'wx', 0o600);
    fs.closeSync(logFd);
    let errLogFd: number;
    try {
      errLogFd = fs.openSync(errLogPath, 'wx', 0o600);
    } catch (e) {
      // The original error MUST be the one thrown: nest the cleanup so a
      // cleanup failure (EPERM/EBUSY on Windows antivirus/handle races) can
      // never mask it. force:true already swallows ENOENT.
      try {
        fs.rmSync(logPath, { force: true });
      } catch (cleanupError) {
        debugLogger.warn(
          '[shellJobLogStore] failed to remove log file during cleanup:',
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
        );
      }
      throw e;
    }
    fs.closeSync(errLogFd);
    this.dirTracker.add(logPath);
    this.errDirTracker.add(errLogPath);
    return { logPath, errLogPath };
  }

  /** Resolve the log path for a job id. Returns undefined if unregistered. */
  getLogPath(jobId: string): string | undefined {
    const dir = this.ensureDir();
    const candidate = path.join(dir, `${jobId}.log`);
    return this.dirTracker.has(candidate) ? candidate : undefined;
  }

  /** Resolve the error log path for a job id (Windows only). */
  getErrLogPath(jobId: string): string | undefined {
    const dir = this.ensureDir();
    const candidate = path.join(dir, `${jobId}.err.log`);
    return this.errDirTracker.has(candidate) ? candidate : undefined;
  }

  /** Delete a single job's log file(s) if they exist. */
  deleteLog(jobId: string): void {
    const logPath = this.getLogPath(jobId);
    if (logPath !== undefined) {
      try {
        fs.unlinkSync(logPath);
      } catch {
        // File may already be deleted; safe to ignore.
      }
      this.dirTracker.delete(logPath);
    }
    const errLogPath = this.getErrLogPath(jobId);
    if (errLogPath !== undefined) {
      try {
        fs.unlinkSync(errLogPath);
      } catch {
        // File may already be deleted; safe to ignore.
      }
      this.errDirTracker.delete(errLogPath);
    }
  }

  /**
   * Delete the entire temp directory. Called during dispose.
   *
   * POSIX path is synchronous (identical to the original): a single rmSync with
   * no retries, no delay. The signature remains async because callers already
   * await it (ShellJobManager.dispose), but no Promise is created on the POSIX
   * path.
   *
   * On Windows, redirected stdout/stderr log handles are released by the OS a
   * short time after the child process exits, so a removal issued immediately
   * after taskkill fails with one of the documented transient codes. A single
   * absolute deadline ({@link LOG_DESTROY_BUDGET_MS}) bounds total retry time.
   * rmSync is called with maxRetries: 0 so the OS-level retry budget is not
   * stacked on top of ours. On deadline expiry, gives up best-effort (does not
   * throw for log files alone).
   */
  async destroy(): Promise<void> {
    if (this.tempDir === null) {
      return;
    }
    const target = this.tempDir;
    this.tempDir = null;
    this.dirTracker.clear();
    this.errDirTracker.clear();

    if (os.platform() !== 'win32') {
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
      return;
    }

    const deadline = Date.now() + LOG_DESTROY_BUDGET_MS;
    for (;;) {
      try {
        fs.rmSync(target, {
          recursive: true,
          force: true,
          maxRetries: 0,
        });
        return;
      } catch (e: unknown) {
        if (!isTransientRemovalError(e) || Date.now() >= deadline) {
          return; // best-effort: give up silently for log files alone
        }
        await new Promise((resolve) =>
          setTimeout(resolve, LOG_DESTROY_RETRY_DELAY_MS),
        );
      }
    }
  }
}
