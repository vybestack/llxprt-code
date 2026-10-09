/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi, expect, describe, it, type Mock } from 'bun:test';
import { spawn } from 'node:child_process';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  HookEventName,
  HookType,
  type HookConfig,
  type HookInput,
  type HookOutput,
} from './types.js';
import type { HookRunner } from './hookRunner.js';
import {
  mockInput,
  invalidJsonCases,
  type MockChildProcessWithoutNullStreams,
} from './hookRunner-test-helpers.js';
let hookRunner: HookRunner;
let mockSpawn: MockChildProcessWithoutNullStreams;
let spawner: Mock<typeof spawn>;
let mockDebugLogger: { warn: (...args: unknown[]) => void };
export function configureRunnerTests(
  runner: HookRunner,
  child: MockChildProcessWithoutNullStreams,
  logger: { warn: (...args: unknown[]) => void },
  spawnFunction: Mock<typeof spawn>,
): void {
  hookRunner = runner;
  spawner = spawnFunction;
  mockSpawn = child;
  mockDebugLogger = logger;
}
export function decodeSpawnCommand(args: readonly string[]): string {
  const shellCommand = String(args[args.length - 1] ?? '');
  const encodedCommand = shellCommand.match(
    /FromBase64String\('([^']+)'\)/,
  )?.[1];
  return encodedCommand
    ? Buffer.from(encodedCommand, 'base64').toString('utf8')
    : shellCommand;
}

/** Checks for escaped version of malicious path in ls command. */
function isMaliciousPathEscaped(s: string): boolean {
  if (!s.startsWith('ls ')) {
    return false;
  }
  if (!s.includes('echo') || !s.includes('pwned')) {
    return false;
  }
  return s.includes("'") || s.includes('"');
}

/** Configures mockProcessOn to fire the `close` event with the given exit code. */
export const onClose = (
  exitCode: number,
  schedule: (cb: () => void) => void = (cb) => setTimeout(cb, 20),
): void => {
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        schedule(() => callback(exitCode));
      }
    },
  );
};

/** Configures mockStdoutOn to emit `data` with the given payload. */
export const onStdoutData = (data: string, delay = 10): void => {
  mockSpawn.mockStdoutOn.mockImplementation(
    (event: string, callback: (data: Buffer) => void) => {
      if (event === 'data') {
        setTimeout(() => callback(Buffer.from(data)), delay);
      }
    },
  );
};

/** Configures mockStderrOn to emit `data` with the given payload. */
export const onStderrData = (data: string, delay = 10): void => {
  mockSpawn.mockStderrOn.mockImplementation(
    (event: string, callback: (data: Buffer) => void) => {
      if (event === 'data') {
        setTimeout(() => callback(Buffer.from(data)), delay);
      }
    },
  );
};

export const configureTimeoutProcess = (): {
  readonly wasKilled: () => boolean;
} => {
  let closeCallback: ((code: number) => void) | undefined;
  let killWasCalled = false;
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') closeCallback = callback;
    },
  );
  mockSpawn.kill = vi.fn().mockImplementation((_signal: string) => {
    killWasCalled = true;
    const callback = closeCallback;
    if (callback) setTimeout(() => callback(128), 5);
    return true;
  });
  return { wasKilled: () => killWasCalled };
};

export const configureSigkillEscalation = (signals: string[]): void => {
  let closeCallback: ((code: number) => void) | undefined;
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') closeCallback = callback;
    },
  );
  mockSpawn.kill = vi.fn().mockImplementation((signal: string) => {
    signals.push(signal);
    Object.assign(mockSpawn, { killed: true });
    const callback = closeCallback;
    if (signal === 'SIGKILL' && callback) {
      Object.assign(mockSpawn, { exitCode: null, signalCode: 'SIGKILL' });
      queueMicrotask(() => callback(137));
    }
    return true;
  });
};

export const expandedProjectCommand = (): string =>
  process.platform === 'win32'
    ? "'/test/project'/hooks/test.sh"
    : '/test/project/hooks/test.sh';

export const configureMixedCloseResults = (): void => {
  let callCount = 0;
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        const exitCode = callCount++ === 0 ? 0 : 1;
        setTimeout(() => callback(exitCode), 10);
      }
    },
  );
};

export const configureSequentialOrder = (executionOrder: string[]): void => {
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        const call = spawner.mock.calls[executionOrder.length];
        executionOrder.push(decodeSpawnCommand(call[1]));
        setImmediate(() => callback(0));
      }
    },
  );
};

export const configureContinueAfterFailure = (): void => {
  let callCount = 0;
  mockSpawn.mockStderrOn.mockImplementation(
    (event: string, callback: (data: Buffer) => void) => {
      if (event === 'data' && callCount === 1) {
        setTimeout(() => callback(Buffer.from('Hook 2 failed')), 10);
      }
    },
  );
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        const exitCode = callCount++ === 1 ? 1 : 0;
        setTimeout(() => callback(exitCode), 20);
      }
    },
  );
};

export const configureFirstHookOutput = (output: unknown): void => {
  let hookCallCount = 0;
  mockSpawn.mockStdoutOn.mockImplementation(
    (event: string, callback: (data: Buffer) => void) => {
      if (event === 'data' && hookCallCount === 0) {
        setTimeout(() => callback(Buffer.from(JSON.stringify(output))), 10);
      }
    },
  );
  mockSpawn.mockProcessOn.mockImplementation(
    (event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        hookCallCount++;
        setTimeout(() => callback(0), 20);
      }
    },
  );
};

export const commandConfig: HookConfig = {
  type: HookType.Command,
  command: './hooks/test.sh',
  timeout: 5000,
};

export async function executesSuccessfulCommand(): Promise<void> {
  const mockOutput: HookOutput = {
    decision: 'allow',
    reason: 'All good',
  };

  // Mock successful execution
  onStdoutData(JSON.stringify(mockOutput));
  onClose(0);

  const result = await hookRunner.executeHook(
    commandConfig,
    HookEventName.BeforeTool,
    mockInput,
  );

  expect(result.success).toBe(true);
  expect(result.output).toStrictEqual(mockOutput);
  expect(result.exitCode).toBe(0);
  expect(mockSpawn.stdin.write).toHaveBeenCalledWith(JSON.stringify(mockInput));
}

export async function handlesFailedCommand(): Promise<void> {
  const errorMessage = 'Command failed';

  onStderrData(errorMessage);
  onClose(1);

  const result = await hookRunner.executeHook(
    commandConfig,
    HookEventName.BeforeTool,
    mockInput,
  );

  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(errorMessage);
}

export async function usesNamedCommandError(): Promise<void> {
  const namedConfig: HookConfig = {
    name: 'my-friendly-hook',
    type: HookType.Command,
    command: './hooks/fail.sh',
  };

  // Mock error during spawn
  spawner.mockImplementationOnce(() => {
    throw new Error('Spawn error');
  });

  await hookRunner.executeHook(
    namedConfig,
    HookEventName.BeforeTool,
    mockInput,
  );

  expect(mockDebugLogger.warn).toHaveBeenCalledWith(
    expect.stringContaining('(hook: my-friendly-hook): Error: Spawn error'),
  );
}

export async function escalatesSigkill(): Promise<void> {
  vi.useFakeTimers();
  const shortTimeoutConfig: HookConfig = {
    type: HookType.Command,
    command: './hooks/slow.sh',
    timeout: 50,
  };

  const signals: string[] = [];

  Object.assign(mockSpawn, {
    exitCode: null,
    signalCode: null,
    killed: false,
  });
  configureSigkillEscalation(signals);

  try {
    const resultPromise = hookRunner.executeHook(
      shortTimeoutConfig,
      HookEventName.BeforeTool,
      mockInput,
    );

    // Let the async executeHook start and set up timers.
    // Under fake timers, we need to flush microtasks for the async
    // operation to proceed and register the setTimeout.
    await advanceTimersByTimeAsync(0);

    // Advance timers to trigger SIGTERM (timeout=50ms)
    vi.advanceTimersByTime(50);
    expect(signals).toStrictEqual(['SIGTERM']);
    expect(mockSpawn.killed).toBe(true);

    // Advance timers to trigger SIGKILL escalation (5000ms after SIGTERM)
    vi.advanceTimersByTime(5000);
    expect(signals).toStrictEqual(['SIGTERM', 'SIGKILL']);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('timed out');
  } finally {
    vi.useRealTimers();
  }
}

export async function expandsCommandEnvironment(): Promise<void> {
  const configWithEnvVar: HookConfig = {
    type: HookType.Command,
    command: '$LLXPRT_PROJECT_DIR/hooks/test.sh',
  };

  onClose(0, (cb) => setImmediate(cb));

  await hookRunner.executeHook(
    configWithEnvVar,
    HookEventName.BeforeTool,
    mockInput,
  );

  // SECURITY: Verify spawn is called with shell executable and expanded path
  const spawnCall = spawner.mock.calls[0];
  expect(spawnCall[0]).toMatch(/bash|powershell/i);
  expect(spawnCall[2]).toStrictEqual(
    expect.objectContaining({
      shell: false,
      env: expect.objectContaining({
        LLXPRT_PROJECT_DIR: '/test/project',
      }),
    }),
  );
  const expandedCommand = decodeSpawnCommand(spawnCall[1]);
  expect(expandedCommand).toContain(expandedProjectCommand());
}

export async function rejectsCommandInjection(): Promise<void> {
  const maliciousCwd = '/test/project; echo "pwned" > /tmp/pwned';
  const mockMaliciousInput: HookInput = {
    ...mockInput,
    cwd: maliciousCwd,
  };

  const config: HookConfig = {
    type: HookType.Command,
    command: 'ls $LLXPRT_PROJECT_DIR',
  };

  onClose(0, (cb) => setImmediate(cb));

  await hookRunner.executeHook(
    config,
    HookEventName.BeforeTool,
    mockMaliciousInput,
  );

  // SECURITY: If secure, spawn will be called with escaped command
  // The malicious "; echo pwned" must appear as LITERAL TEXT, not executed
  expect(spawn).toHaveBeenCalledWith(
    expect.stringMatching(/bash|powershell/),
    expect.arrayContaining([expect.any(String)]),
    expect.objectContaining({
      shell: false, // CRITICAL: shell must be false
    }),
  );

  // Verify the decoded command contains the escaped malicious path.
  const commandArgs = spawner.mock.calls[0][1];
  expect(isMaliciousPathEscaped(decodeSpawnCommand(commandArgs))).toBe(true);
}

export async function passesBeforeAgentMutation(): Promise<void> {
  const configs: HookConfig[] = [
    { type: HookType.Command, command: './hook1.sh' },
    { type: HookType.Command, command: './hook2.sh' },
  ];

  const mockBeforeAgentInput = {
    ...mockInput,
    prompt: 'Original prompt',
  };

  const mockOutput1 = {
    decision: 'allow' as const,
    hookSpecificOutput: {
      additionalContext: 'Context from hook 1',
    },
  };

  configureFirstHookOutput(mockOutput1);

  const results = await hookRunner.executeHooksSequential(
    configs,
    HookEventName.BeforeAgent,
    mockBeforeAgentInput,
  );

  expect(results).toHaveLength(2);
  expect(results[0].success).toBe(true);
  expect(results[0].output).toStrictEqual(mockOutput1);

  // Verify that the second hook received modified input
  const secondHookInput = JSON.parse(mockSpawn.mockStdinWrite.mock.calls[1][0]);
  expect(secondHookInput.prompt).toContain('Original prompt');
  expect(secondHookInput.prompt).toContain('Context from hook 1');
}

export async function passesBeforeModelMutation(): Promise<void> {
  const configs: HookConfig[] = [
    { type: HookType.Command, command: './hook1.sh' },
    { type: HookType.Command, command: './hook2.sh' },
  ];

  const mockBeforeModelInput = {
    ...mockInput,
    llm_request: {
      version: 2,
      model: 'gemini-1.5-pro',
      contents: [
        { speaker: 'user', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    },
  };

  const mockOutput1 = {
    decision: 'allow' as const,
    hookSpecificOutput: {
      llm_request: {
        settings: { temperature: 0.7 },
      },
    },
  };

  configureFirstHookOutput(mockOutput1);

  const results = await hookRunner.executeHooksSequential(
    configs,
    HookEventName.BeforeModel,
    mockBeforeModelInput,
  );

  expect(results).toHaveLength(2);
  expect(results[0].success).toBe(true);

  // Verify that the second hook received modified input
  const secondHookInput = JSON.parse(mockSpawn.mockStdinWrite.mock.calls[1][0]);
  expect(secondHookInput.llm_request.model).toBe('gemini-1.5-pro');
  expect(secondHookInput.llm_request.settings.temperature).toBe(0.7);
  expect(secondHookInput.llm_request.contents).toHaveLength(1);
}
export function registerExecuteHookTests(): void {
  describe('executeHook', () => {
    describe('command hooks', () => {
      describe.skipIf(process.platform !== 'win32')('on Windows', () => {
        it('should preserve native and PowerShell command failures', async () => {
          onClose(2, (callback) => setImmediate(callback));

          const result = await hookRunner.executeHook(
            commandConfig,
            HookEventName.BeforeTool,
            mockInput,
          );

          expect(result.success).toBe(false);
          expect(result.exitCode).toBe(2);
          expect(spawn).toHaveBeenCalledWith(
            expect.stringMatching(/powershell/i),
            expect.arrayContaining([
              expect.stringContaining('[Convert]::FromBase64String'),
              expect.stringContaining('[ScriptBlock]::Create'),
              expect.stringContaining('$global:LASTEXITCODE = 0'),
              expect.stringContaining('$global:__LLXPRT_HOOK_SUCCEEDED = $?'),
              expect.stringContaining(
                '$global:__LLXPRT_HOOK_EXIT_CODE = $LASTEXITCODE',
              ),
              expect.stringContaining(
                'if ($global:__LLXPRT_HOOK_SUCCEEDED) { exit 0 }',
              ),
              expect.stringContaining(
                'if ($global:__LLXPRT_HOOK_EXIT_CODE -ne 0) { exit $global:__LLXPRT_HOOK_EXIT_CODE }',
              ),
              expect.stringContaining('exit 1'),
            ]),
            expect.objectContaining({ shell: false }),
          );
        });
      });
      it('should execute command hook successfully', executesSuccessfulCommand);
      it('should handle command hook failure', handlesFailedCommand);
      it(
        'should use hook name in error messages if available',
        usesNamedCommandError,
      );

      it('should handle command hook timeout', async () => {
        const shortTimeoutConfig: HookConfig = {
          type: HookType.Command,
          command: './hooks/slow.sh',
          timeout: 50, // Very short timeout for testing
        };

        const timeoutProcess = configureTimeoutProcess();

        const result = await hookRunner.executeHook(
          shortTimeoutConfig,
          HookEventName.BeforeTool,
          mockInput,
        );

        expect(result.success).toBe(false);
        expect(timeoutProcess.wasKilled()).toBe(true);
        expect(result.error?.message).toContain('timed out');
        expect(mockSpawn.kill).toHaveBeenCalledWith('SIGTERM');
      });
      it(
        'should escalate to SIGKILL when the process ignores SIGTERM',
        escalatesSigkill,
      );
      it(
        'should expand environment variables in commands',
        expandsCommandEnvironment,
      );
      it(
        'should not allow command injection via LLXPRT_PROJECT_DIR (SECURITY)',
        rejectsCommandInjection,
      );
    });
  });
}

export function registerParallelTests(): void {
  describe('executeHooksParallel', () => {
    it('should execute multiple hooks in parallel', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      // Mock both commands to succeed
      onClose(0, (cb) => setTimeout(cb, 10));

      const results = await hookRunner.executeHooksParallel(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed success and failure', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      configureMixedCloseResults();

      const results = await hookRunner.executeHooksParallel(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });
}

export function registerSequentialTests(): void {
  describe('executeHooksSequential', () => {
    it('should execute multiple hooks in sequence', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      const executionOrder: string[] = [];

      // Mock both commands to succeed
      configureSequentialOrder(executionOrder);

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
      // Verify they were called sequentially
      expect(executionOrder).toStrictEqual(['./hook1.sh', './hook2.sh']);
    });

    it('should continue execution even if a hook fails', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
        { type: HookType.Command, command: './hook3.sh' },
      ];

      configureContinueAfterFailure();

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(3);
    });
    it(
      'should pass modified input from one hook to the next for BeforeAgent',
      passesBeforeAgentMutation,
    );
    it(
      'should pass modified LLM request from one hook to the next for BeforeModel',
      passesBeforeModelMutation,
    );

    it('should not modify input if hook fails', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      onStderrData('Hook failed');

      onClose(1, (callback) => setTimeout(callback, 20));

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success === false)).toBe(true);

      // Verify that both hooks received the same original input
      const firstHookInput = JSON.parse(
        mockSpawn.mockStdinWrite.mock.calls[0][0],
      );
      const secondHookInput = JSON.parse(
        mockSpawn.mockStdinWrite.mock.calls[1][0],
      );
      expect(firstHookInput).toStrictEqual(secondHookInput);
    });
  });
}

export function registerInvalidJsonTests(): void {
  describe('invalid JSON handling', () => {
    it.each(invalidJsonCases)('%s', async (_title, exitCode, text, output) => {
      if (exitCode === 0) onStdoutData(text);
      else onStderrData(text);
      onClose(exitCode);
      const result = await hookRunner.executeHook(
        { type: HookType.Command, command: './hooks/test.sh' },
        HookEventName.BeforeTool,
        mockInput,
      );
      expect(result.success).toBe(exitCode === 0);
      expect(result.exitCode).toBe(exitCode);
      expect(result.output).toStrictEqual(output);
    });
  });
}
