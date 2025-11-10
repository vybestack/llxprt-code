/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '../config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { ContextState, SubagentTerminateMode } from '../core/subagent.js';

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
      run_limits: { max_turns: 12 },
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
      }),
    );
    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
    expect(updateOutput).toHaveBeenCalledWith('[agent-42] progress update');
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
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      run_limits: { interactive: false },
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

  it('ignores run_limits.max_turns below 2 to prevent single-turn runs', async () => {
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
      agentId: 'agent-101',
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
      goal_prompt: 'Keep exploring',
      run_limits: { max_turns: 1 },
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0].runConfig).toBeUndefined();
  });

  it('floors run_limits.max_turns when decimal values are provided', async () => {
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
      agentId: 'agent-102',
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
      goal_prompt: 'Check rounding',
      run_limits: { max_turns: 3.7 },
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0].runConfig?.max_turns).toBe(3);
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
});
