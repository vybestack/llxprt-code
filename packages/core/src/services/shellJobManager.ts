/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { getShellConfiguration } from '../utils/shell-utils.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  SIGKILL_TIMEOUT_MS,
  boundedTaskkill,
  type TaskkillResult,
} from './shellProcessKill.js';
import { ShellJobBudget } from './shellJobBudget.js';
import { ShellJobLogStore } from './shellJobLogStore.js';
import { tailOutput, tailOutputWindows } from './shellJobTail.js';
import {
  applyTerminal,
  childIsRunning,
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
import {
  spawnDetached,
  spawnWindowsBackground,
  type SpawnedProcess,
} from './shellJobSpawn.js';

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
 * Non-evictable record of a Windows job that was force-finalised (cancel
 * timeout, cap breach, dispose) WITHOUT observing the original child exit. It
 * captures the immutable original child handle and pid so {@link
 * ShellJobManager.dispose} can reap it even after retention evicts the job
 * context from `jobs`. Only the original child identity is ever trusted —
 * never a numeric pid alone — which is safe against PID reuse.
 */
export interface SurvivorEntry {
  readonly child: ChildProcess;
  readonly pid: number | undefined;
}

/**
 * Pure reap-eligibility predicate for a survivor: reap only when the ORIGINAL
 * child handle is still running. Extracted from dispose so it can be tested
 * directly without a production mutator of kill-critical state.
 */
export function survivorNeedsReap(entry: SurvivorEntry): boolean {
  return childIsRunning(entry.child);
}

/**
 * Structured information about a surviving process tree that dispose() could
 * not kill. Each entry carries the job id, its pid, and the exact remediation
 * command a human can run to force-kill the tree.
 */
export interface SurvivorInfo {
  readonly id: string;
  readonly pid: number | undefined;
  readonly remediation: string;
}

/**
 * Thrown by {@link ShellJobManager.dispose} when one or more Windows process
 * trees could not be killed after bounded retry. The error carries the
 * surviving job ids, their pids, and the exact `taskkill /T /F /PID <pid>`
 * remediation command for each so the caller (or human operator) can act.
 */
export class ShellJobDisposalError extends Error {
  readonly survivors: readonly SurvivorInfo[];

  constructor(survivors: readonly SurvivorInfo[]) {
    const lines = survivors
      .map((s) => `  job ${s.id} (pid ${s.pid}): ${s.remediation}`)
      .join('\n');
    super(
      `dispose() could not kill ${survivors.length} surviving process tree(s):\n${lines}`,
    );
    this.name = 'ShellJobDisposalError';
    this.survivors = survivors;
  }
}

/**
 * Manages background shell jobs using direct detached spawn. Each job runs in
 * its own process group; cancellation targets the group with SIGTERM → SIGKILL
 * escalation. Terminal transitions are exactly-once through a guarded primitive.
 *
 * Under Bun, `Bun.spawn` is used instead of `node:child_process.spawn` because
 * Bun's ChildProcess `exit` event is intermittently not delivered for the first
 * spawned detached process group. `Bun.spawn`'s `exited` Promise does not have
 * this bug.
 */
export class ShellJobManager {
  private readonly jobs: Map<string, ShellJobContext> = new Map();
  private readonly emitter: EventEmitter;
  private readonly budget: ShellJobBudget;
  private readonly logStore: ShellJobLogStore;
  private readonly logMaxBytes: number;
  private readonly taskkillImpl: (pid: number) => Promise<TaskkillResult>;
  private capPollTimer: ReturnType<typeof setInterval> | null = null;
  private capCheckInFlight = false;
  private readonly windowsKillTimeoutMs = 5000;
  /**
   * Windows-only: jobs that were force-finalised (cancel timeout, cap breach,
   * dispose) WITHOUT observing the original child exit. Each entry captures the
   * immutable original child handle + pid so dispose can reap it independently
   * of the `jobs` map — retention evicting a job context can never orphan a
   * live process. Only these are reap candidates in dispose — never every
   * retained job (PID reuse).
   */
  private readonly survivors: Map<string, SurvivorEntry> = new Map();
  /**
   * Resolves once disposal has begun. Its non-null-ness is the synchronous
   * "closed to new launches" signal: the public {@link dispose} assigns it
   * synchronously (before any await) so {@link launch} cannot slip in between
   * the check and the assignment.
   */
  private disposalPromise: Promise<void> | null = null;

  constructor(options?: {
    maxBackgroundJobs?: number;
    logMaxBytes?: number;
    baseDir?: string;
    taskkillImpl?: (pid: number) => Promise<TaskkillResult>;
  }) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.budget = new ShellJobBudget(
      options?.maxBackgroundJobs ?? DEFAULT_MAX_BACKGROUND_JOBS,
    );
    this.logMaxBytes = options?.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES;
    this.logStore = new ShellJobLogStore(options?.baseDir);
    this.taskkillImpl = options?.taskkillImpl ?? boundedTaskkill;
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
    if (this.disposalPromise !== null) {
      throw new Error(
        'Cannot launch a background job: ShellJobManager is disposing or disposed.',
      );
    }
    // On Windows, live survivors (unkillable process trees whose budget was
    // released by finalization) count against the budget so repeated
    // unkillable jobs cannot accumulate live process trees unconstrained
    // by maxBackgroundJobs. The threshold is 2×max to allow at least max
    // survivors while still bounding total accumulation.
    if (os.platform() === 'win32' && this.budget.getMax() !== -1) {
      const liveSurvivors = this.countLiveSurvivors();
      if (
        liveSurvivors > 0 &&
        this.budget.getActiveCount() + liveSurvivors >= this.budget.getMax() * 2
      ) {
        throw new Error(
          `Background job budget exhausted (max ${this.budget.getMax()}, ${liveSurvivors} live survivor(s))`,
        );
      }
    }
    if (!this.budget.reserve()) {
      throw new Error(
        `Background job budget exhausted (max ${this.budget.getMax()})`,
      );
    }

    const id = generateJobId();

    if (os.platform() === 'win32') {
      return this.launchWindows(input, id);
    }

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

    const { executable, argsPrefix, env } = this.prepareSpawn();
    const spawned = spawnDetached(
      executable,
      [...argsPrefix, input.command],
      input.cwd,
      env,
      logFd,
    );

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
      pid: spawned.pid,
      logPath,
      child: spawned.child,
      exited: spawned.exited,
      onError: spawned.onError,
      terminalPromise,
      resolveTerminal,
    };
    record.phase = null;

    const ctx = createJobContext(record, this.emitter);
    this.attachListeners(ctx);
    this.jobs.set(id, ctx);
    this.budget.consume();

    try {
      fs.closeSync(logFd);
    } catch {
      // Parent's copy of the fd may already be closed by the OS after spawn.
    }

    this.ensureCapPollRunning();
    return toPublicJob(record);
  }

  /**
   * Windows-specific launch path using Start-Process semantics. Opens a
   * stdout/stderr log pair, spawns via spawnWindowsBackground, and registers
   * the job. The POSIX path in launch() stays byte-for-byte unchanged.
   */
  private launchWindows(input: ShellJobLaunchInput, id: string): ShellJob {
    let logPath: string;
    let errLogPath: string;
    try {
      const opened = this.logStore.openLogPaths(id);
      logPath = opened.logPath;
      errLogPath = opened.errLogPath;
    } catch (e) {
      this.budget.release();
      throw e;
    }

    const { executable, env } = this.prepareSpawn();
    let spawned: SpawnedProcess;
    try {
      spawned = spawnWindowsBackground(
        executable,
        input.command,
        input.cwd,
        env,
        logPath,
        errLogPath,
      );
    } catch (e) {
      // A synchronous throw from cpSpawn (bad args, invalid cwd, bootstrap
      // build failure) must release the reservation reserved in launch() so
      // the slot does not leak and degrade capacity until process restart.
      this.budget.release();
      throw e;
    }

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
      pid: spawned.pid,
      logPath,
      errLogPath,
      child: spawned.child,
      exited: spawned.exited,
      onError: spawned.onError,
      terminalPromise,
      resolveTerminal,
    };
    record.phase = null;

    const ctx = createJobContext(record, this.emitter);
    this.attachListeners(ctx);
    this.jobs.set(id, ctx);
    this.budget.consume();

    this.ensureCapPollRunning();
    return toPublicJob(record);
  }

  private prepareSpawn(): {
    executable: string;
    argsPrefix: string[];
    env: Record<string, string | undefined>;
  } {
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
    return { executable, argsPrefix, env };
  }

  /**
   * Wire the process exit and error handlers. Uses the unified `exited`
   * Promise (backed by `Bun.spawn.exited` under Bun, `child.exit` under
   * Node.js) for reliable exit detection.
   */
  private attachListeners(ctx: ShellJobContext): void {
    const { record } = ctx;

    record.exited
      .then(({ exitCode, signal }) => {
        this.handleExit(ctx, exitCode, signal);
      })
      .catch((err: unknown) => {
        if (err instanceof Error) {
          this.handleError(ctx, err);
        }
      });

    record.onError((err) => {
      this.handleError(ctx, err);
    });
  }

  private handleExit(
    ctx: ShellJobContext,
    code: number | null,
    signal: string | null,
  ): void {
    this.survivors.delete(ctx.record.id);
    if (ctx.record.phase === 'capping') {
      return;
    }
    const isCancelling = ctx.record.phase === 'cancelling';
    const { state, details } = classifyExit(code, signal, isCancelling);
    this.finalizeJob(ctx, state, details);
  }

  private handleError(ctx: ShellJobContext, err: Error): void {
    this.survivors.delete(ctx.record.id);
    if (ctx.record.phase === 'capping') {
      return;
    }
    this.finalizeJob(ctx, 'failed', { failureReason: err.message });
  }

  /**
   * Bounded, never-rejecting Windows kill wrapper. Races the injected
   * taskkill implementation against a timeout, clears the timer on settle,
   * and normalises rejection into a TaskkillResult. Used by cancel, cap
   * enforcement, and dispose so no path can hang or leak an unhandled
   * rejection.
   */
  private safeWindowsKill(pid: number | undefined): Promise<TaskkillResult> {
    // An absent pid (spawn never produced one) cannot be taskkilled; resolve
    // as a no-op failure rather than entering the timeout race, so no
    // taskkill process is ever spawned for an unknown pid.
    if (pid === undefined) {
      return Promise.resolve({
        ok: false,
        error: new Error('Cannot taskkill: process has no pid'),
      });
    }
    return new Promise<TaskkillResult>((resolve) => {
      let settled = false;
      const finish = (result: TaskkillResult): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: new Error('Windows kill timed out'),
        });
      }, this.windowsKillTimeoutMs);

      // Normalise via an async trampoline so a SYNCHRONOUS throw from the
      // injected implementation (or a synchronously-rejected promise) can
      // never reject this wrapper or surface as an unhandled rejection.
      // safeWindowsKill must ALWAYS resolve under any implementation.
      Promise.resolve()
        .then(() => this.taskkillImpl(pid))
        .then(finish, (err: unknown) => {
          finish({
            ok: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    });
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
   *
   * First-claimer precedence: if log-cap enforcement already claimed the
   * terminal (phase === 'capping'), cancel cannot overwrite it or start a
   * competing kill. It waits for the cap-owned terminal result and returns false.
   */
  async cancel(id: string): Promise<boolean> {
    const ctx = this.jobs.get(id);
    if (ctx === undefined) {
      return false;
    }
    if (ctx.record.state !== 'running') {
      return false;
    }

    // The first terminal claimant owns termination and the terminal transition.
    if (ctx.record.phase === 'capping' || ctx.record.phase === 'cancelling') {
      await ctx.record.terminalPromise;
      return false;
    }

    // Atomically claim the cancelling phase so exit events defer to cancelled.
    ctx.record.phase = 'cancelling';

    this.sendTermAndEscalate(ctx);

    if (os.platform() === 'win32') {
      await this.awaitBoundedCancel(ctx);
    } else {
      await ctx.record.terminalPromise;
    }
    return readJobState(ctx.record) === 'cancelled';
  }

  private async awaitBoundedCancel(ctx: ShellJobContext): Promise<void> {
    const CANCEL_TIMEOUT_MS = 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        ctx.record.terminalPromise.then((): 'done' => 'done'),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), CANCEL_TIMEOUT_MS);
        }),
      ]);
      if (result === 'timeout' && ctx.record.state === 'running') {
        this.survivors.set(ctx.record.id, {
          child: ctx.record.child,
          pid: ctx.record.pid,
        });
        this.finalizeJob(ctx, 'cancelled', {
          failureReason: 'Cancel timed out waiting for process termination',
        });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private sendTermAndEscalate(ctx: ShellJobContext): void {
    const { record } = ctx;
    const pid = record.pid;
    if (os.platform() === 'win32') {
      // Guard against PID reuse: only kill if the ORIGINAL child is still
      // running, so a pid that was reused by an unrelated process is never
      // targeted.
      if (childIsRunning(record.child)) {
        void this.safeWindowsKill(pid);
      }
      return;
    }
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
    const errLogPath = this.logStore.getErrLogPath(id);
    if (errLogPath !== undefined) {
      return tailOutputWindows(logPath, errLogPath, id, options);
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
   * Terminate every running job CONCURRENTLY (not sequentially). Each job
   * receives SIGTERM → SIGKILL escalation; cancel() returns promptly because
   * the `exited` Promise resolves reliably. Zero orphans.
   *
   * On Windows, only tracked survivors (force-finalised without observing
   * the original child exit) whose ORIGINAL ChildProcess handle confirms
   * still-running are reaped — never based on numeric-pid liveness alone,
   * which is vulnerable to PID reuse.
   *
   * Idempotent: concurrent and repeated calls share one disposal promise and
   * settle identically (both resolve, or both reject with the same
   * {@link ShellJobDisposalError} instance).
   *
   * The {@link disposalPromise} lifecycle gate is assigned within this method's
   * own synchronous call stack — before this method returns, and therefore
   * before any other task or microtask can run — so {@link launch} cannot
   * register a job after disposal has begun.
   */
  dispose(): Promise<void> {
    if (this.disposalPromise !== null) {
      return this.disposalPromise;
    }
    this.disposalPromise = this.disposeInternal();
    return this.disposalPromise;
  }

  private async disposeInternal(): Promise<void> {
    this.stopCapPoll();
    const running = this.getRunningJobs();
    const cancelPromises = running.map((job) => this.cancel(job.id));
    await Promise.all(cancelPromises);

    // Reconcile any jobs that somehow didn't reach terminal.
    for (const ctx of this.jobs.values()) {
      if (ctx.record.state === 'running') {
        if (os.platform() === 'win32') {
          this.survivors.set(ctx.record.id, {
            child: ctx.record.child,
            pid: ctx.record.pid,
          });
        }
        this.finalizeJob(ctx, 'failed', {
          failureReason: 'Disposed while still running',
        });
      }
    }

    // On Windows, reap survivors with bounded retry. Each reap attempt
    // consumes the TaskkillResult and confirms the ORIGINAL child exited via
    // childIsRunning (PID-reuse safe). A survivor is deleted ONLY when its
    // child is confirmed exited; survivors that cannot be killed are RETAINED
    // for tracking so a live process tree is never orphaned without ownership.
    // Total time is bounded: one kill cycle plus short verification delays.
    let remainingSurvivors: SurvivorInfo[] = [];
    if (os.platform() === 'win32') {
      remainingSurvivors = await this.reapSurvivorsBounded();
    }

    if (remainingSurvivors.length > 0) {
      // Retain survivor log files, log-store tracking entries, and job records
      // so the failure is diagnosable and the log is not yanked out from under
      // a live writer. Clean up ONLY confirmed-exited jobs/logs.
      const survivorIds = new Set(remainingSurvivors.map((s) => s.id));
      for (const [id, ctx] of Array.from(this.jobs.entries())) {
        if (!survivorIds.has(id) && ctx.record.state !== 'running') {
          this.logStore.deleteLog(id);
          this.jobs.delete(id);
        }
      }
      throw new ShellJobDisposalError(remainingSurvivors);
    }

    await this.logStore.destroy();
    this.jobs.clear();
  }

  /**
   * Count survivors whose original child is confirmed still running. Used by
   * the budget check in {@link launch} so unkillable survivors count against
   * maxBackgroundJobs. Also available publicly for diagnostics/testing.
   */
  getLiveSurvivorCount(): number {
    return this.countLiveSurvivors();
  }

  private countLiveSurvivors(): number {
    let count = 0;
    for (const entry of this.survivors.values()) {
      if (survivorNeedsReap(entry)) count++;
    }
    return count;
  }

  /**
   * Bounded reap of live survivors during dispose. Kills all live survivors
   * concurrently, then deletes those whose original child confirms exited.
   * Short verification rounds follow for survivors that may need a moment to
   * exit after a successful kill. Survivors that cannot be confirmed exited
   * after all rounds are RETAINED and a diagnostic is logged — they are never
   * silently dropped. Total time is bounded: one kill cycle plus short
   * verification delays, so N never-settling kills complete in roughly one
   * kill timeout (not N).
   *
   * Returns the list of survivors that are still alive after all attempts.
   */
  private async reapSurvivorsBounded(): Promise<SurvivorInfo[]> {
    const VERIFY_ROUNDS = 2;
    const VERIFY_DELAY_MS = 300;

    // Phase 1: Kill all live survivors concurrently.
    const liveEntries = Array.from(this.survivors.entries()).filter(([, e]) =>
      survivorNeedsReap(e),
    );
    if (liveEntries.length === 0) return [];

    await Promise.all(
      liveEntries.map(async ([id, entry]) => {
        await this.safeWindowsKill(entry.pid);
        if (!childIsRunning(entry.child)) {
          this.survivors.delete(id);
        }
      }),
    );

    // Phase 2: Short verification rounds. After a successful-looking kill the
    // process may need a moment to actually exit. These rounds re-check
    // liveness and delete confirmed-exited survivors. They do NOT issue
    // another kill cycle, keeping total dispose time bounded.
    for (let round = 0; round < VERIFY_ROUNDS; round++) {
      const stillLive = Array.from(this.survivors.values()).some(
        survivorNeedsReap,
      );
      if (!stillLive) return [];

      await new Promise<void>((resolve) => {
        setTimeout(resolve, VERIFY_DELAY_MS);
      });

      for (const [id, entry] of Array.from(this.survivors.entries())) {
        if (!childIsRunning(entry.child)) {
          this.survivors.delete(id);
        }
      }
    }

    // Report survivors that are still live after all attempts. RETAIN them
    // for tracking — never silently drop a live process tree.
    const remaining = Array.from(this.survivors.entries())
      .filter(([, e]) => survivorNeedsReap(e))
      .map(([id, entry]) => ({
        id,
        pid: entry.pid,
        remediation:
          entry.pid === undefined
            ? 'pid unknown; cannot emit taskkill remediation'
            : `taskkill /T /F /PID ${entry.pid}`,
      }));
    if (remaining.length > 0) {
      debugLogger.warn(
        `[ShellJobManager] ${remaining.length} survivor(s) still alive after bounded reap; retaining tracking entries.`,
      );
    }
    return remaining;
  }

  // --- Log cap poll ---

  private ensureCapPollRunning(): void {
    if (this.capPollTimer !== null) {
      return;
    }
    if (os.platform() === 'win32') {
      // Windows path needs async taskkill with survivor recording, so the
      // poll callback awaits.
      this.capPollTimer = setInterval(() => {
        void this.checkLogCapAsync().catch((err: unknown) => {
          // Swallow to avoid an unhandled rejection, but log so cap-enforcement
          // failures are not silently destroyed.
          debugLogger.error(
            '[ShellJobManager] cap-poll check failed:',
            err instanceof Error ? err.message : String(err),
          );
        });
      }, LOG_CAP_POLL_INTERVAL_MS);
    } else {
      // POSIX path is fully synchronous — no await boundary between jobs,
      // identical to the original behaviour.
      this.capPollTimer = setInterval(() => {
        this.checkLogCapSync();
      }, LOG_CAP_POLL_INTERVAL_MS);
    }
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

  private checkLogCapSync(): void {
    for (const ctx of this.jobs.values()) {
      if (ctx.record.state !== 'running') {
        continue;
      }
      this.failJobIfOverCapSync(ctx);
    }
  }

  private failJobIfOverCapSync(ctx: ShellJobContext): void {
    const totalSize = this.getTotalLogSize(ctx.record);
    if (totalSize > this.logMaxBytes) {
      // First-claimer precedence: if cancel already claimed the terminal,
      // cap defers so cancel owns the terminal reason.
      if (ctx.record.phase === 'cancelling') {
        return;
      }
      killProcessGroupSafe(ctx.record.pid, 'SIGTERM');
      this.finalizeJob(ctx, 'failed', {
        failureReason: `Log output exceeded cap (${this.logMaxBytes} bytes)`,
      });
    }
  }

  private async checkLogCapAsync(): Promise<void> {
    // Serialise: an in-flight cap check prevents a second one from starting,
    // avoiding overlapping taskkills when enforcement is slow.
    if (this.capCheckInFlight) return;
    this.capCheckInFlight = true;
    try {
      for (const ctx of this.jobs.values()) {
        if (ctx.record.state !== 'running') {
          continue;
        }
        await this.failJobIfOverCapAsync(ctx);
      }
    } finally {
      this.capCheckInFlight = false;
    }
  }

  private async failJobIfOverCapAsync(ctx: ShellJobContext): Promise<void> {
    const totalSize = this.getTotalLogSize(ctx.record);
    if (totalSize > this.logMaxBytes) {
      // First-claimer precedence: if cancel already claimed the terminal
      // (phase === 'cancelling'), cap defers entirely. The cancel kill is
      // already in flight and will finalize the job with the cancel reason.
      // This makes the outcome deterministic regardless of async scheduling.
      if (ctx.record.phase === 'cancelling') {
        return;
      }
      // Claim the terminal transition before taskkill: killing the child emits
      // its exit event, which must not finalize the job without the cap reason.
      ctx.record.phase = 'capping';
      // Guard the kill by ORIGINAL child identity (PID-reuse safe) and
      // record the survivor so dispose can reap if this kill does not
      // observe the exit.
      if (childIsRunning(ctx.record.child)) {
        this.survivors.set(ctx.record.id, {
          child: ctx.record.child,
          pid: ctx.record.pid,
        });
        await this.safeWindowsKill(ctx.record.pid);
      }
      ctx.record.phase = null;
      this.finalizeJob(ctx, 'failed', {
        failureReason: `Log output exceeded cap (${this.logMaxBytes} bytes)`,
      });
    }
  }

  private getTotalLogSize(record: ShellJobRecord): number {
    const stdoutStat = this.statLogFile(record.logPath);
    let total = stdoutStat !== null ? stdoutStat.size : 0;
    if (record.errLogPath !== undefined) {
      const stderrStat = this.statLogFile(record.errLogPath);
      total += stderrStat !== null ? stderrStat.size : 0;
    }
    return total;
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
