/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ToolRenderSuppressionHook } from '../hooks/tool-render-suppression-hook.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';
import type { Config } from '../config/config.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

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
    // Set up the context tracker with an active task
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.setActiveTodo(todoId);

    const config = {
      getSessionId: () => sessionId,
      getAgentId: () => DEFAULT_AGENT_ID,
    } as Config;

    // Check if rendering should be suppressed
    const shouldSuppress =
      ToolRenderSuppressionHook.shouldSuppressToolCallRender(config);

    expect(shouldSuppress).toBe(true);
  });

  it('should not suppress rendering when there is no active task', () => {
    // Ensure there is no active task
    const contextTracker = TodoContextTracker.forAgent(
      sessionId,
      DEFAULT_AGENT_ID,
    );
    contextTracker.clearActiveTodo();

    const config = {
      getSessionId: () => sessionId,
      getAgentId: () => DEFAULT_AGENT_ID,
    } as Config;

    // Check if rendering should be suppressed
    const shouldSuppress =
      ToolRenderSuppressionHook.shouldSuppressToolCallRender(config);

    expect(shouldSuppress).toBe(false);
  });
});
