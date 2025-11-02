/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

describe('ToolCallTrackerService', () => {
  const sessionId = 'test-session';
  const todoId = 'test-todo';
  const secondaryAgentId = 'secondary-agent';

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Clear any existing executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);

    // Set up the context tracker for the default agent
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(todoId);
  });

  afterEach(() => {
    // Clear the context tracker states
    TodoContextTracker.forAgent(sessionId, DEFAULT_AGENT_ID).clearActiveTodo();
    TodoContextTracker.forAgent(sessionId, secondaryAgentId).clearActiveTodo();

    // Clear any executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);
    ToolCallTrackerService.clearToolCallsForSession(
      sessionId,
      secondaryAgentId,
    );
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
      DEFAULT_AGENT_ID,
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get all tool calls for the todo (should have 1 executing)
    let allCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');

    // Complete the tool call
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
      DEFAULT_AGENT_ID,
    );

    // Get all tool calls again (should still have 1, but now completed)
    allCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');
    expect(allCalls[0].parameters).toEqual({
      param1: 'value1',
      param2: 42,
    });
  });

  it('should not track a tool call when there is no active todo', () => {
    // Clear the active todo
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(null);

    // Try to start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'test_tool',
      {
        param1: 'value1',
      },
      DEFAULT_AGENT_ID,
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
      DEFAULT_AGENT_ID,
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get executing tool calls for the todo
    const executingCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
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
      DEFAULT_AGENT_ID,
    );

    // Verify we have one executing tool call
    let allCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(allCalls).toHaveLength(1);

    // Complete the tool call tracking
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
      DEFAULT_AGENT_ID,
    );

    // Verify the tool call is still there (now completed)
    allCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(allCalls).toHaveLength(1); // Still 1, but now in completed array
  });

  it('should fail tracking of executing tool calls', () => {
    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'failing_tool',
      { param: 'value' },
      DEFAULT_AGENT_ID,
    );

    // Verify we have one executing tool call
    let executingCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(executingCalls).toHaveLength(1);

    // Fail the tool call tracking
    ToolCallTrackerService.failToolCallTracking(
      sessionId,
      toolCallId!,
      DEFAULT_AGENT_ID,
    );

    // Verify the tool call is no longer executing
    executingCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(executingCalls).toHaveLength(0);
  });

  it('should isolate tool calls per agent namespace', async () => {
    const primaryTodoId = 'primary-todo';
    const secondaryTodoId = 'secondary-todo';

    TodoContextTracker.forAgent(sessionId, DEFAULT_AGENT_ID).setActiveTodo(
      primaryTodoId,
    );
    TodoContextTracker.forAgent(sessionId, secondaryAgentId).setActiveTodo(
      secondaryTodoId,
    );

    const primaryCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'primary_tool',
      { param: 'primary' },
      DEFAULT_AGENT_ID,
    );
    const secondaryCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'secondary_tool',
      { param: 'secondary' },
      secondaryAgentId,
    );

    const primaryCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      primaryTodoId,
      DEFAULT_AGENT_ID,
    );
    expect(primaryCalls).toHaveLength(1);
    expect(primaryCalls[0].name).toBe('primary_tool');

    const secondaryCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      secondaryTodoId,
      secondaryAgentId,
    );
    expect(secondaryCalls).toHaveLength(1);
    expect(secondaryCalls[0].name).toBe('secondary_tool');

    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      primaryCallId!,
      DEFAULT_AGENT_ID,
    );
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      secondaryCallId!,
      secondaryAgentId,
    );

    const completedPrimary = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      primaryTodoId,
      DEFAULT_AGENT_ID,
    );
    expect(completedPrimary).toHaveLength(1);
    expect(completedPrimary[0].name).toBe('primary_tool');

    const completedSecondary = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      secondaryTodoId,
      secondaryAgentId,
    );
    expect(completedSecondary).toHaveLength(1);
    expect(completedSecondary[0].name).toBe('secondary_tool');
  });
});
