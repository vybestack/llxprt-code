/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';

describe('Todo Integration Test', () => {
  const sessionId = 'test-session';
  const todoId = 'test-todo';

  beforeEach(() => {
    // Reset the context tracker
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.setActiveTodo(null);
  });

  afterEach(() => {
    // Clear the context tracker
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.clearActiveTodo();

    // Clear any executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);
  });

  it('should track tool calls associated with active todo', async () => {
    // Set up the context tracker with an active todo
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.setActiveTodo(todoId);

    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'test_tool',
      { param: 'value' },
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get all tool calls for the todo
    const allCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);

    // Verify we have one executing tool call
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');
    expect(allCalls[0].parameters).toEqual({ param: 'value' });

    // Complete the tool call tracking
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
    );

    // Verify the tool call is still there (now completed)
    const updatedCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
    );
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0].name).toBe('test_tool');
  });
});
