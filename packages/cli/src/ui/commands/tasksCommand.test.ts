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
import { tasksCommands } from './tasksCommand.js';
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

  describe('/tasks list', () => {
    it('should return "No async tasks" when there are no tasks', () => {
      const tasksCommand = tasksCommands[0];
      tasksCommand.action?.(context, 'list');

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

      const tasksCommand = tasksCommands[0];
      tasksCommand.action?.(context, 'list');

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

      const tasksCommand = tasksCommands[0];
      tasksCommand.action?.(context, 'list');

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

      const taskCommand = tasksCommands[1];
      taskCommand.action?.(context, 'end task-789');

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

      const taskCommand = tasksCommands[1];
      taskCommand.action?.(context, 'end task-abc');

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

      const taskCommand = tasksCommands[1];
      taskCommand.action?.(context, 'end task-ab');

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
      const taskCommand = tasksCommands[1];
      taskCommand.action?.(context, 'end unknown-id');

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

      const taskCommand = tasksCommands[1];
      taskCommand.action?.(context, 'end task-xyz');

      expect(addItemMock).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Task task-xyz is already completed.',
        },
        expect.any(Number),
      );
    });
  });
});
