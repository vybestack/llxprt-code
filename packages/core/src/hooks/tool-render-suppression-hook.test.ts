/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRenderSuppressionHook } from '../hooks/tool-render-suppression-hook.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { Config, ConfigParameters } from '../config/config.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

// Mock Config class
vi.mock('../config/config.js', () => ({
  Config: vi.fn().mockImplementation((params) => ({
    getSessionId: vi
      .fn()
      .mockReturnValue(params.sessionId || 'default-session'),
    getAgentId: vi.fn().mockReturnValue(params.agentId || DEFAULT_AGENT_ID),
  })),
}));

describe('ToolRenderSuppressionHook', () => {
  const sessionId = 'test-session';
  const todoId = 'test-todo';

  beforeEach(() => {
    // Reset the context tracker
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.clearActiveTodo();
  });

  it('should suppress rendering when there is an active todo', () => {
    // Set up the context tracker with an active todo
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(todoId);

    // Create a mock config
    const config = new Config({
      sessionId,
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: 'test-model',
      agentId: DEFAULT_AGENT_ID,
    } as ConfigParameters);

    // Check if rendering should be suppressed
    const shouldSuppress =
      ToolRenderSuppressionHook.shouldSuppressToolCallRender(config);

    expect(shouldSuppress).toBe(true);
  });

  it('should not suppress rendering when there is no active todo', () => {
    // Ensure there is no active todo
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.clearActiveTodo();

    // Create a mock config
    const config = new Config({
      sessionId,
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: 'test-model',
      agentId: DEFAULT_AGENT_ID,
    } as ConfigParameters);

    // Check if rendering should be suppressed
    const shouldSuppress =
      ToolRenderSuppressionHook.shouldSuppressToolCallRender(config);

    expect(shouldSuppress).toBe(false);
  });
});
