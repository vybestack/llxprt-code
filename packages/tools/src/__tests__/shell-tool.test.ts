/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell Tool Group Behavioral Tests
 *
 * Verifies observable behavior of ShellTool through injected
 * IShellExecutionService and IToolMessageBus. Primary assertions
 * are on ToolResult.lmContent (stdout/stderr content) and
 * ToolResult.returnDisplay — NOT on adapter method call counts.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code and adapters are wired up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
  IToolMessageBus,
  ToolConfirmationOutcome,
  IShellToolHost,
  ShellExecutionResult as ToolsShellExecutionResult,
} from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

vi.mock('node:os');

/**
 * Fake IShellExecutionService that returns controlled stdout/stderr/exitCode.
 * Infrastructure fake — not mock theater. Primary assertions verify
 * observable ToolResult content, not that execute() was called.
 */
function createFakeShellService(
  responses: Map<string, ShellResult>,
): IShellExecutionService {
  return {
    execute: async (command: string, _opts?: unknown) => {
      const response = responses.get(command);
      if (response) return response;
      return {
        stdout: '',
        stderr: `command not found: ${command}`,
        exitCode: 127,
        aborted: false,
      };
    },
    isCommandAllowed: (command: string) =>
      // Allow echo commands, deny everything else
      command.trim().startsWith('echo ') || command.trim() === 'false',
  };
}

/**
 * Fake IToolMessageBus that returns controlled confirmation outcomes.
 */
function createFakeMessageBus(
  outcome: ToolConfirmationOutcome,
): IToolMessageBus {
  return {
    requestConfirmation: async () => outcome,
    publishPolicyUpdate: async () => {},
  };
}

describe('Shell Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    vi.mocked(os.tmpdir).mockReturnValue('/tmp');
  });

  describe('ShellTool execution through IShellExecutionService adapter', () => {
    it('returns ToolResult with exit code and output for allowed command', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo hello', {
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'echo hello' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('hello');
      expect(result.llmContent).toContain('0');
      expect(result.returnDisplay).toContain('hello');
    });

    it('returns ToolResult with error content for failed command', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('false', {
        stdout: '',
        stderr: 'Command failed with exit code 1',
        exitCode: 1,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'false' },
      );

      expect(result.error?.message).toContain('Command failed');
      expect(result.llmContent).toContain('exit code 1');
    });
  });

  describe('ShellTool denial: command not allowed by policy', () => {
    it('returns error ToolResult for denied command', async () => {
      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(new Map<string, ShellResult>()),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'rm -rf /' },
      );

      expect(result.error?.message).toContain('denied');
      expect(result.llmContent).toContain('rm -rf /');
    });

    it('denial produces observable result indicating blocked execution', async () => {
      const responses = new Map<string, ShellResult>();
      const shell = createFakeShellService(responses);

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(shell, createFakeMessageBus('proceed_once')),
        { command: 'rm -rf /' },
      );

      expect(result.error?.message).toContain('denied');
      expect(result.llmContent).toContain('blocked');
    });
  });

  describe('ShellTool approval/confirmation flow through IToolMessageBus', () => {
    it('requestConfirmation returns proceed_once and produces observable ToolResult', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo test', {
        stdout: 'test\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(responses),
          createFakeMessageBus('proceed_once'),
        ),
        { command: 'echo test' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('test');
    });

    it('requestConfirmation returns cancel and cancels execution with observable outcome', async () => {
      const result = await executeToolForBehavioralAssertion(
        new ShellTool(
          createFakeShellService(new Map<string, ShellResult>()),
          createFakeMessageBus('cancel'),
        ),
        { command: 'echo cancelled' },
      );

      expect(result.error?.message).toContain('cancel');
      expect(result.llmContent).toContain('cancel');
    });
  });

  describe('IShellExecutionService adapter round-trip', () => {
    it('save and retrieve command results through adapter', async () => {
      const responses = new Map<string, ShellResult>();
      responses.set('echo test', {
        stdout: 'test\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      });

      const tool = new ShellTool(
        createFakeShellService(responses),
        createFakeMessageBus('proceed_once'),
      );

      const result1 = await executeToolForBehavioralAssertion(tool, {
        command: 'echo test',
      });
      const result2 = await executeToolForBehavioralAssertion(tool, {
        command: 'echo test',
      });

      expect(result1.error).toBeUndefined();
      expect(result2.error).toBeUndefined();
      expect(result1.llmContent).toBe(result2.llmContent);
      expect(result1.llmContent).toContain('test');
    });
  });
});

describe('is_background parameter behaviour @plan:issue1995', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
    vi.mocked(os.tmpdir).mockReturnValue('/tmp');
  });

  function createBackgroundFakeService(): IShellExecutionService {
    return {
      execute: async (): Promise<ShellResult> => ({
        stdout: 'started\n',
        stderr: '',
        exitCode: 0,
        aborted: false,
      }),
      isCommandAllowed: () => true,
    };
  }

  function createAbortedFakeService(): IShellExecutionService {
    return {
      execute: async (): Promise<ShellResult> => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        aborted: true,
      }),
      isCommandAllowed: () => true,
    };
  }

  function createNonZeroExitFakeService(): IShellExecutionService {
    return {
      execute: async (): Promise<ShellResult> => ({
        stdout: '',
        stderr: 'syntax error',
        exitCode: 2,
        aborted: false,
      }),
      isCommandAllowed: () => true,
    };
  }

  /**
   * Builds a full fake IShellToolHost whose executeShellCommand resolves the
   * given ToolsShellExecutionResult. The execution-service adapter hardcodes
   * signal: null and pid: undefined, so it cannot express a node-pty-shaped
   * result (signal '0', defined pid). This fake does, letting the notice
   * guard be exercised as the real PTY backend would.
   */
  function createFakeHostFromResult(
    result: ToolsShellExecutionResult,
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
        timeoutSeconds: undefined,
        defaultTimeoutSeconds: 60,
      }),
      getOutputLimits: () => ({}),
      executeShellCommand: async () => result,
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
    };
  }

  it('successful background launch: llmContent ends with the notice naming the log path (T14 / AC-8)', async () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).toContain('Background PIDs:');
    expect(llm).toContain('Process Group PGID:');
    // Line 1: the background notice header.
    expect(llm).toContain(
      'Background: command was started in the background and was not awaited.',
    );
    // Line 2: the Output line naming the log path, the tail hint, and the
    // outside-the-workspace wording. The execution-service adapter path has
    // no terminate id, so there must be no Status or Terminate line.
    expect(llm).toMatch(/Output: .*\.log \(outside the workspace/);
    expect(llm).toContain('tail -n 50');
    expect(llm).not.toContain('Status:');
    expect(llm).not.toContain('Terminate:');
  });

  it('successful background launch: non-debug returnDisplay reports the background start (T15 / AC-8)', async () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    expect(String(result.returnDisplay)).toContain('Started in background');
  });

  it('successful background launch with no PGID/PID: returnDisplay omits the PGID clause (T15b / AC-8)', async () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const display = String(result.returnDisplay);
    expect(display).not.toContain('PGID');
    expect(display).toMatch(/^Started in background\. Output: .+\.log$/);
  });

  it('background launch whose wrapper exited non-zero: NO notice, normal failure formatting (T16 / AC-8)', async () => {
    const tool = new ShellTool(
      createNonZeroExitFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).not.toContain(
      'Background: command was started in the background',
    );
    expect(llm).toContain('Exit Code: 2');
  });

  it('background launch whose wrapper reported an error: NO notice, normal failure formatting (T17 / AC-8)', async () => {
    const errorService: IShellExecutionService = {
      execute: async (): Promise<ShellResult> => ({
        stdout: '',
        stderr: 'command not found: echo',
        exitCode: 127,
        aborted: false,
      }),
      isCommandAllowed: () => true,
    };
    const tool = new ShellTool(
      errorService,
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).not.toContain(
      'Background: command was started in the background',
    );
    expect(llm).toContain('Exit Code: 127');
    expect(llm).toContain('command not found: echo');
  });

  it('is_background absent: no notice anywhere in llmContent (T18 / AC-6)', async () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
    });

    expect(String(result.llmContent)).not.toContain(
      'Background: command was started in the background',
    );
  });

  it('getDescription appends [background] when is_background is true and does not when absent (T19 / AC-9)', () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const invocationWith = tool.build({
      command: 'echo started',
      is_background: true,
    });
    const invocationWithout = tool.build({ command: 'echo started' });

    expect(invocationWith.getDescription()).toMatch(/ \[background\]$/);
    expect(invocationWithout.getDescription()).not.toMatch(/ \[background\]$/);
  });

  it('shouldConfirmExecute returns exec details with isBackground === true when set, and without the flag when absent (T20 / AC-9)', async () => {
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const invocationWith = tool.build({
      command: 'echo started',
      is_background: true,
    });
    const confirmationWith = await invocationWith.shouldConfirmExecute(
      new AbortController().signal,
    );
    expect(confirmationWith).not.toBe(false);
    if (confirmationWith !== false) {
      expect(confirmationWith.type).toBe('exec');
      if (confirmationWith.type === 'exec') {
        expect(confirmationWith.isBackground).toBe(true);
      }
    }

    const invocationWithout = tool.build({ command: 'echo started' });
    const confirmationWithout = await invocationWithout.shouldConfirmExecute(
      new AbortController().signal,
    );
    expect(confirmationWithout).not.toBe(false);
    if (confirmationWithout !== false) {
      expect(confirmationWithout.type).toBe('exec');
      if (confirmationWithout.type === 'exec') {
        expect(confirmationWithout.isBackground).toBeUndefined();
      }
    }
  });

  it('Windows rejects is_background: true with a message naming Start-Process (T21 / AC-7)', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    const tool = new ShellTool(
      createBackgroundFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    expect(() =>
      tool.build({ command: 'echo started', is_background: true }),
    ).toThrow(/Start-Process/);
  });

  it('user-cancelled background invocation keeps the cancellation llmContent with no notice (T22 / AC-10)', async () => {
    const tool = new ShellTool(
      createAbortedFakeService(),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).toContain('cancel');
    expect(llm).not.toContain(
      'Background: command was started in the background',
    );
  });

  it('PTY-shaped clean result (signal "0", defined pid): background notice IS emitted and names kill -- -<PGID> (T25 / AC-8)', async () => {
    // node-pty reports signal 0 for a clean exit; CoreShellToolHostAdapter
    // stringifies that to '0'. The pid is defined so the terminate clause is
    // produced from result.pid.
    const ptyResult: ToolsShellExecutionResult = {
      output: 'started',
      exitCode: 0,
      signal: '0',
      error: null,
      aborted: false,
      pid: 4242,
    };
    const tool = new ShellTool(
      createFakeHostFromResult(ptyResult),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).toContain('Background: command was started in the background');
    // With a terminate id, the Status and Terminate lines are present.
    expect(llm).toContain('Status: pgrep -g 4242');
    expect(llm).toContain('Terminate: kill -- -4242');
    // The old single-line kill clause must no longer appear.
    expect(llm).not.toContain('Its output is being written to');
  });

  it('signalled result (exitCode null, signal SIGTERM): background notice is NOT emitted (T26 / AC-8)', async () => {
    const signalledResult: ToolsShellExecutionResult = {
      output: '',
      exitCode: null,
      signal: 'SIGTERM',
      error: null,
      aborted: false,
      pid: 99,
    };
    const tool = new ShellTool(
      createFakeHostFromResult(signalledResult),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    expect(String(result.llmContent)).not.toContain(
      'Background: command was started in the background',
    );
  });

  it('background launch whose wrapper exits non-zero leaves NO shell_bg_*.log behind (G1a)', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(process.env.TMPDIR ?? '/tmp', 'shell-bg-g1a-'),
    );
    try {
      vi.mocked(os.tmpdir).mockReturnValue(tempDir);
      const nonZeroResult: ToolsShellExecutionResult = {
        output: '',
        exitCode: 2,
        signal: null,
        error: null,
        aborted: false,
        pid: undefined,
      };
      const host = createFakeHostFromResult(nonZeroResult);
      const originalExecute = host.executeShellCommand;
      host.executeShellCommand = async (command: string) => {
        // Simulate the background redirect creating the log file on disk, as
        // the real `>log 2>&1` wrapper would.
        const match = command.match(/shell_bg_[a-f0-9]+\.log/);
        if (match) {
          const logPath = path.join(tempDir, match[0]);
          fs.writeFileSync(logPath, '');
        }
        return originalExecute(command);
      };

      const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

      const before = new Set(
        fs
          .readdirSync(tempDir)
          .filter((name) => /^shell_bg_.*\.log$/.test(name)),
      );

      await executeToolForBehavioralAssertion(tool, {
        command: 'echo started',
        is_background: true,
      });

      const after = fs
        .readdirSync(tempDir)
        .filter((name) => /^shell_bg_.*\.log$/.test(name));
      for (const name of after) {
        expect(before.has(name)).toBe(true);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('background launch that succeeds leaves its log file behind (G1b)', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(process.env.TMPDIR ?? '/tmp', 'shell-bg-g1b-'),
    );
    let createdLogPath: string | undefined;
    try {
      vi.mocked(os.tmpdir).mockReturnValue(tempDir);
      const cleanResult: ToolsShellExecutionResult = {
        output: 'started',
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: undefined,
      };
      const host = createFakeHostFromResult(cleanResult);
      host.executeShellCommand = async (command: string) => {
        const match = command.match(/shell_bg_[a-f0-9]+\.log/);
        if (match) {
          createdLogPath = path.join(tempDir, match[0]);
          fs.writeFileSync(createdLogPath, 'started\n');
        }
        return cleanResult;
      };

      const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

      const result = await executeToolForBehavioralAssertion(tool, {
        command: 'echo started',
        is_background: true,
      });

      // The path named in llmContent must still exist on disk, because the
      // detached job owns it.
      const llm = String(result.llmContent);
      const logName = llm.match(/shell_bg_[a-f0-9]+\.log/);
      expect(logName).not.toBeNull();
      const survivingPath = path.join(tempDir, String(logName?.[0]));
      expect(fs.existsSync(survivingPath)).toBe(true);
    } finally {
      if (createdLogPath !== undefined && fs.existsSync(createdLogPath)) {
        fs.unlinkSync(createdLogPath);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
