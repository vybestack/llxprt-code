/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service to track which todo item is currently active in a session and agent scope.
 * This allows associating tool calls with the active todo.
 */
import { DEFAULT_AGENT_ID } from '../core/turn.js';

export class TodoContextTracker {
  private static instances = new Map<string, Map<string, TodoContextTracker>>();

  private activeTodoId: string | null = null;

  private constructor(
    private readonly _sessionId: string,
    private readonly _agentId: string,
  ) {
    // Session and agent IDs reserved for future scope-specific functionality
    void this._sessionId;
    void this._agentId;
  }

  /**
   * Get or create a tracker instance for a session/agent combination.
   */
  static forAgent(sessionId: string, agentId?: string): TodoContextTracker {
    const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;

    if (!this.instances.has(sessionId)) {
      this.instances.set(sessionId, new Map());
    }

    const agentMap = this.instances.get(sessionId)!;

    if (!agentMap.has(scopedAgentId)) {
      agentMap.set(
        scopedAgentId,
        new TodoContextTracker(sessionId, scopedAgentId),
      );
    }

    return agentMap.get(scopedAgentId)!;
  }

  /**
   * Get or create a tracker instance for a session in the default agent scope.
   * This preserves backward compatibility with existing callers.
   */
  static forSession(sessionId: string): TodoContextTracker {
    return this.forAgent(sessionId, DEFAULT_AGENT_ID);
  }

  /**
   * Set the active todo for this session/agent scope.
   */
  setActiveTodo(todoId: string | null): void {
    this.activeTodoId = todoId;
  }

  /**
   * Get the active todo ID for this session/agent scope.
   */
  getActiveTodoId(): string | null {
    return this.activeTodoId;
  }

  /**
   * Clear the active todo for this session/agent scope.
   */
  clearActiveTodo(): void {
    this.activeTodoId = null;
  }
}
