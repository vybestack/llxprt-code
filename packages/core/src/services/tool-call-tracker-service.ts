/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { type TodoToolCall } from '../tools/todo-schemas.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

// Map of session ID -> agent ID -> todo ID -> tool calls
// This keeps track of both executing and completed tool calls in memory (not persisted)
interface TodoToolCalls {
  executing: Map<string, TodoToolCall>;
  completed: TodoToolCall[];
}

type AgentToolCallMap = Map<string, TodoToolCalls>;
type SessionToolCallMap = Map<string, AgentToolCallMap>;

const toolCallsInMemory = new Map<string, SessionToolCallMap>();

// Callbacks for notifying UI of updates, scoped per session/agent
const updateCallbacks = new Map<string, Map<string, Set<() => void>>>();

/**
 * Service to track tool calls and associate them with active todos
 */
export class ToolCallTrackerService {
  /**
   * Starts tracking an executing tool call
   */
  static startTrackingToolCall(
    sessionId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    agentId?: string,
  ): string | null {
    // Don't track todo tools themselves
    if (toolName === 'todo_write' || toolName === 'todo_read') {
      return null;
    }

    const scopedAgentId = this.getScopedAgentId(agentId);

    // Get the context tracker for this session/agent scope
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      scopedAgentId,
    );
    const activeTodoId = contextTracker.getActiveTodoId();

    // If there's no active todo, don't track the tool call
    if (!activeTodoId) {
      return null;
    }

    // Create a tool call record
    const toolCallId = this.generateId();
    const toolCall: TodoToolCall = {
      id: toolCallId,
      name: toolName,
      parameters,
      timestamp: new Date(),
    };

    // Ensure we have a map for this session
    if (!toolCallsInMemory.has(sessionId)) {
      toolCallsInMemory.set(sessionId, new Map());
    }

    const sessionCalls = toolCallsInMemory.get(sessionId)!;

    if (!sessionCalls.has(scopedAgentId)) {
      sessionCalls.set(scopedAgentId, new Map());
    }

    const agentCalls = sessionCalls.get(scopedAgentId)!;

    // Ensure we have a map for this todo
    if (!agentCalls.has(activeTodoId)) {
      agentCalls.set(activeTodoId, {
        executing: new Map(),
        completed: [],
      });
    }

    const todoCalls = agentCalls.get(activeTodoId)!;

    // Add the tool call to the executing map
    todoCalls.executing.set(toolCallId, toolCall);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId, scopedAgentId);

    return toolCallId;
  }

  /**
   * Marks a tool call as completed and moves it to the completed array
   */
  static async completeToolCallTracking(
    sessionId: string,
    toolCallId: string,
    agentId?: string,
  ): Promise<void> {
    const scopedAgentId = this.getScopedAgentId(agentId);

    // Get the tool call before removing it
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      scopedAgentId,
    );
    const activeTodoId = contextTracker.getActiveTodoId();

    if (!activeTodoId) {
      return;
    }

    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) return;

    const agentCalls = sessionCalls.get(scopedAgentId);
    if (!agentCalls) return;

    const todoCalls = agentCalls.get(activeTodoId);
    if (!todoCalls) return;

    const toolCall = todoCalls.executing.get(toolCallId);
    if (!toolCall) return;

    // Move from executing to completed
    todoCalls.executing.delete(toolCallId);
    todoCalls.completed.push(toolCall);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId, scopedAgentId);
  }

  /**
   * Marks a tool call as failed
   */
  static failToolCallTracking(
    sessionId: string,
    toolCallId: string,
    agentId?: string,
  ): void {
    const scopedAgentId = this.getScopedAgentId(agentId);

    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      scopedAgentId,
    );
    const activeTodoId = contextTracker.getActiveTodoId();

    if (!activeTodoId) {
      return;
    }

    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) return;

    const agentCalls = sessionCalls.get(scopedAgentId);
    if (!agentCalls) return;

    const todoCalls = agentCalls.get(activeTodoId);
    if (!todoCalls) return;

    // Simply remove from executing without moving to completed
    todoCalls.executing.delete(toolCallId);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId, scopedAgentId);
  }

  /**
   * Gets all tool calls (executing and completed) for a specific todo
   */
  static getAllToolCalls(
    sessionId: string,
    todoId: string,
    agentId?: string,
  ): TodoToolCall[] {
    const scopedAgentId = this.getScopedAgentId(agentId);

    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) {
      return [];
    }

    const agentCalls = sessionCalls.get(scopedAgentId);
    if (!agentCalls) {
      return [];
    }

    const todoCalls = agentCalls.get(todoId);
    if (!todoCalls) {
      return [];
    }

    // Return both executing and completed calls
    return [
      ...Array.from(todoCalls.executing.values()),
      ...todoCalls.completed,
    ];
  }

  /**
   * Subscribes to tool call updates
   */
  static subscribeToUpdates(
    sessionId: string,
    callback: () => void,
    agentId?: string,
  ): () => void {
    const scopedAgentId = this.getScopedAgentId(agentId);

    if (!updateCallbacks.has(sessionId)) {
      updateCallbacks.set(sessionId, new Map());
    }

    const sessionCallbacks = updateCallbacks.get(sessionId)!;

    if (!sessionCallbacks.has(scopedAgentId)) {
      sessionCallbacks.set(scopedAgentId, new Set());
    }

    const callbacks = sessionCallbacks.get(scopedAgentId)!;
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        sessionCallbacks.delete(scopedAgentId);
        if (sessionCallbacks.size === 0) {
          updateCallbacks.delete(sessionId);
        }
      }
    };
  }

  /**
   * Gets all tool calls for testing and debugging purposes
   */
  static getAllToolCallsForSession(
    sessionId: string,
    agentId?: string,
  ): Map<string, TodoToolCalls> {
    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) {
      return new Map();
    }

    const scopedAgentId = this.getScopedAgentId(agentId);
    const agentCalls = sessionCalls.get(scopedAgentId);
    if (!agentCalls) {
      return new Map();
    }

    return new Map(agentCalls);
  }

  /**
   * Clears all tool calls for a session (for testing purposes)
   */
  static clearToolCallsForSession(sessionId: string, agentId?: string): void {
    if (agentId === undefined) {
      toolCallsInMemory.delete(sessionId);
      updateCallbacks.delete(sessionId);
      return;
    }

    const scopedAgentId = this.getScopedAgentId(agentId);
    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (sessionCalls) {
      sessionCalls.delete(scopedAgentId);
      if (sessionCalls.size === 0) {
        toolCallsInMemory.delete(sessionId);
      }
    }

    const sessionCallbacks = updateCallbacks.get(sessionId);
    if (sessionCallbacks) {
      sessionCallbacks.delete(scopedAgentId);
      if (sessionCallbacks.size === 0) {
        updateCallbacks.delete(sessionId);
      }
    }
  }

  /**
   * Generates a unique ID for tool calls
   */
  private static generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Notifies all subscribers of updates
   */
  private static notifySubscribers(sessionId: string, agentId: string): void {
    const sessionCallbacks = updateCallbacks.get(sessionId);
    if (!sessionCallbacks) {
      return;
    }

    const callbacks = sessionCallbacks.get(agentId);
    if (callbacks) {
      callbacks.forEach((callback) => callback());
    }
  }

  /**
   * Resolve an agent identifier, defaulting when missing.
   */
  private static getScopedAgentId(agentId?: string): string {
    return agentId ?? DEFAULT_AGENT_ID;
  }
}
