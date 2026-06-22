/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool max_turns handling and validation tests.
 * Sibling to task.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
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

  describe('max_turns handling', () => {
    it('passes max_turns from params into launch request runConfig', async () => {
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
        agentId: 'agent-max-turns',
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
        max_turns: 42,
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_turns: 42,
          }),
        }),
        expect.any(AbortSignal),
      );
    });

    it('passes max_turns alongside timeout into runConfig without losing either', async () => {
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
        agentId: 'agent-max-turns-timeout',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithTimeout = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithTimeout, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        max_turns: 30,
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 1,
            max_turns: 30,
          }),
        }),
        expect.any(AbortSignal),
      );
    });

    it('passes max_turns alongside grace_period_seconds into runConfig', async () => {
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
        agentId: 'agent-max-turns-grace',
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
        max_turns: 20,
        grace_period_seconds: 15,
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_turns: 20,
            grace_period_seconds: 15,
          }),
        }),
        expect.any(AbortSignal),
      );
    });
  });

  describe('max_turns validation', () => {
    const createTool = () =>
      new TaskTool(config, {
        orchestratorFactory: () => {
          throw new Error('should not be called');
        },
      });

    it('rejects max_turns of 0', () => {
      const tool = createTool();

      expect(() =>
        tool.build({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          max_turns: 0,
        }),
      ).toThrow('Task tool max_turns must be a positive integer or -1');
    });

    it('rejects fractional max_turns like 0.5', () => {
      const tool = createTool();

      expect(() =>
        tool.build({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          max_turns: 0.5,
        }),
      ).toThrow('Task tool max_turns must be a positive integer or -1');
    });

    it('rejects negative max_turns other than -1', () => {
      const tool = createTool();

      expect(() =>
        tool.build({
          subagent_name: 'helper',
          goal_prompt: 'Do work',
          max_turns: -2,
        }),
      ).toThrow('Task tool max_turns must be a positive integer or -1');
    });

    it('accepts max_turns of -1 for unlimited and wires it through', async () => {
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
        agentId: 'agent-unlimited-turns',
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
        max_turns: -1,
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_turns: -1,
          }),
        }),
        expect.any(AbortSignal),
      );
    });

    it('accepts positive integer max_turns and wires it through', async () => {
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
        agentId: 'agent-fixed-turns',
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
        max_turns: 5,
      });

      await invocation.execute(new AbortController().signal, undefined);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_turns: 5,
          }),
        }),
        expect.any(AbortSignal),
      );
    });
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
});
