/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { TodoToolCall } from '../tools/todo-schemas.js';

// Map of session ID to map of todo ID to tool calls
// This keeps track of both executing and completed tool calls in memory (not persisted)
interface TodoToolCalls {
  executing: Map<string, TodoToolCall>;
  completed: TodoToolCall[];
}

const toolCallsInMemory = new Map<string, Map<string, TodoToolCalls>>();

// Callbacks for notifying UI of updates
const updateCallbacks = new Map<string, Set<() => void>>();

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
  ): string | null {
    // Don't track todo tools themselves
    if (toolName === 'todo_write' || toolName === 'todo_read') {
      return null;
    }

    // Get the context tracker for this session
    const contextTracker = TodoContextTracker.forSession(sessionId);
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

    // Ensure we have a map for this todo
    if (!sessionCalls.has(activeTodoId)) {
      sessionCalls.set(activeTodoId, {
        executing: new Map(),
        completed: [],
      });
    }

    const todoCalls = sessionCalls.get(activeTodoId)!;

    // Add the tool call to the executing map
    todoCalls.executing.set(toolCallId, toolCall);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId);

    return toolCallId;
  }

  /**
   * Marks a tool call as completed and moves it to the completed array
   */
  static async completeToolCallTracking(
    sessionId: string,
    toolCallId: string,
  ): Promise<void> {
    // Get the tool call before removing it
    const contextTracker = TodoContextTracker.forSession(sessionId);
    const activeTodoId = contextTracker.getActiveTodoId();

    if (!activeTodoId) {
      return;
    }

    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) return;

    const todoCalls = sessionCalls.get(activeTodoId);
    if (!todoCalls) return;

    const toolCall = todoCalls.executing.get(toolCallId);
    if (!toolCall) return;

    // Move from executing to completed
    todoCalls.executing.delete(toolCallId);
    todoCalls.completed.push(toolCall);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId);
  }

  /**
   * Marks a tool call as failed
   */
  static failToolCallTracking(sessionId: string, toolCallId: string): void {
    const contextTracker = TodoContextTracker.forSession(sessionId);
    const activeTodoId = contextTracker.getActiveTodoId();

    if (!activeTodoId) {
      return;
    }

    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) return;

    const todoCalls = sessionCalls.get(activeTodoId);
    if (!todoCalls) return;

    // Simply remove from executing without moving to completed
    todoCalls.executing.delete(toolCallId);

    // Notify subscribers of the update
    this.notifySubscribers(sessionId);
  }

  /**
   * Gets all tool calls (executing and completed) for a specific todo
   */
  static getAllToolCalls(sessionId: string, todoId: string): TodoToolCall[] {
    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) {
      return [];
    }

    const todoCalls = sessionCalls.get(todoId);
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
  ): () => void {
    if (!updateCallbacks.has(sessionId)) {
      updateCallbacks.set(sessionId, new Set());
    }

    const callbacks = updateCallbacks.get(sessionId)!;
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        updateCallbacks.delete(sessionId);
      }
    };
  }

  /**
   * Gets all tool calls for testing and debugging purposes
   */
  static getAllToolCallsForSession(
    sessionId: string,
  ): Map<string, TodoToolCalls> {
    const sessionCalls = toolCallsInMemory.get(sessionId);
    if (!sessionCalls) {
      return new Map();
    }
    return new Map(sessionCalls);
  }

  /**
   * Clears all tool calls for a session (for testing purposes)
   */
  static clearToolCallsForSession(sessionId: string): void {
    toolCallsInMemory.delete(sessionId);
    updateCallbacks.delete(sessionId);
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
  private static notifySubscribers(sessionId: string): void {
    const callbacks = updateCallbacks.get(sessionId);
    if (callbacks) {
      callbacks.forEach((callback) => callback());
    }
  }
}
