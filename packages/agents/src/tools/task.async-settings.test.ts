import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});
import { TaskLaunchOwner } from '../session/task-launch-owner.js';

/**
 * TaskTool async mode settings tests.
 * Split from task.async.test.ts to stay under file-level max-lines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { TaskTool, type TaskToolParams } from './task.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

describe('TaskTool', () => {
  let config: Config;
  let settingsRoot: ReturnType<typeof createSessionSettingsFixture>;
  let messageBus: MessageBus;

  beforeEach(() => {
    config = new Config({
      sessionId: 'session-123',
      model: 'task-async-fixture',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
    });
    settingsRoot = createSessionSettingsFixture(config);
    messageBus = new MessageBus();
  });

  afterEach(async () => {
    await config.dispose();
  });

  describe('async mode settings', () => {
    it('returns error when async=true but global subagents.asyncEnabled is false', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
      };
      const configWithDisabledGlobalAsync = config;
      settingsRoot.settingsOwner.writeUserParameter(
        'subagents.asyncEnabled',
        false,
      );
      const tool = new TaskTool(configWithDisabledGlobalAsync, {
        createChildSettings: () =>
          settingsRoot.settingsOwner.createChildStore(),
        readTaskPolicy: () => settingsRoot.settingsOwner.readTaskPolicy(),
        readRunPolicy: () => settingsRoot.settingsOwner.readSubagentRunPolicy(),
        readGovernance: () =>
          settingsRoot.settingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        instructions: emptyInstructionReads,
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        messageBus,
        taskLaunchOwner: new TaskLaunchOwner(
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        ),
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('globally disabled');
      expect(result.llmContent).toContain('/settings');
    });

    it('returns error when async=true but profile subagents.async.enabled is false', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
      };
      const configWithDisabledProfileAsync = config;
      settingsRoot.settingsOwner.writeUserParameter(
        'subagents.asyncEnabled',
        true,
      );
      settingsRoot.settingsOwner.writeUserParameter(
        'subagents.async.enabled',
        false,
      );
      const tool = new TaskTool(configWithDisabledProfileAsync, {
        createChildSettings: () =>
          settingsRoot.settingsOwner.createChildStore(),
        readTaskPolicy: () => settingsRoot.settingsOwner.readTaskPolicy(),
        readRunPolicy: () => settingsRoot.settingsOwner.readSubagentRunPolicy(),
        readGovernance: () =>
          settingsRoot.settingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        instructions: emptyInstructionReads,
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        messageBus,
        taskLaunchOwner: new TaskLaunchOwner(
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        ),
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.llmContent).toContain('profile disables');
      expect(result.llmContent).toContain('/set');
    });

    it('proceeds when async=true and both global and profile settings enabled', async () => {
      const registerTaskMock = vi.fn();
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: registerTaskMock,
        completeTask: vi.fn(),
        failTask: vi.fn(),
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-enabled-agent',
        scope: {
          runNonInteractive: vi.fn().mockResolvedValue(undefined),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: { result: 'success' },
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const configWithEnabledAsync = config;
      settingsRoot.settingsOwner.writeUserParameter(
        'subagents.asyncEnabled',
        true,
      );
      settingsRoot.settingsOwner.writeUserParameter(
        'subagents.async.enabled',
        true,
      );
      const tool = new TaskTool(configWithEnabledAsync, {
        createChildSettings: () =>
          settingsRoot.settingsOwner.createChildStore(),
        readTaskPolicy: () => settingsRoot.settingsOwner.readTaskPolicy(),
        readRunPolicy: () => settingsRoot.settingsOwner.readSubagentRunPolicy(),
        readGovernance: () =>
          settingsRoot.settingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        instructions: emptyInstructionReads,
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        messageBus,
        taskLaunchOwner: new TaskLaunchOwner(
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        ),
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(registerTaskMock).toHaveBeenCalled();
      expect(result.metadata?.async).toBe(true);
    });

    it('defaults to enabled when no subagent settings are configured', async () => {
      const registerTaskMock = vi.fn();
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: registerTaskMock,
        completeTask: vi.fn(),
        failTask: vi.fn(),
      };
      const launchMock = vi.fn().mockResolvedValue({
        agentId: 'async-no-settings',
        scope: {
          runNonInteractive: vi.fn().mockResolvedValue(undefined),
          output: {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: {},
          },
        },
        dispose: vi.fn().mockResolvedValue(undefined),
      });
      const configWithoutSettings = config;

      const tool = new TaskTool(configWithoutSettings, {
        createChildSettings: () =>
          settingsRoot.settingsOwner.createChildStore(),
        readTaskPolicy: () => settingsRoot.settingsOwner.readTaskPolicy(),
        readRunPolicy: () => settingsRoot.settingsOwner.readSubagentRunPolicy(),
        readGovernance: () =>
          settingsRoot.settingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        instructions: emptyInstructionReads,
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        messageBus,
        taskLaunchOwner: new TaskLaunchOwner(
          mockAsyncTaskManager as unknown as AsyncTaskManager,
        ),
        isInteractiveEnvironment: () => false,
      });
      const params: TaskToolParams = {
        subagent_name: 'helper',
        goal_prompt: 'Do async work',
        async: true,
      };

      const invocation = tool.build(params);
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(registerTaskMock).toHaveBeenCalled();
    });
  });
});
