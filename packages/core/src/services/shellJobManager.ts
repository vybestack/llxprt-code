/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import { getShellConfiguration } from '../utils/shell-utils.js';
import { SIGKILL_TIMEOUT_MS } from './shellProcessKill.js';
import { ShellJobBudget } from './shellJobBudget.js';
import { ShellJobLogStore } from './shellJobLogStore.js';
import { tailOutput } from './shellJobTail.js';
import {
  applyTerminal,
  createJobContext,
  killProcessGroupSafe,
  readJobState,
  type ShellJobContext,
} from './shellJobInternal.js';
import { classifyExit, resolveTerminalState } from './shellJobTransition.js';
import {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_MAX_BACKGROUND_JOBS,
  LOG_CAP_POLL_INTERVAL_MS,
  generateJobId,
  toPublicJob,
  type ShellJob,
  type ShellJobLaunchInput,
  type ShellJobRecord,
  type ShellJobState,
  type ShellJobTailOptions,
  type ShellJobTailResult,
  type TerminalDetails,
} from './shellJobTypes.js';
import { ShellExecutionService } from './shellExecutionService.js';

export type {
  ShellJob,
  ShellJobState,
  ShellJobLaunchInput,
  ShellJobTailOptions,
  ShellJobTailResult,
};

/** Result of prefix lookup mirroring AsyncTaskManager.getTaskByPrefix. */
export interface ShellJobPrefixLookup {
  job?: ShellJob;
  candidates?: ShellJob[];
}

/**
 * Manages background shell jobs using direct detached spawn. Each job runs in
 * its own process group; cancellation targets the group with SIGTERM → SIGKILL
 * escalation. Terminal transitions are exactly-once through a guarded primitive.
 */
export class ShellJobManager {
  private readonly jobs: Map<string, ShellJobContext> = new Map();
  private readonly emitter: EventEmitter;
  private readonly budget: ShellJobBudget;
  private readonly logStore: ShellJobLogStore;
  private readonly logMaxBytes: number;
  private capPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: {
    maxBackgroundJobs?: number;
    logMaxBytes?: number;
    baseDir?: string;
  }) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.budget = new ShellJobBudget(
      options?.maxBackgroundJobs ?? DEFAULT_MAX_BACKGROUND_JOBS,
    );
    this.logMaxBytes = options?.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES;
    this.logStore = new ShellJobLogStore(options?.baseDir);
  }

  setMaxBackgroundJobs(max: number): void {
    this.budget.setMax(max);
  }

  getMaxBackgroundJobs(): number {
    return this.budget.getMax();
  }

  /**
   * Launch a background shell job. Reserves a budget slot atomically before
   * any I/O, opens the log file exclusively, spawns detached, attaches
   * listeners, and registers the job. Throws on budget exhaustion, log-open
   * failure, or spawn-setup failure.
   */
  launch(input: ShellJobLaunchInput): ShellJob {
    if (!this.budget.reserve()) {
      throw new Error(
        `Background job budget exhausted (max ${this.budget.getMax()})`,
      );
    }

    const id = generateJobId();
    let logFd: number;
    let logPath: string;
    try {
      const opened = this.logStore.openLog(id);
      logFd = opened.fd;
      logPath = opened.logPath;
    } catch (e) {
      this.budget.release();
      throw e;
    }

    const child = this.spawnJob(input, logFd);

    let resolveTerminal!: () => void;
    const terminalPromise = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });

    const record: ShellJobRecord = {
      id,
      command: input.command,
      cwd: input.cwd,
      state: 'running',
      phase: 'starting',
      startedAt: Date.now(),
      pid: child.pid ?? -1,
      logPath,
      child,
      terminalPromise,
      resolveTerminal,
    };
    record.phase = null;

    const ctx = createJobContext(record, this.emitter);
    this.attachListeners(ctx, child);
    this.jobs.set(id, ctx);
    this.budget.consume();

    try {
      fs.closeSync(logFd);
    } catch {
      // Parent's copy of the fd may already be closed by the OS after spawn.
    }
    child.unref();

    this.ensureCapPollRunning();
    return toPublicJob(record);
  }

  private spawnJob(input: ShellJobLaunchInput, logFd: number): ChildProcess {
    const { executable, argsPrefix } = getShellConfiguration();
    const env = ShellExecutionService.sanitizeEnvironment(
      {
        ...process.env,
        LLXPRT_CODE: '1',
        TERM: 'xterm-256color',
        PAGER: 'cat',
      },
      false,
    );
    delete env.BASH_ENV;

    return cpSpawn(executable, [...argsPrefix, input.command], {
      cwd: input.cwd,
      detached: true,
      shell: false,
      stdio: ['ignore', logFd, logFd],
      env,
    });
  }

  private attachListeners(ctx: ShellJobContext, child: ChildProcess): void {
    child.on('exit', (code, signal) => {
      this.handleExit(ctx, code, signal);
    });
    child.on('error', (err) => {
      this.handleError(ctx, err);
    });
  }

  private handleExit(
    ctx: ShellJobContext,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const isCancelling = ctx.record.phase === 'cancelling';
    const { state, details } = classifyExit(code, signal, isCancelling);
    this.finalizeJob(ctx, state, details);
  }

  private handleError(ctx: ShellJobContext, err: Error): void {
    this.finalizeJob(ctx, 'failed', { failureReason: err.message });
  }

  private finalizeJob(
    ctx: ShellJobContext,
    proposedState: ShellJobState,
    details: TerminalDetails,
  ): void {
    const isCancelling = ctx.record.phase === 'cancelling';
    const state = resolveTerminalState(isCancelling, proposedState);
    if (applyTerminal(ctx, state, details)) {
      this.budget.releaseActive();
      this.maybeStopCapPoll();
      this.enforceRetention();
    }
  }

  /**
   * Cancel a running job. Sends SIGTERM to the process group, escalates to
   * SIGKILL after SIGKILL_TIMEOUT_MS. Resolves true if cancel won the
   * terminal transition; false if the job was already terminal.
   */
  async cancel(id: string): Promise<boolean> {
    const ctx = this.jobs.get(id);
    if (ctx === undefined) {
      return false;
    }
    if (ctx.record.state !== 'running') {
      return false;
    }

    // Atomically claim the cancelling phase so exit events defer to cancelled.
    ctx.record.phase = 'cancelling';

    this.sendTermAndEscalate(ctx);
    await ctx.record.terminalPromise;
    return readJobState(ctx.record) === 'cancelled';
  }

  private sendTermAndEscalate(ctx: ShellJobContext): void {
    const { record } = ctx;
    const pid = record.pid;
    killProcessGroupSafe(pid, 'SIGTERM');

    record.escalateTimer = setTimeout(() => {
      killProcessGroupSafe(pid, 'SIGKILL');
    }, SIGKILL_TIMEOUT_MS);
  }

  get(id: string): ShellJob | undefined {
    const ctx = this.jobs.get(id);
    return ctx !== undefined ? toPublicJob(ctx.record) : undefined;
  }

  getByPrefix(prefix: string): ShellJobPrefixLookup {
    const matches: ShellJob[] = [];
    for (const ctx of this.jobs.values()) {
      if (ctx.record.id.startsWith(prefix)) {
        matches.push(toPublicJob(ctx.record));
      }
    }
    if (matches.length === 0) {
      return {};
    }
    if (matches.length === 1) {
      return { job: matches[0] };
    }
    return { candidates: matches };
  }

  list(): ShellJob[] {
    const result: ShellJob[] = [];
    for (const ctx of this.jobs.values()) {
      result.push(toPublicJob(ctx.record));
    }
    return result;
  }

  /**
   * Read recent output from the end of the job's log file. Resolves the path
   * from the id only — never accepts a caller-supplied path. Does not load
   * the whole file.
   */
  tailOutput(
    id: string,
    options?: Partial<ShellJobTailOptions>,
  ): ShellJobTailResult {
    const logPath = this.logStore.getLogPath(id);
    if (logPath === undefined) {
      return { id, output: '', truncated: false };
    }
    return tailOutput(logPath, id, options);
  }

  markNotified(ids: string[]): void {
    for (const id of ids) {
      const ctx = this.jobs.get(id);
      if (ctx !== undefined && ctx.record.notifiedAt === undefined) {
        ctx.record.notifiedAt = Date.now();
      }
    }
    this.enforceRetention();
  }

  getPendingNotifications(): ShellJob[] {
    const result: ShellJob[] = [];
    for (const ctx of this.jobs.values()) {
      if (this.isPendingNotification(ctx)) {
        result.push(toPublicJob(ctx.record));
      }
    }
    return result;
  }

  private isPendingNotification(ctx: ShellJobContext): boolean {
    const { record } = ctx;
    if (record.state === 'running') {
      return false;
    }
    return record.notifiedAt === undefined;
  }

  getRunningJobs(): ShellJob[] {
    const result: ShellJob[] = [];
    for (const ctx of this.jobs.values()) {
      if (ctx.record.state === 'running') {
        result.push(toPublicJob(ctx.record));
      }
    }
    return result;
  }

  onJobCompleted(handler: (job: ShellJob) => void): () => void {
    this.emitter.on('job-completed', handler);
    return () => this.emitter.off('job-completed', handler);
  }

  onJobFailed(handler: (job: ShellJob) => void): () => void {
    this.emitter.on('job-failed', handler);
    return () => this.emitter.off('job-failed', handler);
  }

  onJobCancelled(handler: (job: ShellJob) => void): () => void {
    this.emitter.on('job-cancelled', handler);
    return () => this.emitter.off('job-cancelled', handler);
  }

  /**
   * Terminate every running job (TERM → bounded wait → KILL), reconcile
   * terminal state, and delete the temp dir. Zero orphans.
   */
  async dispose(): Promise<void> {
    this.stopCapPoll();
    const running = this.getRunningJobs();
    const cancelPromises = running.map((job) => this.cancel(job.id));
    await Promise.all(cancelPromises);

    // Reconcile any jobs that somehow didn't reach terminal.
    for (const ctx of this.jobs.values()) {
      if (ctx.record.state === 'running') {
        this.finalizeJob(ctx, 'failed', {
          failureReason: 'Disposed while still running',
        });
      }
    }

    this.logStore.destroy();
    this.jobs.clear();
  }

  // --- Log cap poll ---

  private ensureCapPollRunning(): void {
    if (this.capPollTimer !== null) {
      return;
    }
    this.capPollTimer = setInterval(() => {
      this.checkLogCap();
    }, LOG_CAP_POLL_INTERVAL_MS);
    this.capPollTimer.unref();
  }

  private maybeStopCapPoll(): void {
    if (this.getRunningJobs().length > 0) {
      return;
    }
    this.stopCapPoll();
  }

  private stopCapPoll(): void {
    if (this.capPollTimer !== null) {
      clearInterval(this.capPollTimer);
      this.capPollTimer = null;
    }
  }

  private checkLogCap(): void {
    for (const ctx of this.jobs.values()) {
      if (ctx.record.state !== 'running') {
        continue;
      }
      this.failJobIfOverCap(ctx);
    }
  }

  private failJobIfOverCap(ctx: ShellJobContext): void {
    const stat = this.statLogFile(ctx.record.logPath);
    if (stat !== null && stat.size > this.logMaxBytes) {
      killProcessGroupSafe(ctx.record.pid, 'SIGTERM');
      this.finalizeJob(ctx, 'failed', {
        failureReason: `Log output exceeded cap (${this.logMaxBytes} bytes)`,
      });
    }
  }

  private statLogFile(logPath: string): { size: number } | null {
    try {
      return fs.statSync(logPath);
    } catch {
      return null;
    }
  }

  // --- Retention ---

  private enforceRetention(): void {
    const historyLimit =
      this.budget.getMax() === -1 ? 10 : this.budget.getMax() * 2;

    const terminal = Array.from(this.jobs.values())
      .filter((ctx) => ctx.record.state !== 'running')
      .sort((a, b) => (a.record.endedAt ?? 0) - (b.record.endedAt ?? 0));

    const excess = terminal.length - historyLimit;
    for (let i = 0; i < excess && i < terminal.length; i++) {
      const ctx = terminal[i];
      if (ctx.record.notifiedAt === undefined) {
        break;
      }
      this.logStore.deleteLog(ctx.record.id);
      this.jobs.delete(ctx.record.id);
    }
  }
}
