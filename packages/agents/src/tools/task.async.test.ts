/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool async mode tests.
 * Sibling to task.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';

describe('TaskTool', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-123',
    } as unknown as Config;
  });

  describe('async mode', () => {
    it('returns error when async=true but AsyncTaskManager not available', async () => {
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        // No getAsyncTaskManager provided
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do something',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('AsyncTaskManager');
    });

    it('returns error when async=true and at task limit', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({
          allowed: false,
          reason: 'Max async tasks (5) reached',
        }),
        tryReserveAsyncSlot: () => null,
      };
      const tool = new TaskTool(config, {
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do something',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('Max async tasks');
      expect(result.llmContent).toContain('check_async_tasks');
      expect(result.llmContent).toContain('synchronously');
    });

    it('registers task with AsyncTaskManager when async=true', async () => {
      const registerTaskMock = vi.fn();
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: registerTaskMock,
        completeTask: vi.fn(),
        failTask: vi.fn(),
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-123',
        scope: {
          runNonInteractive: vi.fn().mockResolvedValue(undefined),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      expect(registerTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'async-agent-123',
          subagentName: 'helper',
          goalPrompt: 'Do async work',
          abortController: expect.any(AbortController),
        }),
        'booking-1',
      );

      // Wait for background task to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('passes the async abort controller signal to orchestrator.launch so cancelTask can stop the subagent', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        completeTask: vi.fn(),
        failTask: vi.fn(),
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-sig',
        scope: {
          runNonInteractive: vi.fn().mockResolvedValue(undefined),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Async work',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // Async tasks MUST pass an AbortSignal (the async abort controller) to
      // launch so AsyncTaskManager.cancelTask can abort the running subagent.
      expect(launchMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(AbortSignal),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('wires the async abort controller so cancelTask aborts the launch signal', async () => {
      // End-to-end wiring at the task-tool boundary: the signal passed to
      // launch is the SAME AbortController registered with the AsyncTaskManager.
      // Aborting it via cancelTask flips that signal's .aborted to true,
      // proving the subagent CAN be stopped by cancellation.
      const realAsyncTaskManager = new AsyncTaskManager();
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-cancel-agent',
        scope: {
          runNonInteractive: vi.fn().mockImplementation(
            () =>
              new Promise<void>(() => {
                // never resolves; we cancel via cancelTask
              }),
          ),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => realAsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Cancellable work',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // The signal passed to launch is the async abort controller's signal.
      const launchSignal = launchMock.mock.calls[0]?.[1] as
        | AbortSignal
        | undefined;
      expect(launchSignal).toBeInstanceOf(AbortSignal);
      expect(launchSignal!.aborted).toBe(false);

      // Cancel via the real AsyncTaskManager → the launch signal aborts.
      realAsyncTaskManager.cancelTask('async-cancel-agent');

      expect(launchSignal!.aborted).toBe(true);
    });

    it('relays the foreground signal abort into the async abort controller', async () => {
      // Fix (b): when the foreground signal passed to executeAsync aborts,
      // the async abort controller's signal must also abort so the subagent
      // stops.
      const realAsyncTaskManager = new AsyncTaskManager();
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-relay-agent',
        scope: {
          runNonInteractive: vi.fn().mockImplementation(
            () =>
              new Promise<void>(() => {
                // never resolves
              }),
          ),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => realAsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Relay work',
        async: true,
      };

      const foregroundController = new AbortController();
      const invocation = tool.build(params);
      await invocation.execute(foregroundController.signal);

      const launchSignal = launchMock.mock.calls[0]?.[1] as
        | AbortSignal
        | undefined;
      expect(launchSignal).toBeInstanceOf(AbortSignal);
      expect(launchSignal!.aborted).toBe(false);

      // Abort the FOREGROUND signal (ESC) → the launch signal must also abort.
      foregroundController.abort();

      // Give the once-listener a tick to fire.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(launchSignal!.aborted).toBe(true);
    });

    it('aborts the launch signal when the foreground aborts DURING launch (before registration)', async () => {
      // Regression for the relay-installed-after-launch gap: if the foreground
      // turn is cancelled (ESC) while orchestrator.launch is still pending —
      // e.g. loading config/profile — the launch signal must already observe
      // the abort, because the relay is wired BEFORE launch is awaited.
      const realAsyncTaskManager = new AsyncTaskManager();
      let capturedLaunchSignal: AbortSignal | undefined;
      let resolveLaunch: (() => void) | undefined;
      const launchGate = new Promise<void>((resolve) => {
        resolveLaunch = resolve;
      });
      const launchMock = vi
        .fn()
        .mockImplementation(
          async (_request: unknown, launchSignal: AbortSignal) => {
            capturedLaunchSignal = launchSignal;
            // Simulate slow launch (config/profile loading) that has not yet
            // returned a scope when the user presses ESC.
            await launchGate;
            return {
              agentId: 'async-launch-abort-agent',
              scope: {
                runNonInteractive: vi.fn().mockImplementation(
                  () =>
                    new Promise<void>(() => {
                      // never resolves
                    }),
                ),
                output: {
                  terminate_reason: SubagentTerminateMode.GOAL,
                  emitted_vars: {},
                },
              },
              dispose: vi.fn().mockResolvedValue(undefined),
            };
          },
        );
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => realAsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Slow launch work',
        async: true,
      };

      const foregroundController = new AbortController();
      const invocation = tool.build(params);
      const executePromise = invocation.execute(foregroundController.signal);

      // Wait until launch has been entered (signal captured) but is still gated.
      while (capturedLaunchSignal === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(capturedLaunchSignal.aborted).toBe(false);

      // Press ESC while launch is still pending.
      foregroundController.abort();
      expect(capturedLaunchSignal.aborted).toBe(true);

      // Let launch resolve so the invocation can settle cleanly.
      resolveLaunch?.();
      await executePromise;

      // The task that registered after the gated launch carries the SAME
      // (already-aborted) controller the relay aborted, so it is registered in
      // an aborted state rather than as a live, unstoppable background task.
      const registered = realAsyncTaskManager.getTask(
        'async-launch-abort-agent',
      );
      expect(registered).toBeDefined();
      expect(registered!.abortController?.signal.aborted).toBe(true);
    });

    it('returns immediately with launch status when async=true (does not block)', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        completeTask: vi.fn(),
        failTask: vi.fn(),
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-456',
        scope: {
          runNonInteractive: vi.fn().mockImplementation(async () => {
            // Simulate long-running task
            await new Promise((resolve) => setTimeout(resolve, 100));
          }),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: { result: 'success' },
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Long running task',
        async: true,
      };

      const invocation = tool.build(params);
      const startTime = Date.now();
      const result = await invocation.execute(new AbortController().signal);
      const endTime = Date.now();

      // Should return immediately (< 50ms), not wait for subagent completion (100ms)
      expect(endTime - startTime).toBeLessThan(50);
      expect(result.error).toBeUndefined();
      expect(result.metadata?.async).toBe(true);
      expect(result.metadata?.status).toBe('running');
      expect(result.metadata?.agentId).toBe('async-agent-456');
      expect(result.llmContent).toContain('Async task launched');
      expect(result.llmContent).toContain('check_async_tasks');

      // Wait for background task to complete to avoid test pollution
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    it('calls completeTask on AsyncTaskManager when background execution succeeds', async () => {
      let resolveExecution: (() => void) | undefined;
      const executionPromise = new Promise<void>(
        (resolve) => (resolveExecution = resolve),
      );
      const completeTaskMock = vi.fn(() => {
        resolveExecution?.();
      });
      const failTaskMock = vi.fn(); // Add failTask to prevent unhandled error
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        completeTask: completeTaskMock,
        failTask: failTaskMock,
      };
      const outputObject = {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'done' },
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-789',
        scope: {
          runNonInteractive: vi.fn().mockResolvedValue(undefined),
          output: outputObject,
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Quick task',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // Wait for background execution to complete
      await executionPromise;

      expect(completeTaskMock).toHaveBeenCalledWith(
        'async-agent-789',
        outputObject,
      );
    });

    it('calls failTask on AsyncTaskManager when background execution fails', async () => {
      let resolveExecution: (() => void) | undefined;
      const executionPromise = new Promise<void>(
        (resolve) => (resolveExecution = resolve),
      );
      const failTaskMock = vi.fn(() => {
        resolveExecution?.();
      });
      const completeTaskMock = vi.fn(); // Add completeTask to prevent unhandled error
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        failTask: failTaskMock,
        completeTask: completeTaskMock,
      };
      const error = new Error('Subagent crashed');
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-error',
        scope: {
          runNonInteractive: vi.fn().mockRejectedValue(error),
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Failing task',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // Wait for background execution to fail
      await executionPromise;

      expect(failTaskMock).toHaveBeenCalledWith(
        'async-agent-error',
        'Subagent crashed',
      );
    });

    it('calls failTask when timeout fires and scope returns normally', async () => {
      vi.useFakeTimers();
      let resolveExecution: (() => void) | undefined;
      const executionPromise = new Promise<void>(
        (resolve) => (resolveExecution = resolve),
      );
      const failTaskMock = vi.fn(() => {
        resolveExecution?.();
      });
      const completeTaskMock = vi.fn();
      // getTask returns a task still in 'running' status (timeout, not cancelTask)
      const getTaskMock = vi.fn(() => ({ status: 'running' }));
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        completeTask: completeTaskMock,
        failTask: failTaskMock,
        getTask: getTaskMock,
      };

      // runNonInteractive resolves normally AFTER the signal is aborted (timeout)
      let resolveRun: (() => void) | undefined;
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-agent-timeout',
        scope: {
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
          runNonInteractive: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveRun = resolve;
              }),
          ),
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Slow task',
        async: true,
        timeout_seconds: 0.05, // 50ms
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // Advance past the timeout so the abort fires
      await vi.advanceTimersByTimeAsync(60);

      // Now let the scope return normally (simulating scope completing after timeout)
      resolveRun?.();
      await vi.advanceTimersByTimeAsync(0);

      // Wait for the background execution to finish
      await executionPromise;

      // failTask should have been called because the task was still 'running'
      // when the timeout-caused abort was detected
      expect(failTaskMock).toHaveBeenCalledWith(
        'async-agent-timeout',
        'Async task timed out',
      );
      expect(completeTaskMock).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does NOT label a user-cancelled task as timeout (cancelTask sets status to cancelled)', async () => {
      // Fix (d): when the signal aborts because the user cancelled (via
      // AsyncTaskManager.cancelTask, which sets status='cancelled'), the
      // background path must NOT call failTask with 'Async task timed out'.
      // Only a true timeout should be labelled as such.
      const realAsyncTaskManager = new AsyncTaskManager();
      let resolveRun: (() => void) | undefined;
      const failTaskSpy = vi.spyOn(realAsyncTaskManager, 'failTask');
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-cancel-status',
        scope: {
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
          runNonInteractive: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveRun = resolve;
              }),
          ),
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const tool = new TaskTool(config, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () => realAsyncTaskManager,
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'User-cancelled task',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal);

      // Cancel via cancelTask (sets status to 'cancelled').
      realAsyncTaskManager.cancelTask('async-cancel-status');

      // Let the scope return (simulating scope completing after cancellation).
      resolveRun?.();
      // Wait for the background execution to finish.
      await new Promise((resolve) => setTimeout(resolve, 20));

      // The task must NOT be labelled as a timeout.
      expect(failTaskSpy).not.toHaveBeenCalledWith(
        'async-cancel-status',
        'Async task timed out',
      );
    });
  });
});
