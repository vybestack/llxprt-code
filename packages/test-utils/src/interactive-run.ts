/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'vitest';
import { execSync } from 'node:child_process';
import { env } from 'node:process';
import type * as pty from '@lydell/node-pty';
import stripAnsi from 'strip-ansi';
import type { DiagnosticsSink } from './diagnostics.js';
import { getDefaultTimeout, poll } from './util.js';
import { detectQuotaSignal, tripQuotaGuard } from './quota-guard.js';

/**
 * Construction-time options for {@link InteractiveRun}.
 */
export interface InteractiveRunConstructorOptions {
  /**
   * Whether the E2E quota guard should observe this interactive session.
   *
   * The PTY child owns its own environment, so InteractiveRun cannot know
   * whether the run is backed by fake responses. {@link TestRig.runInteractive}
   * therefore decides applicability (real provider ⇒ enabled) and passes it in
   * explicitly. Fake-responses runs never touch a real provider, so leaving
   * this `false` keeps fixture text from producing false quota trips. Defaults
   * to `false` so a bare InteractiveRun never mutates shared guard state.
   */
  readonly quotaGuardEnabled?: boolean;
}

/**
 * Manages a PTY-backed interactive CLI session for e2e/integration tests.
 */
export class InteractiveRun {
  readonly ptyProcess: pty.IPty;
  private readonly _output: string[] = [];
  private _exited = false;
  private _exitCode: number | null = null;
  private _killed = false;
  private readonly _diagnostics: DiagnosticsSink;
  private readonly _quotaGuardEnabled: boolean;

  constructor(
    ptyProcess: pty.IPty,
    diagnostics: DiagnosticsSink,
    options: InteractiveRunConstructorOptions = {},
  ) {
    this.ptyProcess = ptyProcess;
    this._diagnostics = diagnostics;
    this._quotaGuardEnabled = options.quotaGuardEnabled ?? false;
    ptyProcess.onData((data) => {
      this._output.push(data);
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      this._exited = true;
      this._exitCode = exitCode;
    });
  }

  /**
   * Scan the accumulated output for a provider quota / rate-limit signal on a
   * FAILURE path, tripping the shared sentinel on the first match.
   *
   * Kept strictly failure-only: callers must invoke this solely when an
   * interaction has already failed (timeout / non-zero exit). Scanning a
   * successful interaction would risk false trips from a model legitimately
   * echoing phrases like "rate limit". No-op (returns `null`) when the guard is
   * disabled for this run. Returns the human-readable reason when a signal is
   * found, otherwise `null`.
   */
  private detectAndTripQuota(): string | null {
    if (!this._quotaGuardEnabled) {
      return null;
    }
    const reason = detectQuotaSignal(stripAnsi(this.output));
    if (reason === null) {
      return null;
    }
    tripQuotaGuard(reason);
    return reason;
  }

  /**
   * Build the labelled quota error for an interactive FAILURE path, or `null`
   * when the guard is disabled or no signal is present.
   *
   * Scanning trips the shared sentinel as a side effect (via
   * {@link detectAndTripQuota}). The `[QUOTA/RATE-LIMIT]` prefix mirrors the
   * non-interactive paths in process-run.ts so both surface identically.
   *
   * @param context Short description of the failure path, embedded in the error.
   */
  private quotaError(context: string): Error | null {
    const reason = this.detectAndTripQuota();
    if (reason === null) {
      return null;
    }
    return new Error(`[QUOTA/RATE-LIMIT] ${context}; ${reason}`);
  }

  /**
   * Fail fast on a quota wall from an interactive FAILURE path by THROWING the
   * labelled error when one applies.
   *
   * Intended for `async` failure paths (e.g. an `expectText` poll timeout or an
   * interactive-readiness timeout) where a throw propagates naturally as a
   * rejected promise. A no-op when the guard is disabled or no signal is
   * present, letting the caller surface its ordinary assertion failure instead.
   *
   * @param context Short description of the failure path, embedded in the error.
   */
  failFastOnQuota(context: string): void {
    const error = this.quotaError(context);
    if (error !== null) {
      throw error;
    }
  }

  /**
   * Combined raw output captured so far (ANSI not stripped).
   */
  get output(): string {
    return this._output.join('');
  }

  /** Whether the underlying PTY process has exited. */
  get exited(): boolean {
    return this._exited;
  }

  /**
   * Get the process ID of the PTY process.
   */
  get pid(): number | undefined {
    return this.ptyProcess.pid;
  }

  /**
   * Get the exit code after the process exits.
   */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Check if the process was killed.
   */
  get killed(): boolean {
    return this._killed;
  }

  async expectText(text: string, timeout?: number) {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    const found = await poll(
      () => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()),
      effectiveTimeout,
      200,
    );
    // Failure-only quota check: a missing text after the poll window is the
    // common interactive quota symptom (the model never responds, or the UI
    // shows a 429). Trip the guard and fail fast with the labelled error before
    // the ordinary assertion so remaining tests skip instead of burning quota.
    if (!found) {
      this.failFastOnQuota(
        `interactive run timed out after ${effectiveTimeout}ms waiting for text "${text}"`,
      );
    }
    expect(stripAnsi(this.output).toLowerCase()).toContain(text.toLowerCase());
  }

  // This types slowly to make sure command is correct, but only work for short
  // commands that are not multi-line, use sendKeys to type long prompts
  async type(text: string) {
    let typedSoFar = '';
    for (const char of text) {
      this.ptyProcess.write(char);
      typedSoFar += char;

      const found = await poll(
        () => stripAnsi(this.output).includes(typedSoFar),
        5000,
        10,
      );

      if (!found) {
        throw new Error(
          `Timed out waiting for typed text to appear in output: "${typedSoFar}".\nStripped output:\n${stripAnsi(
            this.output,
          )}`,
        );
      }
    }
  }

  // Types an entire string at once, necessary for some things like commands
  // but may run into paste detection issues for larger strings.
  async sendText(text: string) {
    this.ptyProcess.write(text);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  // Simulates typing a string one character at a time to avoid paste detection.
  async sendKeys(text: string) {
    const delay = 5;
    for (const char of text) {
      this.ptyProcess.write(char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Kill the process with graceful escalation.
   * First sends SIGTERM, then SIGKILL after gracePeriodMs.
   * On Windows, uses taskkill with /T flag for process tree.
   * @param gracePeriodMs - Time to wait after SIGTERM before SIGKILL (default: 5000ms)
   */
  async kill(gracePeriodMs = 5000): Promise<void> {
    if (this._exited) {
      return;
    }
    this._killed = true;

    if (process.platform === 'win32') {
      await this._killWindows();
    } else {
      await this._killUnix(gracePeriodMs);
    }
  }

  private _killWindows(): Promise<void> {
    try {
      const pid = this.ptyProcess.pid;
      execSync(`taskkill /pid ${pid} /T /F`, { timeout: 10000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('not found') &&
        !message.includes('no running instance')
      ) {
        this._diagnostics.warn('Failed to kill PTY process:', message);
      }
    }
    return Promise.resolve();
  }

  private async _killUnix(gracePeriodMs: number): Promise<void> {
    try {
      this.ptyProcess.kill('SIGTERM');
      const exited = await poll(() => this._exited, gracePeriodMs, 100);
      if (!exited) {
        this.ptyProcess.kill('SIGKILL');
      }
    } catch {
      // Process may already be dead — ignore
    }
  }

  expectExit(timeout?: number): Promise<number> {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    return new Promise((resolve, reject) => {
      // If the PTY already exited, the constructor's onExit handler captured
      // the code; a late onExit registration here would never fire (node-pty
      // does not replay the event), so settle synchronously instead of hanging
      // until the timeout.
      if (this._exited) {
        this._settleExit(this._exitCode ?? 0, resolve, reject);
        return;
      }
      const timer = setTimeout(
        () => reject(this._exitTimeoutError(effectiveTimeout)),
        effectiveTimeout,
      );
      this.ptyProcess.onExit(({ exitCode }) => {
        clearTimeout(timer);
        this._settleExit(exitCode, resolve, reject);
      });
    });
  }

  /**
   * Build the rejection error for an {@link expectExit} TIMEOUT, upgrading it to
   * the labelled `[QUOTA/RATE-LIMIT]` error (and tripping the guard) when the
   * accumulated output carries a quota / rate-limit signal.
   *
   * A PTY child that prints a 429 and then hangs never fires an exit event, so
   * the timeout is the ONLY place the wall can be observed for such a child —
   * without this scan the sentinel would never trip and the rest of the suite
   * would keep burning quota. Falls back to the ordinary timeout error when the
   * guard is disabled or no signal is present, preserving callers that assert on
   * the plain message. Extracted from {@link expectExit} to keep that method's
   * complexity within lint limits.
   */
  private _exitTimeoutError(effectiveTimeout: number): Error {
    const quota = this.quotaError(
      `interactive run did not exit within ${effectiveTimeout}ms`,
    );
    if (quota !== null) {
      return quota;
    }
    return new Error(
      `Test timed out: process did not exit within ${effectiveTimeout}ms.`,
    );
  }

  /**
   * Resolve or reject an {@link expectExit} promise for a given exit code.
   *
   * Failure-only quota check: a non-zero exit whose accumulated output carries
   * a quota / rate-limit signal trips the guard and rejects with the labelled
   * `[QUOTA/RATE-LIMIT]` error. A clean exit — or a non-zero exit without a
   * quota signal — resolves with the code exactly as before, preserving callers
   * that assert on the returned exit code.
   */
  private _settleExit(
    exitCode: number,
    resolve: (code: number) => void,
    reject: (error: Error) => void,
  ): void {
    if (exitCode !== 0) {
      const error = this.quotaError(
        `interactive run exited with code ${exitCode}`,
      );
      if (error !== null) {
        reject(error);
        return;
      }
    }
    resolve(exitCode);
  }
}
