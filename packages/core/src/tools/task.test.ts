/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '../config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { ContextState, SubagentTerminateMode } from '../core/subagent.js';
import { ToolErrorType } from './tool-error.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';

describe('TaskTool', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-123',
    } as unknown as Config;
  });

  it('launches the orchestrator and returns subagent output', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope: {
      output: {
        emitted_vars: Record<string, string>;
        terminate_reason: SubagentTerminateMode;
      };
      runInteractive: ReturnType<typeof vi.fn>;
      runNonInteractive: ReturnType<typeof vi.fn>;
      onMessage?: (message: string) => void;
    } = {
      output: {
        emitted_vars: { summary: 'done' },
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi
        .fn()
        .mockImplementation(async (context: ContextState) => {
          expect(context).toBeInstanceOf(ContextState);
          expect(context.get('task_goal')).toBe('Ship the feature');
          expect(context.get('extra')).toBe('value');
          scope.onMessage?.('progress update');
        }),
      runNonInteractive: vi
        .fn()
        .mockImplementation(async (context: ContextState) => {
          expect(context).toBeInstanceOf(ContextState);
          expect(context.get('task_goal')).toBe('Ship the feature');
          expect(context.get('extra')).toBe('value');
          scope.onMessage?.('progress update');
        }),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const params: TaskToolParams = {
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      behaviour_prompts: ['Respect coding standards'],
      tool_whitelist: ['read_file', 'write_file'],
      output_spec: { summary: 'Outcome summary' },
      context: { extra: 'value' },
    };

    const invocation = tool.build(params);
    const signal = new AbortController().signal;
    const updateOutput = vi.fn();

    const result = await invocation.execute(signal, updateOutput);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'helper',
        behaviourPrompts: ['Ship the feature', 'Respect coding standards'],
        toolConfig: { tools: ['read_file', 'write_file'] },
        outputConfig: { outputs: { summary: 'Outcome summary' } },
        runConfig: { max_time_minutes: 15 },
      }),
      expect.any(AbortSignal),
    );
    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
    // Verify XML wrapping: opening tag, message without prefix, closing tag
    expect(updateOutput).toHaveBeenNthCalledWith(
      1,
      '<subagent name="helper" id="agent-42">\n',
    );
    expect(updateOutput).toHaveBeenNthCalledWith(2, 'progress update\n');
    expect(updateOutput).toHaveBeenNthCalledWith(
      3,
      '</subagent name="helper" id="agent-42">\n',
    );
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result.metadata).toEqual({
      agentId: 'agent-42',
      terminateReason: SubagentTerminateMode.GOAL,
      emittedVars: { summary: 'done' },
    });
    expect(result.llmContent).toContain('"agent_id": "agent-42"');
    expect(result.error).toBeUndefined();
  });

  it('falls back to non-interactive execution when interactive flag is disabled', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn(),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-77',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => false,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).not.toHaveBeenCalled();
    expect(scope.runNonInteractive).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('passes scheduler factory to runInteractive when available', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const schedulerFactory = vi.fn().mockReturnValue({
      schedule: vi.fn(),
    });
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-100',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
      schedulerFactoryProvider: () => schedulerFactory,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Explain thing',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    const [, options] = scope.runInteractive.mock.calls[0];
    expect(options?.schedulerFactory).toBe(schedulerFactory);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
  });

  it('surfaces launch errors with helpful messaging', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('subagent missing'));
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'unknown',
      goal_prompt: 'Do things',
    });
    const result = await invocation.execute(
      new AbortController().signal,
      undefined,
    );

    expect(result.error?.message).toBe('subagent missing');
    expect(result.returnDisplay).toContain(
      "Unable to launch subagent 'unknown'",
    );
    expect(result.returnDisplay).toContain('Details: subagent missing');
  });

  it('defaults to non-interactive execution when environment is non-interactive', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn(),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;

    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => false,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).not.toHaveBeenCalled();
    expect(scope.runNonInteractive).toHaveBeenCalledTimes(1);
  });

  it('cleans up and reports execution errors', async () => {
    const runInteractive = vi.fn().mockRejectedValue(new Error('crashed'));
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.ERROR,
      },
      runInteractive,
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-99',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Do work',
    });

    const result = await invocation.execute(
      new AbortController().signal,
      undefined,
    );

    expect(runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result.error?.message).toBe('crashed');
    expect(result.returnDisplay).toContain('Details: crashed');
    expect(result.metadata).toEqual({
      agentId: 'agent-99',
      error: 'crashed',
    });
  });

  it('returns a cancelled result when aborted during orchestrator launch', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.ERROR,
      },
      runInteractive: vi.fn(),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockImplementation(
      async (_request: unknown, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('launch aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
          setTimeout(
            () =>
              resolve({
                agentId: 'agent-launch',
                scope,
                dispose,
                prompt: {} as unknown,
                profile: {} as unknown,
                config: {} as unknown,
                runtime: {} as unknown,
              }),
            25,
          );
        }),
    );
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Do work',
    });

    const abortController = new AbortController();
    const execution = invocation.execute(abortController.signal, undefined);
    abortController.abort();
    const result = await execution;

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'helper' }),
      expect.any(AbortSignal),
    );
    expect(result.metadata?.cancelled).toBe(true);
    expect(result.returnDisplay).toMatch(/abort/i);
  });

  describe('timeout_seconds handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses default timeout when timeout_seconds is omitted', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-default',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await vi.advanceTimersByTimeAsync(0);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 1,
          }),
        }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('clamps timeout_seconds to max setting', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-max',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;

      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 999999,
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await vi.advanceTimersByTimeAsync(0);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 2,
          }),
        }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('skips timeout when timeout_seconds is -1', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-unlimited',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: -1,
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await vi.advanceTimersByTimeAsync(0);

      expect(launch).toHaveBeenCalledWith(
        expect.not.objectContaining({ runConfig: expect.anything() }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('returns TIMEOUT error and partial output when timed out', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);

      // The key insight: runInteractive in real SubAgentScope creates its own AbortController
      // that listens for parent signals. When timeoutController.signal aborts, the subagent
      // should detect this and reject with AbortError. We simulate that here.

      let rejectPromise: ((error: Error) => void) | null = null;

      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        cancel: vi.fn(),
        runInteractive: vi.fn(
          (_context: ContextState, _options?: unknown) =>
            new Promise((_resolve, reject) => {
              rejectPromise = reject;
            }),
        ),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-timeout',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 0.05, // 50ms
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      // Wait for runInteractive to be called
      await vi.advanceTimersByTimeAsync(5);

      expect(scope.runInteractive).toHaveBeenCalled();

      // Now advance time past the timeout (50ms)
      await vi.advanceTimersByTimeAsync(60);

      // The timeout should fire and the reject function we captured
      // simulates the subagent detecting the abort and rejecting
      if (rejectPromise) {
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        rejectPromise(abortError);
      }

      await expect(resultPromise).resolves.toMatchObject({
        error: { type: ToolErrorType.TIMEOUT },
      });
    });

    it('returns EXECUTION_FAILED for user aborts', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-abort',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const abortController = new AbortController();
      abortController.abort();

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 1,
      });

      const result = await invocation.execute(
        abortController.signal,
        undefined,
      );

      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.type).not.toBe(ToolErrorType.TIMEOUT);
    });
  });

  it('validates required parameters', () => {
    const tool = new TaskTool(config, {
      orchestratorFactory: () => {
        throw new Error('should not be called');
      },
    });

    expect(() => tool.build({ goal_prompt: 'Do work' })).toThrow(
      "params must have required property 'subagent_name'",
    );
    expect(() => tool.build({ subagent_name: 'helper' })).toThrow(
      "params must have required property 'goal_prompt'",
    );
  });

  it('streams subagent messages on separate lines with normalized newlines', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const updateOutput = vi.fn();
    const scope: {
      output: {
        emitted_vars: Record<string, string>;
        terminate_reason: SubagentTerminateMode;
      };
      runInteractive: ReturnType<typeof vi.fn>;
      runNonInteractive: ReturnType<typeof vi.fn>;
      onMessage?: (message: string) => void;
    } = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockImplementation(async (_ctx: ContextState) => {
        // Simulate subagent streaming multiple chunks with different line ending styles
        scope.onMessage?.('first chunk');
        scope.onMessage?.('second chunk\r');
        scope.onMessage?.('third chunk\r\n');
        scope.onMessage?.('fourth chunk\n');
      }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship it',
    });

    await invocation.execute(new AbortController().signal, updateOutput);

    // Verify XML wrapping - opening tag, messages without agent prefix, closing tag
    expect(updateOutput).toHaveBeenNthCalledWith(
      1,
      '<subagent name="helper" id="agent-42">\n',
    );
    expect(updateOutput).toHaveBeenNthCalledWith(2, 'first chunk\n');
    expect(updateOutput).toHaveBeenNthCalledWith(3, 'second chunk\n');
    expect(updateOutput).toHaveBeenNthCalledWith(4, 'third chunk\n');
    expect(updateOutput).toHaveBeenNthCalledWith(5, 'fourth chunk\n');
    expect(updateOutput).toHaveBeenNthCalledWith(
      6,
      '</subagent name="helper" id="agent-42">\n',
    );
    expect(updateOutput).toHaveBeenCalledTimes(6);
  });

  it('filters out empty messages when streaming', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const updateOutput = vi.fn();
    const scope: {
      output: {
        emitted_vars: Record<string, string>;
        terminate_reason: SubagentTerminateMode;
      };
      runInteractive: ReturnType<typeof vi.fn>;
      runNonInteractive: ReturnType<typeof vi.fn>;
      onMessage?: (message: string) => void;
    } = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockImplementation(async (_ctx: ContextState) => {
        // Simulate various empty/whitespace-only messages
        scope.onMessage?.('');
        scope.onMessage?.('  ');
        scope.onMessage?.('\n');
        scope.onMessage?.('actual message');
      }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship it',
    });

    await invocation.execute(new AbortController().signal, updateOutput);

    // XML wrapping: opening tag, actual message (without agent prefix), closing tag
    // Empty/whitespace-only messages are filtered
    expect(updateOutput).toHaveBeenNthCalledWith(
      1,
      '<subagent name="helper" id="agent-42">\n',
    );
    expect(updateOutput).toHaveBeenNthCalledWith(2, 'actual message\n');
    expect(updateOutput).toHaveBeenNthCalledWith(
      3,
      '</subagent name="helper" id="agent-42">\n',
    );
    expect(updateOutput).toHaveBeenCalledTimes(3);
  });

  /**
   * @plan PLAN-20260130-ASYNCTASK.P10
   */
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

    it('passes undefined (not foreground signal) to orchestrator.launch for async tasks', async () => {
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

      // Async tasks must NOT pass the foreground signal to launch
      // so the scope has no parent abort signal dependency
      expect(launchMock).toHaveBeenCalledWith(expect.anything(), undefined);

      await new Promise((resolve) => setTimeout(resolve, 50));
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
  });

  describe('Subagent XML wrapping (Issue #727)', () => {
    it('should wrap non-interactive output with XML tags', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const updateOutput = vi.fn();
      const scope: {
        output: {
          emitted_vars: Record<string, string>;
          terminate_reason: SubagentTerminateMode;
        };
        runInteractive: ReturnType<typeof vi.fn>;
        runNonInteractive: ReturnType<typeof vi.fn>;
        onMessage?: (message: string) => void;
      } = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn(),
        runNonInteractive: vi
          .fn()
          .mockImplementation(async (_ctx: ContextState) => {
            scope.onMessage?.('First message');
            scope.onMessage?.('Second message');
          }),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-xml-001',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => false,
      });
      const invocation = tool.build({
        subagent_name: 'test-agent',
        goal_prompt: 'Do work',
      });

      await invocation.execute(new AbortController().signal, updateOutput);

      // Verify opening tag is sent first
      expect(updateOutput).toHaveBeenNthCalledWith(
        1,
        '<subagent name="test-agent" id="agent-xml-001">\n',
      );

      // Verify messages are sent without [agentId] prefix
      expect(updateOutput).toHaveBeenNthCalledWith(2, 'First message\n');
      expect(updateOutput).toHaveBeenNthCalledWith(3, 'Second message\n');

      // Verify closing tag is sent last
      expect(updateOutput).toHaveBeenLastCalledWith(
        '</subagent name="test-agent" id="agent-xml-001">\n',
      );
    });

    it('should wrap interactive output with XML tags', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const updateOutput = vi.fn();
      const scope: {
        output: {
          emitted_vars: Record<string, string>;
          terminate_reason: SubagentTerminateMode;
        };
        runInteractive: ReturnType<typeof vi.fn>;
        runNonInteractive: ReturnType<typeof vi.fn>;
        onMessage?: (message: string) => void;
      } = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi
          .fn()
          .mockImplementation(async (_ctx: ContextState) => {
            scope.onMessage?.('Interactive message');
          }),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-xml-002',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });
      const invocation = tool.build({
        subagent_name: 'interactive-agent',
        goal_prompt: 'Do work',
      });

      await invocation.execute(new AbortController().signal, updateOutput);

      expect(updateOutput).toHaveBeenNthCalledWith(
        1,
        '<subagent name="interactive-agent" id="agent-xml-002">\n',
      );
      expect(updateOutput).toHaveBeenNthCalledWith(2, 'Interactive message\n');
      expect(updateOutput).toHaveBeenLastCalledWith(
        '</subagent name="interactive-agent" id="agent-xml-002">\n',
      );
    });

    it('should send closing XML tag even when subagent errors', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const updateOutput = vi.fn();
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.ERROR,
        },
        runInteractive: vi.fn(),
        runNonInteractive: vi.fn().mockRejectedValue(new Error('Crash!')),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-xml-err',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => false,
      });
      const invocation = tool.build({
        subagent_name: 'error-agent',
        goal_prompt: 'Do work',
      });

      await invocation.execute(new AbortController().signal, updateOutput);

      // Should still send opening tag
      expect(updateOutput).toHaveBeenNthCalledWith(
        1,
        '<subagent name="error-agent" id="agent-xml-err">\n',
      );
      // And closing tag despite error
      expect(updateOutput).toHaveBeenLastCalledWith(
        '</subagent name="error-agent" id="agent-xml-err">\n',
      );
    });

    it('should send XML tags even when subagent produces no output', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const updateOutput = vi.fn();
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn(),
        runNonInteractive: vi.fn().mockResolvedValue(undefined),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-xml-empty',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const tool = new TaskTool(config, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => false,
      });
      const invocation = tool.build({
        subagent_name: 'silent-agent',
        goal_prompt: 'Do work',
      });

      await invocation.execute(new AbortController().signal, updateOutput);

      // Should still send opening and closing tags
      expect(updateOutput).toHaveBeenCalledTimes(2);
      expect(updateOutput).toHaveBeenNthCalledWith(
        1,
        '<subagent name="silent-agent" id="agent-xml-empty">\n',
      );
      expect(updateOutput).toHaveBeenNthCalledWith(
        2,
        '</subagent name="silent-agent" id="agent-xml-empty">\n',
      );
    });

    it('should send opening and closing XML tags for async tasks', async () => {
      let resolveBackgroundExecution: (() => void) | undefined;
      const backgroundExecutionPromise = new Promise<void>((resolve) => {
        resolveBackgroundExecution = resolve;
      });

      const completeTaskMock = vi.fn(() => {
        resolveBackgroundExecution?.();
      });
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
        completeTask: completeTaskMock,
        failTask: vi.fn(),
      };
      const updateOutput = vi.fn();
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-xml-agent',
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
        subagent_name: 'async-helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      await invocation.execute(new AbortController().signal, updateOutput);

      // Async tasks should send opening tag immediately
      expect(updateOutput).toHaveBeenNthCalledWith(
        1,
        '<subagent name="async-helper" id="async-xml-agent">\n',
      );

      // Wait for background execution to complete and emit closing tag
      await backgroundExecutionPromise;
      expect(updateOutput).toHaveBeenLastCalledWith(
        '</subagent name="async-helper" id="async-xml-agent">\n',
      );
    });
  });
});
