/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IToolHost,
  ITodoService,
  TodoStore,
} from '../interfaces/index.js';
import type { Todo } from '../types/todo-schemas.js';

/**
 * Minimal IToolHost stub. Only provides what TodoWrite needs.
 */
export function createToolHostWithEmojiMode(mode: string): IToolHost {
  return {
    getTargetDir: () => '/tmp',
    getWorkspaceRoots: () => [],
    getApprovalMode: () => 'default' as const,
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({ emojifilter: mode }),
    getDebugMode: () => false,
  };
}

export function createToolHostWithEmptySettings(): IToolHost {
  const host = createToolHostWithEmojiMode('');
  host.getEphemeralSettings = () => ({});
  return host;
}

export function createFakeTodoService(
  initialTodos: Todo[] = [],
): ITodoService & { getStoredTodos: () => Todo[] } {
  let todos = [...initialTodos];

  const store: TodoStore = {
    getTodos: () => todos,
    setTodos: (newTodos: Todo[]) => {
      todos = [...newTodos];
    },
  };

  return {
    getTodoStore: () => store,
    getReminderService: () => ({
      shouldGenerateReminder: () => false,
      getReminderForStateChange: () => undefined,
    }),
    getContextTracker: () => ({
      setActiveTodo: () => {},
    }),
    getDefaultAgentId: () => 'test-agent',
    getStoredTodos: () => todos,
  };
}
