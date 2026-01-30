/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P16
 * @requirement REQ-ASYNC-006, REQ-ASYNC-007
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { taskCommand, tasksCommands } from './tasksCommand.js';
import type { CommandContext } from './types.js';
import {
  AsyncTaskManager,
  SubagentTerminateMode,
  type Config,
  type Logger,
} from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { SessionStatsState } from '../contexts/SessionContext.js';

describe('tasksCommand', () => {
  let asyncTaskManager: AsyncTaskManager;
  let context: CommandContext;
  let addItemMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    asyncTaskManager = new AsyncTaskManager(5);
    addItemMock = vi.fn();

    context = {
      services: {
        config: {
          getAsyncTaskManager: () => asyncTaskManager,
        } as unknown as Config,
        settings: {} as unknown as LoadedSettings,
        git: undefined,
        logger: {} as unknown as Logger,
      },
      ui: {
        addItem: addItemMock,
        clear: vi.fn(),
        setDebugMessage: vi.fn(),
        pendingItem: null,
        setPendingItem: vi.fn(),
        loadHistory: vi.fn(),
        toggleCorgiMode: vi.fn(),
        toggleDebugProfiler: vi.fn(),
        toggleVimEnabled: vi.fn(),
        setGeminiMdFileCount: vi.fn(),
        setLlxprtMdFileCount: vi.fn(),
        updateHistoryTokenCount: vi.fn(),
        reloadCommands: vi.fn(),
        extensionsUpdateState: new Map(),
        dispatchExtensionStateUpdate: vi.fn(),
        addConfirmUpdateExtensionRequest: vi.fn(),
      },
      session: {
        stats: {} as unknown as SessionStatsState,
        sessionShellAllowlist: new Set(),
      },
    };
  });

  it('should export taskCommand with subCommands', () => {
    expect(taskCommand.name).toBe('task');
    expect(taskCommand.subCommands).toHaveLength(2);
    expect(taskCommand.subCommands?.[0].name).toBe('list');
    expect(taskCommand.subCommands?.[1].name).toBe('end');
  });

  it('should export tasksCommands array with taskCommand', () => {
    expect(tasksCommands).toHaveLength(1);
    expect(tasksCommands[0]).toBe(taskCommand);
  });

  describe('/task list', () => {
    it('should return "No async tasks" when there are no tasks', () => {
      const listSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'list',
      );
      listSubCommand?.action?.(context, '');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'No async tasks.',
        },
        expect.any(Number),
      );
    });

    it('should show running tasks with duration', () => {
      asyncTaskManager.registerTask({
        id: 'task-123',
        subagentName: 'deepthinker',
        goalPrompt: 'Analyze the codebase structure',
        abortController: new AbortController(),
      });

      const listSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'list',
      );
      listSubCommand?.action?.(context, '');

      expect(addItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('[RUNNING]'),
        }),
        expect.any(Number),
      );

      const callText = addItemMock.mock.calls[0][0].text;
      expect(callText).toContain('task-123');
      expect(callText).toContain('deepthinker');
      expect(callText).toContain('Analyze the codebase structure');
    });

    it('should show completed tasks', () => {
      asyncTaskManager.registerTask({
        id: 'task-456',
        subagentName: 'typescriptexpert',
        goalPrompt: 'Refactor the authentication module',
        abortController: new AbortController(),
      });

      asyncTaskManager.completeTask('task-456', {
        emitted_vars: {},
        final_message: 'Refactoring complete',
        terminate_reason: SubagentTerminateMode.GOAL,
      });

      const listSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'list',
      );
      listSubCommand?.action?.(context, '');

      expect(addItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('[DONE]'),
        }),
        expect.any(Number),
      );

      const callText = addItemMock.mock.calls[0][0].text;
      expect(callText).toContain('task-456');
      expect(callText).toContain('typescriptexpert');
    });
  });

  describe('/task end', () => {
    it('should cancel task with valid ID', () => {
      asyncTaskManager.registerTask({
        id: 'task-789',
        subagentName: 'codereviewer',
        goalPrompt: 'Review security vulnerabilities',
        abortController: new AbortController(),
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, 'task-789');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Cancelled task: codereviewer (task-789)',
        },
        expect.any(Number),
      );
    });

    it('should cancel task with prefix', () => {
      asyncTaskManager.registerTask({
        id: 'task-abc123',
        subagentName: 'researcher',
        goalPrompt: 'Research best practices',
        abortController: new AbortController(),
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, 'task-abc');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Cancelled task: researcher (task-abc)',
        },
        expect.any(Number),
      );
    });

    it('should show candidates for ambiguous prefix', () => {
      asyncTaskManager.registerTask({
        id: 'task-abc123',
        subagentName: 'researcher',
        goalPrompt: 'Research patterns',
        abortController: new AbortController(),
      });

      asyncTaskManager.registerTask({
        id: 'task-abc456',
        subagentName: 'deepthinker',
        goalPrompt: 'Deep analysis',
        abortController: new AbortController(),
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, 'task-ab');

      expect(addItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('Ambiguous task ID'),
        }),
        expect.any(Number),
      );

      const callText = addItemMock.mock.calls[0][0].text;
      expect(callText).toContain('task-abc');
      expect(callText).toContain('researcher');
      expect(callText).toContain('deepthinker');
    });

    it('should show error for unknown task ID', () => {
      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, 'unknown-id');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Task not found: unknown-id',
        },
        expect.any(Number),
      );
    });

    it('should show error when trying to cancel already completed task', () => {
      asyncTaskManager.registerTask({
        id: 'task-xyz',
        subagentName: 'validator',
        goalPrompt: 'Validate changes',
        abortController: new AbortController(),
      });

      asyncTaskManager.completeTask('task-xyz', {
        emitted_vars: {},
        final_message: 'Done',
        terminate_reason: SubagentTerminateMode.GOAL,
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, 'task-xyz');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Task task-xyz is already completed.',
        },
        expect.any(Number),
      );
    });

    it('should show usage error when no task ID provided', () => {
      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      endSubCommand?.action?.(context, '');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Usage: /task end <task_id>',
        },
        expect.any(Number),
      );
    });

    it('should provide completion for running task IDs', async () => {
      asyncTaskManager.registerTask({
        id: 'task-abc123',
        subagentName: 'researcher',
        goalPrompt: 'Research patterns',
        abortController: new AbortController(),
      });

      asyncTaskManager.registerTask({
        id: 'task-xyz789',
        subagentName: 'deepthinker',
        goalPrompt: 'Deep analysis',
        abortController: new AbortController(),
      });

      // Complete one task so it doesn't show in completions
      asyncTaskManager.completeTask('task-xyz789', {
        emitted_vars: {},
        final_message: 'Done',
        terminate_reason: SubagentTerminateMode.GOAL,
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      const completions = await endSubCommand?.completion?.(context, '');

      // Only running task should be in completions
      expect(completions).toContain('task-abc');
      expect(completions).not.toContain('task-xyz');
    });

    it('should filter completions by partial input', async () => {
      asyncTaskManager.registerTask({
        id: 'task-abc123',
        subagentName: 'researcher',
        goalPrompt: 'Research patterns',
        abortController: new AbortController(),
      });

      asyncTaskManager.registerTask({
        id: 'task-def456',
        subagentName: 'deepthinker',
        goalPrompt: 'Deep analysis',
        abortController: new AbortController(),
      });

      const endSubCommand = taskCommand.subCommands?.find(
        (c) => c.name === 'end',
      );
      const completions = await endSubCommand?.completion?.(context, 'task-a');

      expect(completions).toContain('task-abc');
      expect(completions).not.toContain('task-def');
    });
  });
});
