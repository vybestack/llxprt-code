/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool async mode settings tests.
 * Split from task.async.test.ts to stay under file-level max-lines.
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

  describe('async mode settings', () => {
    it('returns error when async=true but global subagents.asyncEnabled is false', async () => {
      const mockAsyncTaskManager = {
        canLaunchAsync: () => ({ allowed: true }),
        tryReserveAsyncSlot: () => 'booking-1',
        registerTask: vi.fn(),
      };
      const configWithDisabledGlobalAsync = {
        ...config,
        getSettingsService: () => ({
          getAllGlobalSettings: () => ({
            subagents: { asyncEnabled: false },
          }),
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithDisabledGlobalAsync, {
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
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
      const configWithDisabledProfileAsync = {
        ...config,
        getSettingsService: () => ({
          getAllGlobalSettings: () => ({
            subagents: { asyncEnabled: true },
          }),
        }),
        getEphemeralSettings: () => ({
          'subagents.async.enabled': false,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithDisabledProfileAsync, {
        orchestratorFactory: () => ({}) as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
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
      const configWithEnabledAsync = {
        ...config,
        getSettingsService: () => ({
          getAllGlobalSettings: () => ({
            subagents: { asyncEnabled: true },
          }),
        }),
        getEphemeralSettings: () => ({
          'subagents.async.enabled': true,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithEnabledAsync, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
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

    it('defaults to enabled when settings service is unavailable', async () => {
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
      const configWithoutSettings = {
        ...config,
      } as unknown as Config;
      const tool = new TaskTool(configWithoutSettings, {
        orchestratorFactory: () =>
          ({ launch: launchMock }) as unknown as SubagentOrchestrator,
        getAsyncTaskManager: () =>
          mockAsyncTaskManager as unknown as AsyncTaskManager,
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
