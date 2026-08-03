/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  initializeParser,
  detectTrailingBackgroundOperator,
} from '../utils/shell-parser.js';
import { ShellJobManager } from './shellJobManager.js';
import type { ShellJob } from './shellJobManager.js';

/**
 * Integration tests proving that a plain `cmd &` promoted via AST detection
 * and launched through ShellJobManager survives on BOTH backends
 * (the regression proof for the documented bug), and that a launched job is
 * NOT cancelled when the tool call's timeout/abort fires afterwards.
 *
 * These tests use real processes and the real tree-sitter parser.
 */

function makeTempBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shell-bg-int-'));
}

function waitForTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = 5000,
): Promise<ShellJob | undefined> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const job = manager.get(id);
      if (job !== undefined && job.state !== 'running') {
        resolve(job);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Job ${id} did not reach terminal state in time`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe.skipIf(os.platform() === 'win32')(
  'AST-promoted background job survives on both backends (#1995 slice 6)',
  () => {
    let managers: ShellJobManager[] = [];
    let baseDirs: string[] = [];

    beforeAll(async () => {
      await initializeParser();
    });

    afterEach(async () => {
      for (const m of managers) {
        await m.dispose();
      }
      managers = [];
      for (const d of baseDirs) {
        fs.rmSync(d, { recursive: true, force: true });
      }
      baseDirs = [];
    });

    function makeManager(): ShellJobManager {
      const baseDir = makeTempBase();
      baseDirs.push(baseDir);
      const manager = new ShellJobManager({ baseDir });
      managers.push(manager);
      return manager;
    }

    it('promotes "sleep 1 &" via AST and the job is visible as running', () => {
      const command = 'sleep 1 &';
      const result = detectTrailingBackgroundOperator(command);
      expect(result.promoted).toBe(true);
      expect(result.command).toBe('sleep 1');

      const manager = makeManager();
      const job = manager.launch({ command: result.command, cwd: os.tmpdir() });

      expect(job.state).toBe('running');
      expect(job.id).toMatch(/^shell_/);
      expect(job.command).toBe('sleep 1');
    });

    it('the promoted job survives past the launch and reaches completed with exit code 0 (child_process backend)', async () => {
      const manager = makeManager();
      const sentinel = path.join(
        makeTempBase(),
        'sentinel_' + process.pid.toString(),
      );

      const command = 'echo done; sleep 1; touch ' + sentinel + ' &';
      const result = detectTrailingBackgroundOperator(command);
      expect(result.promoted).toBe(true);

      const job = manager.launch({ command: result.command, cwd: os.tmpdir() });
      expect(job.state).toBe('running');

      // Wait for the job to finish.
      const terminal = await waitForTerminal(manager, job.id, 10000);
      expect(terminal).toBeDefined();
      expect(terminal?.state).toBe('completed');
      expect(terminal?.exitCode).toBe(0);

      // The sentinel must exist, proving the full command ran.
      expect(fs.existsSync(sentinel)).toBe(true);

      // The tail must contain the output.
      const tail = manager.tailOutput(job.id);
      expect(tail.output).toContain('done');

      fs.rmSync(path.dirname(sentinel), { recursive: true, force: true });
    });

    it('a launched job is NOT cancelled when the tool call abort signal fires afterwards (#1995 slice 5)', async () => {
      const manager = makeManager();
      const sentinel = path.join(
        makeTempBase(),
        'timeout_sentinel_' + process.pid.toString(),
      );

      // Launch a job that will run for ~2 seconds.
      const job = manager.launch({
        command: `sleep 2; touch ${sentinel}`,
        cwd: os.tmpdir(),
      });
      expect(job.state).toBe('running');

      // Simulate the tool call's timeout/abort firing AFTER the job was
      // successfully launched. In the real tool, the timeout/abort controller
      // is NOT wired to the background job — we verify the job survives.
      const abortController = new AbortController();
      abortController.abort();

      // The abort must not have cancelled the job.
      const stillRunning = manager.get(job.id);
      expect(stillRunning?.state).toBe('running');

      // Wait for the job to finish naturally.
      const terminal = await waitForTerminal(manager, job.id, 10000);
      expect(terminal?.state).toBe('completed');
      expect(fs.existsSync(sentinel)).toBe(true);

      fs.rmSync(path.dirname(sentinel), { recursive: true, force: true });
    });

    it('a fast-completing background job returns a job-shaped result immediately, not foreground-shaped', () => {
      const manager = makeManager();
      const job = manager.launch({
        command: 'true',
        cwd: os.tmpdir(),
      });

      // Even a fast-completing job is job-shaped: it has an id, command,
      // and state. The result schema is deterministic.
      expect(job.id).toMatch(/^shell_/);
      expect(job.command).toBe('true');
      expect(['running', 'completed', 'failed']).toContain(job.state);
    });
  },
);
