/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3031 — `run_shell_command` timeout ceiling semantics.
 *
 * Behavioural tests driving the REAL ShellTool against a fake IShellToolHost
 * whose `executeShellCommand` either completes immediately or hangs until the
 * abort signal fires. They assert the corrected ceiling semantics:
 *  - `timeout_seconds: -1` under a finite host maximum is BOUNDED (the command
 *    times out at the ceiling, not unbounded).
 *  - a request above the maximum is clamped and the result surfaces it.
 *  - a request below the maximum is honoured exactly, with no clamp notice.
 *  - a host maximum of `-1` with `-1` arms no timer (unbounded).
 */

import { describe, it, expect } from 'bun:test';
import { withBoundedGuard } from '@vybestack/llxprt-code-test-utils';
import { ShellTool } from '../index.js';
import { ToolErrorType } from '../types/tool-error.js';
import type {
  IShellToolHost,
  ShellExecutionResult,
} from '../interfaces/index.js';
import type { ToolResult } from '../index.js';

interface FakeHostOptions {
  /** Configured maximum (ceiling) reported by getTimeoutConfig. */
  max: number | undefined;
  /** Configured default reported by getTimeoutConfig. */
  defaultSeconds: number;
  /** 'complete' resolves immediately; 'hang' resolves only on abort. */
  behavior: 'complete' | 'hang';
}

const NORMAL_RESULT: ShellExecutionResult = {
  output: 'done\n',
  exitCode: 0,
  signal: null,
  error: null,
  aborted: false,
  pid: undefined,
};

const ABORTED_RESULT: ShellExecutionResult = {
  output: '',
  exitCode: null,
  signal: null,
  error: null,
  aborted: true,
  pid: undefined,
};

function createFakeHost(opts: FakeHostOptions): IShellToolHost {
  return {
    getTargetDir: () => '/tmp',
    getWorkspaceContext: () => ({
      getDirectories: () => ['/tmp'],
      isPathWithinWorkspace: (p: string) =>
        p === '/tmp' || p.startsWith('/tmp/'),
    }),
    isCommandAllowed: () => ({ allowed: true }),
    isShellInvocationAllowlisted: () => true,
    isInteractive: () => true,
    isYoloMode: () => true,
    getDebugMode: () => false,
    getShellExecutionConfig: () => ({
      shouldUseNodePty: false,
      executionOptions: {},
    }),
    getTimeoutConfig: () => ({
      timeoutSeconds: opts.max,
      defaultTimeoutSeconds: opts.defaultSeconds,
    }),
    getOutputLimits: () => ({}),
    executeShellCommand: async (_command, _cwd, _onOutput, signal) => {
      if (opts.behavior === 'complete') {
        return NORMAL_RESULT;
      }
      if (signal.aborted) {
        return ABORTED_RESULT;
      }
      return new Promise<ShellExecutionResult>((resolve) => {
        signal.addEventListener('abort', () => resolve(ABORTED_RESULT), {
          once: true,
        });
      });
    },
    getCommandRoots: (command: string) => {
      const root = command.trim().split(/\s+/)[0];
      return root ? [root] : [];
    },
    stripShellWrapper: (command: string) => command,
    validatePathWithinWorkspace: () => null,
    isPtyActive: () => false,
    formatMemoryUsage: (bytes: number) => `${bytes} bytes`,
    trySummarizeOutput: async (content: string) => content,
    getSummarizeConfig: () => undefined,
    limitOutputTokens: (content: string) => ({ content, wasTruncated: false }),
    launchBackgroundJob: () => {
      throw new Error('not used');
    },
    tailBackgroundJob: () => {
      throw new Error('not used');
    },
    detectTrailingBackground: (command: string) => ({
      promoted: false,
      command,
    }),
  };
}

async function runShell(
  host: IShellToolHost,
  params: { command: string; timeout_seconds?: number },
): Promise<ToolResult> {
  const tool = new ShellTool(host);
  const invocation = tool.build(params);
  return invocation.execute(new AbortController().signal);
}

describe('Issue #3031 — shell tool timeout ceiling semantics', () => {
  it('bounds timeout_seconds: -1 under a finite host maximum', async () => {
    const host = createFakeHost({
      max: 0.1,
      defaultSeconds: 60,
      behavior: 'hang',
    });

    const result = await withBoundedGuard(
      runShell(host, { command: 'echo hi', timeout_seconds: -1 }),
    );

    expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    const content = String(result.llmContent);
    expect(content).toContain('0.1s');
    expect(content).toContain('shell-max-timeout-seconds');
    expect(content).toContain('timeout_seconds');
    expect(content).toContain('reduced to the configured ceiling of 0.1s');
  });

  it('clamps an above-maximum request and surfaces it in the result', async () => {
    const host = createFakeHost({
      max: 0.1,
      defaultSeconds: 60,
      behavior: 'complete',
    });

    const result = await runShell(host, {
      command: 'echo hi',
      timeout_seconds: 9999,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).toContain('reduced to the configured ceiling of 0.1s');
    expect(content).toContain('shell-max-timeout-seconds');
  });

  it('honours a below-maximum request exactly with no clamp notice', async () => {
    const host = createFakeHost({
      max: 100,
      defaultSeconds: 60,
      behavior: 'complete',
    });

    const result = await runShell(host, {
      command: 'echo hi',
      timeout_seconds: 5,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).not.toContain('ceiling');
  });

  it('arms no timer when both the host maximum and request are -1', async () => {
    const host = createFakeHost({
      max: -1,
      defaultSeconds: 60,
      behavior: 'complete',
    });

    const result = await runShell(host, {
      command: 'echo hi',
      timeout_seconds: -1,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    expect(content).not.toContain('ceiling');
  });

  it('rejects timeout_seconds: -2 at validation with a clear message', () => {
    const host = createFakeHost({
      max: 100,
      defaultSeconds: 60,
      behavior: 'complete',
    });
    const tool = new ShellTool(host);
    expect(() =>
      tool.build({ command: 'echo hi', timeout_seconds: -2 }),
    ).toThrow(/timeout_seconds/);
    expect(() =>
      tool.build({ command: 'echo hi', timeout_seconds: -2 }),
    ).toThrow(/-1/);
  });

  it('rejects timeout_seconds: 0 at validation with a clear message', () => {
    const host = createFakeHost({
      max: 100,
      defaultSeconds: 60,
      behavior: 'complete',
    });
    const tool = new ShellTool(host);
    expect(() =>
      tool.build({ command: 'echo hi', timeout_seconds: 0 }),
    ).toThrow(/timeout_seconds/);
  });

  it('accepts timeout_seconds: -1 at validation (unlimited ask)', () => {
    const host = createFakeHost({
      max: 100,
      defaultSeconds: 60,
      behavior: 'complete',
    });
    const tool = new ShellTool(host);
    expect(() =>
      tool.build({ command: 'echo hi', timeout_seconds: -1 }),
    ).not.toThrow();
  });

  // Gated to match the production guard: ShellTool.validateToolParams rejects
  // `is_background: true` on win32 outright (shell.ts BACKGROUND_WINDOWS_ERROR),
  // so a background job — and therefore the absence of a clamp notice on one —
  // cannot exist there. Without the gate `build()` throws that validation error
  // and the test fails for a reason unrelated to clamping.
  it.skipIf(process.platform === 'win32')(
    'does not report a clamp notice for a background job (no false claim)',
    async () => {
      const host = createFakeHost({
        max: 0.1,
        defaultSeconds: 60,
        behavior: 'complete',
      });
      // Override launchBackgroundJob so background execution is exercised.
      host.launchBackgroundJob = () => ({
        id: 'job-1',
        command: 'sleep 9999',
        cwd: '/tmp',
        state: 'running',
        startedAt: Date.now(),
        pid: 12345,
      });
      const tool = new ShellTool(host);
      const invocation = tool.build({
        command: 'sleep 9999',
        is_background: true,
        timeout_seconds: 9999,
      });
      const result = await invocation.execute(new AbortController().signal);
      const content = String(result.llmContent);
      // A clamp notice would be a false claim: no timeout is applied to
      // background jobs (Finding 3).
      expect(content).not.toContain('reduced to the configured ceiling');
      expect(content).not.toContain('clamp');
    },
  );

  // The complement of the gate above: win32 has no background jobs, and that
  // rejection is the reason the clamp case cannot be exercised there. Asserting
  // it keeps the platform covered rather than merely skipped.
  it.skipIf(process.platform !== 'win32')(
    'rejects a background job outright on Windows',
    () => {
      const host = createFakeHost({
        max: 0.1,
        defaultSeconds: 60,
        behavior: 'complete',
      });
      const tool = new ShellTool(host);
      expect(() =>
        tool.build({
          command: 'sleep 9999',
          is_background: true,
          timeout_seconds: 9999,
        }),
      ).toThrow(/is_background is not supported on Windows/);
    },
  );

  it('survives summarization and token limiting (durable clamp notice, Finding 4)', async () => {
    const host = createFakeHost({
      max: 0.1,
      defaultSeconds: 60,
      behavior: 'complete',
    });
    // Make summarization REPLACE the whole content and token limiting
    // TRUNCATE it — both are lossy and would erase a notice appended inside
    // formatOutputContent.
    host.trySummarizeOutput = async () => 'SUMMARIZED-REPLACEMENT';
    host.getSummarizeConfig = () => ({ tokenBudget: 100 });
    host.limitOutputTokens = (content: string) => ({
      content: content.slice(0, 5),
      wasTruncated: true,
    });

    const result = await runShell(host, {
      command: 'echo hi',
      timeout_seconds: 9999,
    });

    expect(result.error).toBeUndefined();
    const content = String(result.llmContent);
    // The clamp notice must survive because it is appended AFTER summarization
    // and token limiting (Finding 4).
    expect(content).toContain('reduced to the configured ceiling of 0.1s');
    expect(content).toContain('shell-max-timeout-seconds');
  });
});
