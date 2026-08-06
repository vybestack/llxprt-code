/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import os from 'node:os';

import { Config } from '../config/config.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { ShellJob, ShellJobManager } from '../services/shellJobManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ShellTool, type IToolMessageBus } from '@vybestack/llxprt-code-tools';

/**
 * Windows-only end-to-end coverage for the real background-job path that was
 * previously only exercised through a fake host (`shell-tool.test.ts`):
 *
 *   ShellTool -> CoreShellToolHostAdapter.launchBackgroundJob()
 *             -> real ShellJobManager -> real PowerShell process
 *
 * Every command here drives a REAL process and REAL log files through the
 * production adapter wired to a production Config. Nothing the adapter or
 * manager does is mocked. Deleting either implementation makes these tests
 * fail (no job created, no process spawned, no terminal transition, empty tail).
 */

let sessionIdCounter = 0;

function makeAdapter(): {
  config: Config;
  adapter: CoreShellToolHostAdapter;
} {
  sessionIdCounter += 1;
  const config = new Config({
    model: 'test-model',
    question: 'test question',
    embeddingModel: 'test-embedding',
    targetDir: os.tmpdir(),
    usageStatisticsEnabled: false,
    sessionId: `adapter-e2e-${Date.now()}-${sessionIdCounter}`,
    debugMode: false,
    cwd: os.tmpdir(),
    settingsService: new SettingsService(),
  });
  const adapter = new CoreShellToolHostAdapter(config);
  return { config, adapter };
}

/**
 * Message bus whose only method throws. Background launches must never request
 * confirmation, so if the tool ever calls it the test fails loudly. This is a
 * real (inert) dependency, not a mock of the component under test.
 */
function createInertMessageBus(): IToolMessageBus {
  return {
    requestConfirmation: async (): Promise<never> => {
      throw new Error(
        'requestConfirmation must not be called for a background job launch',
      );
    },
  };
}

function waitForTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = 10000,
): Promise<ShellJob> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const job = manager.get(id);
      if (job !== undefined && job.state !== 'running') {
        resolve(job);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Job ${id} did not reach a terminal state in time`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Returns the ShellJobManager the adapter lazily built. Lives outside the test
 * body so its guard is not a conditional-in-test. Throwing here (rather than
 * asserting) also preserves the precise TypeScript narrowing the caller needs.
 */
function requireManager(config: Config): ShellJobManager {
  const manager = config.getShellJobManager();
  if (manager === undefined) {
    throw new Error('ShellJobManager was not created by the adapter');
  }
  return manager;
}

/** Extracts the real job id the tool printed, throwing if absent. */
function extractJobId(llm: string): string {
  const match = /Job ID: (shell_\w+)/.exec(llm);
  if (match === null) {
    throw new Error('Could not extract job id from tool result');
  }
  return match[1];
}

describe.skipIf(os.platform() !== 'win32')(
  'CoreShellToolHostAdapter -> real ShellJobManager (Windows end-to-end)',
  () => {
    let config: Config;
    let adapter: CoreShellToolHostAdapter;

    beforeEach(() => {
      const built = makeAdapter();
      config = built.config;
      adapter = built.adapter;
    });

    afterEach(async () => {
      const manager = config.getShellJobManager();
      if (manager !== undefined) {
        // dispose() rejects by design when Windows survivors are retained.
        // Catch so teardown does not mask real test results or leak processes.
        try {
          await manager.dispose();
        } catch (err) {
          debugLogger.warn(
            '[CoreShellToolHostAdapter.test] dispose() rejected during teardown:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    });

    it('launchBackgroundJob returns a shell_ id and the real output is retrievable via tailBackgroundJob', async () => {
      const job = adapter.launchBackgroundJob({
        command: "Write-Output 'adapter-e2e-success'",
        cwd: os.tmpdir(),
      });

      // The id must come from the real ShellJobManager's id generator.
      expect(job.id).toMatch(/^shell_/);
      expect(job.state).toBe('running');

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, job.id);

      // The real process reached a terminal state with a real exit code.
      expect(terminal.state).toBe('completed');
      expect(terminal.exitCode).toBe(0);

      // The real command output is retrievable through the adapter's tail.
      const tail = adapter.tailBackgroundJob(job.id);
      expect(tail.output).toContain('adapter-e2e-success');
    });

    it('launchBackgroundJob reports the real non-zero exit code for a failing command', async () => {
      const job = adapter.launchBackgroundJob({
        command: 'exit 7',
        cwd: os.tmpdir(),
      });

      expect(job.id).toMatch(/^shell_/);

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, job.id);

      // A real failing command surfaces its real non-zero exit code.
      expect(terminal.state).toBe('failed');
      expect(terminal.exitCode).toBe(7);
    });

    it('ShellTool wired to the real adapter launches a REAL background job with a shell_ id and contract-clean output', async () => {
      const tool = new ShellTool(adapter, createInertMessageBus());

      const invocation = tool.build({
        command: "Write-Output 'via-shell-tool'",
        is_background: true,
      });
      const result = await invocation.execute(new AbortController().signal);

      const llm = String(result.llmContent);
      expect(llm).toContain('Background job launched.');
      expect(llm).toContain('Job ID: shell_');
      expect(llm).toContain('State:');

      // Extract the real job id the tool obtained from the real manager and
      // prove the process actually ran: terminal state + retrievable output.
      const jobId = extractJobId(llm);

      const manager = requireManager(config);
      const terminal = await waitForTerminal(manager, jobId);
      expect(terminal.state).toBe('completed');
      expect(terminal.exitCode).toBe(0);

      const tail = adapter.tailBackgroundJob(jobId);
      expect(tail.output).toContain('via-shell-tool');
    });
  },
);
