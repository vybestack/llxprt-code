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
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] progress update\n');
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

    // Verify all messages end with newline and normalize CR/CRLF to LF
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] first chunk\n');
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] second chunk\n');
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] third chunk\n');
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] fourth chunk\n');
    expect(updateOutput).toHaveBeenCalledTimes(4);
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

    // Only the actual message should be output, empty/whitespace-only are filtered
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] actual message\n');
    expect(updateOutput).toHaveBeenCalledTimes(1);
  });
});
