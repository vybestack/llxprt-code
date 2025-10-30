/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

describe('Todo Integration Test', () => {
  const sessionId = 'test-session';
  const todoId = 'test-todo';
  const secondaryAgentId = 'secondary-agent';

  beforeEach(() => {
    // Reset the context tracker
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(null);
  });

  afterEach(() => {
    // Clear the context tracker
    TodoContextTracker.forAgent(sessionId, DEFAULT_AGENT_ID).clearActiveTodo();
    TodoContextTracker.forAgent(sessionId, secondaryAgentId).clearActiveTodo();

    // Clear any executing tool calls for this session
    ToolCallTrackerService.clearToolCallsForSession(sessionId);
    ToolCallTrackerService.clearToolCallsForSession(
      sessionId,
      secondaryAgentId,
    );
  });

  it('should track tool calls associated with active todo', async () => {
    // Set up the context tracker with an active todo
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(todoId);

    // Start tracking a tool call
    const toolCallId = ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'test_tool',
      { param: 'value' },
      DEFAULT_AGENT_ID,
    );

    // Verify we got a tool call ID
    expect(toolCallId).toBeTruthy();

    // Get all tool calls for the todo
    const allCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );

    // Verify we have one executing tool call
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].name).toBe('test_tool');
    expect(allCalls[0].parameters).toEqual({ param: 'value' });

    // Complete the tool call tracking
    await ToolCallTrackerService.completeToolCallTracking(
      sessionId,
      toolCallId!,
      DEFAULT_AGENT_ID,
    );

    // Verify the tool call is still there (now completed)
    const updatedCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      todoId,
      DEFAULT_AGENT_ID,
    );
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0].name).toBe('test_tool');
  });

  it('should keep tool calls isolated between agents', () => {
    const primaryTodo = 'primary-todo';
    const secondaryTodo = 'secondary-todo';

    TodoContextTracker.forAgent(sessionId, DEFAULT_AGENT_ID).setActiveTodo(
      primaryTodo,
    );
    TodoContextTracker.forAgent(sessionId, secondaryAgentId).setActiveTodo(
      secondaryTodo,
    );

    ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'primary_tool',
      { scope: 'primary' },
      DEFAULT_AGENT_ID,
    );
    ToolCallTrackerService.startTrackingToolCall(
      sessionId,
      'secondary_tool',
      { scope: 'secondary' },
      secondaryAgentId,
    );

    const primaryCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      primaryTodo,
      DEFAULT_AGENT_ID,
    );
    expect(primaryCalls).toHaveLength(1);
    expect(primaryCalls[0].name).toBe('primary_tool');

    const secondaryCalls = ToolCallTrackerService.getAllToolCalls(
      sessionId,
      secondaryTodo,
      secondaryAgentId,
    );
    expect(secondaryCalls).toHaveLength(1);
    expect(secondaryCalls[0].name).toBe('secondary_tool');
  });
});
