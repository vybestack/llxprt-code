/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';

describe('ToolCallTrackerService', () => {
  const sessionId = 'test-session';
  const todoId = 'test-todo';

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Clear any existing executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);

    // Set up the context tracker
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.setActiveTodo(todoId);
  });

  afterEach(() => {
    // Clear the context tracker
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.clearActiveTodo();

    // Clear any executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);
  });

  it('should track and complete tool calls in memory', async () => {
    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'test_tool',
      {
        param1: 'value1',
        param2: 42,
      },
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get all tool calls for the todo (should have 1 executing)
    let allCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');

    // Complete the tool call
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
    );

    // Get all tool calls again (should still have 1, but now completed)
    allCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');
    expect(allCalls[0].parameters).toEqual({
      param1: 'value1',
      param2: 42,
    });
  });

  it('should not track a tool call when there is no active todo', () => {
    // Clear the active todo
    const contextTracker = TodoContextTracker.forSession(sessionId);
    contextTracker.setActiveTodo(null);

    // Try to start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'test_tool',
      {
        param1: 'value1',
      },
    );

    // Verify no tool call was tracked
    expect(toolCallId).toBeNull();
  });

  it('should track executing tool calls', () => {
    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'executing_tool',
      { param: 'value' },
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get executing tool calls for the todo
    const executingCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
    );

    // Verify we have one executing tool call
    expect(executingCalls).toHaveLength(1);
    expect(executingCalls[0].name).toBe('executing_tool');
    expect(executingCalls[0].parameters).toEqual({ param: 'value' });
  });

  it('should complete tracking of executing tool calls', async () => {
    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'completing_tool',
      { param: 'value' },
    );

    // Verify we have one executing tool call
    let allCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);
    expect(allCalls).toHaveLength(1);

    // Complete the tool call tracking
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
    );

    // Verify the tool call is still there (now completed)
    allCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);
    expect(allCalls).toHaveLength(1); // Still 1, but now in completed array
  });

  it('should fail tracking of executing tool calls', () => {
    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'failing_tool',
      { param: 'value' },
    );

    // Verify we have one executing tool call
    let executingCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
    );
    expect(executingCalls).toHaveLength(1);

    // Fail the tool call tracking
    ToolCallTrackerService.failToolCallTracking(sessionId, toolCallId!);

    // Verify the tool call is no longer executing
    executingCalls = ToolCallTrackerService.getAllToolCalls(sessionId, todoId);
    expect(executingCalls).toHaveLength(0);
  });
});
