/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { TodoContextTracker } from '../services/todo-context-tracker.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

/**
 * Hook to determine if tool call rendering should be suppressed
 */
export class ToolRenderSuppressionHook {
  /**
   * Checks if tool call rendering should be suppressed for the current session
   * Tool calls are suppressed when there's an active todo, as they're displayed in the todo UI instead
   */
  static shouldSuppressToolCallRender(config: Config): boolean {
    // Get the session ID
    const sessionId =
      typeof config.getSessionId === 'function'
        ? config.getSessionId()
        : 'default';

    const agentAwareConfig = config as { getAgentId?: () => string };
    const agentId =
      typeof agentAwareConfig.getAgentId === 'function'
        ? agentAwareConfig.getAgentId()
        : DEFAULT_AGENT_ID;

    // Check if there's an active todo - if yes, suppress tool rendering
    // as it will be shown in the todo display instead
    const contextTracker = TodoContextTracker.forAgent(sessionId, agentId);
    return contextTracker.getActiveTodoId() !== null;
  }
}
