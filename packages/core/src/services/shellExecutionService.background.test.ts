/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getPty } from '../utils/getPty.js';
import { ShellExecutionService } from './shellExecutionService.js';
import type { ShellOutputEvent } from './shellExecutionService.js';
import type { ShellExecutionResult } from './shellExecutionTypes.js';
import { buildCommandToExecute } from '@vybestack/llxprt-code-tools';

/**
 * Real-process behavioural tests proving a background-wrapped command survives
 * ShellExecutionService teardown on BOTH production backends (T10-T13).
 *
 * These tests do NOT mock node-pty or child_process: they exercise the real
 * ShellExecutionService.execute(). Each test deterministically kills its own
 * process group in a finally block so no orphaned job survives the test.
 */

/** Resolved once at module load; the node-pty path skips when null. */
const ptyInfo = await getPty();
const ptyAvailable = ptyInfo !== null;

describe.skipIf(os.platform() === 'win32')(
  'Background wrapper survival through real ShellExecutionService',
  () => {
    let tempDir: string;
    const killedPids: number[] = [];

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-bg-svc-'));
      // Reset so pids never accumulate across tests in this block.
      killedPids.length = 0;
    });

    afterEach(() => {
      for (const pid of killedPids) {
        try {
          killPidGroup(pid);
        } catch {
          // Process may already be gone.
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /**
     * Kills the process-group leader by reading the pgid with `ps` and only
     * issuing a negative-pid SIGKILL when the parsed pgid strictly equals the
     * pid (i.e. the pid really is its own process-group leader). Falls back to
     * a single-pid kill otherwise so the test never risks signalling the test
     * runner's own process group.
     */
    function killPidGroup(pid: number): void {
      const psResult = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
      });
      const pgid = parseInt(psResult.stdout.trim(), 10);
      if (Number.isNaN(pgid) || pgid !== pid) {
        process.kill(pid, 'SIGKILL');
        return;
      }
      process.kill(-pid, 'SIGKILL');
    }

    function noOpOutputHandler(_event: ShellOutputEvent): void {
      // Background wrapper redirects to a log file; no output events expected.
    }

    /**
     * Registers a pid for the afterEach process-group kill. Only registers
     * when the pid is actually defined — a fallback of -1 would make
     * process.kill(-(-1)) target PID 1.
     */
    function registerPid(pid: number | undefined): void {
      if (pid !== undefined) {
        killedPids.push(pid);
      }
    }

    /**
     * Polls for a file's existence, resolving true once it exists or false
     * after the timeout. Extracted so the test body stays free of inline
     * conditionals (vitest/no-conditional-in-test).
     */
    async function waitForFile(
      filePath: string,
      timeoutMs = 3000,
      intervalMs = 100,
    ): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      let exists = fs.existsSync(filePath);
      while (!exists && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        exists = fs.existsSync(filePath);
      }
      return exists;
    }

    function makePaths(): {
      pgrepFile: string;
      logFile: string;
      sentinel: string;
    } {
      const hex = crypto.randomBytes(6).toString('hex');
      return {
        pgrepFile: path.join(tempDir, `pgrep_${hex}.tmp`),
        logFile: path.join(tempDir, `bg_${hex}.log`),
        sentinel: path.join(tempDir, `sentinel_${hex}`),
      };
    }

    /**
     * Runs execute() with the production-shaped background wrapper, returning
     * the resolved result, the handle pid, and the log file path so the caller
     * can read the job's output and clean up.
     */
    async function runBackground(
      shouldUseNodePty: boolean,
      command: string,
    ): Promise<{
      result: ShellExecutionResult;
      handlePid: number | undefined;
      logFile: string;
    }> {
      const { pgrepFile, logFile } = makePaths();
      const built = buildCommandToExecute(command, false, pgrepFile, logFile);
      const controller = new AbortController();
      const handle = await ShellExecutionService.execute(
        built,
        tempDir,
        noOpOutputHandler,
        controller.signal,
        shouldUseNodePty,
        {},
      );
      registerPid(handle.pid);
      const result = await handle.result;
      return { result, handlePid: handle.pid, logFile };
    }

    it.skipIf(ptyAvailable === false)(
      'node-pty: background job survives PTY teardown and writes to the log file (T10 / AC-3)',
      async () => {
        const { sentinel } = makePaths();
        const command = `sleep 1; echo done; touch ${sentinel}`;

        const { result, logFile } = await runBackground(true, command);

        expect(result.exitCode).toBe(0);
        expect(result.error).toBeNull();

        // The sentinel must appear AFTER the result resolved, proving the job
        // was still alive when the service tore down the PTY.
        expect(await waitForFile(sentinel)).toBe(true);

        // The log file must have received the job's output.
        const logContent = fs.readFileSync(logFile, 'utf8');
        expect(logContent).toContain('done');
      },
      15000,
    );

    it('child_process: background job survives and the log file receives output (T11 / AC-3)', async () => {
      const { sentinel } = makePaths();
      const command = `sleep 1; echo done; touch ${sentinel}`;

      const { result, logFile } = await runBackground(false, command);

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();

      expect(await waitForFile(sentinel)).toBe(true);

      const logContent = fs.readFileSync(logFile, 'utf8');
      expect(logContent).toContain('done');
    }, 15000);

    it('child_process: a chatty background job does not hold the tool streams — output lands in the log file, not result.output (T12 / AC-3)', async () => {
      const { sentinel } = makePaths();
      const command = `for i in $(seq 1 2000); do echo "line $i"; done; sleep 1; touch ${sentinel}`;

      const { result, logFile } = await runBackground(false, command);

      expect(result.exitCode).toBe(0);

      expect(await waitForFile(sentinel)).toBe(true);

      // The job's verbose output must be in the log file.
      const logContent = fs.readFileSync(logFile, 'utf8');
      expect(logContent).toContain('line 2000');

      // The job's output must NOT come back through the tool's streams.
      expect(result.output).not.toContain('line 2000');
    }, 15000);

    it('foreground (non-background) wrapping of the same command resolves only after the job has finished (T13 / AC-3 contrast)', async () => {
      const { sentinel, pgrepFile } = makePaths();
      const command = `sleep 1; touch ${sentinel}`;

      const built = buildCommandToExecute(command, false, pgrepFile);
      const controller = new AbortController();
      const handle = await ShellExecutionService.execute(
        built,
        tempDir,
        noOpOutputHandler,
        controller.signal,
        false,
        {},
      );
      registerPid(handle.pid);
      const result = await handle.result;

      expect(result.exitCode).toBe(0);
      // The sentinel MUST already exist — the wrapper waited for completion.
      expect(fs.existsSync(sentinel)).toBe(true);
    }, 15000);
  },
);
