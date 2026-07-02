/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool core tests: orchestrator launch, output extraction, termination.
 * Sibling files cover max_turns, timeout, async mode, and issue-specific tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';

describe('TaskTool', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-123',
    } as unknown as Config;
  });

  function createMockOrchestrator(agentId: string) {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn(),
    };
    const orchestrator = {
      launch: vi.fn().mockResolvedValue({
        agentId,
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      }),
    } as unknown as SubagentOrchestrator;
    return { orchestrator, scope };
  }

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
    expect(result.metadata).toStrictEqual({
      agentId: 'agent-42',
      terminateReason: SubagentTerminateMode.GOAL,
      emittedVars: { summary: 'done' },
    });
    expect(result.llmContent).toContain('"agent_id": "agent-42"');
    expect(result.error).toBeUndefined();
  });

  it('passes the invocation messageBus into injected orchestrator factories', async () => {
    const messageBus = {} as MessageBus;
    const { orchestrator, scope } = createMockOrchestrator('agent-messagebus');
    const orchestratorFactory = vi.fn(() => orchestrator);
    const tool = new TaskTool(config, {
      orchestratorFactory,
      isInteractiveEnvironment: () => true,
      messageBus,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(orchestratorFactory).toHaveBeenCalledWith(messageBus);
    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
  });

  it('passes undefined messageBus when no messageBus is configured', async () => {
    const { orchestrator, scope } = createMockOrchestrator(
      'agent-without-messagebus',
    );
    const orchestratorFactory = vi.fn(() => orchestrator);
    const tool = new TaskTool(config, {
      orchestratorFactory,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(orchestratorFactory).toHaveBeenCalledWith(undefined);
    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
  });

  it('filters explicit tool_whitelist against enabled registry tools', async () => {
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
      agentId: 'agent-allowlist',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const configWithRegistry = {
      ...config,
      getEphemeralSettings: () => ({
        'tools.disabled': ['google_web_fetch'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'google_web_fetch' },
          { name: 'task' },
          { name: 'list_subagents' },
        ],
      }),
    } as unknown as Config;

    const tool = new TaskTool(configWithRegistry, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      tool_whitelist: [
        'google_web_fetch',
        'ReadFileTool',
        'task',
        'list_subagents',
      ],
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: { tools: ['read_file'] },
      }),
      expect.any(AbortSignal),
    );
  });

  it('does not fall back to registry tools when explicit whitelist is fully filtered', async () => {
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
      agentId: 'agent-empty-whitelist',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const configWithRegistry = {
      ...config,
      getEphemeralSettings: () => ({
        'tools.disabled': ['google_web_fetch'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'google_web_fetch' },
          { name: 'task' },
          { name: 'list_subagents' },
        ],
      }),
    } as unknown as Config;

    const tool = new TaskTool(configWithRegistry, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      tool_whitelist: ['google_web_fetch', 'task', 'list_subagents'],
    });

    await invocation.execute(new AbortController().signal, undefined);

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    // Explicit whitelist fully filtered to zero must preserve fail-closed
    // toolConfig: { tools: [] }, NOT omit toolConfig (which means runtime defaults).
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('filters excluded task tools from explicit whitelist using canonical tool names', async () => {
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
      agentId: 'agent-canonical-excluded',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const configWithRegistry = {
      ...config,
      getEphemeralSettings: () => ({
        'tools.disabled': ['google_web_fetch'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'read_file' },
          { name: 'task' },
          { name: 'list_subagents' },
        ],
      }),
    } as unknown as Config;

    const tool = new TaskTool(configWithRegistry, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      tool_whitelist: ['ReadFileTool', 'TaskTool', 'listSubagents'],
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolConfig: { tools: ['read_file'] },
      }),
      expect.any(AbortSignal),
    );
  });

  it('treats explicit empty tool_whitelist as fail-closed and does not repopulate from registry', async () => {
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
      agentId: 'agent-explicit-empty-whitelist',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const configWithRegistry = {
      ...config,
      getEphemeralSettings: () => ({
        'tools.disabled': ['google_web_fetch'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'task' },
          { name: 'list_subagents' },
        ],
      }),
    } as unknown as Config;

    const tool = new TaskTool(configWithRegistry, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
      tool_whitelist: [],
    });

    await invocation.execute(new AbortController().signal, undefined);

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    // Explicit empty whitelist must preserve fail-closed toolConfig: { tools: [] },
    // NOT omit toolConfig (which means runtime defaults).
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('backfills sessionId from config when context does not provide one', async () => {
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
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi
        .fn()
        .mockImplementation(async (context: ContextState) => {
          expect(context.get('sessionId')).toBe('session-123');
        }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-session',
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
      context: { extra: 'value' },
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
  });

  it('keeps explicit context sessionId without overriding it', async () => {
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
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi
        .fn()
        .mockImplementation(async (context: ContextState) => {
          expect(context.get('sessionId')).toBe('explicit-session');
        }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-session-explicit',
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
      context: { sessionId: 'explicit-session' },
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
  });

  it('leaves sessionId absent when config has no session id', async () => {
    const configWithoutSessionId = {
      getSessionId: () => '',
    } as unknown as Config;

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
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi
        .fn()
        .mockImplementation(async (context: ContextState) => {
          expect(context.get('sessionId')).toBeUndefined();
        }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-session-missing',
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(configWithoutSessionId, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship the feature',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(scope.runInteractive).toHaveBeenCalledTimes(1);
    expect(scope.runNonInteractive).not.toHaveBeenCalled();
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
    expect(result.metadata).toStrictEqual({
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
});
