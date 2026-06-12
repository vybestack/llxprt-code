/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const trackers = new Map<string, TodoContextTracker>();

export class TodoContextTracker {
  private activeTodoId: string | null = null;

  static forAgent(sessionId: string, agentId: string): TodoContextTracker {
    const key = `${sessionId}:${agentId}`;
    let tracker = trackers.get(key);
    if (!tracker) {
      tracker = new TodoContextTracker();
      trackers.set(key, tracker);
    }
    return tracker;
  }

  setActiveTodo(todoId: string | null): void {
    this.activeTodoId = todoId;
  }

  clearActiveTodo(): void {
    this.activeTodoId = null;
  }

  getActiveTodo(): string | null {
    return this.activeTodoId;
  }
}
