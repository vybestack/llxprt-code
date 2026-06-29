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

  constructor(ptyProcess: pty.IPty, diagnostics: DiagnosticsSink) {
    this.ptyProcess = ptyProcess;
    this._diagnostics = diagnostics;
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
    await poll(
      () => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()),
      effectiveTimeout,
      200,
    );
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
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Test timed out: process did not exit within ${effectiveTimeout}ms.`,
            ),
          ),
        effectiveTimeout,
      );
      this.ptyProcess.onExit(({ exitCode }) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
  }
}
