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
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
  IToolMessageBus,
  ToolConfirmationOutcome,
  IShellToolHost,
  HostShellJobInfo,
  HostShellJobTailResult,
  BackgroundPromotionResult,
} from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';

const { mockPlatform, mockTmpdir } = {
  mockPlatform: vi.fn(() => 'darwin'),
  mockTmpdir: vi.fn(() => '/tmp'),
};

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: { ...actual, platform: mockPlatform, tmpdir: mockTmpdir },
    ...actual,
    platform: mockPlatform,
    tmpdir: mockTmpdir,
  };
});

/**
 * Fake IShellExecutionService that returns controlled stdout/stderr/exitCode.
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
      command.trim().startsWith('echo ') || command.trim() === 'false',
  };
}

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
    mockPlatform.mockReturnValue('darwin');
    mockTmpdir.mockReturnValue('/tmp');
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

describe('is_background managed job behavior @plan:issue1995', () => {
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
        timeoutSeconds: undefined,
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

  it('is_background: true returns a deterministic job-shaped result with job id, command, and state (T14)', async () => {
    let launched: { command: string; cwd: string } | undefined;
    const fakeJob: HostShellJobInfo = {
      id: 'shell_abc123',
      command: 'echo started',
      cwd: process.cwd(),
      state: 'running',
      startedAt: 1000,
      pid: 42,
    };

    const host = createFakeHostWithBackground((input) => {
      launched = input;
      return fakeJob;
    });

    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    // The job was launched with the stripped command and resolved cwd.
    expect(launched).toBeDefined();
    expect(launched?.command).toBe('echo started');

    const llm = String(result.llmContent);
    expect(llm).toContain('Background job launched.');
    expect(llm).toContain('Job ID: shell_abc123');
    expect(llm).toContain('Command: echo started');
    expect(llm).toContain('State: running');
    expect(llm).toContain('check_async_tasks');
    // Must NOT print a filesystem path, raw PGID, or pgrep/kill instructions.
    expect(llm).not.toContain('.log');
    expect(llm).not.toContain('pgrep');
    expect(llm).not.toContain('kill');
    expect(llm).not.toContain('PGID');
  });

  it('is_background: true with a fast-completing job includes exit code and output tail (T15)', async () => {
    const fakeJob: HostShellJobInfo = {
      id: 'shell_def456',
      command: 'true',
      cwd: process.cwd(),
      state: 'completed',
      startedAt: 1000,
      endedAt: 1001,
      pid: 42,
      exitCode: 0,
    };

    const host = createFakeHostWithBackground(
      () => fakeJob,
      () => ({ id: 'shell_def456', output: 'done\n', truncated: false }),
    );

    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'true',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).toContain('Job ID: shell_def456');
    expect(llm).toContain('State: completed');
    expect(llm).toContain('Exit Code: 0');
    expect(llm).toContain('done');
    expect(llm).toContain('check_async_tasks');
  });

  it('is_background: true never returns foreground-shaped output (T16)', async () => {
    const fakeJob: HostShellJobInfo = {
      id: 'shell_fast',
      command: 'true',
      cwd: process.cwd(),
      state: 'completed',
      startedAt: 1000,
      endedAt: 1000,
      pid: 1,
      exitCode: 0,
    };

    const host = createFakeHostWithBackground(() => fakeJob);
    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'true',
      is_background: true,
    });

    const llm = String(result.llmContent);
    // Must NOT contain the foreground-shaped output keys.
    expect(llm).not.toContain('Stdout:');
    expect(llm).not.toContain('Stderr:');
    expect(llm).not.toContain('Process Group PGID:');
    expect(llm).not.toContain('Background PIDs:');
  });

  it('is_background absent: no job-shaped result, normal foreground output (T18)', async () => {
    const responses = new Map<string, ShellResult>();
    responses.set('echo started', {
      stdout: 'started\n',
      stderr: '',
      exitCode: 0,
      aborted: false,
    });

    const tool = new ShellTool(
      createFakeShellService(responses),
      createFakeMessageBus('proceed_once'),
    );

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
    });

    const llm = String(result.llmContent);
    expect(llm).not.toContain('Background job launched.');
    expect(llm).not.toContain('Job ID:');
    expect(llm).toContain('started');
  });

  it('getDescription appends [background] when is_background is true and does not when absent (T19)', () => {
    const fakeJob: HostShellJobInfo = {
      id: 'shell_x',
      command: 'echo started',
      cwd: process.cwd(),
      state: 'running',
      startedAt: 1,
      pid: 1,
    };
    const host = createFakeHostWithBackground(() => fakeJob);
    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

    const invocationWith = tool.build({
      command: 'echo started',
      is_background: true,
    });
    const invocationWithout = tool.build({ command: 'echo started' });

    expect(invocationWith.getDescription()).toMatch(/ \[background\]$/);
    expect(invocationWithout.getDescription()).not.toMatch(/ \[background\]$/);
  });

  it('shouldConfirmExecute returns exec details with isBackground === true when set (T20)', async () => {
    const fakeJob: HostShellJobInfo = {
      id: 'shell_x',
      command: 'echo started',
      cwd: process.cwd(),
      state: 'running',
      startedAt: 1,
      pid: 1,
    };
    const host = createFakeHostWithBackground(() => fakeJob);
    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

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
  });

  it('Windows accepts is_background: true as a managed background job (T21)', () => {
    mockPlatform.mockReturnValue('win32');
    const tool = new ShellTool(
      createFakeShellService(new Map<string, ShellResult>()),
      createFakeMessageBus('proceed_once'),
    );

    // Windows now supports managed background jobs — build() must NOT throw.
    expect(() =>
      tool.build({ command: 'echo started', is_background: true }),
    ).not.toThrow();
  });

  it('background result does not reference any filesystem path (no .log, no tmpdir) (T22)', async () => {
    const fakeJob: HostShellJobInfo = {
      id: 'shell_nopath',
      command: 'sleep 60',
      cwd: '/tmp',
      state: 'running',
      startedAt: 1000,
      pid: 99,
    };

    const host = createFakeHostWithBackground(() => fakeJob);
    const tool = new ShellTool(host, createFakeMessageBus('proceed_once'));

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'sleep 60',
      is_background: true,
    });

    const llm = String(result.llmContent);
    expect(llm).not.toMatch(/\.log/);
    expect(llm).not.toContain('/tmp/');
    expect(llm).not.toContain('os.tmpdir');
  });

  it('standalone execution-service adapter fails fast for is_background: true (T23)', async () => {
    // The standalone adapter (createShellToolHostFromExecutionService) has no
    // ShellJobManager. It must throw rather than silently degrade.
    const service: IShellExecutionService = {
      execute: async (): Promise<ShellResult> => ({
        stdout: '',
        stderr: '',
        exitCode: 0,
        aborted: false,
      }),
      isCommandAllowed: () => true,
    };

    const tool = new ShellTool(service, createFakeMessageBus('proceed_once'));

    const result = await executeToolForBehavioralAssertion(tool, {
      command: 'echo started',
      is_background: true,
    });

    // The error must be caught and surfaced, not silently degraded.
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('not supported');
  });
});
