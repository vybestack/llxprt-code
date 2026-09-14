/**
 * @plan:issue3589
 */

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { ShellTool } from '../index.js';
import type { ToolResult } from '../tools/tools.js';
import { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';
import type {
  IToolMessageBus,
  IShellToolHost,
  HostShellJobInfo,
  HostShellJobTailResult,
  BackgroundPromotionResult,
  ShellExecutionResult,
} from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

const { mockPlatform, mockTmpdir } = {
  mockPlatform: vi.fn(() => 'darwin'),
  mockTmpdir: vi.fn(() => '/tmp'),
};

const actual = { ...(await import('node:os')) };
void vi.mock('node:os', () => ({
  ...actual,
  default: { ...actual, platform: mockPlatform, tmpdir: mockTmpdir },
  platform: mockPlatform,
  tmpdir: mockTmpdir,
}));

function createFakeMessageBus(
  outcome: ToolConfirmationOutcome,
): IToolMessageBus {
  return {
    requestConfirmation: async () => outcome,
    publishPolicyUpdate: async () => {},
  };
}

describe('shell result contracts @plan:issue1995 @plan:issue3200', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('darwin');
    mockTmpdir.mockReturnValue('/tmp');
  });

  /**
   * Builds a fake IShellToolHost that launches managed background jobs via a
   * fake `launchBackgroundJob` returning a controlled HostShellJobInfo. This
   * tests the deterministic result contract: the tool must always return a
   * job-shaped result, never foreground-shaped.
   */
  function createFakeHostWithBackground(
    launchJob: (input: { command: string; cwd: string }) => HostShellJobInfo,
    tail: (id: string) => HostShellJobTailResult = () => ({
      id: 'fake',
      output: '',
      truncated: false,
    }),
  ): IShellToolHost {
    return {
      getTargetDir: () => process.cwd(),
      getWorkspaceContext: () => ({
        getDirectories: () => [process.cwd()],
        isPathWithinWorkspace: (resolvedPath: string) =>
          resolvedPath === process.cwd() ||
          resolvedPath.startsWith(`${process.cwd()}/`),
      }),
      isCommandAllowed: () => ({ allowed: true }),
      isShellInvocationAllowlisted: () => false,
      isInteractive: () => true,
      isYoloMode: () => false,
      getDebugMode: () => false,
      getShellExecutionConfig: () => ({
        shouldUseNodePty: false,
        executionOptions: {},
      }),
      getTimeoutConfig: () => ({
        timeoutSeconds: -1,
        defaultTimeoutSeconds: 60,
      }),
      getOutputLimits: () => ({}),
      executeShellCommand: async () => {
        throw new Error('Should not execute synchronously for background jobs');
      },
      getCommandRoots: (command: string) => {
        const root = command.trim().split(/\s+/)[0];
        return root ? [root] : [];
      },
      stripShellWrapper: (command: string) => command,
      validatePathWithinWorkspace: () => null,
      isPtyActive: () => false,
      formatMemoryUsage: (bytes: number) =>
        bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`,
      trySummarizeOutput: async (content: string) => content,
      getSummarizeConfig: () => undefined,
      limitOutputTokens: (content: string) => ({
        content,
        wasTruncated: false,
      }),
      launchBackgroundJob: launchJob,
      tailBackgroundJob: tail,
      detectTrailingBackground: (
        command: string,
      ): BackgroundPromotionResult => ({
        promoted: false,
        command,
      }),
    };
  }

  /**
   * Builds a host whose foreground execution resolves with an aborted
   * result only when the combined timeout/user signal fires, so the tool
   * computes a genuine abort path (timeout-triggered or user-cancelled)
   * the way production does. The fake result carries its pgid verbatim so
   * collectProcessInfo never falls through to a real `ps` lookup for the
   * fabricated pid.
   */
  function createTimeoutAbortingHost(
    resultFields: Partial<ShellExecutionResult>,
    onEntered: () => void = () => undefined,
  ): IShellToolHost {
    const base = createFakeHostWithBackground(() => {
      throw new Error('Foreground execution must not launch a background job');
    });
    const buildResult = (): ShellExecutionResult => ({
      output: 'partial output',
      exitCode: null,
      signal: '15',
      error: null,
      aborted: true,
      pid: 4321,
      pgid: 4321,
      ...resultFields,
    });
    return {
      ...base,
      executeShellCommand: (_command, _cwd, _onOutput, signal) =>
        new Promise<ShellExecutionResult>((resolve) => {
          onEntered();
          if (signal.aborted) {
            resolve(buildResult());
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              resolve(buildResult());
            },
            { once: true },
          );
        }),
    };
  }

  describe('termination cause reporting @plan:issue3589', () => {
    const setting = 'shell-inactivity-timeout-seconds';
    const outside = 'outside the shell tool';
    function causeHost(
      fields: Partial<ShellExecutionResult>,
      inactivityTimeoutMs?: number,
    ): IShellToolHost {
      const base = createTimeoutAbortingHost({});
      return {
        ...base,
        getShellExecutionConfig: () => ({
          ...base.getShellExecutionConfig(),
          inactivityTimeoutMs,
        }),
        executeShellCommand: async () => ({
          output: 'partial output',
          exitCode: null,
          signal: '15',
          error: null,
          aborted: false,
          pid: 4321,
          pgid: 4321,
          ...fields,
        }),
      };
    }
    async function runHost(
      host: IShellToolHost,
      signal?: AbortSignal,
      timeout_seconds?: number,
    ): Promise<ToolResult> {
      const bus = createFakeMessageBus(ToolConfirmationOutcome.ProceedOnce);
      return executeToolForBehavioralAssertion(
        new ShellTool(host, bus),
        { command: 'sleep 60', timeout_seconds },
        signal,
      );
    }
    describe.each([
      {
        cause: 'A/B: inactivity',
        inactivityTimedOut: true,
        phrases: ['no output', setting, '120s', '-1', 'timeout_seconds'],
      },
      {
        cause: 'D: external signal',
        inactivityTimedOut: false,
        phrases: [
          outside,
          'signal 15',
          'not a tool timeout',
          'not an inactivity kill',
          'not a user cancellation',
        ],
      },
    ])('$cause', ({ inactivityTimedOut, phrases }) => {
      it.each([false, true])(
        'survives summarization=%s in both fields',
        async (summarize) => {
          const base = causeHost({ inactivityTimedOut }, 120000);
          const host: IShellToolHost = {
            ...base,
            getSummarizeConfig: () =>
              summarize ? { tokenBudget: 100 } : undefined,
            trySummarizeOutput: async () => 'SUMMARIZED OUTPUT',
          };
          const result = await runHost(host);
          for (const content of [result.llmContent, result.returnDisplay]) {
            for (const phrase of phrases)
              expect(String(content)).toContain(phrase);
            expect(String(content).includes(outside)).toBe(!inactivityTimedOut);
          }
          const prefix = summarize
            ? 'SUMMARIZED OUTPUT\n\nTermination cause:'
            : 'Signal: 15';
          expect(String(result.llmContent)).toContain(prefix);
        },
      );
      it('survives token limiting in both fields', async () => {
        const host = causeHost({ inactivityTimedOut }, 120000);
        host.limitOutputTokens = () => ({
          content: 'TRUNCATED TOKEN LIMITED OUTPUT',
          wasTruncated: true,
        });

        const result = await runHost(host);

        const llmContent = String(result.llmContent);
        const limitedPrefix =
          'TRUNCATED TOKEN LIMITED OUTPUT\n\n(output exceeded token limit)\n\nTermination cause:';
        expect(llmContent.startsWith(limitedPrefix)).toBe(true);
        for (const phrase of phrases) {
          expect(llmContent.indexOf(phrase)).toBeGreaterThanOrEqual(
            limitedPrefix.length,
          );
          expect(String(result.returnDisplay)).toContain(phrase);
        }
      });
    });
    it.each([undefined, Number.NaN, Infinity, 0, -1])(
      'C: omits invalid window %s',
      async (window) => {
        const result = await runHost(
          causeHost({ inactivityTimedOut: true }, window),
        );
        for (const content of [result.llmContent, result.returnDisplay]) {
          expect(String(content)).toContain('no output');
          expect(String(content)).toContain(setting);
          expect(String(content)).not.toMatch(/NaN|undefined|Infinity|0s|-1s/);
        }
      },
    );
    it.each([null, ''])(
      'E: no cause notice for clean signal=%s',
      async (signal) => {
        const result = await runHost(causeHost({ signal, exitCode: 0 }));
        expect(result.llmContent).toBe(
          'Command: sleep 60\n' +
            'Directory: (root)\n' +
            'Stdout: partial output\n' +
            'Stderr: (empty)\n' +
            'Error: (none)\n' +
            'Exit Code: 0\n' +
            `Signal: ${signal === null ? '(none)' : ''}\n` +
            'Background PIDs: (none)\n' +
            'Process Group PGID: 4321',
        );
        expect(result.returnDisplay).toBe('partial output');
        for (const content of [result.llmContent, result.returnDisplay]) {
          expect(String(content)).not.toContain('Termination cause:');
        }
      },
    );
    it.each([false, true])(
      'F: cancellation with inactivity=%s',
      async (inactivityTimedOut) => {
        const userAbort = new AbortController();
        const entered = Promise.withResolvers<void>();
        const host = createTimeoutAbortingHost(
          { inactivityTimedOut },
          entered.resolve,
        );
        const pending = runHost(host, userAbort.signal);
        await entered.promise;
        userAbort.abort();
        const result = await pending;
        expect(String(result.llmContent)).toContain('cancelled by user');
        for (const content of [result.llmContent, result.returnDisplay]) {
          expect(String(content)).not.toContain(outside);
          expect(String(content).includes(setting)).toBe(inactivityTimedOut);
        }
      },
    );
    it.each([false, true])(
      'G: timeout with inactivity=%s',
      async (inactivityTimedOut) => {
        const host = createTimeoutAbortingHost({ inactivityTimedOut });
        const result = await runHost(host, undefined, 0.01);
        for (const content of [result.llmContent, result.returnDisplay]) {
          expect(String(content)).toContain('timed out');
          expect(String(content)).not.toContain(outside);
          expect(String(content).includes(setting)).toBe(inactivityTimedOut);
        }
      },
    );
  });
});
