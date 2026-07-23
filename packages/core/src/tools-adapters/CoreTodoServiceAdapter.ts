/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LocalTodoStore,
  TODO_DEFAULT_AGENT_ID,
  TodoContextTracker,
  TodoReminderService,
  type ITodoService,
  type ToolContext,
  type TodoDataDirResolver,
  type TodoContextTracker as TodoContextTrackerBoundary,
  type TodoReminderService as TodoReminderServiceBoundary,
  type TodoStore as TodoStoreBoundary,
} from '@vybestack/llxprt-code-tools';
import { Storage } from '@vybestack/llxprt-code-settings';

/**
 * Adapter that constructs {@link LocalTodoStore} instances using the canonical
 * Storage data directory. Storage remains the sole OS-platform path authority
 * (it is the composition root for the data category); the leaf tools package
 * never re-implements the platform algorithm.
 */
export class CoreTodoServiceAdapter implements ITodoService {
  private readonly todoDataDirResolver: TodoDataDirResolver;

  constructor(
    todoDataDirResolver: TodoDataDirResolver = () => Storage.getGlobalDataDir(),
  ) {
    this.todoDataDirResolver = todoDataDirResolver;
  }

  getTodoStore(context?: ToolContext): TodoStoreBoundary {
    return new LocalTodoStore(
      context?.sessionId ?? 'default',
      { dataDirResolver: this.todoDataDirResolver },
      context?.agentId,
    );
  }

  getReminderService(): TodoReminderServiceBoundary {
    return new TodoReminderService();
  }

  getContextTracker(context?: ToolContext): TodoContextTrackerBoundary {
    return TodoContextTracker.forAgent(
      context?.sessionId ?? 'default',
      context?.agentId ?? TODO_DEFAULT_AGENT_ID,
    );
  }

  getDefaultAgentId(): string {
    return TODO_DEFAULT_AGENT_ID;
  }
}
