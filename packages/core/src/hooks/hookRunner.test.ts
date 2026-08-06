/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P07
 * @requirement:HOOK-061,HOOK-063,HOOK-064,HOOK-065,HOOK-066,HOOK-067a,HOOK-067b,HOOK-068,HOOK-070
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { setGlobal, restoreGlobals } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HookEventName, HookType } from './types.js';
import type { HookConfig } from './types.js';
import type { Config } from '../config/config.js';
import type { HookInput } from './types.js';
import type { Readable, Writable } from 'node:stream';

const realDebugModule = { ...(await import('../debug/index.js')) };
afterEach(() => {
  restoreGlobals();
});

function decodeSpawnCommand(args: readonly string[]): string {
  const shellCommand = String(args.at(-1) ?? '');
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

// Mock type for the child_process spawn
type MockChildProcessWithoutNullStreams = ChildProcessWithoutNullStreams & {
  mockStdoutOn: ReturnType<typeof vi.fn>;
  mockStderrOn: ReturnType<typeof vi.fn>;
  mockProcessOn: ReturnType<typeof vi.fn>;
};

// Mock child_process with sync importOriginal for partial mocking
const __actual = { ...(await import('node:child_process')) };
void vi.mock('node:child_process', () => {
  const actual = __actual as typeof import('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Mock debugLogger using vi.hoisted
const mockDebugLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

void vi.mock('../debug/index.js', () => {
  // Create a constructor function that returns the mock
  const DebugLogger = vi.fn().mockImplementation(() => mockDebugLogger);
  // Add getLogger as a static method
  DebugLogger.getLogger = vi.fn().mockReturnValue(mockDebugLogger);

  return {
    ...realDebugModule,
    DebugLogger,
  };
});

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

setGlobal('console', mockConsole);

// Dynamic import AFTER vi.mock calls so mocks are applied.
const { HookRunner } = await import('./hookRunner.js');

describe('HookRunner', () => {
  let hookRunner: HookRunner;
  let mockSpawn: MockChildProcessWithoutNullStreams;

  const mockInput: HookInput = {
    session_id: 'test-session',
    transcript_path: '/path/to/transcript',
    cwd: '/test/project',
    hook_event_name: 'BeforeTool',
    timestamp: '2025-01-01T00:00:00.000Z',
  };

  // Mock Config object with required methods
  const mockConfig = {
    isTrustedFolder: () => true,
    getSanitizationConfig: () => ({
      enableEnvironmentVariableRedaction: false,
      allowedEnvironmentVariables: [],
      blockedEnvironmentVariables: [],
    }),
  } as unknown as Config;

  beforeEach(() => {
    vi.resetAllMocks();

    hookRunner = new HookRunner(mockConfig);

    // Mock spawn with accessible mock functions
    const mockStdoutOn = vi.fn();
    const mockStderrOn = vi.fn();
    const mockProcessOn = vi.fn();

    mockSpawn = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      } as unknown as Writable,
      stdout: {
        on: mockStdoutOn,
      } as unknown as Readable,
      stderr: {
        on: mockStderrOn,
      } as unknown as Readable,
      on: mockProcessOn,
      kill: vi.fn(),
      killed: false,
      mockStdoutOn,
      mockStderrOn,
      mockProcessOn,
    } as unknown as MockChildProcessWithoutNullStreams;

    (spawn as Mock<typeof spawn>).mockReturnValue(mockSpawn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeHook', () => {
    describe('command hooks', () => {
      const commandConfig: HookConfig = {
        type: HookType.Command,
        command: './hooks/test.sh',
        timeout: 5000,
      };

      if (process.platform === 'win32') {
        it('should preserve native and PowerShell command failures', async () => {
          mockSpawn.mockProcessOn.mockImplementation(
            (event: string, callback: (code: number) => void) => {
              if (event === 'close') {
                setImmediate(() => callback(2));
              }
            },
          );

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
      }

      it('should execute command hook successfully', async () => {
        const mockOutput = { decision: 'allow', reason: 'All good' };

        // Mock successful execution
        mockSpawn.mockStdoutOn.mockImplementation(
          (event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              setTimeout(
                () => callback(Buffer.from(JSON.stringify(mockOutput))),
                10,
              );
            }
          },
        );

        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 20);
            }
          },
        );

        const result = await hookRunner.executeHook(
          commandConfig,
          HookEventName.BeforeTool,
          mockInput,
        );

        expect(result.success).toBe(true);
        expect(result.output).toStrictEqual(mockOutput);
        expect(result.exitCode).toBe(0);
        expect(mockSpawn.stdin.write).toHaveBeenCalledWith(
          JSON.stringify(mockInput),
        );
      });

      it('should handle command hook failure', async () => {
        const errorMessage = 'Command failed';

        mockSpawn.mockStderrOn.mockImplementation(
          (event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              setTimeout(() => callback(Buffer.from(errorMessage)), 10);
            }
          },
        );

        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setTimeout(() => callback(1), 20);
            }
          },
        );

        const result = await hookRunner.executeHook(
          commandConfig,
          HookEventName.BeforeTool,
          mockInput,
        );

        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe(errorMessage);
      });

      it('should use hook name in error messages if available', async () => {
        const namedConfig: HookConfig = {
          name: 'my-friendly-hook',
          type: HookType.Command,
          command: './hooks/fail.sh',
        };

        // Mock error during spawn
        (spawn as Mock<typeof spawn>).mockImplementationOnce(() => {
          throw new Error('Spawn error');
        });

        await hookRunner.executeHook(
          namedConfig,
          HookEventName.BeforeTool,
          mockInput,
        );

        expect(mockDebugLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            '(hook: my-friendly-hook): Error: Spawn error',
          ),
        );
      });

      it('should handle command hook timeout', async () => {
        const shortTimeoutConfig: HookConfig = {
          type: HookType.Command,
          command: './hooks/slow.sh',
          timeout: 50, // Very short timeout for testing
        };

        let closeCallback: ((code: number) => void) | undefined;
        let killWasCalled = false;

        // Mock a hanging process that registers the close handler but doesn't call it initially
        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              closeCallback = callback; // Store the callback but don't call it yet
            }
          },
        );

        // Mock the kill method to simulate the process being killed
        mockSpawn.kill = vi.fn().mockImplementation((_signal: string) => {
          killWasCalled = true;
          // Simulate that killing the process triggers the close event
          if (closeCallback) {
            setTimeout(() => {
              closeCallback!(128); // Exit code 128 indicates process was killed by signal
            }, 5);
          }
          return true;
        });

        const result = await hookRunner.executeHook(
          shortTimeoutConfig,
          HookEventName.BeforeTool,
          mockInput,
        );

        expect(result.success).toBe(false);
        expect(killWasCalled).toBe(true);
        expect(result.error?.message).toContain('timed out');
        expect(mockSpawn.kill).toHaveBeenCalledWith('SIGTERM');
      });

      it('should escalate to SIGKILL when the process ignores SIGTERM', async () => {
        vi.useFakeTimers();
        const shortTimeoutConfig: HookConfig = {
          type: HookType.Command,
          command: './hooks/slow.sh',
          timeout: 50,
        };

        let closeCallback: ((code: number) => void) | undefined;
        const signals: string[] = [];

        Object.assign(mockSpawn, {
          exitCode: null,
          signalCode: null,
          killed: false,
        });

        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              closeCallback = callback;
            }
          },
        );

        mockSpawn.kill = vi.fn().mockImplementation((signal: string) => {
          signals.push(signal);
          // Node sets killed=true when the signal is sent, even if ignored.
          mockSpawn.killed = true;
          if (signal === 'SIGKILL' && closeCallback) {
            mockSpawn.exitCode = null;
            mockSpawn.signalCode = 'SIGKILL';
            queueMicrotask(() => closeCallback!(137));
          }
          return true;
        });

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
      });

      it('should expand environment variables in commands', async () => {
        const configWithEnvVar: HookConfig = {
          type: HookType.Command,
          command: '$LLXPRT_PROJECT_DIR/hooks/test.sh',
        };

        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setImmediate(() => callback(0));
            }
          },
        );

        await hookRunner.executeHook(
          configWithEnvVar,
          HookEventName.BeforeTool,
          mockInput,
        );

        // SECURITY: Verify spawn is called with shell executable and expanded path
        const spawnCall = (spawn as Mock<typeof spawn>).mock.calls[0];
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
        expect(expandedCommand).toContain(
          process.platform === 'win32'
            ? "'/test/project'/hooks/test.sh"
            : '/test/project/hooks/test.sh',
        );
      });

      /**
       * SECURITY TEST: Command injection via LLXPRT_PROJECT_DIR
       * GIVEN: HookInput.cwd contains shell injection payload "; echo pwned"
       * WHEN: Hook command uses $LLXPRT_PROJECT_DIR variable
       * THEN: Injection payload must be escaped, not executed
       * @requirement: Prevent shell injection via environment variable expansion
       */
      it('should not allow command injection via LLXPRT_PROJECT_DIR (SECURITY)', async () => {
        const maliciousCwd = '/test/project; echo "pwned" > /tmp/pwned';
        const mockMaliciousInput: HookInput = {
          ...mockInput,
          cwd: maliciousCwd,
        };

        const config: HookConfig = {
          type: HookType.Command,
          command: 'ls $LLXPRT_PROJECT_DIR',
        };

        mockSpawn.mockProcessOn.mockImplementation(
          (event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setImmediate(() => callback(0));
            }
          },
        );

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
        const commandArgs = (spawn as Mock<typeof spawn>).mock.calls[0][1];
        expect(isMaliciousPathEscaped(decodeSpawnCommand(commandArgs))).toBe(
          true,
        );
      });
    });
  });

  describe('executeHooksParallel', () => {
    it('should execute multiple hooks in parallel', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      // Mock both commands to succeed
      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10);
          }
        },
      );

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

      let callCount = 0;
      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            const exitCode = callCount++ === 0 ? 0 : 1; // First succeeds, second fails
            setTimeout(() => callback(exitCode), 10);
          }
        },
      );

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

  describe('executeHooksSequential', () => {
    it('should execute multiple hooks in sequence', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      const executionOrder: string[] = [];

      // Mock both commands to succeed
      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            // Extract command from shell args instead of command directly
            const args = (spawn as Mock<typeof spawn>).mock.calls[
              executionOrder.length
            ][1] as string[];
            executionOrder.push(decodeSpawnCommand(args));
            setImmediate(() => callback(0));
          }
        },
      );

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

      let callCount = 0;
      mockSpawn.mockStderrOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data' && callCount === 1) {
            // Second hook fails
            setTimeout(() => callback(Buffer.from('Hook 2 failed')), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            const exitCode = callCount++ === 1 ? 1 : 0; // Second fails, others succeed
            setTimeout(() => callback(exitCode), 20);
          }
        },
      );

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

    it('should pass modified input from one hook to the next for BeforeAgent', async () => {
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

      let hookCallCount = 0;
      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data' && hookCallCount === 0) {
            setTimeout(
              () => callback(Buffer.from(JSON.stringify(mockOutput1))),
              10,
            );
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

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeAgent,
        mockBeforeAgentInput,
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toStrictEqual(mockOutput1);

      // Verify that the second hook received modified input
      const secondHookInput = JSON.parse(
        (mockSpawn.stdin.write as Mock<typeof mockSpawn.stdin.write>).mock
          .calls[1][0],
      );
      expect(secondHookInput.prompt).toContain('Original prompt');
      expect(secondHookInput.prompt).toContain('Context from hook 1');
    });

    it('should pass modified LLM request from one hook to the next for BeforeModel', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      const mockBeforeModelInput = {
        ...mockInput,
        llm_request: {
          model: 'gemini-1.5-pro',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      const mockOutput1 = {
        decision: 'allow' as const,
        hookSpecificOutput: {
          llm_request: {
            temperature: 0.7,
          },
        },
      };

      let hookCallCount = 0;
      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data' && hookCallCount === 0) {
            setTimeout(
              () => callback(Buffer.from(JSON.stringify(mockOutput1))),
              10,
            );
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

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeModel,
        mockBeforeModelInput,
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);

      // Verify that the second hook received modified input
      const secondHookInput = JSON.parse(
        (mockSpawn.stdin.write as Mock<typeof mockSpawn.stdin.write>).mock
          .calls[1][0],
      );
      expect(secondHookInput.llm_request.model).toBe('gemini-1.5-pro');
      expect(secondHookInput.llm_request.temperature).toBe(0.7);
    });

    it('should not modify input if hook fails', async () => {
      const configs: HookConfig[] = [
        { type: HookType.Command, command: './hook1.sh' },
        { type: HookType.Command, command: './hook2.sh' },
      ];

      mockSpawn.mockStderrOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from('Hook failed')), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 20); // All hooks fail
          }
        },
      );

      const results = await hookRunner.executeHooksSequential(
        configs,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success === false)).toBe(true);

      // Verify that both hooks received the same original input
      const firstHookInput = JSON.parse(
        (mockSpawn.stdin.write as Mock<typeof mockSpawn.stdin.write>).mock
          .calls[0][0],
      );
      const secondHookInput = JSON.parse(
        (mockSpawn.stdin.write as Mock<typeof mockSpawn.stdin.write>).mock
          .calls[1][0],
      );
      expect(firstHookInput).toStrictEqual(secondHookInput);
    });
  });

  describe('invalid JSON handling', () => {
    const commandConfig: HookConfig = {
      type: HookType.Command,
      command: './hooks/test.sh',
    };

    it('should handle invalid JSON output gracefully', async () => {
      const invalidJson = '{ "decision": "allow", incomplete';

      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from(invalidJson)), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      // Should convert plain text to structured output
      expect(result.output).toStrictEqual({
        decision: 'allow',
        systemMessage: invalidJson,
      });
    });

    it('should handle malformed JSON with exit code 0', async () => {
      const malformedJson = 'not json at all';

      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from(malformedJson)), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(true);
      expect(result.output).toStrictEqual({
        decision: 'allow',
        systemMessage: malformedJson,
      });
    });

    it('should handle invalid JSON with exit code 1 (non-blocking error)', async () => {
      const invalidJson = '{ broken json';

      mockSpawn.mockStderrOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from(invalidJson)), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toStrictEqual({
        decision: 'allow',
        systemMessage: `Warning: ${invalidJson}`,
      });
    });

    it('should handle invalid JSON with exit code 2 (blocking error)', async () => {
      const invalidJson = '{ "error": incomplete';

      mockSpawn.mockStderrOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from(invalidJson)), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(2), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.output).toStrictEqual({
        decision: 'deny',
        reason: invalidJson,
      });
    });

    it('should handle empty JSON output', async () => {
      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from('')), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBeUndefined();
    });

    it('should handle double-encoded JSON string', async () => {
      const mockOutput = { decision: 'allow', reason: 'All good' };
      const doubleEncodedJson = JSON.stringify(JSON.stringify(mockOutput));

      mockSpawn.mockStdoutOn.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.from(doubleEncodedJson)), 10);
          }
        },
      );

      mockSpawn.mockProcessOn.mockImplementation(
        (event: string, callback: (code: number) => void) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 20);
          }
        },
      );

      const result = await hookRunner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(result.success).toBe(true);
      expect(result.output).toStrictEqual(mockOutput);
    });
  });
});
