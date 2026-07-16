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

  async function streamSubagentDeltas(
    emitDeltas: (emit: (message: string) => void) => Promise<void> | void,
  ): Promise<string[]> {
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
        await emitDeltas((message: string) => scope.onMessage?.(message));
      }),
      runNonInteractive: vi.fn(),
      onMessage: undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose: vi.fn().mockResolvedValue(undefined),
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
    const updateOutput = vi.fn();
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship it',
    });

    await invocation.execute(new AbortController().signal, updateOutput);

    return updateOutput.mock.calls.map((c) => c[0] as string).slice(1, -1);
  }

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

  it('streams subagent messages with normalized newlines across mixed line endings', async () => {
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

    const calls = updateOutput.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('<subagent name="helper" id="agent-42">\n');
    expect(calls[calls.length - 1]).toBe(
      '</subagent name="helper" id="agent-42">\n',
    );

    const accumulated = calls.slice(1, -1).join('');

    expect(accumulated).toBe(
      'first chunksecond chunk\nthird chunk\nfourth chunk\n',
    );
  });

  it('preserves standalone newline chunks without dropping them', async () => {
    const deltas = await streamSubagentDeltas((emit) => {
      emit('Hello');
      emit('\n');
      emit('World');
    });

    expect(deltas.join('')).toBe('Hello\nWorld');
  });

  it('does not invent separators at word-token fragment boundaries', async () => {
    const deltas = await streamSubagentDeltas((emit) => {
      for (const token of 'Hello World'.match(/(\w+|\s)/g) ?? []) {
        emit(token);
      }
    });

    expect(deltas.join('')).toBe('Hello World');
  });

  it('filters out only truly empty messages when streaming', async () => {
    const deltas = await streamSubagentDeltas((emit) => {
      emit('');
      emit('  ');
      emit('\n');
      emit('\t');
      emit('actual message');
    });

    expect(deltas).toStrictEqual(['  ', '\n', '\t', 'actual message']);
  });

  it('preserves CRLF semantics across split chunk boundaries (a\\r then \\nb)', async () => {
    const deltas = await streamSubagentDeltas((emit) => {
      emit('a\r');
      emit('\nb');
    });

    expect(deltas.join('')).toBe('a\nb');
  });

  it('flushes a pending CR as LF when the stream ends in a lone CR', async () => {
    const deltas = await streamSubagentDeltas((emit) => {
      emit('hello');
      emit('\r');
    });

    expect(deltas.join('')).toBe('hello\n');
  });

  /**
   * @plan PLAN-20260130-ASYNCTASK.P10
   */
});
