/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool } from './task.js';
import type { Config } from '../config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '../core/subagent.js';

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
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      onMessage: undefined,
    };

    const launch = vi.fn().mockResolvedValue({
      agentId: 'test-agent',
      scope,
      dispose,
    });

    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'test-agent',
      goal_prompt: 'test goal',
    });

    await invocation.execute(new AbortController().signal, undefined);

    expect(launch).toHaveBeenCalledWith(
      {
        name: 'test-agent',
        behaviourPrompts: ['test goal'],
      },
      expect.any(Object),
    );

    expect(dispose).toHaveBeenCalled();
  });

  it('calls updateOutput with subagent output during execution', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const output = {
      emitted_vars: { result: 'subagent result' },
      terminate_reason: SubagentTerminateMode.GOAL,
    };
    const scope = {
      output,
      runInteractive: vi.fn().mockImplementation((_ctx) => {
        scope.onMessage?.('some message');
      }),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      onMessage: undefined as ((m: string) => void) | undefined,
    };

    const updateOutput = vi.fn();

    const launch = vi.fn().mockResolvedValue({
      agentId: 'test-agent',
      scope,
      dispose,
    });

    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });

    const invocation = tool.build({
      subagent_name: 'test-agent',
      goal_prompt: 'test goal',
    });

    await invocation.execute(new AbortController().signal, updateOutput);

    expect(updateOutput).toHaveBeenCalledWith(
      expect.stringContaining('[test-agent]'),
    );
  });

  it('should properly stream subagent messages on separate lines', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const updateOutput = vi.fn();
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockImplementation(async (_ctx) => {
        // Simulate subagent streaming two chunks
        scope.onMessage?.('first chunk');
        scope.onMessage?.('second chunk');
      }),
      runNonInteractive: vi.fn(),
      onMessage: undefined as ((m: string) => void) | undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const config = {} as unknown as Config;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Ship it',
    });
    await invocation.execute(new AbortController().signal, updateOutput);
    expect(updateOutput).toHaveBeenCalledWith(
      expect.stringContaining('[agent-42] first chunk\n'),
    );
    expect(updateOutput).toHaveBeenCalledWith(
      expect.stringContaining('[agent-42] second chunk\n'),
    );
  });

  it('handles empty messages gracefully', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const updateOutput = vi.fn();
    const scope = {
      output: {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      },
      runInteractive: vi.fn().mockImplementation(async (_ctx) => {
        scope.onMessage?.('');
        scope.onMessage?.('   ');
      }),
      runNonInteractive: vi.fn(),
      onMessage: undefined as ((m: string) => void) | undefined,
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'agent-42',
      scope,
      dispose,
    });
    const orchestrator = { launch } as unknown as SubagentOrchestrator;
    const tool = new TaskTool(config, {
      orchestratorFactory: () => orchestrator,
      isInteractiveEnvironment: () => true,
    });
    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Test',
    });
    await invocation.execute(new AbortController().signal, updateOutput);
    expect(updateOutput).not.toHaveBeenCalled();
  });

  it('validates required parameters', () => {
    const tool = new TaskTool(config, {
      orchestratorFactory: () => ({}) as SubagentOrchestrator,
      isInteractiveEnvironment: () => true,
    });

    // Test missing subagent_name
    expect(() => {
      tool.build({
        goal_prompt: 'test goal',
      });
    }).toThrow("params must have required property 'subagent_name'");

    // Test missing goal_prompt
    expect(() => {
      tool.build({
        subagent_name: 'test-agent',
      });
    }).toThrow("params must have required property 'goal_prompt'");
  });
});
