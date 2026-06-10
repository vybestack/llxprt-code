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
  type TodoContextTracker as TodoContextTrackerBoundary,
  type TodoReminderService as TodoReminderServiceBoundary,
  type TodoStore as TodoStoreBoundary,
} from '@vybestack/llxprt-code-tools';

export class CoreTodoServiceAdapter implements ITodoService {
  getTodoStore(context?: ToolContext): TodoStoreBoundary {
    return new LocalTodoStore(
      context?.sessionId ?? 'default',
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
