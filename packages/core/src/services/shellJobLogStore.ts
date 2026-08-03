/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Manages the private temp directory and per-job log files. Each manager owns
 * one mkdtemp dir (mode 0700) with exclusive (wx) log files (mode 0600).
 */
export class ShellJobLogStore {
  private readonly baseDir: string;
  private tempDir: string | null = null;
  private readonly dirTracker: Set<string> = new Set();

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

  /** Resolve the log path for a job id. Returns undefined if unregistered. */
  getLogPath(jobId: string): string | undefined {
    const dir = this.ensureDir();
    const candidate = path.join(dir, `${jobId}.log`);
    return this.dirTracker.has(candidate) ? candidate : undefined;
  }

  /** Delete a single job's log file if it exists. */
  deleteLog(jobId: string): void {
    const logPath = this.getLogPath(jobId);
    if (logPath === undefined) {
      return;
    }
    try {
      fs.unlinkSync(logPath);
    } catch {
      // File may already be deleted; safe to ignore.
    }
    this.dirTracker.delete(path.join(this.ensureDir(), `${jobId}.log`));
  }

  /** Delete the entire temp directory. Called during dispose. */
  destroy(): void {
    if (this.tempDir === null) {
      return;
    }
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
    this.tempDir = null;
    this.dirTracker.clear();
  }
}
