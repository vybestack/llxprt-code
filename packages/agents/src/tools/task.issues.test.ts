/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool issue-specific tests: XML wrapping (#727), toolConfig omission (#2069).
 * Sibling to task.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskTool, type TaskToolParams } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';

describe('TaskTool', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-123',
    } as unknown as Config;
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

  describe('Issue #2069: toolConfig omission with output_spec', () => {
    it('omits toolConfig (not empty) when no explicit whitelist and registry unavailable, so runtime uses profile defaults', async () => {
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
        agentId: 'agent-2069-no-registry',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      // Config WITHOUT getToolRegistry — simulates registry unavailable
      const configNoRegistry = {
        getSessionId: () => 'session-2069',
      } as unknown as Config;

      const tool = new TaskTool(configNoRegistry, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'rustcoder',
        goal_prompt: 'Write a function',
        output_spec: { result: 'The implementation' },
      });

      await invocation.execute(new AbortController().signal, undefined);

      const launchRequest = launch.mock.calls[0]?.[0] as
        | { toolConfig?: unknown; outputConfig?: unknown }
        | undefined;
      expect(launchRequest).toBeDefined();
      // toolConfig must be absent (undefined) so runtime uses profile defaults
      expect(launchRequest).not.toHaveProperty('toolConfig');
      // outputConfig must still be present
      expect(launchRequest).toHaveProperty('outputConfig');
    });

    it('omits toolConfig (not parent registry-derived) when no explicit whitelist and registry available, so runtime uses profile defaults', async () => {
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
        agentId: 'agent-2069-with-registry',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithRegistry = {
        getSessionId: () => 'session-2069',
        getEphemeralSettings: () => ({}),
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
        subagent_name: 'rustcoder',
        goal_prompt: 'Write a function',
        output_spec: { result: 'The implementation' },
      });

      await invocation.execute(new AbortController().signal, undefined);

      const launchRequest = launch.mock.calls[0]?.[0] as
        | { toolConfig?: unknown; outputConfig?: unknown }
        | undefined;
      expect(launchRequest).toBeDefined();
      // Issue #2069: no explicit whitelist must NOT synthesize toolConfig from
      // the parent registry. toolConfig omitted → runtime/profile defaults apply.
      expect(launchRequest).not.toHaveProperty('toolConfig');
      // outputConfig must still be present
      expect(launchRequest).toHaveProperty('outputConfig');
    });
  });

  describe('Issue #2069: no-registry explicit whitelist must strip task/list_subagents', () => {
    it('filters task/list_subagents from explicit whitelist when registry is unavailable', async () => {
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
        agentId: 'agent-2069-no-reg-filter',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      // Config WITHOUT getToolRegistry — simulates registry unavailable
      const configNoRegistry = {
        getSessionId: () => 'session-2069',
      } as unknown as Config;

      const tool = new TaskTool(configNoRegistry, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        tool_whitelist: ['read_file', 'task', 'list_subagents'],
      });

      await invocation.execute(new AbortController().signal, undefined);

      const launchRequest = launch.mock.calls[0]?.[0] as
        | { toolConfig?: { tools?: string[] } }
        | undefined;
      expect(launchRequest).toBeDefined();
      expect(launchRequest).toHaveProperty('toolConfig');
      // task/list_subagents must be removed even without a registry;
      // read_file is preserved (no-registry explicit whitelist semantics).
      expect(launchRequest?.toolConfig?.tools).toStrictEqual(['read_file']);
    });

    it('preserves fail-closed toolConfig { tools: [] } when explicit whitelist only contains task/list_subagents and registry unavailable', async () => {
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
        agentId: 'agent-2069-no-reg-failclosed',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configNoRegistry = {
        getSessionId: () => 'session-2069',
      } as unknown as Config;

      const tool = new TaskTool(configNoRegistry, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        tool_whitelist: ['task', 'list_subagents'],
      });

      await invocation.execute(new AbortController().signal, undefined);

      const launchRequest = launch.mock.calls[0]?.[0] as
        | { toolConfig?: { tools?: string[] } }
        | undefined;
      expect(launchRequest).toBeDefined();
      expect(launchRequest).toHaveProperty('toolConfig');
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
    });
  });

  // Issue #2184: API-qualified tool names (e.g. functions.run_shell_command)
  // must resolve to the registry tool name. Unknown qualified names must
  // remain fail-closed. Qualified excluded tools must still be stripped.
  describe('Issue #2184: API-qualified tool name resolution', () => {
    type LaunchRequest = {
      toolConfig?: { tools?: string[] };
      outputConfig?: unknown;
    };

    function createIssue2184Harness(
      registryTools: string[],
      ephemerals: Record<string, unknown> = {},
    ) {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        // Required by SubAgentScope; these tests exercise the interactive path.
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-2184',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithRegistry = {
        getSessionId: () => 'session-2184',
        getEphemeralSettings: () => ephemerals,
        getExcludeTools: () => [],
        getToolRegistry: () => ({
          getEnabledTools: () => registryTools.map((name) => ({ name })),
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithRegistry, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });
      return { launch, tool };
    }

    async function executeIssue2184Invocation(
      params: Pick<TaskToolParams, 'tool_whitelist' | 'output_spec'>,
      registryTools = ['run_shell_command'],
      ephemerals: Record<string, unknown> = {},
    ): Promise<LaunchRequest | undefined> {
      const { launch, tool } = createIssue2184Harness(
        registryTools,
        ephemerals,
      );
      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Do work',
        ...params,
      });

      await invocation.execute(new AbortController().signal, undefined);

      return launch.mock.calls[0]?.[0] as LaunchRequest | undefined;
    }

    it("resolves functions.run_shell_command to 'run_shell_command' via the registry", async () => {
      const launchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['functions.run_shell_command'],
      });

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'run_shell_command',
      ]);
    });

    it('does not treat GitHub namespaces as API aliases for registry tools', async () => {
      const readFileLaunchRequest = await executeIssue2184Invocation(
        { tool_whitelist: ['github.read_file'] },
        ['read_file'],
      );
      const repoLaunchRequest = await executeIssue2184Invocation(
        { tool_whitelist: ['github.repo'] },
        ['repo'],
      );
      const repoReadFileLaunchRequest = await executeIssue2184Invocation(
        { tool_whitelist: ['github.repo.read_file'] },
        ['repo.read_file', 'read_file'],
      );

      expect(readFileLaunchRequest).toBeDefined();
      expect(readFileLaunchRequest?.toolConfig?.tools).toStrictEqual([]);
      expect(repoLaunchRequest).toBeDefined();
      expect(repoLaunchRequest?.toolConfig?.tools).toStrictEqual([]);
      expect(repoReadFileLaunchRequest).toBeDefined();
      expect(repoReadFileLaunchRequest?.toolConfig?.tools).toStrictEqual([]);
    });

    it('remains fail-closed with [] for unknown or malformed qualified names', async () => {
      const unknownLaunchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['functions.does_not_exist'],
      });
      const malformedLaunchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['functions.'],
      });

      expect(unknownLaunchRequest).toBeDefined();
      expect(unknownLaunchRequest).toHaveProperty('toolConfig');
      expect(unknownLaunchRequest?.toolConfig?.tools).toStrictEqual([]);
      expect(malformedLaunchRequest).toBeDefined();
      expect(malformedLaunchRequest).toHaveProperty('toolConfig');
      expect(malformedLaunchRequest?.toolConfig?.tools).toStrictEqual([]);
    });

    it('resolves multi-segment qualified names', async () => {
      const launchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['api.v1.run_shell_command'],
      });

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'run_shell_command',
      ]);
    });

    it('honors qualified disabled entries before resolving through the registry', async () => {
      const launchRequest = await executeIssue2184Invocation(
        {
          tool_whitelist: ['functions.run_shell_command'],
        },
        ['run_shell_command'],
        { 'tools.disabled': ['functions.run_shell_command'] },
      );

      expect(launchRequest).toBeDefined();
      expect(launchRequest).toHaveProperty('toolConfig');
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
    });

    it('honors versioned API entries in governance allowlists', async () => {
      const launchRequest = await executeIssue2184Invocation(
        {
          tool_whitelist: ['functions.run_shell_command'],
        },
        ['run_shell_command'],
        { 'tools.allowed': ['api.v1.run_shell_command'] },
      );

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'run_shell_command',
      ]);
    });

    it('resolves plain whitelist entries to dotted registry tool names', async () => {
      const launchRequest = await executeIssue2184Invocation(
        {
          tool_whitelist: ['run_shell_command'],
        },
        ['functions.run_shell_command'],
      );

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'functions.run_shell_command',
      ]);
    });

    it('filters excluded tools after resolving their qualified names', async () => {
      const launchRequest = await executeIssue2184Invocation(
        {
          tool_whitelist: [
            'functions.run_shell_command',
            'functions.task',
            'functions.list_subagents',
          ],
        },
        ['run_shell_command', 'task', 'list_subagents'],
      );

      expect(launchRequest).toBeDefined();
      expect(launchRequest).toHaveProperty('toolConfig');
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'run_shell_command',
      ]);
    });

    it('preserves resolved whitelist tools when output_spec is provided', async () => {
      const launchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['functions.run_shell_command'],
        output_spec: { result: 'The output' },
      });

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([
        'run_shell_command',
      ]);
      // outputConfig must contain the outputs mapped from output_spec.
      expect(launchRequest?.outputConfig).toStrictEqual({
        outputs: { result: 'The output' },
      });
    });

    it('preserves output_spec when qualified whitelist resolution leaves zero tools', async () => {
      const launchRequest = await executeIssue2184Invocation({
        tool_whitelist: ['functions.does_not_exist'],
        output_spec: { result: 'The output' },
      });

      expect(launchRequest).toBeDefined();
      expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
      expect(launchRequest?.outputConfig).toStrictEqual({
        outputs: { result: 'The output' },
      });
    });
  });
});
